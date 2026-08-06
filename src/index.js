#!/usr/bin/env node
/**
 * excalidash-mcp v2 — MCP server for live drawing on ExcaliDash.
 * Simplified pipeline: DSL → simplified format → convertToExcalidrawElements() → push.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { parseDSL, resolveColor, resolveFill } from "./elements.js";
import { parseGraphDSL, layoutGraph } from "./layout.js";
import { ExcaliDashProvider } from "./excalidash.js";
import { convertElements, closeConverter, renderPng } from "./converter.js";
import { writeFile } from "node:fs/promises";

const provider = new ExcaliDashProvider();

// ============================================================
// Convert elements via Excalidraw library (Playwright)
// ============================================================
async function convert(elements) {
  try {
    const converted = await convertElements(elements);
    return converted;
  } catch (err) {
    console.error("Excalidraw conversion failed, using raw elements:", err.message);
    return elements;
  }
}

// ============================================================
// Z-ordering of converted elements
// Excalidraw renders in array order: first = back, last = front
// We want: arrows (back) → large containers → shapes → text (front)
// ============================================================
function zOrderConverted(elements) {
  const arrows = [];
  const containers = [];
  const shapes = [];
  const boundTexts = [];
  const freeTexts = [];

  for (const el of elements) {
    if (el.type === "arrow" || el.type === "line") {
      arrows.push(el);
    } else if (["rectangle", "ellipse", "diamond"].includes(el.type)) {
      const area = (el.width || 0) * (el.height || 0);
      if (area > 80000) { containers.push(el); } else { shapes.push(el); }
    } else if (el.type === "text" && el.containerId) {
      boundTexts.push(el);
    } else {
      freeTexts.push(el);
    }
  }

  // Classify arrows: "between layers" vs "inside container"
  // An arrow is "inside" a container if both its start and end shapes are inside that container
  const containerBounds = containers.map(c => ({
    id: c.id, x: c.x, y: c.y, r: c.x + (c.width||0), b: c.y + (c.height||0)
  }));

  function isInsideContainer(arrow) {
    // Check if both endpoints are within a container
    const sx = arrow.x, sy = arrow.y;
    const ex = arrow.x + (arrow.width||0), ey = arrow.y + (arrow.height||0);
    return containerBounds.some(c =>
      sx >= c.x && sx <= c.r && sy >= c.y && sy <= c.b &&
      ex >= c.x && ex <= c.r && ey >= c.y && ey <= c.b
    );
  }

  const outerArrows = arrows.filter(a => !isInsideContainer(a));
  const innerArrows = arrows.filter(a => isInsideContainer(a));

  const ordered = [];

  // 1. Outer arrows + labels (very back — between layers)
  for (const arrow of outerArrows) {
    ordered.push(arrow);
    ordered.push(...boundTexts.filter(t => t.containerId === arrow.id));
  }

  // 2. Containers
  ordered.push(...containers);

  // 3. Inner arrows + labels (inside containers, behind inner shapes)
  for (const arrow of innerArrows) {
    ordered.push(arrow);
    ordered.push(...boundTexts.filter(t => t.containerId === arrow.id));
  }

  // 4. Shapes + their labels
  for (const shape of shapes) {
    ordered.push(shape);
    ordered.push(...boundTexts.filter(t => t.containerId === shape.id));
  }

  // 5. Remaining bound texts
  const placed = new Set(ordered.map(e => e.id));
  for (const bt of boundTexts) {
    if (!placed.has(bt.id)) ordered.push(bt);
  }

  // 6. Free text on top
  ordered.push(...freeTexts);

  return ordered;
}

// ============================================================
// Core: push elements live + persist
// ============================================================
async function pushElements(boardId, newElements, mode = "append", opts = {}) {
  await provider.joinRoom(boardId);

  let convertedNew = newElements.length > 0 ? await convert(newElements) : newElements;

  // Z-order AFTER conversion: arrows behind everything, shapes in middle, text on top.
  // Auto-laid-out graphs already carry a deliberate order — don't reshuffle them.
  if (convertedNew.length > 0 && !opts.preLaidOut) {
    convertedNew = zOrderConverted(convertedNew);
  }

  const existing = await provider.getDrawing(boardId);
  if (!existing) throw new Error(`Board ${boardId} not found`);

  const existingEls = existing.elements || [];
  const now = Date.now();
  let merged, socketElements;

  if (mode === "replace" && convertedNew.length === 0) {
    const deleted = existingEls.map(e => ({
      ...e, isDeleted: true, updated: now,
      version: (e.version || 1) + 1,
      versionNonce: Math.floor(Math.random() * 2147483647),
    }));
    merged = deleted;
    socketElements = deleted;
  } else if (mode === "replace") {
    const deleted = existingEls.map(e => ({
      ...e, isDeleted: true, updated: now,
      version: (e.version || 1) + 1,
      versionNonce: Math.floor(Math.random() * 2147483647),
    }));
    // Z-ordered active elements FIRST, deleted at end
    // Array position = z-order in Excalidraw
    merged = [...convertedNew, ...deleted];
    socketElements = merged;
  } else {
    merged = [...existingEls, ...convertedNew];
    socketElements = convertedNew;
  }

  // elementOrder controls z-ordering: first = back, last = front
  // Only include active (non-deleted) elements, in our z-ordered sequence
  const elementOrder = merged.filter(e => !e.isDeleted).map(e => e.id);
  await provider.pushLive(boardId, socketElements, elementOrder);
  await provider.updateDrawing(boardId, merged);

  const active = merged.filter(e => !e.isDeleted).length;
  return { total: active, added: newElements.length, url: provider.getUrl(boardId) };
}

// ============================================================
// MCP Server
// ============================================================
const server = new McpServer({ name: "excalidash-mcp", version: "2.0.0" });

// ============================================================
// read_me — Element format cheat sheet
// ============================================================
const CHEAT_SHEET = `# ExcaliDash Drawing Guide

## Which tool?

**draw_graph — use this for anything made of boxes and arrows.** Architectures, flows, pipelines,
state machines, org charts. You describe only the structure; the layout engine positions everything,
sizes boxes to their labels, keeps arrows out of unrelated boxes and reserves room for edge labels.

\`\`\`
direction LR                      # LR, TB (default), RL, BT
title 'Request Pipeline'
node client 'Client' color=blue fill=blue
node api 'Backend Service' color=green fill=green
node cache 'Cache hit?' shape=diamond color=orange fill=orange
edge client -> api 'HTTPS'
edge api -> cache
\`\`\`

**draw_scene — use this when you need control over placement**: annotations, legends, free-form
sketches, or anything that isn't a graph. It takes absolute coordinates, so you own the layout —
including making sure nothing overlaps. The rest of this guide covers draw_scene.

## Named Elements (wichtig!)
Every element SHOULD get a short, descriptive ID right after the type keyword.
This makes update_element/delete_elements easy — no cryptic IDs to look up.

\`\`\`
rect frontend 100,100 200x80 ...     → ID = "frontend"
arrow api-call 0,0 -> 0,0 ...        → ID = "api-call"
text title 250,20 ...                 → ID = "title"
\`\`\`

Without a name, elements get auto-generated IDs like "el-1744123456789-0".
read_board shows all element IDs — named ones are instantly recognizable.

Alternative: \`name=xxx\` as key-value also works: \`rect 100,100 name=frontend ...\`

## Color Palette
### Fills (pastel, for shape backgrounds)
| Color | Hex | Use |
|-------|-----|-----|
| Light Blue | #a5d8ff | Primary, input, sources |
| Light Green | #b2f2bb | Success, output |
| Light Orange | #ffd8a8 | Warning, external |
| Light Purple | #d0bfff | Processing, middleware |
| Light Red | #ffc9c9 | Error, critical |
| Light Yellow | #fff3bf | Notes, decisions |
| Light Teal | #c3fae8 | Storage, data |
| Gray | #dee2e6 | Inactive, optional |

### Stroke Colors
blue=#4a9eed, green=#22c55e, red=#ef4444, purple=#8b5cf6, orange=#f59e0b, gray=#868e96, black=#1e1e1e

## draw_scene DSL

One element per line. Use \`mode=replace\` to redraw entirely.

### Shapes (with label)
\`\`\`
rect ID x,y WxH color=C fill=F 'Label Text'
circle ID x,y WxH color=C fill=F 'Label'
diamond ID x,y WxH color=C fill=F 'Label'
\`\`\`
Label auto-centers inside shape. Min size: 150x80.

### Shapes with details (label + detail text below)
\`\`\`
rect ID x,y WxH color=C fill=F 'Title' 'Detail line 1|Detail line 2'
\`\`\`
Use | without spaces for line breaks. With spaces stays literal: "A | B | C"

### Arrows (bound to shapes)
\`\`\`
arrow ARROW-ID 0,0 -> 0,0 from=SHAPE-ID to=SHAPE-ID color=C 'Label'
\`\`\`
Coordinates auto-calculated from shape edges. Just use 0,0 -> 0,0.
Arrow styles: style=dashed, start=arrow, end=triangle/dot/bar/none

### Arrows (manual coordinates)
\`\`\`
arrow ARROW-ID x1,y1 -> x2,y2 color=C 'Label'
\`\`\`

### Standalone text
\`\`\`
text TEXT-ID x,y size=28 color=blue 'Title Text'
\`\`\`

## Layout Rules
- Min shape size: 150×80 for labeled shapes
- Min gap between elements: 30px
- Min fontSize: 16 for labels, 20 for titles, 12 for details
- Use fewer, larger elements over many tiny ones
- Leave breathing room — don't pack elements tight

## Example
\`\`\`
text heading 250,20 size=28 color=blue 'System Architecture'
rect fe 100,100 200x80 color=blue fill=blue 'Frontend'
rect be 400,100 200x100 color=green fill=green 'Backend' 'Express.js|PostgreSQL'
arrow fe-to-be 0,0 -> 0,0 from=fe to=be color=gray 'REST API'
diamond db 400,280 150x100 color=orange fill=orange 'Database'
arrow be-to-db 0,0 -> 0,0 from=be to=db color=gray 'SQL'
\`\`\`
`;

server.registerTool("read_me", {
  description: "Get the element format cheat sheet. Call this ONCE at the start before drawing.",
  annotations: { readOnlyHint: true },
}, async () => {
  return { content: [{ type: "text", text: CHEAT_SHEET }] };
});

// ============================================================
// Board management
// ============================================================
server.registerTool("list_boards", {
  description: "List all boards.",
  annotations: { readOnlyHint: true },
}, async () => {
  try {
    const drawings = await provider.listDrawings();
    if (!drawings.length) return { content: [{ type: "text", text: "No boards." }] };
    return { content: [{ type: "text", text: drawings.map(d => `- ${d.name} (id: ${d.id})`).join("\n") }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("create_board", {
  description: "Create a new board. Returns URL + ID.",
  inputSchema: z.object({ name: z.string() }),
}, async ({ name }) => {
  try {
    const d = await provider.createDrawing(name, [], {}, {});
    return { content: [{ type: "text", text: `Board "${name}"\nURL: ${provider.getUrl(d.id)}\nID: ${d.id}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("read_board", {
  description: "Read all elements from a board. Shows element names/IDs for use with update_element and delete_elements.",
  annotations: { readOnlyHint: true },
  inputSchema: z.object({ board_id: z.string() }),
}, async ({ board_id }) => {
  try {
    const d = await provider.getDrawing(board_id);
    if (!d) return { content: [{ type: "text", text: "Board not found" }], isError: true };
    const active = (d.elements || []).filter(e => !e.isDeleted);
    const summary = active.map(e => {
      const label = e.text ? ` "${e.text.substring(0, 30)}"` : "";
      return `  [${e.id}] ${e.type} (${Math.round(e.x)},${Math.round(e.y)})${label}`;
    }).join("\n");
    return { content: [{ type: "text", text: `"${d.name}" — ${active.length} elements\n${summary}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("clear_board", {
  description: "Remove all elements from a board.",
  inputSchema: z.object({ board_id: z.string() }),
}, async ({ board_id }) => {
  try {
    const r = await pushElements(board_id, [], "replace");
    return { content: [{ type: "text", text: `Cleared. ${r.url}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

// ============================================================
// Drawing — main tool
// ============================================================
server.registerTool("draw_scene", {
  description: `Draw elements with compact DSL. Live updates in open browsers.
Call read_me first for the full format guide.
Use mode=replace to clear and redraw. Use mode=append (default) to add to existing.
IMPORTANT: Always give elements descriptive IDs (e.g. 'rect frontend 100,100 ...'). This makes update/delete easy.`,
  inputSchema: z.object({
    board_id: z.string(),
    scene: z.string().describe("DSL scene (one element per line)"),
    mode: z.enum(["append", "replace"]).optional(),
  }),
}, async ({ board_id, scene, mode }) => {
  try {
    const elements = parseDSL(scene);
    if (!elements.length) return { content: [{ type: "text", text: "No valid elements." }], isError: true };
    const r = await pushElements(board_id, elements, mode || "append");
    return { content: [{ type: "text", text: `Drew ${r.added} elements (${r.total} total). ${r.url}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("draw_graph", {
  description: `Draw a node/edge diagram with automatic layout. Prefer this over draw_scene for
architectures, flows, pipelines and any boxes-and-arrows diagram — you describe the structure and
the layout engine places everything, so boxes never overlap and arrows don't cut through them.

Format (no coordinates):
  direction LR            # LR, TB (default), RL, BT
  title 'Request Pipeline'
  node client 'Client' color=blue fill=blue
  node api 'Backend Service' shape=diamond color=green fill=green
  edge client -> api 'HTTPS'

Colors: blue, green, orange, purple, red, yellow, teal, pink, gray. Shapes: rect (default), circle,
diamond. Long labels wrap automatically and boxes are sized to fit.`,
  inputSchema: z.object({
    board_id: z.string(),
    graph: z.string().describe("Graph DSL — node/edge lines, no coordinates"),
    mode: z.enum(["append", "replace"]).optional().describe("Default: replace"),
  }),
}, async ({ board_id, graph, mode }) => {
  try {
    const parsed = parseGraphDSL(graph);
    if (!parsed.nodes.length) {
      return { content: [{ type: "text", text: "No nodes found. Use: node <id> 'Label'" }], isError: true };
    }
    const unknown = parsed.edges.filter(e =>
      !parsed.nodes.some(n => n.id === e.from) || !parsed.nodes.some(n => n.id === e.to));
    const elements = layoutGraph(parsed);
    const r = await pushElements(board_id, elements, mode || "replace", { preLaidOut: true });
    const warn = unknown.length
      ? `\nSkipped ${unknown.length} edge(s) referencing unknown nodes: ${unknown.map(e => `${e.from}->${e.to}`).join(", ")}`
      : "";
    return { content: [{ type: "text", text: `Drew ${parsed.nodes.length} nodes, ${parsed.edges.length - unknown.length} edges (${parsed.direction}). ${r.url}${warn}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

// ============================================================
// Edit / Delete
// ============================================================
server.registerTool("update_element", {
  description: "Update properties of an existing element by its name/ID (e.g. 'frontend', 'api-arrow'). Use read_board to see all element IDs.",
  inputSchema: z.object({
    board_id: z.string(),
    element_id: z.string(),
    props: z.string().describe('JSON of properties to change'),
  }),
}, async ({ board_id, element_id, props }) => {
  try {
    const changes = JSON.parse(props);
    await provider.joinRoom(board_id);
    const existing = await provider.getDrawing(board_id);
    if (!existing) return { content: [{ type: "text", text: "Board not found" }], isError: true };
    const els = existing.elements || [];
    const idx = els.findIndex(e => e.id === element_id);
    if (idx < 0) return { content: [{ type: "text", text: `Element "${element_id}" not found` }], isError: true };
    const updated = {
      ...els[idx], ...changes, updated: Date.now(),
      version: (els[idx].version || 1) + 1,
      versionNonce: Math.floor(Math.random() * 2147483647),
    };
    els[idx] = updated;
    await provider.pushLive(board_id, [updated], els.map(e => e.id));
    await provider.updateDrawing(board_id, els);
    return { content: [{ type: "text", text: `Updated "${element_id}"` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("rename_element", {
  description: "Rename an element's ID (e.g. 'el-1744123456789-0' → 'frontend'). Updates all references (bindings, containers, boundElements) across the board.",
  inputSchema: z.object({
    board_id: z.string(),
    old_id: z.string().describe("Current element ID"),
    new_id: z.string().describe("New descriptive name"),
  }),
}, async ({ board_id, old_id, new_id }) => {
  try {
    await provider.joinRoom(board_id);
    const existing = await provider.getDrawing(board_id);
    if (!existing) return { content: [{ type: "text", text: "Board not found" }], isError: true };
    const els = existing.elements || [];

    const idx = els.findIndex(e => e.id === old_id);
    if (idx < 0) return { content: [{ type: "text", text: `Element "${old_id}" not found` }], isError: true };
    if (els.some(e => e.id === new_id)) return { content: [{ type: "text", text: `ID "${new_id}" already exists` }], isError: true };

    const now = Date.now();
    const changed = [];

    for (let i = 0; i < els.length; i++) {
      let modified = false;
      const el = { ...els[i] };

      // Rename the element itself
      if (el.id === old_id) {
        el.id = new_id;
        modified = true;
      }

      // Update containerId reference
      if (el.containerId === old_id) {
        el.containerId = new_id;
        modified = true;
      }

      // Update boundElements references
      if (Array.isArray(el.boundElements)) {
        const newBound = el.boundElements.map(b => {
          if (b.id === old_id) { modified = true; return { ...b, id: new_id }; }
          return b;
        });
        if (modified) el.boundElements = newBound;
      }

      // Update arrow bindings
      if (el.startBinding?.elementId === old_id) {
        el.startBinding = { ...el.startBinding, elementId: new_id };
        modified = true;
      }
      if (el.endBinding?.elementId === old_id) {
        el.endBinding = { ...el.endBinding, elementId: new_id };
        modified = true;
      }

      if (modified) {
        el.updated = now;
        el.version = (els[i].version || 1) + 1;
        el.versionNonce = Math.floor(Math.random() * 2147483647);
        changed.push(el);
      }

      els[i] = el;
    }

    await provider.pushLive(board_id, changed, els.map(e => e.id));
    await provider.updateDrawing(board_id, els);
    return { content: [{ type: "text", text: `Renamed "${old_id}" → "${new_id}" (${changed.length} elements updated)` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("delete_elements", {
  description: "Delete elements by name/ID (e.g. ['frontend', 'api-arrow']). Use read_board to see all element IDs.",
  inputSchema: z.object({
    board_id: z.string(),
    element_ids: z.array(z.string()),
  }),
}, async ({ board_id, element_ids }) => {
  try {
    if (element_ids[0] === "all") {
      const r = await pushElements(board_id, [], "replace");
      return { content: [{ type: "text", text: "Cleared." }] };
    }
    await provider.joinRoom(board_id);
    const existing = await provider.getDrawing(board_id);
    if (!existing) return { content: [{ type: "text", text: "Board not found" }], isError: true };
    const deleteSet = new Set(element_ids);
    // A shape's label is a separate element bound to it. Deleting only the shape
    // leaves the label floating on the canvas.
    for (const el of existing.elements || []) {
      if (el.containerId && deleteSet.has(el.containerId)) deleteSet.add(el.id);
    }
    const now = Date.now();
    const els = (existing.elements || []).map(e =>
      deleteSet.has(e.id)
        ? { ...e, isDeleted: true, updated: now, version: (e.version || 1) + 1, versionNonce: Math.floor(Math.random() * 2147483647) }
        : e
    );
    const deleted = els.filter(e => deleteSet.has(e.id));
    await provider.pushLive(board_id, deleted, els.map(e => e.id));
    await provider.updateDrawing(board_id, els);
    return { content: [{ type: "text", text: `Deleted ${deleted.length} elements.` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

// ============================================================
// Export / Screenshot
// ============================================================
let _browser = null;
async function getBrowser() {
  if (_browser?.isConnected()) return _browser;
  const { chromium } = await import("playwright");
  _browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  return _browser;
}

server.registerTool("export_png", {
  description: "Export a board as a PNG screenshot. The view is zoomed to fit the drawing, so the image is framed on the content rather than the canvas.",
  inputSchema: z.object({
    board_id: z.string().optional(),
    url: z.string().optional(),
    output: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    wait: z.number().optional(),
    fit: z.boolean().optional().describe("Crop to the drawing (default true; only used when passing a raw url)"),
    scale: z.number().optional().describe("Pixel density for the export, default 2"),
  }),
}, async ({ board_id, url, output, width, height, wait, fit, scale }) => {
  try {
    const targetUrl = url || (board_id ? provider.getUrl(board_id) : null);
    if (!targetUrl) return { content: [{ type: "text", text: "Provide board_id or url" }], isError: true };
    const outPath = output || `/tmp/excalidash-export-${Date.now()}.png`;

    // Preferred path: render the board's elements with Excalidraw's own export.
    // Always frames the whole drawing, and skips loading the editor entirely.
    if (board_id && !url) {
      const drawing = await provider.getDrawing(board_id);
      if (!drawing) return { content: [{ type: "text", text: "Board not found" }], isError: true };
      const active = (drawing.elements || []).filter(e => !e.isDeleted);
      if (!active.length) return { content: [{ type: "text", text: "Board is empty — nothing to export." }], isError: true };
      const dataUrl = await renderPng(active, { scale: scale || 2 });
      await writeFile(outPath, Buffer.from(dataUrl.split(",")[1], "base64"));
      return { content: [{ type: "text", text: `Screenshot saved: ${outPath} (${active.length} elements)` }] };
    }

    const browser = await getBrowser();
    const page = await browser.newPage({ viewport: { width: width || 1920, height: height || 1080 } });
    if (board_id && !url) {
      // networkidle never settles here: the app holds a Socket.IO connection open.
      await page.goto(provider.publicUrl + "/login", { waitUntil: "domcontentloaded", timeout: 15000 });
      await page.fill('input[type="email"]', provider.email).catch(() => {});
      await page.fill('input[type="password"]', provider.password).catch(() => {});
      await page.click('button[type="submit"]').catch(() => {});
      await page.waitForURL(u => !u.pathname.startsWith("/login"), { timeout: 15000 }).catch(() => {});
    }
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForSelector("canvas", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(wait || 2500);
    await page.evaluate(() => {
      document.querySelectorAll('[class*="Island"], .layer-ui__wrapper, [class*="header"], .main-menu-trigger').forEach(el => el.style.display = "none");
    }).catch(() => {});
    // Frame the drawing instead of shipping a mostly-empty canvas. Excalidraw's
    // "zoom to fit" shortcut doesn't reach the editor here, so measure the drawn
    // pixels directly and crop to them.
    let clip = null, clipped = false;
    if (fit !== false) {
      clip = await page.evaluate((pad) => {
        const canvas = document.querySelector("canvas.excalidraw__canvas.static") ||
                       document.querySelector("canvas.excalidraw__canvas") ||
                       document.querySelector("canvas");
        if (!canvas) return null;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return null;
        const { width: cw, height: ch } = canvas;
        const { data } = ctx.getImageData(0, 0, cw, ch);

        // The background is a flat colour; anything differing from the corner
        // pixel is drawing.
        const bg = [data[0], data[1], data[2]];
        const differs = (i) =>
          data[i + 3] > 8 &&
          (Math.abs(data[i] - bg[0]) > 12 ||
           Math.abs(data[i + 1] - bg[1]) > 12 ||
           Math.abs(data[i + 2] - bg[2]) > 12);

        let minX = cw, minY = ch, maxX = -1, maxY = -1;
        for (let y = 0; y < ch; y++) {
          for (let x = 0; x < cw; x++) {
            if (differs((y * cw + x) * 4)) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < 0) return null;

        // The canvas is sized in device pixels; the screenshot clip is in CSS pixels.
        const scale = cw / (canvas.getBoundingClientRect().width || cw);
        const touchesEdge = minX <= 1 || minY <= 1 || maxX >= cw - 2 || maxY >= ch - 2;
        return {
          x: Math.max(0, minX / scale - pad),
          y: Math.max(0, minY / scale - pad),
          width: (maxX - minX) / scale + pad * 2,
          height: (maxY - minY) / scale + pad * 2,
          touchesEdge,
        };
      }, 40).catch(() => null);
    }

    if (clip) {
      const { touchesEdge, ...box } = clip;
      box.width = Math.min(box.width, (width || 1920) - box.x);
      box.height = Math.min(box.height, (height || 1080) - box.y);
      await page.screenshot({ path: outPath, clip: box });
      clipped = !touchesEdge;
    } else {
      await page.screenshot({ path: outPath });
    }
    await page.close();
    const note = clip && !clipped
      ? " (drawing reaches the viewport edge — pass a larger width/height to capture all of it)"
      : "";
    return { content: [{ type: "text", text: `Screenshot saved: ${outPath}${note}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

// ============================================================
// Version History
// ============================================================
server.registerTool("board_history", {
  description: "Show version history for a board. Returns snapshot IDs and timestamps for use with restore_version.",
  annotations: { readOnlyHint: true },
  inputSchema: z.object({
    board_id: z.string(),
    limit: z.number().optional().describe("Max entries (default 20)"),
  }),
}, async ({ board_id, limit }) => {
  try {
    const data = await provider.getDrawingHistory(board_id, limit || 20);
    if (!data?.snapshots?.length) return { content: [{ type: "text", text: "No history for this board." }] };
    const lines = data.snapshots.map(s =>
      `  v${s.version} | ${s.id} | ${new Date(s.createdAt).toISOString()}`
    );
    return { content: [{ type: "text", text: `History (${data.totalCount} total):\n${lines.join("\n")}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("restore_version", {
  description: "Restore a board to a previous version. Current state is auto-snapshotted first (reversible). Use board_history to find snapshot IDs.",
  inputSchema: z.object({
    board_id: z.string(),
    snapshot_id: z.string().describe("Snapshot ID from board_history"),
  }),
}, async ({ board_id, snapshot_id }) => {
  try {
    const result = await provider.restoreSnapshot(board_id, snapshot_id);
    return { content: [{ type: "text", text: `Restored board to snapshot ${snapshot_id}. New version: v${result.version}. ${provider.getUrl(board_id)}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

// ============================================================
// Shutdown
//
// Both the screenshot browser and the converter browser are long-lived by
// design, and Playwright's Chromium keeps the event loop alive. Without this,
// the server outlives its client: every MCP session leaves a node process and
// its Chromium children running forever.
// ============================================================
let _shuttingDown = false;
async function shutdown(code = 0) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  await Promise.allSettled([
    _browser?.close(),
    closeConverter(),
    provider.disconnect(),
  ]);
  process.exit(code);
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => shutdown(0));
}
// The client going away closes stdin — that is the normal end of an MCP session.
process.stdin.on("close", () => shutdown(0));
process.stdin.on("end", () => shutdown(0));

async function main() { await server.connect(new StdioServerTransport()); }
main().catch((e) => { console.error(e); process.exit(1); });
