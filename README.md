# excalidash-mcp

MCP server for live collaborative drawing on [ExcaliDash](https://github.com/ZimengXiong/ExcaliDash). Draw diagrams, brainstorm, and visualize ideas — changes appear instantly in the browser via Socket.IO.

https://github.com/user-attachments/assets/placeholder-demo.mp4

## Features

- **Live updates** — Elements appear instantly in open browsers, no refresh needed
- **Scene DSL** — Draw complex diagrams with a compact one-line-per-element syntax
- **Named Elements** — Give elements descriptive IDs (`rect frontend 100,100 ...`) for easy reference
- **Edit & Delete** — Modify or remove elements by name, live
- **Rename** — Rename cryptic auto-generated IDs to descriptive names
- **Version History** — Browse snapshots, restore previous versions (requires [ExcaliDash](https://github.com/ZimengXiong/ExcaliDash) with [PR #138](https://github.com/ZimengXiong/ExcaliDash/pull/138))
- **Token-efficient** — ~85% fewer tokens compared to raw Excalidraw JSON

## Prerequisites

You need a running [ExcaliDash](https://github.com/ZimengXiong/ExcaliDash) instance. ExcaliDash is a self-hosted Excalidraw dashboard with user management, REST API, and real-time collaboration.

### 1. Set up ExcaliDash

Follow the [ExcaliDash installation guide](https://github.com/ZimengXiong/ExcaliDash) to get your instance running. Typically:

```bash
git clone https://github.com/ZimengXiong/ExcaliDash.git
cd ExcaliDash
cp .env.example .env  # configure JWT_SECRET, CSRF_SECRET, etc.
docker compose up -d
```

### 2. No proxy config needed — use `/api`

**You do not need to write or mount an Nginx config.** The ExcaliDash frontend image already
proxies both routes this adapter needs, out of the box:

- `/api/` → the backend (the `/api` prefix is stripped, so `/api/drawings` reaches `/drawings`)
- `/socket.io/` → the backend, with WebSocket upgrade headers

So point `EXCALIDASH_BACKEND_URL` at `https://your-domain/api` and everything works through your
existing setup — no extra ports, no custom Nginx, no changes to your compose file.

> **Note:** earlier versions of this README told you to mount a custom `nginx.conf` at
> `/etc/nginx/conf.d/default.conf`. That advice was wrong. The frontend image renders its config to
> `/etc/nginx/nginx.conf` at startup and never includes `conf.d/`, so the mount silently does
> nothing. If you followed it, you can drop the mount.

### 3. Create an agent user

Create a dedicated user for the MCP adapter in ExcaliDash. This keeps agent actions separate from your personal account and shows up as a distinct collaborator on the board.

You can create a user via the ExcaliDash UI or API.

### 4. (Optional) Expose the backend port

Only relevant if the MCP adapter runs **on the same machine** as ExcaliDash and you want to skip the
Nginx hop:

```yaml
backend:
  ports:
    - "127.0.0.1:6768:8000"
```

Then use `EXCALIDASH_BACKEND_URL=http://127.0.0.1:6768` instead of the `/api` URL. If the backend
runs with `TRUST_PROXY`, also set `EXCALIDASH_PROXY_PROTO` and `EXCALIDASH_PROXY_HOST` — otherwise
it answers with a 302 to your public URL.

## Installation

```bash
git clone https://github.com/davifernan/excalidash-mcp.git
cd excalidash-mcp
npm install
```

## Configuration

Add to your MCP client config (e.g. `~/.mcp.json` for Claude Code).

### Recommended — MCP client anywhere, ExcaliDash behind a domain

This is the usual case: ExcaliDash runs on a server, your MCP client runs on your laptop. Both URLs
are your public domain; the backend is reached through the frontend's built-in `/api` proxy.

```json
{
  "mcpServers": {
    "excalidash": {
      "command": "node",
      "args": ["/path/to/excalidash-mcp/src/index.js"],
      "env": {
        "EXCALIDASH_BACKEND_URL": "https://draw.example.com/api",
        "EXCALIDASH_URL": "https://draw.example.com",
        "EXCALIDASH_EMAIL": "agent@example.com",
        "EXCALIDASH_PASSWORD": "your-agent-password"
      }
    }
  }
}
```

Nothing else is required — no exposed backend port and no custom proxy rules.

### Same-host — MCP client on the ExcaliDash machine

Slightly lower latency, but needs the backend port exposed (see step 4 above). If the backend runs
with `TRUST_PROXY`, the proxy hints are required or it will answer with redirects:

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

## Tools

### Drawing (token-efficient)

| Tool | Description |
|------|-------------|
| `read_me` | Element format cheat sheet — call once before drawing |
| `draw_scene` | Compact DSL — one element per line, `mode=append` or `mode=replace` |

### Scene DSL

Draw multiple elements in a single call with minimal tokens. **Always give elements descriptive IDs** — this makes updating and deleting easy:

```
# Comments start with #
text title 250,20 size=28 color=blue 'System Architecture'

rect frontend 100,100 200x100 color=blue fill=blue 'Frontend'
rect backend 400,100 200x100 color=green fill=green 'Backend'
arrow fe-to-be 300,150 -> 400,150 color=gray style=dashed 'API'

diamond cache 250,280 120x80 color=orange fill=orange
circle queue 500,280 80x80 color=purple fill=purple
```

**Supported types:** `rect`, `circle`, `diamond`, `arrow`, `line`, `text`

**Colors:** `red`, `blue`, `green`, `orange`, `purple`, `pink`, `yellow`, `gray`, `black` — or any hex code (`#e03131`)

**Arrow options:** `style=dashed`, `start=arrow`, `end=triangle`

### Board Management

| Tool | Description |
|------|-------------|
| `list_boards` | List all boards |
| `create_board` | Create a new board |
| `read_board` | Read elements with IDs (for editing) |
| `clear_board` | Remove all elements |

### Editing

| Tool | Description |
|------|-------------|
| `update_element` | Change any property by element name/ID |
| `delete_elements` | Delete specific elements by name/ID |
| `rename_element` | Rename a cryptic ID to a descriptive name (updates all references) |

### Version History

Requires [ExcaliDash](https://github.com/ZimengXiong/ExcaliDash) with [PR #138](https://github.com/ZimengXiong/ExcaliDash/pull/138) (pending merge).

| Tool | Description |
|------|-------------|
| `board_history` | List version snapshots (ID + timestamp) |
| `restore_version` | Restore a board to a previous snapshot (reversible) |

### Export

| Tool | Description |
|------|-------------|
| `export_png` | Render a board to a PNG screenshot (headless Chromium via Playwright) |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EXCALIDASH_BACKEND_URL` | Yes | Where the backend is reachable — `https://draw.example.com/api` (through the frontend proxy) or `http://127.0.0.1:6768` (direct). A path prefix like `/api` is supported and is applied to Socket.IO too. |
| `EXCALIDASH_URL` | Yes | Public frontend URL, used to build board links (e.g. `https://draw.example.com`) |
| `EXCALIDASH_EMAIL` | Yes | Agent user email |
| `EXCALIDASH_PASSWORD` | Yes | Agent user password |
| `EXCALIDASH_PROXY_PROTO` | No | Set to `https` when talking to a `TRUST_PROXY` backend directly, to avoid redirects |
| `EXCALIDASH_PROXY_HOST` | No | Hostname for the `Host` header in the same case |

## Troubleshooting

**`Expected JSON from … but got HTML`** — the URL in `EXCALIDASH_BACKEND_URL` is being answered by
the frontend instead of the backend. Almost always a missing `/api` suffix. Verify with:

```bash
curl -sS https://draw.example.com/api/health    # → {"status":"ok"}
curl -sS https://draw.example.com/health        # → HTML, this is expected
```

**Login fails with a 302 / redirect** — you are pointing at the backend directly while it runs with
`TRUST_PROXY`. Add `EXCALIDASH_PROXY_PROTO=https` and `EXCALIDASH_PROXY_HOST=your-domain`, or switch
to the `/api` URL.

**REST works but nothing appears live** — Socket.IO isn't getting through. Your proxy must forward
`/socket.io/` with the `Upgrade`/`Connection` headers. The stock frontend image does this already;
custom proxies in front of it (Cloudflare, Traefik, another Nginx) need WebSockets enabled.

### Running on a PaaS (Coolify, Dokku, …)

The `/api` setup above needs no platform-specific work. If your platform puts its own proxy in front
of ExcaliDash, the things worth knowing are that the platform usually wants to own Docker networking
(a custom `networks:` block can isolate your containers from the platform proxy and produce a 504),
and that Docker Compose interpolates `$` inside inline `configs:` blocks.

[@dadof3bytes](https://github.com/dadof3bytes) wrote up a detailed Coolify field guide in
[issue #1](https://github.com/davifernan/excalidash-mcp/issues/1) — worth reading if you deploy
there.

## How it works

```
Claude / AI Agent
       │
       │ MCP tool calls (draw_scene, update_element, etc.)
       ▼
┌─────────────────┐
│  excalidash-mcp │  ← enriches elements, calculates text dimensions
│  (MCP Server)   │
└───────┬─────────┘
        │
   ┌────┴────┐
   │         │
   ▼         ▼
Socket.IO   REST API
(live)      (persist)
   │         │
   └────┬────┘
        ▼
┌─────────────────┐
│   ExcaliDash    │  ← self-hosted Excalidraw dashboard
│   Backend       │
└───────┬─────────┘
        │
        ▼
   Browser(s)  ← instant live updates, no refresh
```

## License

MIT
