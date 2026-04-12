/**
 * Excalidraw element helpers — v2 simplified.
 *
 * The DSL parser outputs the simplified format that convertToExcalidrawElements()
 * understands directly. No intermediate enrichment layer.
 */

// ============================================================
// Color palette (from official excalidraw-mcp cheat sheet)
// ============================================================
export const COLORS = {
  blue: "#4a9eed", amber: "#f59e0b", green: "#22c55e", red: "#ef4444",
  purple: "#8b5cf6", pink: "#ec4899", cyan: "#06b6d4", lime: "#84cc16",
  black: "#1e1e1e", gray: "#868e96", white: "#ffffff",
  orange: "#f59e0b", yellow: "#f59e0b",
};

export const FILLS = {
  blue: "#a5d8ff", green: "#b2f2bb", orange: "#ffd8a8", purple: "#d0bfff",
  red: "#ffc9c9", yellow: "#fff3bf", teal: "#c3fae8", pink: "#eebefa",
  gray: "#dee2e6", cyan: "#c3fae8", lime: "#fff3bf", amber: "#ffd8a8",
};

export const ZONES = {
  blue: "#dbe4ff", purple: "#e5dbff", green: "#d3f9d8",
};

export function resolveColor(c) { return COLORS[c] || c || "#1e1e1e"; }
export function resolveFill(c) { return FILLS[c] || c || "transparent"; }

// ============================================================
// DSL Parser — outputs simplified format for convertToExcalidrawElements()
//
// Syntax:
//   TYPE [ID] x,y [WxH] [key=val...] ['label']
//   arrow [ID] x,y -> x2,y2 [from=ID] [to=ID] ['label']
//   # comments
//
// Output: array of simplified elements ready for the Excalidraw library.
// ============================================================

let _idCounter = 0;
function nextId() { return `el-${Date.now()}-${_idCounter++}`; }

/**
 * Compute fixedPoint for arrow binding based on relative shape positions.
 */
function computeFixedPoints(fromShape, toShape) {
  const fcx = fromShape.x + fromShape.width / 2;
  const fcy = fromShape.y + fromShape.height / 2;
  const tcx = toShape.x + toShape.width / 2;
  const tcy = toShape.y + toShape.height / 2;
  const dx = tcx - fcx, dy = tcy - fcy;

  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? [[1, 0.5], [0, 0.5]] : [[0, 0.5], [1, 0.5]];
  } else {
    return dy > 0 ? [[0.5, 1], [0.5, 0]] : [[0.5, 0], [0.5, 1]];
  }
}

/**
 * Compute arrow start position from source shape edge toward target.
 */
function edgePoint(shape, targetX, targetY) {
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  const dx = targetX - cx, dy = targetY - cy;
  const hw = shape.width / 2, hh = shape.height / 2;
  if (hw === 0 || hh === 0) return { x: cx, y: cy };

  if (Math.abs(dx) * hh > Math.abs(dy) * hw) {
    const sx = dx > 0 ? 1 : -1;
    return { x: cx + sx * hw, y: cy + dy * (hw / Math.abs(dx)) };
  } else {
    const sy = dy > 0 ? 1 : -1;
    return { x: cx + dx * (hh / Math.abs(dy)), y: cy + sy * hh };
  }
}

