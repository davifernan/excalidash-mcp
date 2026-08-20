/**
 * ExcaliDash provider — REST API + Socket.IO live updates.
 *
 * Env vars:
 *   EXCALIDASH_BACKEND_URL  (default: http://127.0.0.1:6768)
 *   EXCALIDASH_URL          (default: http://localhost:6767)
 *   EXCALIDASH_EMAIL
 *   EXCALIDASH_PASSWORD
 *   EXCALIDASH_PROXY_PROTO  (optional: "https" if behind reverse proxy with TRUST_PROXY)
 *   EXCALIDASH_PROXY_HOST   (optional: hostname for Host header)
 */
import { io } from "socket.io-client";

export class ExcaliDashProvider {
  constructor(opts = {}) {
    // Trailing slashes would produce "//csrf-token" once a path is appended.
    const rawBackend = opts.backendUrl || process.env.EXCALIDASH_BACKEND_URL || "http://127.0.0.1:6768";
    this.backendUrl = rawBackend.replace(/\/+$/, "");
    this.publicUrl = (opts.publicUrl || process.env.EXCALIDASH_URL || "http://localhost:6767").replace(/\/+$/, "");
    // An API key is the preferred credential: it needs no login round trip,
    // no CSRF token and no cookie jar, and it is revocable on its own.
    this.apiKey = opts.apiKey || process.env.EXCALIDASH_API_KEY || "";
    // Email and password stay supported for instances without API keys.
    this.email = opts.email || process.env.EXCALIDASH_EMAIL || "";
    this.password = opts.password || process.env.EXCALIDASH_PASSWORD || "";

    // Optional proxy headers (needed when TRUST_PROXY=true on backend)
    const proto = opts.proxyProto || process.env.EXCALIDASH_PROXY_PROTO || "";
    const host = opts.proxyHost || process.env.EXCALIDASH_PROXY_HOST || "";
    this.proxyHeaders = {};
    if (proto) this.proxyHeaders["X-Forwarded-Proto"] = proto;
    if (host) this.proxyHeaders["Host"] = host;

    if (!this.apiKey && !(this.email && this.password)) {
      throw new Error(
        "No credentials: set EXCALIDASH_API_KEY (create one under Profile > API keys), " +
        "or EXCALIDASH_EMAIL and EXCALIDASH_PASSWORD."
      );
    }

    this.authToken = null;
    this.csrfToken = null;
    this.authCookies = [];
    this.socket = null;
    this.joinedRooms = new Set();
    // Who we are signed in as. Sharing needs it: the instance hides the current
    // user from its own lookup, so "share with the agent's own account" would
    // otherwise come back as an unhelpful "no such user".
    this.user = null;

    // Socket.IO must be given an origin, never a URL with a path: io() would read
    // the path as a namespace. When the backend is reached through a prefix
    // (EXCALIDASH_BACKEND_URL=https://draw.example.com/api), that prefix belongs
    // in the engine.io path instead.
    const parsed = new URL(this.backendUrl);
    this.socketOrigin = parsed.origin;
    this.socketPath = `${parsed.pathname.replace(/\/+$/, "")}/socket.io/`;
  }

  getUrl(drawingId) { return `${this.publicUrl}/editor/${drawingId}`; }

  /** Credentials for a REST call: a bearer key, or the cookie session. */
  #authHeaders(extra = {}) {
    if (this.apiKey) {
      return { ...this.proxyHeaders, Authorization: `Bearer ${this.apiKey}`, ...extra };
    }
    // CSRF only guards cookie sessions; key requests are exempt server-side.
    const csrf = this.csrfToken ? { "x-csrf-token": this.csrfToken } : {};
    return { ...this.proxyHeaders, Cookie: this.#getCookieHeader(), ...csrf, ...extra };
  }

