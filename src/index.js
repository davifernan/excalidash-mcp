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
import { commit as commitToBoard } from "./commit.js";
import {
  ACCESS_LEVELS,
  MIN_QUERY_LENGTH,
  describeUser,
  parseShareTarget,
  pickRecipient,
} from "./sharing.js";
import { convertElements, closeConverter, renderPng } from "./converter.js";
import { editableMermaidElements, mermaidErrorMessage, stableMermaidIds } from "./mermaid.js";
import { writeFile } from "node:fs/promises";
import { exportPath, checkedUrl } from "./exports.js";
import { reviewChanges } from "./elementProps.js";
import { expandDeletion, severReferences, retargetReferences, reflowDependants } from "./relations.js";
import { edgePoint, centre } from "./geometry.js";
import { checkIds } from "./validate.js";
import { browserLaunchOptions } from "./browser.js";
import packageMetadata from "../package.json" with { type: "json" };

const provider = new ExcaliDashProvider();

/** commit(), with this server's provider already bound in. */
const commit = (boardId, mutate, opts) => commitToBoard(provider, boardId, mutate, opts);

// ============================================================
// Convert elements via Excalidraw library (Playwright)
// ============================================================
/**
 * Turn the simplified DSL elements into real Excalidraw elements.
 *
 * This used to fall back to the simplified elements when the headless browser
 * was unavailable, and report success. Those objects are not Excalidraw
 * elements: a `label` is not a bound text element, bindings and version fields
 * are missing. They were then persisted, so a Playwright or CDN hiccup quietly
 * corrupted the board. Fail instead.
 */
async function convert(elements) {
  try {
    return stableLabelIds(await convertElements(elements));
  } catch (err) {
    throw new Error(
      `Could not render the elements — the headless Excalidraw conversion failed (${err.message}). ` +
      `Nothing was written to the board.`);
  }
}

/**
 * Give bound labels an id derived from their container.
 *
 * The library invents a random id for every text it binds into a shape. On a
 * redraw the boxes keep their ids but their labels do not, so each pass left
 * the previous labels behind as tombstones — ten of them after three redraws of
 * a six-element graph. Deriving the id makes a label the same element again.
 */
