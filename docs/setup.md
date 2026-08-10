# Setup

## 1. An ExcaliDash instance

Follow the [ExcaliDash installation guide](https://github.com/ZimengXiong/ExcaliDash). Typically:

```bash
git clone https://github.com/ZimengXiong/ExcaliDash.git
cd ExcaliDash
cp .env.example .env   # configure JWT_SECRET, CSRF_SECRET, etc.
docker compose up -d
```

## 2. Reaching the backend: use `/api`

**No proxy configuration is needed.** The ExcaliDash frontend image already proxies the two routes
this adapter uses:

- `/api/` → the backend, with the `/api` prefix stripped, so `/api/drawings` reaches `/drawings`
- `/socket.io/` → the backend, with WebSocket upgrade headers

So set `EXCALIDASH_BACKEND_URL` to `https://your-domain/api` and everything works through your
existing setup. No extra ports, no custom Nginx, no compose changes.

Verify it:

```bash
curl -sS https://draw.example.com/api/health    # → {"status":"ok"}
curl -sS https://draw.example.com/health        # → HTML. This is expected.
```

> [!WARNING]
> Earlier versions of this project's README told you to mount a custom `nginx.conf` at
> `/etc/nginx/conf.d/default.conf`. That advice was wrong. The frontend image renders its config to
> `/etc/nginx/nginx.conf` at startup and never includes `conf.d/`, so the mount silently does
> nothing, and the image has proxied both routes all along. If you followed it, drop the mount.

## 3. An agent user

Create a dedicated ExcaliDash account for the adapter, through the UI or the API. Its actions then
show up as a distinct collaborator on the board and stay separate from your own account.

That separation has a consequence worth knowing before you hit it: **boards the agent creates belong
to the agent's account**, and your own account cannot see them. The link the agent hands you will not
open. Two ways round it:

- Ask the agent to share the finished board: `share_board(board_id, with="you@example.com")`.
- Or set `EXCALIDASH_SHARE_WITH` to your address, and every board it creates is shared with you from
  the moment it exists.

Both need the recipient to have an account on the same instance. See
[Sharing](../README.md#sharing).

## 4. Optional: the same-host route

If the MCP server runs on the same machine as ExcaliDash, you can skip the Nginx hop by exposing the
backend port:

```yaml
backend:
  ports:
    - "127.0.0.1:6768:8000"
```

```json
{
  "env": {
    "EXCALIDASH_BACKEND_URL": "http://127.0.0.1:6768",
    "EXCALIDASH_URL": "https://draw.example.com",
    "EXCALIDASH_EMAIL": "agent@example.com",
    "EXCALIDASH_PASSWORD": "your-agent-password",
    "EXCALIDASH_PROXY_PROTO": "https",
    "EXCALIDASH_PROXY_HOST": "draw.example.com"
  }
}
```

The two proxy hints are required here: a backend running with `TRUST_PROXY` answers plain HTTP with a
302 to your public URL.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EXCALIDASH_BACKEND_URL` | Yes | Where the backend is reachable: `https://draw.example.com/api` through the frontend proxy, or `http://127.0.0.1:6768` direct. A path prefix like `/api` is supported and is applied to Socket.IO too. |
| `EXCALIDASH_URL` | Yes | Public frontend URL, used to build board links |
| `EXCALIDASH_EMAIL` | Yes | Agent user email |
| `EXCALIDASH_PASSWORD` | Yes | Agent user password |
| `EXCALIDASH_PROXY_PROTO` | No | Set to `https` when talking to a `TRUST_PROXY` backend directly |
| `EXCALIDASH_PROXY_HOST` | No | Hostname for the `Host` header in the same case |
| `EXCALIDASH_SHARE_WITH` | No | Share every new board with this person: an email address or user id, optionally `:view` or `:edit` (default `edit`) |

## Running on a PaaS (Coolify, Dokku, …)

The `/api` setup needs no platform-specific work. If your platform runs its own proxy in front of
ExcaliDash, two things are worth knowing: the platform usually wants to own Docker networking, so a
custom `networks:` block can isolate your containers from the platform proxy and produce a 504. Also,
Docker Compose interpolates `$` inside inline `configs:` blocks.

[@dadof3bytes](https://github.com/dadof3bytes) wrote a detailed Coolify field guide in
[issue #1](https://github.com/davifernan/excalidash-mcp/issues/1), worth reading if you deploy there.

## Screenshots

`export_png` renders through Excalidraw's own export, which needs a headless browser:

```bash
npx playwright install chromium
```
