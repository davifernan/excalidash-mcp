# excalidraw-mcp

MCP server for drawing on Excalidraw & ExcaliDash — with live updates via Socket.IO.

## Features

- **High-level tools**: `add_text`, `add_shape`, `add_arrow` — minimal tokens
- **Scene DSL**: Draw complex diagrams with a compact one-line-per-element syntax
- **Live updates**: Changes appear instantly in open browsers (ExcaliDash)
- **File mode**: Read/write `.excalidraw` JSON files (vanilla Excalidraw)
- **Library**: Search and place library icons/templates
- **Edit/Delete**: Modify or remove individual elements by ID

## Providers

| Provider | Live | Backend | Use case |
|----------|------|---------|----------|
| `excalidash` | Yes (Socket.IO) | ExcaliDash server | Collaborative live whiteboarding |
| `file` | No | None | Offline diagrams, CI/CD, export |

## Quick Start

### ExcaliDash (live)

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["path/to/excalidraw-mcp/src/index.js"],
      "env": {
        "EXCALIDASH_BACKEND_URL": "http://127.0.0.1:8000",
        "EXCALIDASH_URL": "https://your-excalidash.example.com",
        "EXCALIDASH_EMAIL": "user@example.com",
        "EXCALIDASH_PASSWORD": "password"
      }
    }
  }
}
```

### File mode (offline)

```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["path/to/excalidraw-mcp/src/index.js"],
      "env": {
        "EXCALIDRAW_MCP_PROVIDER": "file",
        "EXCALIDRAW_DIR": "./my-drawings"
      }
    }
  }
}
```

## Tools

### Drawing (token-efficient)

| Tool | Description |
|------|-------------|
| `add_text` | Add text (x, y, text, color, size) |
| `add_shape` | Add rectangle/ellipse/diamond with optional label |
| `add_arrow` | Arrow with head options (arrow/bar/dot/triangle/none), line styles |
| `draw_scene` | Compact DSL for multiple elements |

### Scene DSL Example

```
rect 100,100 200x100 color=blue fill=blue 'Frontend'
rect 400,100 200x100 color=green fill=green 'Backend'
arrow 300,150 -> 400,150 color=gray style=dashed 'API'
text 250,20 size=28 color=black 'Architecture'
diamond 300,300 120x80 color=orange fill=orange
```

### Board Management

| Tool | Description |
|------|-------------|
| `list_boards` | List all boards |
| `create_board` | Create new board |
| `read_board` | Read elements with IDs |
| `clear_board` | Remove all elements |

### Edit

| Tool | Description |
|------|-------------|
| `update_element` | Change properties by ID |
| `delete_elements` | Delete by ID |

### Library (ExcaliDash)

| Tool | Description |
|------|-------------|
| `get_library` | Search available icons/templates |
| `add_from_library` | Place a library item on the board |

## Environment Variables

| Variable | Provider | Description |
|----------|----------|-------------|
| `EXCALIDRAW_MCP_PROVIDER` | Both | `file` or `excalidash` (auto-detect) |
| `EXCALIDASH_BACKEND_URL` | ExcaliDash | Backend API URL |
| `EXCALIDASH_URL` | ExcaliDash | Public frontend URL |
| `EXCALIDASH_EMAIL` | ExcaliDash | Login email |
| `EXCALIDASH_PASSWORD` | ExcaliDash | Login password |
| `EXCALIDASH_PROXY_PROTO` | ExcaliDash | `https` if behind reverse proxy |
| `EXCALIDASH_PROXY_HOST` | ExcaliDash | Hostname for proxy Host header |
| `EXCALIDRAW_DIR` | File | Directory for .excalidraw files |

## License

MIT