function stableLabelIds(elements) {
  const renamed = new Map();
  const out = elements.map((el) => {
    if (!el.containerId) return el;
    const id = `${el.containerId}-label`;
    renamed.set(el.id, id);
    return { ...el, id };
  });
  if (!renamed.size) return out;
  return out.map((el) =>
    el.boundElements?.some((b) => renamed.has(b.id))
      ? { ...el, boundElements: el.boundElements.map((b) => (renamed.has(b.id) ? { ...b, id: renamed.get(b.id) } : b)) }
      : el);
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
/**
 * Marks an element as drawn by this server.
 *
 * Without it "replace" has no way to tell its own output from what a person
 * drew by hand, and clearing the board was the only thing it could do.
 */
const MCP_SOURCE = "excalidash-mcp";
const stampOwnership = (elements) =>
  elements.map((el) => ({
    ...el,
    customData: { ...(el.customData || {}), source: MCP_SOURCE },
  }));
const isOwnElement = (el) => el?.customData?.source === MCP_SOURCE;

async function pushElements(boardId, newElements, mode = "append", opts = {}) {
  // Conversion is the expensive part and does not depend on the board, so it
  // happens once even if the write has to be retried.
  let convertedNew = opts.alreadyConverted
    ? stableLabelIds(newElements)
    : newElements.length > 0 ? await convert(newElements) : newElements;

  // Z-order AFTER conversion: arrows behind everything, shapes in middle, text on top.
  // Auto-laid-out graphs already carry a deliberate order — don't reshuffle them.
  if (convertedNew.length > 0 && !opts.preLaidOut) {
    convertedNew = zOrderConverted(convertedNew);
  }
  convertedNew = stampOwnership(convertedNew);

  return commit(boardId, (existingEls) => {
    const now = Date.now();

    if (mode === "replace" || mode === "wipe") {
      // "replace" clears only what this server drew, so hand-drawn work on the
      // same board survives a redraw. "wipe" is the old behaviour, kept for
      // boards whose contents predate the marker.
      const previouslyOwn = mode === "wipe" ? existingEls : existingEls.filter(isOwnElement);
      const kept = mode === "wipe" ? [] : existingEls.filter((e) => !isOwnElement(e));

      // A redraw reuses the same ids — node "api" stays "api". Writing the new
      // element and a tombstone for the old one would put two entries with the
      // same id into the board, and since the tombstone carries the higher
      // version, collaboration would settle on the deletion. So a reused id is
      // carried forward as a new version of the same element instead.
      const priorById = new Map(previouslyOwn.map((e) => [e.id, e]));
      const clash = convertedNew.find((e) => kept.some((k) => k.id === e.id));
      if (clash) {
        throw new Error(
          `Element id "${clash.id}" is already used by something this server does not own. ` +
          `Rename the node, or use mode "wipe" to clear the board first.`);
      }

      const survivors = convertedNew.map((el) => {
        const prior = priorById.get(el.id);
        if (!prior) return el;
        priorById.delete(el.id);
        return { ...el, version: Math.max(prior.version || 1, el.version || 1) + 1, updated: now };
      });

      // Whatever this server drew last time and did not draw again is gone.
      const deleted = [...priorById.values()].map((e) => ({
        ...e, isDeleted: true, updated: now,
        version: (e.version || 1) + 1,
        versionNonce: Math.floor(Math.random() * 2147483647),
      }));

      // Array position is z-order. Generated content goes behind anything drawn
      // by hand: someone who annotates a diagram wants their note on top of it,
      // not buried under the next redraw.
      const merged = [...survivors, ...kept, ...deleted];
      return {
        elements: merged,
        live: [...survivors, ...deleted],
        value: { total: merged.filter((e) => !e.isDeleted).length, added: newElements.length, url: provider.getUrl(boardId) },
      };
    }

    const merged = [...existingEls, ...convertedNew];
    return {
      elements: merged,
      live: convertedNew,
      value: { total: merged.filter((e) => !e.isDeleted).length, added: newElements.length, url: provider.getUrl(boardId) },
    };
  });
}

// ============================================================
// MCP Server
// ============================================================
const server = new McpServer({ name: "excalidash-mcp", version: packageMetadata.version });

// ============================================================
// read_me — Element format cheat sheet
// ============================================================
const CHEAT_SHEET = `# ExcaliDash Drawing Guide

## Which tool?

**draw_mermaid — start here for structured diagrams.** Architectures, flows, pipelines, sequence,
class, state and entity-relationship diagrams. Mermaid gives language models a familiar, expressive
format and Excalidraw's official converter produces native, editable elements with automatic layout.

\`\`\`mermaid
flowchart LR
  Client -->|HTTPS| API
  API --> Database[(Database)]
\`\`\`

**draw_graph — use this for small node/edge diagrams.** It is a compact alternative when Mermaid's
extra syntax is unnecessary. You describe only the structure; the layout engine positions everything.

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

One element per line. Use \`mode=replace\` to redraw this server's own output; hand-drawn elements survive.

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
    return { content: [{ type: "text", text: `Board "${name}"\nURL: ${provider.getUrl(d.id)}\nID: ${d.id}\n${await autoShare(d.id)}` }] };
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

// ============================================================
// Sharing
//
// The agent signs in as its own account — which is what this project's setup
// guide recommends — so every board it creates belongs to that account and
// nobody else can open it. Two paths hand a board back to a person: an explicit
// tool call, and a standing EXCALIDASH_SHARE_WITH for the recipient who is the
// same every time.
//
// Both go through applyShare, so there is one resolution rule, one permission
// model, and one place for a bug about who gets access to live.
// ============================================================
const shareTarget = parseShareTarget(process.env.EXCALIDASH_SHARE_WITH);

async function applyShare(boardId, recipient, access, knownUserId = null) {
  const wanted = String(recipient ?? "").trim();
  if (!wanted) return { status: "empty" };

  // The instance hides the signed-in user from its own lookup, so without this
  // the agent naming itself would come back as "no such user".
  const me = await provider.whoAmI();
  if (me && (wanted === me.id || wanted.toLowerCase() === String(me.email ?? "").toLowerCase())) {
    return { status: "self", me };
  }

  try {
    let user = null;
    if (!knownUserId && wanted.length >= MIN_QUERY_LENGTH) {
      const picked = pickRecipient(wanted, await provider.findUsers(boardId, wanted));
      if (picked.status === "ambiguous") return { ...picked, query: wanted };
      if (picked.status === "resolved") user = picked.user;
    }

    // The lookup searches name, username and address only, so a raw user id
    // arrives here unresolved. Pass it through and let the instance reject it:
    // that keeps ids working without this code having to guess what one is.
    const granteeUserId = knownUserId ?? user?.id ?? wanted;
    const who = user ? describeUser(user) : wanted;

    if (access === "none") {
      const { permissions } = await provider.getSharing(boardId);
      const granted = permissions.find((p) => p.granteeUserId === granteeUserId);
      if (!granted) return { status: "not-shared", who };
      await provider.revokeAccess(boardId, granted.id);
      return { status: "revoked", who };
    }

    const saved = await provider.grantAccess(boardId, granteeUserId, access);
    return {
      status: "granted",
      who: saved?.granteeUser ? describeUser(saved.granteeUser) : who,
      userId: saved?.granteeUserId ?? granteeUserId,
      access,
    };
  } catch (err) {
    // Both of these arrive as a bare 404 and mean very different things, which
    // is why the response body is read. Say which one it was.
    if (/User not found/i.test(err.message)) {
      return { status: "unresolved", query: wanted, tooShort: wanted.length < MIN_QUERY_LENGTH };
    }
    if (/Drawing not found/i.test(err.message)) return { status: "not-owner" };
    throw err;
  }
}

function shareMessage(result, boardId) {
  switch (result.status) {
    case "granted":
      return `Shared with ${result.who} (${result.access} access). It is now in their "Shared with me".\n${provider.getUrl(boardId)}`;
    case "revoked":
      return `Removed ${result.who}'s access to this board.`;
    case "not-shared":
      return `Nothing to do — this board was not shared with ${result.who}.`;
    case "self":
      return `"${result.me.email}" is the agent's own account, which already owns this board. Name the person it should be shared with instead.`;
    case "ambiguous":
      return [
        result.candidates.length === 1
          ? `Nothing was shared. "${result.query}" is not this account's exact name or address, and the instance matches on fragments, so this may well be somebody else.`
          : `Nothing was shared. "${result.query}" matches several accounts, and picking one would risk giving the board to the wrong person.`,
        `Confirm who is meant, then call again with their exact email address:`,
        ...result.candidates.map((u) => `  - ${describeUser(u)}`),
      ].join("\n");
    case "unresolved":
      return result.tooShort
        ? `Nothing was shared. "${result.query}" is too short — the instance ignores lookups under ${MIN_QUERY_LENGTH} characters. Give the full email address.`
        : `Nothing was shared. No account on this instance matches "${result.query}". Check the spelling, or ask them for the address they signed up with.`;
    case "not-owner":
      return `Nothing was shared. This board either does not exist or belongs to somebody else — only a board's owner can change who it is shared with.`;
    case "empty":
      return `Name a recipient: an email address, or a name as it appears on the instance.`;
    default:
      return `Unexpected result: ${result.status}`;
  }
}

