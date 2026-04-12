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
    roughness: 0,       // crisp/modern (not hand-drawn)
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
// Shape + label + details helper
//
// Layout inside shape:
//   ┌──────────────────┐
//   │  Title (bold/big) │  ← label, centered horizontally, near top
//   │  detail line 1    │  ← details, smaller, left-aligned below title
//   │  detail line 2    │
//   └──────────────────────┘
// ============================================================
export function createShapeWithLabel(shapeProps, labelText, labelProps = {}) {
  const titleFontSize = labelProps.fontSize || 16;
  const fontFamily = labelProps.fontFamily || 1;
  const mult = FONT_WIDTH[fontFamily] || 0.6;
  const detailText = labelProps.details || null;
  const padding = 12;
  const titleLineHeight = titleFontSize * 1.25;

  // Auto-size shape height based on content
  let requiredHeight = padding * 2 + titleLineHeight;
  let detailFontSize = 12;
  let detailLines = [];

  if (detailText) {
    detailFontSize = Math.max(11, titleFontSize - 4);
    detailLines = detailText.split("\\n");
    const detailHeight = detailLines.length * detailFontSize * 1.4;
    requiredHeight = padding + titleLineHeight + 6 + detailHeight + padding;
  }

  // Expand shape if content doesn't fit
  if (shapeProps.height && shapeProps.height < requiredHeight) {
    shapeProps.height = requiredHeight;
  } else if (!shapeProps.height) {
    shapeProps.height = requiredHeight;
  }

  // Also ensure width fits the detail text (generous — 0.7x for safety)
  if (detailLines.length > 0) {
    const maxDetailLen = Math.max(...detailLines.map(l => l.length));
    const detailTextWidth = maxDetailLen * detailFontSize * 0.7 + padding * 2;
    if (!shapeProps.width || shapeProps.width < detailTextWidth) {
      shapeProps.width = detailTextWidth;
    }
  }

  const shape = enrichElement(shapeProps);
  if (!labelText) return [shape];

  const elements = [shape];

  // Title text — centered horizontally, near top of shape
  const titleWidth = labelText.length * titleFontSize * mult;
  const titleY = detailText
    ? shape.y + padding
    : shape.y + (shape.height - titleLineHeight) / 2;
  const titleX = shape.x + (shape.width - titleWidth) / 2;

  elements.push(enrichElement({
    type: "text",
    id: `${shape.id}-label`,
    text: labelText,
    fontSize: titleFontSize,
    fontFamily,
    strokeColor: labelProps.strokeColor || shape.strokeColor,
    textAlign: "center",
    verticalAlign: "top",
    strokeWidth: 1,
    roughness: 0,
    x: titleX,
    y: titleY,
    width: titleWidth,
    height: titleLineHeight,
    originalText: labelText,
    autoResize: true,
  }));

  // Detail text — smaller, left-aligned, below title
  if (detailText && detailLines.length > 0) {
    const detailHeight = detailLines.length * detailFontSize * 1.4;
    const maxLineLen = Math.max(...detailLines.map(l => l.length));
    const detailWidth = maxLineLen * detailFontSize * 0.7; // generous width

    elements.push(enrichElement({
      type: "text",
      id: `${shape.id}-details`,
      text: detailLines.join("\n"),
      fontSize: detailFontSize,
      fontFamily,
      strokeColor: resolveColor("gray"),
      textAlign: "left",
      verticalAlign: "top",
      strokeWidth: 1,
      roughness: 0,
      x: shape.x + padding,
      y: titleY + titleLineHeight + 6,
      width: detailWidth,
      height: detailHeight,
      originalText: detailLines.join("\n"),
      autoResize: true,
    }));
  }

  return elements;
}

// ============================================================
// Arrow with bindings helper
// ============================================================
function shapeCenter(el) {
  return { x: el.x + (el.width || 0) / 2, y: el.y + (el.height || 0) / 2 };
}

function shapeEdgePoint(shape, targetX, targetY) {
  // Find the point on the shape edge closest to the target direction
  const cx = shape.x + (shape.width || 0) / 2;
  const cy = shape.y + (shape.height || 0) / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;
  const hw = (shape.width || 0) / 2;
  const hh = (shape.height || 0) / 2;

  if (hw === 0 || hh === 0) return { x: cx, y: cy };

  // Determine which edge to use based on direction
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);

  if (absDx * hh > absDy * hw) {
    // Hit left or right edge
    const signX = dx > 0 ? 1 : -1;
    return { x: cx + signX * hw, y: cy + dy * (hw / absDx) };
  } else {
    // Hit top or bottom edge
    const signY = dy > 0 ? 1 : -1;
    return { x: cx + dx * (hh / absDy), y: cy + signY * hh };
  }
}

