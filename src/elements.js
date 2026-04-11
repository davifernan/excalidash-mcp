/**
 * Excalidraw element builder & helpers.
 * Shared across all providers — no backend dependency.
 */

// ============================================================
// Color palette (semantic)
// ============================================================
export const COLORS = {
  red: "#e03131", blue: "#1971c2", green: "#2f9e44", orange: "#f08c00",
  purple: "#7048e8", pink: "#e8590c", yellow: "#e67700", gray: "#868e96",
  black: "#1e1e1e", white: "#ffffff",
};
export const FILLS = {
  red: "#ffc9c9", blue: "#a5d8ff", green: "#b2f2bb", orange: "#fff3bf",
  purple: "#d0bfff", pink: "#ffe8cc", yellow: "#fff3bf", gray: "#dee2e6",
};

export function resolveColor(c) { return COLORS[c] || c || "#1e1e1e"; }
export function resolveFill(c) { return FILLS[c] || c || "transparent"; }

// ============================================================
// Element builder
// ============================================================
const FONT_WIDTH = { 1: 0.6, 2: 0.55, 3: 0.55 }; // Virgil, Helvetica, Cascadia
let idCounter = 0;

export function makeId() { return `xmcp-${Date.now()}-${idCounter++}`; }

export function enrichElement(el) {
  const now = Date.now();
  const enriched = {
    id: makeId(),
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: el.type === "text" ? null : { type: (el.type === "line" || el.type === "arrow") ? 2 : 3 },
    seed: Math.floor(Math.random() * 2147483647),
    version: 2,
    versionNonce: Math.floor(Math.random() * 2147483647),
    isDeleted: false,
    boundElements: [],
    updated: now,
    link: null,
    locked: false,
    ...el,
  };

  if (enriched.type === "text") {
    const fontSize = enriched.fontSize || 20;
    const fontFamily = enriched.fontFamily || 1;
    const text = enriched.text || "";
    const lines = text.split("\n");
    const maxLen = Math.max(...lines.map(l => l.length));
    const mult = FONT_WIDTH[fontFamily] || 0.6;
    if (!enriched.width || enriched.width <= 0) enriched.width = maxLen * fontSize * mult;
    if (!enriched.height || enriched.height <= 0) enriched.height = lines.length * fontSize * 1.25;
    enriched.baseline = enriched.baseline ?? Math.round(fontSize * 0.89);
    enriched.lineHeight = enriched.lineHeight ?? 1.25;
    enriched.verticalAlign = enriched.verticalAlign ?? "top";
    enriched.textAlign = enriched.textAlign ?? "left";
    enriched.containerId = enriched.containerId ?? null;
    enriched.originalText = enriched.originalText ?? text;
    enriched.autoResize = enriched.autoResize ?? true;
    enriched.fontFamily = fontFamily;
    enriched.fontSize = fontSize;
  }

  if (enriched.type === "arrow" || enriched.type === "line") {
    enriched.points = enriched.points || [[0, 0], [enriched.width || 100, enriched.height || 0]];
    enriched.lastCommittedPoint = null;
    if (enriched.type === "arrow") {
      enriched.startArrowhead = enriched.startArrowhead ?? null;
      enriched.endArrowhead = enriched.endArrowhead ?? "arrow";
    }
  }

  return enriched;
}

// ============================================================
// DSL parser for draw_scene
// ============================================================
export function parseDSL(dsl) {
  const elements = [];
  for (const raw of dsl.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    const textMatch = line.match(/'([^']+)'|"([^"]+)"/);
    const text = textMatch ? (textMatch[1] || textMatch[2]) : null;
    const withoutText = line.replace(/'[^']*'|"[^"]*"/, "").trim();
    const tokens = withoutText.split(/\s+/);
    const type = tokens[0]?.toLowerCase();
    if (!type) continue;

    const typeMap = {
      rect: "rectangle", box: "rectangle", circle: "ellipse", oval: "ellipse",
      diamond: "diamond", arrow: "arrow", line: "line", text: "text",
      ellipse: "ellipse", rectangle: "rectangle",
    };
    const exType = typeMap[type];
    if (!exType) continue;

    const coordMatch = tokens[1]?.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    const x = coordMatch ? parseFloat(coordMatch[1]) : 0;
    const y = coordMatch ? parseFloat(coordMatch[2]) : 0;

    let width = 0, height = 0;
    const sizeToken = tokens.find(t => /^\d+x\d+$/.test(t));
    if (sizeToken) [width, height] = sizeToken.split("x").map(Number);

    let arrowEndX = 0, arrowEndY = 0;
    const arrowIdx = tokens.indexOf("->");
    if (arrowIdx >= 0 && tokens[arrowIdx + 1]) {
      const m = tokens[arrowIdx + 1].match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
      if (m) { arrowEndX = parseFloat(m[1]); arrowEndY = parseFloat(m[2]); }
    }

    const props = {};
    for (const t of tokens) {
      const kv = t.match(/^(\w+)=(.+)$/);
      if (kv) props[kv[1]] = kv[2];
    }

    const color = resolveColor(props.color);
    const fill = props.fill ? resolveFill(props.fill) : "transparent";
    const fontSize = props.size ? parseInt(props.size) : 20;

    const el = { type: exType, x, y, strokeColor: color, backgroundColor: fill };

    if (exType === "text") {
      el.text = text || props.label || "text";
      el.fontSize = fontSize;
      el.fontFamily = props.font ? parseInt(props.font) : 1;
      el.strokeWidth = 1;
      el.roughness = 0;
    } else if (exType === "arrow" || exType === "line") {
      if (arrowIdx >= 0) {
        el.width = arrowEndX - x;
        el.height = arrowEndY - y;
      } else {
        el.width = width || 100;
        el.height = height || 0;
      }
      el.points = [[0, 0], [el.width, el.height]];
      if (props.style) el.strokeStyle = props.style;
      if (exType === "arrow") {
        el.startArrowhead = ["arrow", "dot", "bar", "triangle"].includes(props.start) ? props.start : null;
        el.endArrowhead = props.end === "none" ? null : (props.end || "arrow");
      }
    } else {
      el.width = width || 160;
      el.height = height || 80;
    }

    elements.push(enrichElement(el));
  }
  return elements;
}
