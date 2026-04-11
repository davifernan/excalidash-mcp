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
import { BaseProvider } from "./base.js";

export class ExcaliDashProvider extends BaseProvider {
  constructor(opts = {}) {
    super();
    this.backendUrl = opts.backendUrl || process.env.EXCALIDASH_BACKEND_URL || "http://127.0.0.1:6768";
    this.publicUrl = opts.publicUrl || process.env.EXCALIDASH_URL || "http://localhost:6767";
    this.email = opts.email || process.env.EXCALIDASH_EMAIL || "";
    this.password = opts.password || process.env.EXCALIDASH_PASSWORD || "";

    // Optional proxy headers (needed when TRUST_PROXY=true on backend)
    const proto = opts.proxyProto || process.env.EXCALIDASH_PROXY_PROTO || "";
    const host = opts.proxyHost || process.env.EXCALIDASH_PROXY_HOST || "";
    this.proxyHeaders = {};
    if (proto) this.proxyHeaders["X-Forwarded-Proto"] = proto;
    if (host) this.proxyHeaders["Host"] = host;

    this.authToken = null;
    this.csrfToken = null;
    this.authCookies = [];
    this.socket = null;
    this.joinedRooms = new Set();
  }

  get supportsLive() { return true; }

  getUrl(drawingId) { return `${this.publicUrl}/editor/${drawingId}`; }

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
      headers: { ...this.proxyHeaders, "Cookie": this.#getCookieHeader() },
    });
    const data = await res.json();
    this.csrfToken = data.token;
    this.authCookies.push(...(res.headers.getSetCookie?.() || []));
  }

  async #login() {
    if (this.authToken) { await this.#refreshCsrf(); return; }

    const csrfRes = await fetch(`${this.backendUrl}/csrf-token`, { headers: this.proxyHeaders });
    const csrfData = await csrfRes.json();
    this.csrfToken = csrfData.token;
    this.authCookies = csrfRes.headers.getSetCookie?.() || [];

    const loginRes = await fetch(`${this.backendUrl}/auth/login`, {
      method: "POST",
      headers: { ...this.proxyHeaders, "Content-Type": "application/json", "x-csrf-token": this.csrfToken, "Cookie": this.#getCookieHeader() },
      body: JSON.stringify({ email: this.email, password: this.password }),
    });
    if (!loginRes.ok) throw new Error(`Login failed: ${loginRes.status}`);

    const loginCookies = loginRes.headers.getSetCookie?.() || [];
    this.authCookies.push(...loginCookies);
    const ac = loginCookies.find(c => c.startsWith("excalidash-access-token="));
    if (ac) this.authToken = ac.split("=")[1].split(";")[0];
    if (!this.authToken) throw new Error("No auth token received");
    await this.#refreshCsrf();
  }

  // --- REST ---
  async #get(path) {
    await this.#login();
    const res = await fetch(`${this.backendUrl}${path}`, {
      headers: { ...this.proxyHeaders, "Cookie": this.#getCookieHeader() },
    });
    if (!res.ok) return null;
    return res.json();
  }

  async #post(path, body) {
    await this.#login();
    const res = await fetch(`${this.backendUrl}${path}`, {
      method: "POST",
      headers: { ...this.proxyHeaders, "Content-Type": "application/json", "x-csrf-token": this.csrfToken, "Cookie": this.#getCookieHeader() },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path}: ${res.status}`);
    return res.json();
  }

  async #put(path, body) {
    await this.#login();
    const res = await fetch(`${this.backendUrl}${path}`, {
      method: "PUT",
      headers: { ...this.proxyHeaders, "Content-Type": "application/json", "x-csrf-token": this.csrfToken, "Cookie": this.#getCookieHeader() },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PUT ${path}: ${res.status}`);
    return res.json();
  }

  // --- Socket.IO ---
  async #getSocket() {
    if (this.socket?.connected) return this.socket;
    await this.#login();
    this.socket = io(this.backendUrl, {
      auth: { token: this.authToken },
      transports: ["websocket", "polling"],
      extraHeaders: { ...this.proxyHeaders, "Cookie": this.#getCookieHeader() },
      reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 1000,
    });
    this.socket.on("disconnect", () => this.joinedRooms.clear());
    return new Promise((resolve, reject) => {
      this.socket.on("connect", () => resolve(this.socket));
      this.socket.on("connect_error", (err) => reject(new Error(`Socket: ${err.message}`)));
      setTimeout(() => reject(new Error("Socket timeout")), 5000);
    });
  }

  // --- Provider interface ---
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

  async pushLive(drawingId, elements, elementOrder) {
    const sock = await this.#getSocket();
    sock.emit("element-update", { drawingId, elements, elementOrder, userId: "excalidraw-mcp" });
  }
}
