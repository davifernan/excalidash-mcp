# excalidash-mcp

**Let your AI coding agent draw on your self-hosted ExcaliDash whiteboard.** This package is an MCP
client for a running [ExcaliDash](https://github.com/ZimengXiong/ExcaliDash) instance; it is not a
general-purpose MCP server for excalidraw.com or arbitrary Excalidraw files. It is tested against
ExcaliDash v0.5.1 and works with Claude Desktop, Claude Code, Cursor, Codex, and other MCP clients.
Diagrams appear live in every browser that has the board open, with no refresh needed.

![Order processing diagram drawn by the MCP server](https://raw.githubusercontent.com/davifernan/excalidash-mcp/main/assets/02-order-processing.png)

<sub>Eight nodes and eight edges, written as plain text. No coordinates by hand.</sub>

[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-black.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-server-black.svg)](https://modelcontextprotocol.io)

## Why

Ask a language model for a diagram and it has to invent pixel coordinates. It is bad at that, and the
result shows: arrows cut through boxes, labels hide underneath them, text overflows its container.

So don't ask it to. Describe the **structure**, meaning nodes and edges, and let a layout engine do
the geometry. Same graph, both ways:

| ❌ Model picks coordinates | ✅ Model picks structure |
|---|---|
| ![](https://raw.githubusercontent.com/davifernan/excalidash-mcp/main/assets/00-before-manual-coordinates.png) | ![](https://raw.githubusercontent.com/davifernan/excalidash-mcp/main/assets/01-after-auto-layout.png) |
| Arrows through boxes, labels clipped | `draw_graph` + dagre |

## Installation

You need Node.js 22 or newer, a running ExcaliDash instance, and an ExcaliDash user account for the
agent. Install the matching Chromium build once; package installation deliberately does not download
a browser behind your back:

```bash
npx -y excalidash-mcp setup-browser
```

When a later package update needs a different Chromium revision, startup stops with this same command
instead of failing with an internal Playwright error.

On a minimal Linux server or container, install Chromium and its operating-system libraries together:

```bash
npx -y excalidash-mcp setup-browser --with-deps
```

The `--with-deps` variant may ask for elevated privileges because it uses the system package manager.

Chromium's process sandbox is enabled by default. Run the server as a non-root user, including in
containers. Only when that is impossible, `EXCALIDASH_DISABLE_BROWSER_SANDBOX=1` disables the
sandbox; the server prints a security warning because browser compromise could then expose its
ExcaliDash credentials and host access.

The examples use an API key. Create one under **Profile → API keys** in ExcaliDash. Email and password
are also supported: replace `EXCALIDASH_API_KEY` with both `EXCALIDASH_EMAIL` and
`EXCALIDASH_PASSWORD`.

### Claude Desktop

Add this server to the `mcpServers` object in your Claude Desktop configuration, then restart Claude
Desktop:

```json
{
  "mcpServers": {
    "excalidash": {
      "command": "npx",
      "args": ["-y", "excalidash-mcp@1"],
      "env": {
        "EXCALIDASH_BACKEND_URL": "https://draw.example.com/api",
        "EXCALIDASH_URL": "https://draw.example.com",
        "EXCALIDASH_API_KEY": "exd_..."
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add --scope user excalidash \
  --env EXCALIDASH_BACKEND_URL=https://draw.example.com/api \
  --env EXCALIDASH_URL=https://draw.example.com \
  --env EXCALIDASH_API_KEY=exd_... \
  -- npx -y excalidash-mcp@1
```

Verify it with `claude mcp get excalidash`.

### Cursor

Add this to `~/.cursor/mcp.json`, then reload Cursor:

```json
{
  "mcpServers": {
    "excalidash": {
      "command": "npx",
      "args": ["-y", "excalidash-mcp@1"],
      "env": {
        "EXCALIDASH_BACKEND_URL": "https://draw.example.com/api",
        "EXCALIDASH_URL": "https://draw.example.com",
        "EXCALIDASH_API_KEY": "exd_..."
      }
    }
  }
}
```

> [!TIP]
> The key is shown once, right after you
> create it. Give it the `drawings:history` and `drawings:share` scopes if you want the agent to
> read version history or manage sharing; the defaults cover drawing and collection work.
>
> Email and password still work for instances without API keys, but a key needs no login round
> trip, is not subject to the login rate limit, and can be revoked on its own.

> [!TIP]
> Point `EXCALIDASH_BACKEND_URL` at your instance's **`/api`** path. The ExcaliDash frontend proxies
> it to the backend already, so no custom Nginx config and no exposed ports are needed.
> See [the setup guide](https://github.com/davifernan/excalidash-mcp/blob/main/docs/setup.md) for the details and the same-host alternative.

## Drawing

Ask for a diagram in plain language and the agent writes the DSL. This is what it writes:

```
direction LR
title 'Deploy Pipeline'
node push 'git push' color=gray fill=gray
node lint 'Lint' color=blue fill=blue
node test 'Test Suite' color=blue fill=blue
node gate 'All green?' shape=diamond color=orange fill=orange
node build 'Build Image' color=purple fill=purple
node stage 'Staging' color=green fill=green
node prod 'Production' color=green fill=green
node roll 'Rollback' color=red fill=red
edge push -> lint
edge push -> test
edge lint -> gate
edge test -> gate
edge gate -> build 'yes'
edge gate -> roll 'no'
edge build -> stage 'auto'
edge stage -> prod 'manual approve'
edge prod -> roll 'on error' color=red style=dashed
```

![Deploy pipeline diagram](https://raw.githubusercontent.com/davifernan/excalidash-mcp/main/assets/03-deploy-pipeline.png)

Boxes are sized to fit their labels, long labels wrap, edge labels get their own space, and parallel
edges fan apart instead of stacking. **Directions:** `LR`, `TB`, `RL`, `BT` · **Shapes:** `rect`,
`circle`, `diamond` · **Colors:** `blue`, `green`, `orange`, `purple`, `red`, `yellow`, `teal`,
`pink`, `gray`, or any hex code.

For annotations, legends and free-form sketches there is a second DSL that takes absolute
coordinates. See [the scene DSL reference](https://github.com/davifernan/excalidash-mcp/blob/main/docs/scene-dsl.md).

## Sharing

The agent signs in as its own account, so the boards it draws on belong to that account and nobody
else can open them. Ask it to share one when it's done:

```
share_board(board_id, with="you@example.com", access="edit")
```

The board then appears under **Shared with me** on your dashboard. `access="none"` takes it away
again. Pass an email address: the instance matches on fragments, so anything that isn't an exact
address or name is handed back for you to confirm rather than guessed at.

If every board should reach you anyway, set a standing recipient:

```json
"EXCALIDASH_SHARE_WITH": "you@example.com"
```

Every board the agent creates is then shared with you the moment it exists, so you can watch it being
drawn. This one shares **view** access, because the board is still being worked on: drawing rewrites
the board's contents, and `draw_graph` replaces them outright, so anything you added would be gone on
the next call. Append `:edit` if you want it anyway. A user id works in place of the address and
skips the lookup entirely.

## Tools

| Tool | What it does |
|------|--------------|
| `draw_graph` | Node/edge diagram with automatic layout. **Start here.** |
| `draw_scene` | Place elements at absolute coordinates |
| `read_me` | Format cheat sheet; the agent calls this once before drawing |
| `list_boards` · `create_board` · `read_board` | Board management |
| `share_board` | Give a person access to a finished board, or take it away |
| `update_element` · `delete_elements` · `rename_element` | Edit by name, live |
| `board_history` · `restore_version` | Browse and restore snapshots<sup>†</sup> |
| `export_png` | Render a board to PNG, framed on the drawing |

<sup>†</sup> Version history needs the snapshot API from
[PR #138](https://github.com/ZimengXiong/ExcaliDash/pull/138), merged into ExcaliDash in April 2026.
Any current version has it.

## How it works

![Architecture: agent to MCP server to ExcaliDash to browser](https://raw.githubusercontent.com/davifernan/excalidash-mcp/main/assets/how-it-works.png)

The server pushes over Socket.IO **and** persists over REST, which is why elements show up in an open
board immediately and still survive a reload. Every diagram in this README was drawn by the server
itself and exported with `export_png`.

## Docs

- [Diagramming skill](https://github.com/davifernan/excalidash-mcp/blob/main/skills/diagramming/SKILL.md): what to do and what to avoid, for agents that draw
- [Examples](https://github.com/davifernan/excalidash-mcp/blob/main/docs/examples.md): more diagrams, each with the DSL that produced it
- [Setup](https://github.com/davifernan/excalidash-mcp/blob/main/docs/setup.md): ExcaliDash instance, the `/api` path, environment variables
- [Scene DSL](https://github.com/davifernan/excalidash-mcp/blob/main/docs/scene-dsl.md): manual placement, element reference
- [Troubleshooting](https://github.com/davifernan/excalidash-mcp/blob/main/docs/troubleshooting.md): HTML instead of JSON, redirects, missing live updates,
  a board link that won't open, sign-ins that start failing on their own
- [Releasing](https://github.com/davifernan/excalidash-mcp/blob/main/docs/releasing.md): release tags, first-publish token scope, and npm Trusted Publishing

## License

MIT
