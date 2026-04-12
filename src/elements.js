/**
 * Excalidraw element builder & helpers.
 * Produces well-formed elements with proper text centering and arrow bindings.
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
export const FONT_WIDTH = { 1: 0.6, 2: 0.55, 3: 0.55 }; // Virgil, Helvetica, Cascadia
let idCounter = 0;

export function makeId() { return `xmcp-${Date.now()}-${idCounter++}`; }

function baseProps(el) {
  return {
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
    seed: Math.floor(Math.random() * 2147483647),
    version: 2,
    versionNonce: Math.floor(Math.random() * 2147483647),
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
    ...el,
  };
}

export function enrichElement(el) {
  const enriched = baseProps(el);

  // Roundness per type
  if (!enriched.roundness && enriched.type !== "text") {
    if (enriched.type === "line" || enriched.type === "arrow") {
      enriched.roundness = { type: 2 };
    } else if (enriched.type === "diamond" || enriched.type === "rectangle" || enriched.type === "ellipse") {
      enriched.roundness = { type: 3 };
    }
  }
  if (enriched.type === "text") enriched.roundness = null;

  // Text-specific
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

  // Arrow/line
  if (enriched.type === "arrow" || enriched.type === "line") {
    enriched.points = enriched.points || [[0, 0], [enriched.width || 100, enriched.height || 0]];
    enriched.lastCommittedPoint = null;
    if (enriched.type === "arrow") {
      enriched.startArrowhead = enriched.startArrowhead ?? null;
      enriched.endArrowhead = enriched.endArrowhead ?? "arrow";
      enriched.startBinding = enriched.startBinding ?? null;
      enriched.endBinding = enriched.endBinding ?? null;
    }
  }

  return enriched;
}

// ============================================================
// Shape + label helper (creates properly bound shape + text)
// ============================================================
export function createShapeWithLabel(shapeProps, labelText, labelProps = {}) {
  const shape = enrichElement(shapeProps);
  if (!labelText) return [shape];

  const fontSize = labelProps.fontSize || 16;
  const fontFamily = labelProps.fontFamily || 1;
  const labelId = `${shape.id}-label`;

  // Shape gets boundElements reference to label
  shape.boundElements = [...(shape.boundElements || []), { id: labelId, type: "text" }];

  // Label is centered inside the shape via containerId
  const label = enrichElement({
    type: "text",
    id: labelId,
    text: labelText,
    fontSize,
    fontFamily,
    strokeColor: labelProps.strokeColor || shape.strokeColor,
    containerId: shape.id,
    textAlign: "center",
    verticalAlign: "middle",
    strokeWidth: 1,
    roughness: 0,
    // Position at shape center (browser will auto-adjust with containerId)
    x: shape.x + shape.width / 2,
    y: shape.y + shape.height / 2,
    originalText: labelText,
    autoResize: true,
  });

  return [shape, label];
}

// ============================================================
// Arrow with bindings helper
// ============================================================
export function createBoundArrow(arrowProps, fromShapeId, toShapeId, allElements) {
  const arrow = enrichElement({ type: "arrow", ...arrowProps });

  // Bind to source shape
  if (fromShapeId) {
    const fromShape = allElements.find(e => e.id === fromShapeId || e._dslId === fromShapeId);
    if (fromShape) {
      arrow.startBinding = {
        elementId: fromShape.id,
        focus: 0,
        gap: 8,
        fixedPoint: null,
      };
      // Add arrow to shape's boundElements
      fromShape.boundElements = [...(fromShape.boundElements || []), { id: arrow.id, type: "arrow" }];
    }
  }

  // Bind to target shape
  if (toShapeId) {
    const toShape = allElements.find(e => e.id === toShapeId || e._dslId === toShapeId);
    if (toShape) {
      arrow.endBinding = {
        elementId: toShape.id,
        focus: 0,
        gap: 8,
        fixedPoint: null,
      };
      toShape.boundElements = [...(toShape.boundElements || []), { id: arrow.id, type: "arrow" }];
    }
  }

  return arrow;
}

// ============================================================
// DSL parser for draw_scene
//
// Syntax:
//   TYPE [ID] x,y [WxH] [key=val ...] ['label text']
//   arrow [ID] x,y -> x2,y2 [from=ID] [to=ID] [key=val ...] ['label']
//
// IDs allow arrows to bind to shapes:
//   rect frontend 100,100 200x100 color=blue fill=blue 'Frontend'
//   rect backend 400,100 200x100 color=green fill=green 'Backend'
//   arrow 300,150 -> 400,150 from=frontend to=backend color=gray 'API'
// ============================================================
export function parseDSL(dsl) {
  const elements = [];
  const idMap = new Map(); // DSL ID -> element

  for (const raw of dsl.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    // Extract quoted text
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

    // Check if second token is an ID (not coordinates, not key=val, not ->)
    let dslId = null;
    let coordTokenIdx = 1;
    if (tokens[1] && !tokens[1].includes(",") && !tokens[1].includes("=") && tokens[1] !== "->") {
      dslId = tokens[1];
      coordTokenIdx = 2;
    }

    // Parse coordinates
    const coordMatch = tokens[coordTokenIdx]?.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    const x = coordMatch ? parseFloat(coordMatch[1]) : 0;
    const y = coordMatch ? parseFloat(coordMatch[2]) : 0;

    // Parse size (WxH)
    let width = 0, height = 0;
    const sizeToken = tokens.find(t => /^\d+x\d+$/.test(t));
    if (sizeToken) [width, height] = sizeToken.split("x").map(Number);

    // Parse arrow target: -> x,y
    let arrowEndX = 0, arrowEndY = 0;
    const arrowIdx = tokens.indexOf("->");
    if (arrowIdx >= 0 && tokens[arrowIdx + 1]) {
      const m = tokens[arrowIdx + 1].match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
      if (m) { arrowEndX = parseFloat(m[1]); arrowEndY = parseFloat(m[2]); }
    }

    // Parse key=value pairs
    const props = {};
    for (const t of tokens) {
      const kv = t.match(/^(\w+)=(.+)$/);
      if (kv) props[kv[1]] = kv[2];
    }

    const color = resolveColor(props.color);
    const fill = props.fill ? resolveFill(props.fill) : "transparent";
    const fontSize = props.size ? parseInt(props.size) : 20;

    if (exType === "text") {
      // Free-standing text
      const el = enrichElement({
        type: "text", x, y,
        text: text || props.label || "text",
        fontSize, fontFamily: props.font ? parseInt(props.font) : 1,
        strokeColor: color, strokeWidth: 1, roughness: 0,
      });
      if (dslId) { el._dslId = dslId; idMap.set(dslId, el); }
      elements.push(el);

    } else if (exType === "arrow" || exType === "line") {
      // Arrow/line
      const dx = arrowIdx >= 0 ? arrowEndX - x : (width || 100);
      const dy = arrowIdx >= 0 ? arrowEndY - y : (height || 0);

      const arrowEl = {
        type: exType, x, y, width: dx, height: dy,
        points: [[0, 0], [dx, dy]],
        strokeColor: color,
        strokeStyle: props.style || "solid",
      };
      if (exType === "arrow") {
        arrowEl.startArrowhead = ["arrow", "dot", "bar", "triangle"].includes(props.start) ? props.start : null;
        arrowEl.endArrowhead = props.end === "none" ? null : (props.end || "arrow");
      }

      // Bindings
      if (props.from || props.to) {
        const arrow = createBoundArrow(arrowEl, props.from, props.to, elements);
        if (dslId) { arrow._dslId = dslId; idMap.set(dslId, arrow); }
        elements.push(arrow);
      } else {
        const arrow = enrichElement(arrowEl);
        if (dslId) { arrow._dslId = dslId; idMap.set(dslId, arrow); }
        elements.push(arrow);
      }

      // Arrow label
      if (text) {
        elements.push(enrichElement({
          type: "text",
          x: x + dx / 2 - 20, y: y + dy / 2 - 15,
          text, fontSize: 14, fontFamily: 1,
          strokeColor: resolveColor(props.color || "gray"),
          strokeWidth: 1, roughness: 0,
        }));
      }

    } else {
      // Shape (rect, ellipse, diamond) with optional label
      const w = width || 160, h = height || 80;
      const shapeProps = {
        type: exType, x, y, width: w, height: h,
        strokeColor: color, backgroundColor: fill,
      };

      if (text) {
        const [shape, label] = createShapeWithLabel(shapeProps, text, { strokeColor: color, fontSize: Math.min(fontSize, 18) });
        if (dslId) { shape._dslId = dslId; idMap.set(dslId, shape); }
        elements.push(shape, label);
      } else {
        const shape = enrichElement(shapeProps);
        if (dslId) { shape._dslId = dslId; idMap.set(dslId, shape); }
        elements.push(shape);
      }
    }
  }

  // Clean up internal _dslId before returning
  return elements.map(el => { const { _dslId, ...rest } = el; return rest; });
}