export function createBoundArrow(arrowProps, fromShapeId, toShapeId, allElements) {
  const fromShape = fromShapeId ? allElements.find(e => e.id === fromShapeId) : null;
  const toShape = toShapeId ? allElements.find(e => e.id === toShapeId) : null;

  // Auto-calculate arrow coordinates from shape edges
  if (fromShape && toShape) {
    const fromCenter = shapeCenter(fromShape);
    const toCenter = shapeCenter(toShape);
    const startPt = shapeEdgePoint(fromShape, toCenter.x, toCenter.y);
    const endPt = shapeEdgePoint(toShape, fromCenter.x, fromCenter.y);
    const gap = 8;

    // Adjust for gap
    const dx = endPt.x - startPt.x;
    const dy = endPt.y - startPt.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > gap * 2) {
      const nx = dx / len, ny = dy / len;
      startPt.x += nx * gap;
      startPt.y += ny * gap;
      endPt.x -= nx * gap;
      endPt.y -= ny * gap;
    }

    arrowProps.x = startPt.x;
    arrowProps.y = startPt.y;
    arrowProps.width = endPt.x - startPt.x;
    arrowProps.height = endPt.y - startPt.y;
    arrowProps.points = [[0, 0], [arrowProps.width, arrowProps.height]];
  }

  const arrow = enrichElement({ type: "arrow", ...arrowProps });

  if (fromShape) {
    arrow.startBinding = { elementId: fromShape.id, focus: 0, gap: 8, fixedPoint: null };
    fromShape.boundElements = [...(fromShape.boundElements || []), { id: arrow.id, type: "arrow" }];
  }

  if (toShape) {
    arrow.endBinding = { elementId: toShape.id, focus: 0, gap: 8, fixedPoint: null };
    toShape.boundElements = [...(toShape.boundElements || []), { id: arrow.id, type: "arrow" }];
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
  // Two-pass parsing:
  // Pass 1: Parse all lines into intermediate records, create shapes first
  // Pass 2: Resolve arrow bindings (from=/to=) now that all shapes exist
  const elements = [];
  const idMap = new Map();
  const deferredArrows = []; // arrows with from=/to= to resolve in pass 2

  for (const raw of dsl.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    // Extract ALL quoted strings (first = label, second = details if present)
    const quotedStrings = [];
    const withoutQuotes = line.replace(/'([^']*)'|"([^"]*)"/g, (_, s1, s2) => {
      quotedStrings.push(s1 || s2);
      return "";
    }).trim();
    const text = quotedStrings[0] || null;
    const quotedDetails = quotedStrings[1] || null;
    const tokens = withoutQuotes.split(/\s+/).filter(Boolean);

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
        ...(dslId ? { id: dslId } : {}),
        text: text || props.label || "text",
        fontSize, fontFamily: props.font ? parseInt(props.font) : 3,
        strokeColor: color, strokeWidth: 1, roughness: 0,
      });
      if (dslId) idMap.set(dslId, el);
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

      if (dslId) arrowEl.id = dslId;

      if (props.from || props.to) {
        // Defer to pass 2 — target shapes may not exist yet
        deferredArrows.push({ arrowEl, from: props.from, to: props.to, dslId, text, props });
      } else {
        // No binding — create immediately
        const arrow = enrichElement(arrowEl);
        if (dslId) idMap.set(dslId, arrow);
        elements.push(arrow);
        // Arrow label
        if (text) {
          const labelFontSize = props.labelsize ? parseInt(props.labelsize) : 13;
          const labelWidth = text.length * labelFontSize * 0.55;
          const aw = arrow.width || 0, ah = arrow.height || 0;
          const isVertical = Math.abs(ah) > Math.abs(aw);
          const offsetX = isVertical ? 10 : -labelWidth / 2;
          const offsetY = isVertical ? -labelFontSize / 2 : -labelFontSize - 4;
          elements.push(enrichElement({
            type: "text",
            x: arrow.x + aw / 2 + offsetX,
            y: arrow.y + ah / 2 + offsetY,
            text, fontSize: labelFontSize, fontFamily: 3,
            strokeColor: resolveColor(props.color || "gray"),
            strokeWidth: 1, roughness: 0,
          }));
        }
      }

    } else {
      // Shape (rect, ellipse, diamond) with optional label
      const w = width || 160, h = height || 80;
      const shapeProps = {
        type: exType, x, y, width: w, height: h,
        strokeColor: color, backgroundColor: fill,
      };

      // Use DSL ID as element ID if provided (descriptive, readable)
      if (dslId) shapeProps.id = dslId;

      if (text) {
        // Details: from second quoted string or props
        // Pipe WITHOUT surrounding spaces = line break: "line1|line2"
        // Pipe WITH spaces = literal separator: "A | B | C" stays one line
        const rawDetails = props.details || quotedDetails || null;
        const detailStr = rawDetails
          ? rawDetails.replace(/(?<! )\|(?! )/g, "\\n")
          : null;
        const shapeEls = createShapeWithLabel(shapeProps, text, {
          strokeColor: color,
          fontSize: Math.min(fontSize, 18),
          details: detailStr,
        });
        if (dslId) idMap.set(dslId, shapeEls[0]);
        elements.push(...shapeEls);
      } else {
        const shape = enrichElement(shapeProps);
        if (dslId) idMap.set(dslId, shape);
        elements.push(shape);
      }
    }
  }

  // Pass 2: Resolve deferred arrows (from=/to= bindings)
  for (const { arrowEl, from, to, dslId, text, props } of deferredArrows) {
    const arrow = createBoundArrow(arrowEl, from, to, elements);
    if (dslId) idMap.set(dslId, arrow);
    elements.push(arrow);

    if (text) {
      const labelFontSize = props.labelsize ? parseInt(props.labelsize) : 13;
      const labelWidth = text.length * labelFontSize * 0.55;
      const aw = arrow.width || 0, ah = arrow.height || 0;
      const isVertical = Math.abs(ah) > Math.abs(aw);
      const offsetX = isVertical ? 10 : -labelWidth / 2;
      const offsetY = isVertical ? -labelFontSize / 2 : -labelFontSize - 4;
      elements.push(enrichElement({
        type: "text",
        x: arrow.x + aw / 2 + offsetX,
        y: arrow.y + ah / 2 + offsetY,
        text, fontSize: labelFontSize, fontFamily: 3,
        strokeColor: resolveColor(props.color || "gray"),
        strokeWidth: 1, roughness: 0,
      }));
    }
  }

  return elements;
}
