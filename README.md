# excalidash-mcp

MCP server for live collaborative drawing on [ExcaliDash](https://github.com/ZimengXiong/ExcaliDash). Draw diagrams, brainstorm, and visualize ideas — changes appear instantly in the browser via Socket.IO.

https://github.com/user-attachments/assets/placeholder-demo.mp4

## Features

- **Live updates** — Elements appear instantly in open browsers, no refresh needed
- **High-level tools** — `add_text`, `add_shape`, `add_arrow` with minimal tokens
- **Scene DSL** — Draw complex diagrams with a compact one-line-per-element syntax
- **Edit & Delete** — Modify or remove individual elements by ID, live
- **Library** — Search and place icons/templates from your ExcaliDash library
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

### 2. Configure Nginx (important!)

The default ExcaliDash frontend Nginx config does **not** proxy `/api/` and `/socket.io/` to the backend. You need to add these proxy rules for the MCP adapter (and live collaboration) to work.

Create a custom `nginx.conf` and mount it into the frontend container:

```nginx
server {
    listen 80;
    server_name localhost;

    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://backend:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend routes (auth, drawings, etc.)
    location ~ ^/(auth|csrf-token|drawings|health|collections|admin) {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Socket.IO (live collaboration)
    location /socket.io/ {
        proxy_pass http://backend:8000/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

Mount it in your `docker-compose.yml`:

```yaml
frontend:
  image: zimengxiong/excalidash-frontend:latest
  volumes:
    - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
```

### 3. Create an agent user

Create a dedicated user for the MCP adapter in ExcaliDash. This keeps agent actions separate from your personal account and shows up as a distinct collaborator on the board.

You can create a user via the ExcaliDash UI or API.

### 4. (Optional) Expose backend port

If the MCP adapter runs on the same machine as ExcaliDash, expose the backend port for direct access (faster than going through Nginx):

```yaml
backend:
  ports:
    - "127.0.0.1:6768:8000"
```

## Installation

```bash
git clone https://github.com/davifernan/excalidash-mcp.git
cd excalidash-mcp
npm install
```

## Configuration

Add to your MCP client config (e.g. `~/.mcp.json` for Claude Code):

```json
{
  "mcpServers": {
    "excalidash": {
      "command": "node",
      "args": ["/path/to/excalidash-mcp/src/index.js"],
      "env": {
        "EXCALIDASH_BACKEND_URL": "http://127.0.0.1:6768",
        "EXCALIDASH_URL": "https://your-excalidash.example.com",
        "EXCALIDASH_EMAIL": "agent@example.com",
        "EXCALIDASH_PASSWORD": "your-agent-password"
      }
    }
  }
}
```

### Behind a reverse proxy?

If your ExcaliDash backend has `TRUST_PROXY=true` (common when behind Nginx/Cloudflare), add these to prevent redirect loops:

```json
{
  "env": {
    "EXCALIDASH_PROXY_PROTO": "https",
    "EXCALIDASH_PROXY_HOST": "your-excalidash.example.com"
  }
}
```

## Tools

### Drawing (token-efficient)

| Tool | Description |
|------|-------------|
| `add_text` | Add text with position, color, size, font |
| `add_shape` | Add rectangle/ellipse/diamond with optional label |
| `add_arrow` | Arrow with head styles (arrow/bar/dot/triangle/none), line styles (solid/dashed/dotted) |
| `draw_scene` | Compact DSL — one element per line |

### Scene DSL

Draw multiple elements in a single call with minimal tokens:

```
# Comments start with #
text 250,20 size=28 color=blue 'System Architecture'

rect 100,100 200x100 color=blue fill=blue 'Frontend'
rect 400,100 200x100 color=green fill=green 'Backend'
arrow 300,150 -> 400,150 color=gray style=dashed 'API'

diamond 250,280 120x80 color=orange fill=orange
circle 500,280 80x80 color=purple fill=purple
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
| `update_element` | Change any property by element ID |
| `delete_elements` | Delete specific elements by ID |

### Library

| Tool | Description |
|------|-------------|
| `get_library` | Search available icons/templates by name |
| `add_from_library` | Place a library item on the board |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EXCALIDASH_BACKEND_URL` | Yes | Backend API URL (e.g. `http://127.0.0.1:6768`) |
| `EXCALIDASH_URL` | Yes | Public frontend URL (e.g. `https://draw.example.com`) |
| `EXCALIDASH_EMAIL` | Yes | Agent user email |
| `EXCALIDASH_PASSWORD` | Yes | Agent user password |
| `EXCALIDASH_PROXY_PROTO` | No | Set to `https` if behind reverse proxy with `TRUST_PROXY=true` |
| `EXCALIDASH_PROXY_HOST` | No | Hostname for proxy `Host` header |

## How it works

```
Claude / AI Agent
       │
       │ MCP tool calls (add_text, draw_scene, etc.)
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