// The address in the config is resolved once and then remembered as an id. A
// standing recipient has to keep working: without this, someone signing up
// later with a name that contains the configured one would make the lookup
// ambiguous, and boards would quietly stop being shared.
let shareTargetUserId = null;

/** Apply EXCALIDASH_SHARE_WITH to a freshly created board, if it is set. */
async function autoShare(boardId) {
  if (!shareTarget) {
    return `Access: private to the agent's account. Use share_board to give someone else access.`;
  }
  try {
    const result = await applyShare(
      boardId,
      shareTarget.recipient,
      shareTarget.access,
      shareTargetUserId,
    );
    if (result.status === "granted") {
      shareTargetUserId ??= result.userId ?? null;
      return `Access: shared with ${result.who} (${result.access}), from EXCALIDASH_SHARE_WITH.`;
    }
    // A board that exists but is private beats no board at all, so this never
    // fails the creation it is attached to. Say so plainly instead.
    return `Access: private — EXCALIDASH_SHARE_WITH ("${shareTarget.recipient}") did not apply. ${shareMessage(result, boardId)}`;
  } catch (err) {
    return `Access: private — EXCALIDASH_SHARE_WITH ("${shareTarget.recipient}") failed: ${err.message}`;
  }
}

server.registerTool("share_board", {
  description: `Give a person access to a board, or take it away with access "none".

Boards this server creates belong to the agent's own account, so nobody else can open one until it
is shared. Call this when the drawing is finished.`,
  inputSchema: z.object({
    board_id: z.string(),
    with: z.string().describe("Recipient's email address, or their name on the instance"),
    access: z.enum(ACCESS_LEVELS).optional().describe("Default: edit"),
  }),
}, async ({ board_id, with: recipient, access }) => {
  try {
    const result = await applyShare(board_id, recipient, access || "edit");
    const settled = result.status === "granted" || result.status === "revoked";
    return {
      content: [{ type: "text", text: shareMessage(result, board_id) }],
      ...(settled ? {} : { isError: true }),
    };
  } catch (err) {
    return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
  }
});