export function parseDSL(dsl) {
  const shapes = new Map();  // id -> shape element
  const elements = [];       // simplified elements (pass 1: shapes + text)
  const deferredArrows = []; // arrows resolved in pass 2

  for (const raw of dsl.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    // Extract quoted strings
    const quotedStrings = [];
    const withoutQuotes = line.replace(/'([^']*)'|"([^"]*)"/g, (_, s1, s2) => {
      quotedStrings.push(s1 || s2);
      return "";
    }).trim();
    const labelText = quotedStrings[0] || null;
    const detailsRaw = quotedStrings[1] || null;
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

    // ID detection
    let id = null, coordIdx = 1;
    if (tokens[1] && !tokens[1].includes(",") && !tokens[1].includes("=") && tokens[1] !== "->") {
      id = tokens[1];
      coordIdx = 2;
    }
    if (!id) id = nextId();

    // Coordinates
    const cm = tokens[coordIdx]?.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    const x = cm ? parseFloat(cm[1]) : 0;
    const y = cm ? parseFloat(cm[2]) : 0;

    // Size WxH
    let width = 0, height = 0;
    const sz = tokens.find(t => /^\d+x\d+$/.test(t));
    if (sz) [width, height] = sz.split("x").map(Number);

    // Arrow endpoint
    const arrowIdx = tokens.indexOf("->");
    let endX = 0, endY = 0;
    if (arrowIdx >= 0 && tokens[arrowIdx + 1]) {
      const m = tokens[arrowIdx + 1].match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
      if (m) { endX = parseFloat(m[1]); endY = parseFloat(m[2]); }
    }

    // Key=value props
    const props = {};
    for (const t of tokens) {
      const kv = t.match(/^(\w+)=(.+)$/);
      if (kv) props[kv[1]] = kv[2];
    }

    const color = resolveColor(props.color);
    const fill = props.fill ? resolveFill(props.fill) : "transparent";
    const fontSize = props.size ? parseInt(props.size) : 20;

    // === SHAPES ===
    if (exType === "rectangle" || exType === "ellipse" || exType === "diamond") {
      const w = width || 160, h = height || 80;
      const shape = {
        type: exType, id, x, y, width: w, height: h,
        strokeColor: color,
        backgroundColor: fill,
        fillStyle: fill !== "transparent" ? "solid" : "solid",
        strokeWidth: 2,
        roughness: 0,
        roundness: { type: 3 },
      };

      shapes.set(id, shape);

      // Detect if this is a large container shape (other shapes sit inside it)
      const isContainer = w * h > 100000; // ~316x316+

      if (labelText && !detailsRaw && !isContainer) {
        // Simple label — let the library auto-center it
        shape.label = { text: labelText, fontSize: Math.min(fontSize, 20) };
        elements.push(shape);
      } else if (labelText && !detailsRaw && isContainer) {
        // Container: label as free text at top-left
        elements.push(shape);
        elements.push({
          type: "text",
          id: `${id}-title`,
          x: x + 15,
          y: y + 12,
          text: labelText,
          fontSize: Math.min(fontSize, 20),
          strokeColor: color,
          textAlign: "left",
        });
      } else if (labelText && detailsRaw) {
        // Label + details — both as free text to avoid overlap
        elements.push(shape);

        const titleFontSize = Math.min(fontSize, 18);
        const detailFontSize = 12;
        const detailLines = detailsRaw.replace(/(?<! )\|(?! )/g, "\n");
        const numDetailLines = detailLines.split("\n").length;

        // Title centered at top of shape
        const titleWidth = labelText.length * titleFontSize * 0.5;
        elements.push({
          type: "text",
          id: `${id}-title`,
          x: x + (w - titleWidth) / 2,
          y: y + 8,
          text: labelText,
          fontSize: titleFontSize,
          strokeColor: color,
          textAlign: "center",
        });

        // Details below title
        elements.push({
          type: "text",
          id: `${id}-details`,
          x: x + 12,
          y: y + 8 + titleFontSize * 1.3,
          text: detailLines,
          fontSize: detailFontSize,
          strokeColor: "#868e96",
          textAlign: "left",
        });

        // Auto-expand shape height if needed
        const neededH = 8 + titleFontSize * 1.3 + numDetailLines * detailFontSize * 1.4 + 12;
        if (shape.height < neededH) shape.height = neededH;
      } else {
        elements.push(shape);
      }

    // === TEXT ===
    } else if (exType === "text") {
      elements.push({
        type: "text", id, x, y,
        text: labelText || "text",
        fontSize: fontSize,
        strokeColor: color,
        textAlign: props.align || "left",
      });

    // === ARROWS ===
    } else if (exType === "arrow" || exType === "line") {
      const dx = arrowIdx >= 0 ? endX - x : (width || 100);
      const dy = arrowIdx >= 0 ? endY - y : (height || 0);

      const arrow = {
        type: exType, id, x, y,
        width: dx, height: dy,
        points: [[0, 0], [dx, dy]],
        strokeColor: color,
        strokeWidth: 2,
        strokeStyle: props.style || "solid",
        roughness: 0,
      };

      if (exType === "arrow") {
        arrow.endArrowhead = props.end === "none" ? null : (props.end || "arrow");
        arrow.startArrowhead = ["arrow", "dot", "bar", "triangle"].includes(props.start) ? props.start : null;
      }

      if (props.from || props.to) {
        deferredArrows.push({ arrow, from: props.from, to: props.to, labelText });
      } else {
        if (labelText) arrow.label = { text: labelText, fontSize: 14 };
        elements.push(arrow);
      }
    }
  }

  // Pass 2: Resolve arrow bindings
  for (const { arrow, from, to, labelText } of deferredArrows) {
    const fromShape = from ? shapes.get(from) : null;
    const toShape = to ? shapes.get(to) : null;

    if (fromShape && toShape) {
      const [startFP, endFP] = computeFixedPoints(fromShape, toShape);
      const fromCenter = { x: fromShape.x + fromShape.width / 2, y: fromShape.y + fromShape.height / 2 };
      const toCenter = { x: toShape.x + toShape.width / 2, y: toShape.y + toShape.height / 2 };
      const start = edgePoint(fromShape, toCenter.x, toCenter.y);
      const end = edgePoint(toShape, fromCenter.x, fromCenter.y);

      arrow.x = start.x;
      arrow.y = start.y;
      arrow.width = end.x - start.x;
      arrow.height = end.y - start.y;
      arrow.points = [[0, 0], [arrow.width, arrow.height]];
      arrow.startBinding = { elementId: fromShape.id, fixedPoint: startFP, gap: 10 };
      arrow.endBinding = { elementId: toShape.id, fixedPoint: endFP, gap: 10 };
    } else {
      if (fromShape) {
        arrow.startBinding = { elementId: fromShape.id, fixedPoint: [1, 0.5], gap: 10 };
      }
      if (toShape) {
        arrow.endBinding = { elementId: toShape.id, fixedPoint: [0, 0.5], gap: 10 };
      }
    }

    elements.push(arrow);

    // Arrow label as free text above the arrow midpoint (not on the arrow)
    if (labelText) {
      const midX = arrow.x + (arrow.width || 0) / 2;
      const midY = arrow.y + (arrow.height || 0) / 2;
      const isVertical = Math.abs(arrow.height || 0) > Math.abs(arrow.width || 0);
      const labelW = labelText.length * 14 * 0.5;
      elements.push({
        type: "text",
        id: `${arrow.id}-label`,
        x: isVertical ? midX + 10 : midX - labelW / 2,
        y: isVertical ? midY - 10 : midY - 20,
        text: labelText,
        fontSize: 13,
        strokeColor: arrow.strokeColor || "#868e96",
        textAlign: "center",
      });
    }
  }

  return elements;
}
