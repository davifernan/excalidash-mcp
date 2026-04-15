/**
 * Excalidraw element helpers — v2.1
 *
 * Changes from v2:
 * - Shapes with details: single multi-line label instead of separate texts
 * - Arrow labels: always via arrow.label (library places them)
 * - Z-ordering: arrows behind shapes
 * - Post-processing: overlap detection + spacing fix
 */

// ============================================================
// Color palette
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

export function resolveColor(c) { return COLORS[c] || c || "#1e1e1e"; }
export function resolveFill(c) { return FILLS[c] || c || "transparent"; }

// ============================================================
// DSL Parser
// ============================================================
let _idCounter = 0;
function nextId(name) {
  if (name) return name;
  return `el-${Date.now()}-${_idCounter++}`;
}

function computeFixedPoints(fromShape, toShape) {
  const dx = (toShape.x + toShape.width / 2) - (fromShape.x + fromShape.width / 2);
  const dy = (toShape.y + toShape.height / 2) - (fromShape.y + fromShape.height / 2);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx > 0 ? [[1, 0.5], [0, 0.5]] : [[0, 0.5], [1, 0.5]];
  } else {
    return dy > 0 ? [[0.5, 1], [0.5, 0]] : [[0.5, 0], [0.5, 1]];
  }
}

function edgePoint(shape, tx, ty) {
  const cx = shape.x + shape.width / 2, cy = shape.y + shape.height / 2;
  const dx = tx - cx, dy = ty - cy;
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
  const shapes = new Map();
  const elements = [];
  const deferredArrows = [];

  for (const raw of dsl.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    const quotedStrings = [];
    const withoutQuotes = line.replace(/'([^']*)'|"([^"]*)"/g, (_, s1, s2) => {
      quotedStrings.push(s1 || s2); return "";
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

    let id = null, coordIdx = 1;
    if (tokens[1] && !tokens[1].includes(",") && !tokens[1].includes("=") && tokens[1] !== "->") {
      id = tokens[1]; coordIdx = 2;
    }

    // Also check name=xxx in props (parsed later, but peek here for ID)
    const nameToken = tokens.find(t => /^name=/.test(t));
    if (!id && nameToken) id = nameToken.split("=")[1];
    if (!id) id = nextId();

    const cm = tokens[coordIdx]?.match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
    const x = cm ? parseFloat(cm[1]) : 0;
    const y = cm ? parseFloat(cm[2]) : 0;

    let width = 0, height = 0;
    const sz = tokens.find(t => /^\d+x\d+$/.test(t));
    if (sz) [width, height] = sz.split("x").map(Number);

    const arrowIdx = tokens.indexOf("->");
    let endX = 0, endY = 0;
    if (arrowIdx >= 0 && tokens[arrowIdx + 1]) {
      const m = tokens[arrowIdx + 1].match(/^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/);
      if (m) { endX = parseFloat(m[1]); endY = parseFloat(m[2]); }
    }

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
        strokeWidth: 2, roughness: 0,
        roundness: { type: 3 },
      };

      shapes.set(id, shape);
      const isContainer = w * h > 100000;

      if (isContainer && labelText) {
        // Container: label as free text at top-left (not centered)
        elements.push(shape);
        elements.push({
          type: "text", id: `${id}-title`,
          x: x + 15, y: y + 12,
          text: labelText,
          fontSize: Math.min(fontSize, 20),
          strokeColor: color, textAlign: "left",
        });
      } else if (labelText) {
        // Normal shape: combine title + details into one multi-line label
        // The library auto-centers and auto-sizes this
        let fullLabel = labelText;
        if (detailsRaw) {
          const detailLines = detailsRaw.replace(/(?<! )\|(?! )/g, "\n");
          fullLabel = labelText + "\n" + detailLines;
        }
        shape.label = { text: fullLabel, fontSize: Math.min(fontSize, 16) };
        elements.push(shape);
      } else {
        elements.push(shape);
      }

    // === TEXT ===
    } else if (exType === "text") {
      elements.push({
        type: "text", id, x, y,
        text: labelText || "text",
        fontSize, strokeColor: color,
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
        strokeColor: color, strokeWidth: 2,
        strokeStyle: props.style || "solid",
        roughness: 0,
      };

      if (exType === "arrow") {
        arrow.endArrowhead = props.end === "none" ? null : (props.end || "arrow");
        arrow.startArrowhead = ["arrow", "dot", "bar", "triangle"].includes(props.start) ? props.start : null;
      }

      // Always use arrow.label for labels (library places them properly)
      if (labelText) {
        arrow.label = { text: labelText, fontSize: 14 };
      }

      if (props.from || props.to) {
        deferredArrows.push({ arrow, from: props.from, to: props.to });
      } else {
        elements.push(arrow);
      }
    }
  }

  // Pass 2: Resolve arrow bindings
  for (const { arrow, from, to } of deferredArrows) {
    const fromShape = from ? shapes.get(from) : null;
    const toShape = to ? shapes.get(to) : null;

    if (fromShape && toShape) {
      const [startFP, endFP] = computeFixedPoints(fromShape, toShape);
      const fc = { x: fromShape.x + fromShape.width / 2, y: fromShape.y + fromShape.height / 2 };
      const tc = { x: toShape.x + toShape.width / 2, y: toShape.y + toShape.height / 2 };
      const start = edgePoint(fromShape, tc.x, tc.y);
      const end = edgePoint(toShape, fc.x, fc.y);
      arrow.x = start.x; arrow.y = start.y;
      arrow.width = end.x - start.x; arrow.height = end.y - start.y;
      arrow.points = [[0, 0], [arrow.width, arrow.height]];
      arrow.startBinding = { elementId: fromShape.id, fixedPoint: startFP, gap: 10 };
      arrow.endBinding = { elementId: toShape.id, fixedPoint: endFP, gap: 10 };
    } else {
      if (fromShape) arrow.startBinding = { elementId: fromShape.id, fixedPoint: [1, 0.5], gap: 10 };
      if (toShape) arrow.endBinding = { elementId: toShape.id, fixedPoint: [0, 0.5], gap: 10 };
    }

    elements.push(arrow);
  }

  // Pass 3: Z-ordering — arrows behind shapes, text on top
  return zOrder(elements);
}

// ============================================================
// Z-ordering: array order = render order (first = back)
// Order: arrows → container shapes → regular shapes → text
// ============================================================
function zOrder(elements) {
  const arrows = [];
  const containers = [];
  const shapes = [];
  const texts = [];

  for (const el of elements) {
    if (el.type === "arrow" || el.type === "line") {
      arrows.push(el);
    } else if (["rectangle", "ellipse", "diamond"].includes(el.type) && (el.width || 0) * (el.height || 0) > 100000) {
      containers.push(el);
    } else if (["rectangle", "ellipse", "diamond"].includes(el.type)) {
      shapes.push(el);
    } else {
      texts.push(el);
    }
  }

  // Arrows first (back), then containers, then shapes, then text (front)
  return [...arrows, ...containers, ...shapes, ...texts];
}