// ============================================================
// Drawing — main tool
// ============================================================
server.registerTool("draw_scene", {
  description: `Draw elements with compact DSL. Live updates in open browsers.
Call read_me first for the full format guide.
Use mode=replace to redraw what this server drew before, leaving hand-drawn work untouched. Use mode=append (default) to add. Use mode=wipe only to clear the entire board.
IMPORTANT: Always give elements descriptive IDs (e.g. 'rect frontend 100,100 ...'). This makes update/delete easy.`,
  inputSchema: z.object({
    board_id: z.string(),
    scene: z.string().describe("DSL scene (one element per line)"),
    mode: z.enum(["append", "replace", "wipe"]).optional(),
  }),
}, async ({ board_id, scene, mode }) => {
  try {
    const elements = parseDSL(scene);
    if (!elements.length) return { content: [{ type: "text", text: "No valid elements." }], isError: true };
    // Two elements sharing a name means update_element and delete_elements can
    // only ever reach one of them, and which one is not predictable.
    const problems = checkIds(elements.map(e => e.id));
    if (problems.length) {
      return { content: [{ type: "text", text: `Cannot draw this scene: ${problems.join(" ")}` }], isError: true };
    }
    const r = await pushElements(board_id, elements, mode || "append");
    return { content: [{ type: "text", text: `Drew ${r.added} elements (${r.total} total). ${r.url}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("draw_graph", {
  description: `Draw a node/edge diagram with automatic layout. Prefer this over draw_scene for
architectures, flows, pipelines and any boxes-and-arrows diagram — you describe the structure and
the layout engine places everything, so boxes never overlap and arrows don't cut through them.

Format (no coordinates):
  direction LR            # LR, TB (default), RL, BT. LR for pipelines, TB for hierarchies
  title 'Request Pipeline'
  node client 'Client' color=blue fill=blue
  node api 'Backend Service' shape=diamond color=green fill=green
  edge client -> api 'HTTPS'

Colors: blue, green, orange, purple, red, yellow, teal, pink, gray. Shapes: rect (default), circle,
diamond. Long labels wrap automatically and boxes are sized to fit.

Edge labels: two or three words. One sits mid-arrow, so a longer one reaches onto a neighbouring box.`,
  inputSchema: z.object({
    board_id: z.string(),
    graph: z.string().describe("Graph DSL — node/edge lines, no coordinates"),
    mode: z.enum(["append", "replace", "wipe"]).optional().describe("Default: replace, which clears only what this server drew before; append adds to it; wipe clears the whole board including hand-drawn work"),
  }),
}, async ({ board_id, graph, mode }) => {
  try {
    const parsed = parseGraphDSL(graph);
    if (!parsed.nodes.length) {
      return { content: [{ type: "text", text: "No nodes found. Use: node <id> 'Label'" }], isError: true };
    }
    const unknown = parsed.edges.filter(e =>
      !parsed.nodes.some(n => n.id === e.from) || !parsed.nodes.some(n => n.id === e.to));
    const elements = await layoutGraph(parsed);
    const r = await pushElements(board_id, elements, mode || "replace", { preLaidOut: true });
    const warn = unknown.length
      ? `\nSkipped ${unknown.length} edge(s) referencing unknown nodes: ${unknown.map(e => `${e.from}->${e.to}`).join(", ")}`
      : "";
    return { content: [{ type: "text", text: `Drew ${parsed.nodes.length} nodes, ${parsed.edges.length - unknown.length} edges (${parsed.direction}). ${r.url}${warn}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("draw_mermaid", {
  description: `Convert Mermaid source with Excalidraw's official converter and draw it as native,
editable Excalidraw elements. Prefer this for architectures, flows, sequence diagrams, class
diagrams, state diagrams and ER diagrams. The Mermaid source is processed locally and no screenshot
is used. Unsupported Mermaid diagram types are refused instead of being inserted as a flat image.

Use mode=replace to redraw what this server drew before while preserving hand-drawn annotations.
Use mode=append to add another diagram, or mode=wipe only when the entire board should be cleared.`,
  inputSchema: z.object({
    board_id: z.string(),
    mermaid: z.string().min(1).max(50000).describe("Mermaid diagram source, including its diagram type declaration"),
    mode: z.enum(["append", "replace", "wipe"]).optional().describe("Default: replace"),
  }),
}, async ({ board_id, mermaid, mode }) => {
  try {
    const writeMode = mode || "replace";
    const converted = await editableMermaidElements(mermaid);
    const elements = writeMode === "append" ? converted : stableMermaidIds(converted);
    const r = await pushElements(board_id, elements, writeMode, {
      alreadyConverted: true,
      preLaidOut: true,
    });
    return { content: [{ type: "text", text: `Drew Mermaid diagram as ${r.added} editable elements. ${r.url}` }] };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Mermaid syntax or conversion error: ${mermaidErrorMessage(err)} Nothing was written.` }],
      isError: true,
    };
  }
});

// ============================================================
// Edit / Delete
// ============================================================
/** Why some of the requested changes were not made. */
function refusalText(protectedKeys, unknown) {
  const parts = [];
  if (protectedKeys.length) {
    parts.push(
      `Left alone: ${protectedKeys.join(", ")} — these hold the board together ` +
      `(identity, bindings, deletion state) and changing them by hand breaks it. ` +
      `Use rename_element, delete_elements or redraw instead.`);
  }
  if (unknown.length) parts.push(`Not a known property: ${unknown.join(", ")}.`);
  return parts.join(" ");
}
server.registerTool("update_element", {
  description: "Update properties of an existing element by its name/ID (e.g. 'frontend', 'api-arrow'). Use read_board to see all element IDs.",
  inputSchema: z.object({
    board_id: z.string(),
    element_id: z.string(),
    props: z.string().describe('JSON of appearance, geometry or text properties, e.g. {"strokeColor":"#1971c2","x":200}'),
  }),
}, async ({ board_id, element_id, props }) => {
  try {
    const changes = JSON.parse(props);
    let report = null;

    const outcome = await commit(board_id, (els) => {
      const idx = els.findIndex(e => e.id === element_id);
      if (idx < 0) throw new Error(`Element "${element_id}" not found`);

      const { applied, protectedKeys, unknown } = reviewChanges(changes, els[idx]);
      if (!Object.keys(applied).length) {
        throw new Error(refusalText(protectedKeys, unknown) || "Nothing to change.");
      }

      const now = Date.now();
      const updated = {
        ...els[idx], ...applied, updated: now,
        version: (els[idx].version || 1) + 1,
        versionNonce: Math.floor(Math.random() * 2147483647),
      };
      const before = els[idx];
      const next = els.map((e, i) => (i === idx ? updated : e));

      // Moving a shape has to move its caption and re-aim the arrows attached
      // to it, or the board falls apart around the element that was edited.
      const { touched, keptArrows } = reflowDependants(next, element_id, before, edgePoint, centre);
      const followers = touched.map(e => ({
        ...e, updated: now,
        version: (e.version || 1) + 1,
        versionNonce: Math.floor(Math.random() * 2147483647),
      }));
      const byId = new Map(followers.map(e => [e.id, e]));
      const finalEls = next.map(e => byId.get(e.id) || e);

      report = { applied, protectedKeys, unknown, followers: followers.length, keptArrows };
      return { elements: finalEls, live: [updated, ...followers], value: true };
    });
    if (!outcome) return { content: [{ type: "text", text: "Board not found" }], isError: true };

    const notes = [refusalText(report.protectedKeys, report.unknown)];
    if (report.followers) notes.push(`Brought ${report.followers} attached element(s) along.`);
    if (report.keptArrows.length) {
      notes.push(`Left the shape of ${report.keptArrows.join(", ")} alone — a bent or half-bound arrow is not safe to re-aim automatically.`);
    }
    if (report.applied.width || report.applied.height) {
      notes.push("The label was re-centred but not re-wrapped; redraw the node if the text no longer fits.");
    }
    const note = notes.filter(Boolean).join(" ");
    return { content: [{ type: "text", text: `Updated "${element_id}" (${Object.keys(report.applied).join(", ")}). ${provider.getUrl(board_id)}${note ? `\n${note}` : ""}` }] };
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
    let repairedCount = 0;
    const outcome = await commit(board_id, (els) => {
      const idx = els.findIndex(e => e.id === old_id);
      if (idx < 0) throw new Error(`Element "${old_id}" not found`);
      if (els.some(e => e.id === new_id)) throw new Error(`ID "${new_id}" already exists`);

      const now = Date.now();
      const bump = (e, extra) => ({
        ...e, ...extra, updated: now,
        version: (e.version || 1) + 1,
        versionNonce: Math.floor(Math.random() * 2147483647),
      });

      const { elements: retargeted, touched } = retargetReferences(els, old_id, new_id);
      const repaired = touched.map(e => bump(e));
      const byId = new Map(repaired.map(e => [e.id, e]));

      const renamed = bump({ ...els[idx], id: new_id });
      // An id is an element's identity, so a rename is really a new element.
      // The old one has to be sent as deleted as well: without that, a client
      // with the board open keeps showing the old element next to the new one,
      // and only a reload makes the duplicate disappear.
      const buried = bump({ ...els[idx], isDeleted: true });

      const finalEls = retargeted
        .map(e => (e.id === old_id ? renamed : byId.get(e.id) || e))
        .concat(buried);

      repairedCount = repaired.length;
      return { elements: finalEls, live: [renamed, buried, ...repaired], value: true };
    });
    if (!outcome) return { content: [{ type: "text", text: "Board not found" }], isError: true };

    return { content: [{ type: "text", text: `Renamed "${old_id}" to "${new_id}" (${repairedCount} reference(s) repointed). ${provider.getUrl(board_id)}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

server.registerTool("delete_elements", {
  description: "Delete elements by name/ID (e.g. ['frontend', 'api-arrow']), or ['all'] to empty the board — that clears everything, hand-drawn work included. Use read_board to see all element IDs.",
  inputSchema: z.object({
    board_id: z.string(),
    element_ids: z.array(z.string()),
  }),
}, async ({ board_id, element_ids }) => {
  try {
    if (element_ids[0] === "all") {
      // "all" means all — including hand-drawn work, which "replace" now
      // deliberately spares.
      const r = await pushElements(board_id, [], "wipe");
      return { content: [{ type: "text", text: `Cleared the whole board, hand-drawn work included. ${r.url}` }] };
    }
    let summary = null;
    let missing = null;

    const outcome = await commit(board_id, (allEls) => {
      // Only what is still on the board can be deleted. Matching against every
      // element would also match the tombstones of earlier deletions, and a
      // second delete of the same name would report a success that removed
      // nothing at all.
      const live = allEls.filter(e => !e.isDeleted);
      const named = live.filter(e => element_ids.includes(e.id)).map(e => e.id);
      const deleteSet = expandDeletion(live, named);

      // Nothing matched, so nothing was deleted. Reporting "deleted 0" without
      // saying so reads as done, and the caller moves on believing the board
      // changed. Names are the only handle here, and they are easy to get wrong.
      if (deleteSet.size === 0) {
        // Bound labels carry generated ids nobody typed, so naming them back as
        // suggestions is noise. Only what a caller could have meant is listed.
        missing = live.filter(e => !e.containerId).map(e => e.id);
        return null;
      }

      const now = Date.now();
      const bump = (e, extra) => ({
        ...e, ...extra, updated: now,
        version: (e.version || 1) + 1,
        versionNonce: Math.floor(Math.random() * 2147483647),
      });

      const tombstoned = allEls.map(e => (deleteSet.has(e.id) ? bump(e, { isDeleted: true }) : e));

      // Whatever pointed at the deleted elements has to let go of them, or the
      // board keeps arrows bound to shapes that are no longer there.
      const { elements: els, touched } = severReferences(tombstoned, deleteSet);
      const repaired = touched.map(e => bump(e));
      const byId = new Map(repaired.map(e => [e.id, e]));
      const finalEls = els.map(e => byId.get(e.id) || e);

      const deleted = finalEls.filter(e => deleteSet.has(e.id));
      summary = { deleted: deleted.length, repaired: repaired.length };
      return { elements: finalEls, live: [...deleted, ...repaired], value: true };
    });

    if (missing) {
      return {
        content: [{
          type: "text",
          text: `Nothing was deleted: no element on this board is named ${element_ids.map(id => `"${id}"`).join(", ")}.`
            + (missing.length ? ` The board has ${missing.slice(0, 15).join(", ")}${missing.length > 15 ? ", …" : ""}.` : " The board is empty."),
        }],
        isError: true,
      };
    }
    if (!outcome) return { content: [{ type: "text", text: "Board not found" }], isError: true };
    const note = summary.repaired ? ` Released ${summary.repaired} reference(s) to them.` : "";
    return { content: [{ type: "text", text: `Deleted ${summary.deleted} elements.${note} ${provider.getUrl(board_id)}` }] };
  } catch (err) { return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true }; }
});

// ============================================================
// Export / Screenshot
// ============================================================
let _browser = null;
async function getBrowser() {
  if (_browser?.isConnected()) return _browser;
  const { chromium } = await import("playwright");
  _browser = await chromium.launch(browserLaunchOptions());
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
    if (!board_id && !url) return { content: [{ type: "text", text: "Provide board_id or url" }], isError: true };
    const targetUrl = url ? checkedUrl(url, provider.publicUrl) : provider.getUrl(board_id);
    const outPath = exportPath(output);
    // A canvas is allocated at width x height x scale^2; without a ceiling a
    // single call can ask for gigabytes.
    const density = Math.min(Math.max(scale || 2, 1), 4);

    // Preferred path: render the board's elements with Excalidraw's own export.
    // Always frames the whole drawing, and skips loading the editor entirely.
    if (board_id && !url) {
      const drawing = await provider.getDrawing(board_id);
      if (!drawing) return { content: [{ type: "text", text: "Board not found" }], isError: true };
      const active = (drawing.elements || []).filter(e => !e.isDeleted);
      if (!active.length) return { content: [{ type: "text", text: "Board is empty — nothing to export." }], isError: true };
      const dataUrl = await renderPng(active, { scale: density });
      await writeFile(outPath, Buffer.from(dataUrl.split(",")[1], "base64"));
      return { content: [{ type: "text", text: `Screenshot saved: ${outPath} (${active.length} elements)` }] };
    }

    const browser = await getBrowser();
    const page = await browser.newPage({
      viewport: {
        width: Math.min(Math.max(width || 1920, 320), 4000),
        height: Math.min(Math.max(height || 1080, 240), 4000),
      },
    });
    try {
    // Reaching this point means a url was passed, so the board was never
    // fetched through the API and the editor has to be logged in. An API key
    // cannot drive a browser form, so this path needs email and password.
    if (provider.email && provider.password) {
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
    const note = clip && !clipped
      ? " (drawing reaches the viewport edge — pass a larger width/height to capture all of it)"
      : "";
    return { content: [{ type: "text", text: `Screenshot saved: ${outPath}${note}` }] };
    } finally {
      // Anything thrown between opening the page and here used to leave it
      // open, so a run of failed exports piled up tabs in the shared browser.
      await page.close().catch(() => {});
    }
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
