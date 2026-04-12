#!/usr/bin/env node
/**
 * excalidash-mcp — MCP server for live drawing on ExcaliDash
 *
 * Env vars:
 *   EXCALIDASH_BACKEND_URL  Backend API URL (default: http://127.0.0.1:6768)
 *   EXCALIDASH_URL          Public frontend URL (default: http://localhost:6767)
 *   EXCALIDASH_EMAIL        Login email
 *   EXCALIDASH_PASSWORD     Login password
 *   EXCALIDASH_PROXY_PROTO  Optional: "https" if behind reverse proxy
 *   EXCALIDASH_PROXY_HOST   Optional: hostname for proxy Host header
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { enrichElement, parseDSL, resolveColor, resolveFill, makeId, FONT_WIDTH, createShapeWithLabel, createBoundArrow } from "./elements.js";
import { ExcaliDashProvider } from "./excalidash.js";

const provider = new ExcaliDashProvider();

// ============================================================
// Core: push elements + persist
// ============================================================
async function pushElements(boardId, newElements, mode = "append") {
  await provider.joinRoom(boardId);

  const existing = await provider.getDrawing(boardId);
  if (!existing) throw new Error(`Board ${boardId} not found`);

  const existingEls = existing.elements || [];
  const now = Date.now();

  let merged, socketElements;

  if (mode === "replace" && newElements.length === 0) {
    const deletedEls = existingEls.map(e => ({
      ...e, isDeleted: true, updated: now,
      version: (e.version || 1) + 1,
      versionNonce: Math.floor(Math.random() * 2147483647),
    }));
    merged = deletedEls;
    socketElements = deletedEls;
  } else if (mode === "replace") {
    const deletedEls = existingEls.map(e => ({
      ...e, isDeleted: true, updated: now,
      version: (e.version || 1) + 1,
      versionNonce: Math.floor(Math.random() * 2147483647),
    }));
    merged = [...deletedEls, ...newElements];
    socketElements = merged;
  } else {
    merged = [...existingEls, ...newElements];
    socketElements = newElements;
  }

  const elementOrder = merged.map(e => e.id);

  await provider.pushLive(boardId, socketElements, elementOrder);
  await provider.updateDrawing(boardId, merged);

  const active = merged.filter(e => !e.isDeleted).length;
  const url = provider.getUrl(boardId);
  return { total: active, added: newElements.length, url };
}

// ============================================================
// MCP Server
// ============================================================
const server = new McpServer({
  name: "excalidash-mcp",
  version: "0.1.0",
});

// --- Board management ---

server.registerTool("list_boards", {
  description: "List all boards/drawings.",
  annotations: { readOnlyHint: true },
}, async () => {
  try {
    const drawings = await provider.listDrawings();
    if (!drawings.length) return { content: [{ type: "text", text: "No boards." }] };
    const list = drawings.map(d => `- ${d.name} (id: ${d.id})`).join("\n");
    return { content: [{ type: "text", text: list }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("create_board", {
  description: "Create a new board. Returns URL + ID.",
  inputSchema: z.object({ name: z.string().describe("Board name") }),
}, async ({ name }) => {
  try {
    const drawing = await provider.createDrawing(name, [], {}, {});
    const url = provider.getUrl(drawing.id);
    return { content: [{ type: "text", text: `Board "${name}"\n${url ? `URL: ${url}\n` : ""}ID: ${drawing.id}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("read_board", {
  description: "Read all elements from a board (with IDs for update/delete).",
  annotations: { readOnlyHint: true },
  inputSchema: z.object({ board_id: z.string() }),
}, async ({ board_id }) => {
  try {
    const d = await provider.getDrawing(board_id);
    if (!d) return { content: [{ type: "text", text: "Board not found" }], isError: true };
    const active = (d.elements || []).filter(e => !e.isDeleted);
    const summary = active.map(e => {
      const label = e.text ? ` "${e.text.substring(0, 30)}"` : "";
      const size = e.width && e.height ? ` ${Math.round(e.width)}x${Math.round(e.height)}` : "";
      return `  [${e.id}] ${e.type} (${Math.round(e.x)},${Math.round(e.y)})${size}${label}`;
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
    return { content: [{ type: "text", text: `Cleared.${r.url ? ` ${r.url}` : ""}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

// --- High-level drawing tools ---

server.registerTool("add_text", {
  description: "Add text to a board. Live if supported.",
  inputSchema: z.object({
    board_id: z.string(),
    text: z.string(),
    x: z.number(), y: z.number(),
    color: z.string().optional().describe("Color name (red/blue/green/orange/purple/black) or hex"),
    size: z.number().optional().describe("Font size (default 20)"),
    font: z.number().optional().describe("1=Virgil(hand), 2=Helvetica, 3=Cascadia(code)"),
  }),
}, async ({ board_id, text, x, y, color, size, font }) => {
  try {
    const el = enrichElement({
      type: "text", x, y, text,
      fontSize: size || 20, fontFamily: font || 1,
      strokeColor: resolveColor(color || "black"),
      strokeWidth: 1, roughness: 0,
    });
    const r = await pushElements(board_id, [el]);
    return { content: [{ type: "text", text: `Added text "${text}" (${r.total} total)` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("add_shape", {
  description: "Add a shape (rectangle, ellipse, diamond) to a board.",
  inputSchema: z.object({
    board_id: z.string(),
    shape: z.enum(["rectangle", "ellipse", "diamond"]),
    x: z.number(), y: z.number(),
    width: z.number().optional().describe("Width (default 160)"),
    height: z.number().optional().describe("Height (default 80)"),
    color: z.string().optional().describe("Stroke color"),
    fill: z.string().optional().describe("Fill color"),
    label: z.string().optional().describe("Title/label inside the shape"),
    details: z.string().optional().describe("Detail text below the label (use \\n for line breaks)"),
  }),
}, async ({ board_id, shape, x, y, width, height, color, fill, label, details }) => {
  try {
    const w = width || 160, h = height || 80;
    const els = createShapeWithLabel(
      { type: shape, x, y, width: w, height: h, strokeColor: resolveColor(color || "black"), backgroundColor: fill ? resolveFill(fill) : "transparent" },
      label, { strokeColor: resolveColor(color || "black"), details }
    );
    const r = await pushElements(board_id, els);
    return { content: [{ type: "text", text: `Added ${shape}${label ? ` "${label}"` : ""} (${r.total} total)` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("add_arrow", {
  description: "Add an arrow/line between two points.",
  inputSchema: z.object({
    board_id: z.string(),
    from_x: z.number(), from_y: z.number(),
    to_x: z.number(), to_y: z.number(),
    color: z.string().optional(),
    label: z.string().optional(),
    start_head: z.enum(["arrow", "bar", "dot", "triangle", "none"]).optional().describe("Start arrowhead (default none)"),
    end_head: z.enum(["arrow", "bar", "dot", "triangle", "none"]).optional().describe("End arrowhead (default arrow)"),
    line_style: z.enum(["solid", "dashed", "dotted"]).optional(),
    line_type: z.enum(["arrow", "line"]).optional().describe("arrow (default) or line (no heads)"),
  }),
}, async ({ board_id, from_x, from_y, to_x, to_y, color, label, start_head, end_head, line_style, line_type }) => {
  try {
    const dx = to_x - from_x, dy = to_y - from_y;
    const type = line_type || "arrow";
    const els = [enrichElement({
      type, x: from_x, y: from_y, width: dx, height: dy,
      points: [[0, 0], [dx, dy]],
      strokeColor: resolveColor(color || "black"),
      strokeStyle: line_style || "solid",
      startArrowhead: type === "arrow" ? (start_head === "none" ? null : (start_head || null)) : null,
      endArrowhead: type === "arrow" ? (end_head === "none" ? null : (end_head || "arrow")) : null,
    })];
    if (label) {
      els.push(enrichElement({
        type: "text", x: from_x + dx / 2 - 20, y: from_y + dy / 2 - 15,
        text: label, fontSize: 14, fontFamily: 1,
        strokeColor: resolveColor(color || "gray"), strokeWidth: 1, roughness: 0,
      }));
    }
    const r = await pushElements(board_id, els);
    return { content: [{ type: "text", text: `Added ${type}${label ? ` "${label}"` : ""} (${r.total} total)` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

// --- Modify ---

server.registerTool("update_element", {
  description: "Update properties of an existing element by ID. Use read_board to find IDs.",
  inputSchema: z.object({
    board_id: z.string(),
    element_id: z.string(),
    props: z.string().describe('JSON of properties to change, e.g. {"x": 200, "text": "new"}'),
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

    if (updated.type === "text" && (changes.text || changes.fontSize || changes.fontFamily)) {
      const fontSize = updated.fontSize || 20;
      const fontFamily = updated.fontFamily || 1;
      const text = updated.text || "";
      const lines = text.split("\n");
      const maxLen = Math.max(...lines.map(l => l.length));
      const mult = FONT_WIDTH[fontFamily] || 0.6;
      updated.width = maxLen * fontSize * mult;
      updated.height = lines.length * fontSize * 1.25;
      updated.baseline = Math.round(fontSize * 0.89);
      updated.originalText = text;
    }

    els[idx] = updated;
    await provider.pushLive(board_id, [updated], els.map(e => e.id));
    await provider.updateDrawing(board_id, els);

    return { content: [{ type: "text", text: `Updated "${element_id}" (${Object.keys(changes).join(", ")})` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("delete_elements", {
  description: "Delete elements by ID.",
  inputSchema: z.object({
    board_id: z.string(),
    element_ids: z.array(z.string()).describe('Element IDs to delete, or ["all"]'),
  }),
}, async ({ board_id, element_ids }) => {
  try {
    if (element_ids.length === 1 && element_ids[0] === "all") {
      const r = await pushElements(board_id, [], "replace");
      return { content: [{ type: "text", text: `Cleared board.` }] };
    }
    await provider.joinRoom(board_id);
    const existing = await provider.getDrawing(board_id);
    if (!existing) return { content: [{ type: "text", text: "Board not found" }], isError: true };

    const deleteSet = new Set(element_ids);
    const now = Date.now();
    const els = (existing.elements || []).map(e => {
      if (deleteSet.has(e.id)) {
        return { ...e, isDeleted: true, updated: now, version: (e.version || 1) + 1, versionNonce: Math.floor(Math.random() * 2147483647) };
      }
      return e;
    });
    const deleted = els.filter(e => deleteSet.has(e.id));
    await provider.pushLive(board_id, deleted, els.map(e => e.id));
    await provider.updateDrawing(board_id, els);

    return { content: [{ type: "text", text: `Deleted ${deleted.length} elements.` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

// --- Library ---

server.registerTool("get_library", {
  description: "List available library items (icons, templates).",
  annotations: { readOnlyHint: true },
  inputSchema: z.object({
    search: z.string().optional().describe("Filter by name"),
    limit: z.number().optional().describe("Max results (default 30)"),
  }),
}, async ({ search, limit }) => {
  try {
    const items = await provider.getLibrary();
    if (!items.length) return { content: [{ type: "text", text: "Library empty." }] };
    let filtered = items;
    if (search) {
      const q = search.toLowerCase();
      filtered = items.filter(i => (i.name || "").toLowerCase().includes(q));
    }
    const max = limit || 30;
    const shown = filtered.slice(0, max);
    const list = shown.map(i => `  ${i.name || "unnamed"} (${i.elements?.length || 0} els)`).join("\n");
    const more = filtered.length > max ? `\n  ... and ${filtered.length - max} more` : "";
    return { content: [{ type: "text", text: `${filtered.length} items${search ? ` matching "${search}"` : ""}\n${list}${more}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("add_from_library", {
  description: "Add a library item to a board by name.",
  inputSchema: z.object({
    board_id: z.string(),
    name: z.string().describe("Library item name (exact or partial)"),
    x: z.number(), y: z.number(),
    scale: z.number().optional().describe("Scale factor (default 1.0)"),
  }),
}, async ({ board_id, name, x, y, scale }) => {
  try {
    const items = await provider.getLibrary();
    if (!items.length) return { content: [{ type: "text", text: "Library empty." }], isError: true };
    const q = name.toLowerCase();
    const item = items.find(i => (i.name || "").toLowerCase() === q)
      || items.find(i => (i.name || "").toLowerCase().includes(q));
    if (!item) return { content: [{ type: "text", text: `"${name}" not found.` }], isError: true };

    const s = scale || 1.0;
    const srcEls = item.elements || [];
    if (!srcEls.length) return { content: [{ type: "text", text: `"${item.name}" has no elements.` }], isError: true };

    const minX = Math.min(...srcEls.map(e => e.x || 0));
    const minY = Math.min(...srcEls.map(e => e.y || 0));
    const idMap = new Map();

    const newEls = srcEls.map(e => {
      const newId = makeId();
      idMap.set(e.id, newId);
      return enrichElement({
        ...e, id: newId,
        x: x + ((e.x || 0) - minX) * s, y: y + ((e.y || 0) - minY) * s,
        width: (e.width || 0) * s, height: (e.height || 0) * s,
      });
    });

    for (const el of newEls) {
      if (el.containerId && idMap.has(el.containerId)) el.containerId = idMap.get(el.containerId);
      if (Array.isArray(el.boundElements)) el.boundElements = el.boundElements.map(b => idMap.has(b.id) ? { ...b, id: idMap.get(b.id) } : b);
      if (el.startBinding?.elementId && idMap.has(el.startBinding.elementId)) el.startBinding = { ...el.startBinding, elementId: idMap.get(el.startBinding.elementId) };
      if (el.endBinding?.elementId && idMap.has(el.endBinding.elementId)) el.endBinding = { ...el.endBinding, elementId: idMap.get(el.endBinding.elementId) };
    }

    const r = await pushElements(board_id, newEls);
    return { content: [{ type: "text", text: `Added "${item.name}" (${newEls.length} els) at (${x},${y}). ${r.total} total.` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

// --- Scene DSL ---

server.registerTool("draw_scene", {
  description: `Draw multiple elements with compact DSL. Each line = one element.

Syntax: TYPE [ID] x,y [WxH] [key=val...] ['label']
Types: rect, box, circle, oval, diamond, arrow, line, text
Colors: red, blue, green, orange, purple, yellow, gray, black (or #hex)

Shapes with details: rect ID x,y WxH color=C fill=F details='line1\\nline2' 'Title'
Bound arrows: arrow 0,0 -> 0,0 from=ID to=ID color=C ['label']
  (coords auto-calculated when from/to specified — use 0,0 -> 0,0)
Arrow styles: style=dashed start=arrow end=triangle

Example:
  rect fe 100,100 200x80 color=blue fill=blue 'Frontend'
  rect be 400,100 200x120 color=green fill=green details='Express\\nPostgres' 'Backend'
  arrow 0,0 -> 0,0 from=fe to=be color=gray 'REST API'
  text 250,20 size=28 color=black 'Architecture'`,
  inputSchema: z.object({
    board_id: z.string(),
    scene: z.string().describe("DSL (one element per line)"),
    mode: z.enum(["append", "replace"]).optional(),
  }),
}, async ({ board_id, scene, mode }) => {
  try {
    const elements = parseDSL(scene);
    if (!elements.length) return { content: [{ type: "text", text: "No valid elements." }], isError: true };
    const r = await pushElements(board_id, elements, mode || "append");
    return { content: [{ type: "text", text: `Drew ${r.added} elements (${r.total} total).${r.url ? ` ${r.url}` : ""}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

// --- Low-level fallback ---

server.registerTool("draw_to_board", {
  description: "Low-level: raw Excalidraw elements (JSON). Prefer add_text/add_shape/draw_scene.",
  inputSchema: z.object({
    board_id: z.string(),
    elements: z.string().describe("JSON array of Excalidraw elements"),
    mode: z.enum(["append", "replace"]).optional(),
  }),
}, async ({ board_id, elements, mode }) => {
  try {
    const parsed = JSON.parse(elements).map(enrichElement);
    const r = await pushElements(board_id, parsed, mode || "append");
    return { content: [{ type: "text", text: `Drew ${r.added} elements (${r.total} total).${r.url ? ` ${r.url}` : ""}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

// --- Export / Screenshot ---

let _browser = null;
async function getBrowser() {
  if (_browser?.isConnected()) return _browser;
  const { chromium } = await import("playwright");
  _browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  return _browser;
}

server.registerTool("export_png", {
  description: "Export a board (or any URL) as a PNG screenshot. Returns the file path.",
  inputSchema: z.object({
    board_id: z.string().optional().describe("Board ID to screenshot (uses ExcaliDash URL)"),
    url: z.string().optional().describe("Or: any URL to screenshot instead"),
    output: z.string().optional().describe("Output file path (default: /tmp/excalidash-export-{timestamp}.png)"),
    width: z.number().optional().describe("Viewport width (default 1920)"),
    height: z.number().optional().describe("Viewport height (default 1080)"),
    wait: z.number().optional().describe("Wait ms after load (default 2000)"),
    full_page: z.boolean().optional().describe("Capture full page (default false)"),
  }),
}, async ({ board_id, url, output, width, height, wait, full_page }) => {
  try {
    const targetUrl = url || (board_id ? provider.getUrl(board_id) : null);
    if (!targetUrl) return { content: [{ type: "text", text: "Provide board_id or url" }], isError: true };

    const outPath = output || `/tmp/excalidash-export-${Date.now()}.png`;
    const browser = await getBrowser();
    const page = await browser.newPage({ viewport: { width: width || 1920, height: height || 1080 } });

    // Login to ExcaliDash if targeting a board (not a generic URL)
    if (board_id && !url) {
      const loginUrl = provider.publicUrl + "/login";
      await page.goto(loginUrl, { waitUntil: "networkidle", timeout: 15000 });
      // Fill login form
      await page.fill('input[type="email"], input[name="email"]', provider.email).catch(() => {});
      await page.fill('input[type="password"], input[name="password"]', provider.password).catch(() => {});
      await page.click('button[type="submit"]').catch(() => {});
      await page.waitForTimeout(2000);
    }

    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForTimeout(wait || 3000);

    // Hide ExcaliDash UI elements for a clean screenshot
    await page.evaluate(() => {
      for (const sel of [".main-menu-trigger", "[class*='header']", "[class*='toolbar']", "[class*='sidebar']", "[class*='Island']", ".layer-ui__wrapper"]) {
        document.querySelectorAll(sel).forEach(el => el.style.display = "none");
      }
    }).catch(() => {});

    await page.screenshot({ path: outPath, fullPage: full_page || false });
    await page.close();

    return { content: [{ type: "text", text: `Screenshot saved: ${outPath}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

// ============================================================
async function main() { await server.connect(new StdioServerTransport()); }
main().catch((e) => { console.error(e); process.exit(1); });