  /**
   * Parse a backend response as JSON, with a useful error when it isn't.
   *
   * A misconfigured reverse proxy serves the frontend SPA (200 + index.html)
   * for backend paths instead of forwarding them, so `res.json()` fails with a
   * bare "Unexpected token '<'". Name the actual cause instead.
   */
  async #json(res, path) {
    const body = await res.text();
    try {
      return JSON.parse(body);
    } catch {
      const looksLikeHtml = /^\s*<(!doctype|html)/i.test(body);
      if (looksLikeHtml) {
        throw new Error(
          `Expected JSON from ${this.backendUrl}${path} but got HTML — that URL is being answered ` +
          `by the ExcaliDash frontend, not the backend. Set EXCALIDASH_BACKEND_URL to your ` +
          `instance's /api path (e.g. https://draw.example.com/api), which the frontend proxies ` +
          `to the backend. Verify with: curl -sS <your-url>/health`
        );
      }
      throw new Error(`Invalid JSON from ${this.backendUrl}${path} (HTTP ${res.status}): ${body.slice(0, 120)}`);
    }
  }

  // --- Auth ---
  #getCookieHeader() {
    const seen = new Map();
    for (const c of this.authCookies) {
      const clean = c.split(";")[0];
      const name = clean.split("=")[0];
      seen.set(name, clean);
    }
    return [...seen.values()].join("; ");
  }

  async #refreshCsrf() {
    const res = await fetch(`${this.backendUrl}/csrf-token`, {
      headers: this.#authHeaders(),
    });
    const data = await this.#json(res, "/csrf-token");
    this.csrfToken = data.token;
    this.authCookies.push(...(res.headers.getSetCookie?.() || []));
  }

  async #login() {
    // A key authenticates every request on its own; there is nothing to log in to.
    if (this.apiKey) return;
    if (this.authToken) { await this.#refreshCsrf(); return; }

    const csrfRes = await fetch(`${this.backendUrl}/csrf-token`, { headers: this.proxyHeaders });
    const csrfData = await this.#json(csrfRes, "/csrf-token");
    this.csrfToken = csrfData.token;
    this.authCookies = csrfRes.headers.getSetCookie?.() || [];

    const loginRes = await fetch(`${this.backendUrl}/auth/login`, {
      method: "POST",
      headers: { ...this.proxyHeaders, "Content-Type": "application/json", "x-csrf-token": this.csrfToken, "Cookie": this.#getCookieHeader() },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);

    this.user = (await loginRes.clone().json().catch(() => null))?.user ?? null;

    const loginCookies = loginRes.headers.getSetCookie?.() || [];
    this.authCookies.push(...loginCookies);
    const ac = loginCookies.find(c => c.startsWith("excalidash-access-token="));
    if (ac) this.authToken = ac.split("=")[1].split(";")[0];
    if (!this.authToken) {
      // A proxy serving the SPA answers /auth/login with 200 + HTML and no cookies
      if (/text\/html/i.test(loginRes.headers.get("content-type") || "")) {
        throw new Error(
          `Login to ${this.backendUrl}/auth/login returned HTML instead of an auth cookie — ` +
          `EXCALIDASH_BACKEND_URL points at the frontend. Use your instance's /api path instead.`
        );
      }
      throw new Error("No auth token received");
    }
    await this.#refreshCsrf();
  }

  // --- REST ---
  async #reauth() {
    this.authToken = null;
    this.csrfToken = null;
    this.authCookies = [];
    if (this.socket) { this.socket.disconnect(); this.socket = null; this.joinedRooms.clear(); }
    await this.#login();
  }

  async #get(path) {
    await this.#login();
    let res = await fetch(`${this.backendUrl}${path}`, {
      headers: this.#authHeaders(),
    });
    if (res.status === 401 || res.status === 403) {
      await this.#reauth();
      res = await fetch(`${this.backendUrl}${path}`, {
        headers: this.#authHeaders(),
      });
    }
    if (!res.ok) return null;
    return this.#json(res, path);
  }

  async #post(path, body) {
    await this.#login();
    let res = await fetch(`${this.backendUrl}${path}`, {
      method: "POST",
      headers: this.#authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) {
      await this.#reauth();
      res = await fetch(`${this.backendUrl}${path}`, {
        method: "POST",
        headers: this.#authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
    }
    if (!res.ok) throw await this.#fail(res, "POST", path);
    return this.#json(res, path);
  }

  /**
   * Turn a failed response into an error that names the reason.
   *
   * The status alone is not enough for sharing: granting access answers 404
   * both for "you don't own this board" and for "no such user", and the two
   * need very different advice. The body separates them.
   */
  async #fail(res, method, path) {
    const text = await res.text().catch(() => "");
    let reason = "";
    try {
      const body = JSON.parse(text);
      reason = body?.message || body?.error || "";
    } catch {
      reason = text.slice(0, 120);
    }
    return new Error(`${method} ${path}: ${res.status}${reason ? ` — ${reason}` : ""}`);
  }

  /**
   * A GET whose failure is not allowed to look like an empty result.
   *
   * The forgiving #get answers null for every non-2xx, which is harmless when
   * a missing board means "no board". It is not harmless for sharing: a 500
   * while reading who a board is shared with would read as "shared with
   * nobody", and revoking would then report that there was nothing to revoke
   * while the access quietly stayed in place.
   */
  async #getStrict(path) {
    await this.#login();
    const send = () => fetch(`${this.backendUrl}${path}`, {
      headers: this.#authHeaders(),
    });
    let res = await send();
    if (res.status === 401 || res.status === 403) {
      await this.#reauth();
      res = await send();
    }
    if (!res.ok) throw await this.#fail(res, "GET", path);
    return this.#json(res, path);
  }

  async #delete(path) {
    await this.#login();
    const send = () => fetch(`${this.backendUrl}${path}`, {
      method: "DELETE",
      headers: this.#authHeaders(),
    });
    let res = await send();
    if (res.status === 401 || res.status === 403) {
      await this.#reauth();
      res = await send();
    }
    if (!res.ok) throw await this.#fail(res, "DELETE", path);
    return this.#json(res, path);
  }

  async #put(path, body) {
    await this.#login();
    let res = await fetch(`${this.backendUrl}${path}`, {
      method: "PUT",
      headers: this.#authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (res.status === 401 || res.status === 403) {
      await this.#reauth();
      res = await fetch(`${this.backendUrl}${path}`, {
        method: "PUT",
        headers: this.#authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      });
    }
    if (!res.ok) throw new Error(`PUT ${path}: ${res.status}`);
    return this.#json(res, path);
  }

  // --- Socket.IO ---
  async #getSocket() {
    if (this.socket?.connected) return this.socket;
    await this.#login();
    this.socket = io(this.socketOrigin, {
      path: this.socketPath,
      // The server accepts either an API key or an access token here.
      auth: { token: this.apiKey || this.authToken },
      transports: ["websocket", "polling"],
      extraHeaders: this.apiKey
        ? { ...this.proxyHeaders }
        : { ...this.proxyHeaders, Cookie: this.#getCookieHeader() },
      reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 1000,
    });
    this.socket.on("disconnect", () => this.joinedRooms.clear());
    return new Promise((resolve, reject) => {
      this.socket.on("connect", () => resolve(this.socket));
      this.socket.on("connect_error", (err) => reject(new Error(`Socket: ${err.message}`)));
      setTimeout(() => reject(new Error("Socket timeout")), 5000);
    });
  }

  // --- API ---
  async getDrawing(id) { return this.#get(`/drawings/${id}`); }
  async createDrawing(name, elements, appState = {}, files = {}) {
    return this.#post("/drawings", { name, elements, appState, files });
  }
  async updateDrawing(id, elements) { return this.#put(`/drawings/${id}`, { elements }); }
  async listDrawings() {
    const data = await this.#get("/drawings");
    return data?.drawings || [];
  }
  async getLibrary() {
    const data = await this.#get("/library");
    return data?.items || [];
  }
  async getDrawingHistory(id, limit = 50) {
    return this.#get(`/drawings/${id}/history?limit=${limit}`);
  }
  async getDrawingSnapshot(drawingId, snapshotId) {
    return this.#get(`/drawings/${drawingId}/history/${snapshotId}`);
  }
  async restoreSnapshot(drawingId, snapshotId) {
    return this.#post(`/drawings/${drawingId}/history/${snapshotId}/restore`, {});
  }

  // --- Sharing ---
  //
  // All four are owner-only on the instance: they answer 404 when the signed-in
  // account does not own the drawing, which is the normal case for a board the
  // agent was merely invited to.

  /** Who we are signed in as, once the session exists. */
  async whoAmI() {
    await this.#login();
    // With a key there is no login response to learn the identity from, so ask.
    if (!this.user && this.apiKey) {
      this.user = (await this.#get("/auth/me"))?.user ?? null;
    }
    return this.user;
  }

  /** Candidate users for a name or address. Ignores queries under 3 characters. */
  async findUsers(drawingId, query) {
    const data = await this.#getStrict(
      `/drawings/${drawingId}/share-resolve?q=${encodeURIComponent(query)}`,
    );
    return data?.users || [];
  }

  /** Everyone this drawing is shared with, plus any active link policy. */
  async getSharing(drawingId) {
    const data = await this.#getStrict(`/drawings/${drawingId}/sharing`);
    return { permissions: data?.permissions || [], linkShares: data?.linkShares || [] };
  }

  async grantAccess(drawingId, granteeUserId, permission) {
    const data = await this.#post(`/drawings/${drawingId}/permissions`, {
      granteeUserId,
      permission,
    });
    return data?.permission || null;
  }

  async revokeAccess(drawingId, permissionId) {
    return this.#delete(`/drawings/${drawingId}/permissions/${permissionId}`);
  }

  async joinRoom(drawingId) {
    if (this.joinedRooms.has(drawingId)) return;
    const sock = await this.#getSocket();
    return new Promise((resolve) => {
      sock.emit("join-room", { drawingId, user: { name: "Excalidraw-MCP", color: "#1971c2" } }, (ack) => {
        this.joinedRooms.add(drawingId);
        resolve(ack);
      });
      setTimeout(() => { this.joinedRooms.add(drawingId); resolve(); }, 2000);
    });
  }

  /** Close the Socket.IO connection so the process can exit. */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.joinedRooms.clear();
    }
  }

  async pushLive(drawingId, elements, elementOrder) {
    const sock = await this.#getSocket();
    sock.emit("element-update", { drawingId, elements, elementOrder, userId: "excalidraw-mcp" });
  }
}
