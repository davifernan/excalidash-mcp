/**
 * Auto-layout for graph diagrams.
 *
 * The scene DSL asks the model for absolute pixel coordinates, which is where
 * most bad-looking diagrams come from: boxes drift out of alignment, arrows cut
 * straight through unrelated boxes, and edge labels land underneath them.
 *
 * Here the model describes only structure — nodes and edges — and dagre decides
 * the geometry. Box sizes are derived from the label text, and edge labels are
 * declared to dagre as real obstacles so it reserves space for them.
 */
import dagre from "@dagrejs/dagre";
import { resolveColor, resolveFill } from "./elements.js";
import { layoutLabels } from "./converter.js";

/**
 * Run dagre over the graph and return simplified elements ready for
 * convertToExcalidrawElements().
 *
 * @param {{nodes: Array, edges: Array, direction?: string, title?: string}} graph
 */
/**
 * Run dagre over the graph and return simplified elements ready for
 * convertToExcalidrawElements().
 *
 * @param {{nodes: Array, edges: Array, direction?: string, title?: string}} graph
 */
export async function layoutGraph({ nodes, edges, direction = "TB", title = null }) {
  const sized = await sizeNodes(nodes);
  const edgeLabelWidths = await measureEdgeLabels(edges);

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({
    rankdir: direction,
    nodesep: 70,      // within a rank
    ranksep: 130,     // between ranks — room for edge labels and arrowheads
    marginx: 40,
    marginy: 40,
    edgesep: 30,
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const [id, n] of sized) g.setNode(id, { width: n.width, height: n.height });

  // Declaring label size makes dagre reserve space, so labels stop landing on
  // top of the boxes they run between.
  edges.forEach((e, i) => {
    if (!sized.has(e.from) || !sized.has(e.to)) return;
    const lw = edgeLabelWidths.get(e.label);
    const label = e.label ? { width: Math.round(lw + 16), height: 24, labelpos: "c" } : {};
    g.setEdge(e.from, e.to, label, `e${i}`);
  });

  dagre.layout(g);

  // dagre positions nodes by centre; Excalidraw wants the top-left corner.
  for (const [id, node] of sized) {
    const pos = g.node(id);
    if (!pos) continue;
    node.box = {
      x: Math.round(pos.x - node.width / 2),
      y: Math.round(pos.y - node.height / 2),
      width: node.width,
      height: node.height,
    };
  }

  clearArrowCorridors(sized, edges, direction);

  const elements = [];
  for (const [id, node] of sized) {
    if (!node.box) continue;
    elements.push({
      type: node.shape || "rectangle",
      id,
      x: node.box.x,
      y: node.box.y,
      width: node.box.width,
      height: node.box.height,
      strokeColor: resolveColor(node.color),
      backgroundColor: node.fill ? resolveFill(node.fill) : "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      roughness: 0,
      roundness: { type: 3 },
      label: {
        text: node.text,
        fontSize: node.fontSize,
        // Stroke-coloured text on a pastel fill of the same hue is hard to read.
        strokeColor: "#1e1e1e",
      },
    });
  }

  // Several edges between the same pair of nodes share a midpoint, so their
  // labels would be drawn on top of each other. Count them up front to fan them
  // out below.
  const pairCount = new Map();
  const pairKey = (a, b) => [a, b].sort().join(" ");
  for (const e of edges) {
    if (!sized.has(e.from) || !sized.has(e.to)) continue;
    const k = pairKey(e.from, e.to);
    pairCount.set(k, (pairCount.get(k) || 0) + 1);
  }
  const pairSeen = new Map();

  edges.forEach((e, i) => {
    const from = sized.get(e.from);
    const to = sized.get(e.to);
    if (!from?.box || !to?.box) return;

    if (e.from === e.to) {
      elements.push(...selfLoop(from.box, e, e.id || `edge-${i}`));
      return;
    }

    const fc = centre(from.box);
    const tc = centre(to.box);
    let start = edgePoint(from.box, tc.x, tc.y);
    let end = edgePoint(to.box, fc.x, fc.y);

    // Put the breathing room into the points themselves. Leaving it to the
    // binding's gap makes Excalidraw re-project the endpoint after the arrowhead
    // has been placed, which shows up as a kinked, doubled-looking tip.
    const len = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const ux = (end.x - start.x) / len, uy = (end.y - start.y) / len;
    const AIR = 8;
    start = { x: start.x + ux * AIR, y: start.y + uy * AIR };
    end = { x: end.x - ux * AIR, y: end.y - uy * AIR };

    // Fan parallel edges apart: bow each one sideways by a different amount so
    // their midpoints — and therefore their labels — no longer coincide.
    const key = pairKey(e.from, e.to);
    const total = pairCount.get(key) || 1;
    const nth = pairSeen.get(key) || 0;
    pairSeen.set(key, nth + 1);

    const points = [[0, 0]];
    if (total > 1) {
      const spread = 34;
      // The perpendicular flips with the arrow's direction, so two opposing
      // edges given mirrored offsets end up bowing to the same side and drawn
      // on top of each other. Measuring from a fixed end of the pair keeps them
      // apart.
      const offset = (nth - (total - 1) / 2) * spread * (e.from > e.to ? -1 : 1);
      points.push([(end.x - start.x) / 2 - uy * offset, (end.y - start.y) / 2 + ux * offset]);
    }
    points.push([end.x - start.x, end.y - start.y]);

    const arrow = {
      type: "arrow",
      id: e.id || `edge-${i}`,
      x: start.x, y: start.y,
      width: end.x - start.x,
      height: end.y - start.y,
      points,
      strokeColor: resolveColor(e.color || "gray"),
      strokeWidth: 2,
      strokeStyle: e.style || "solid",
      roughness: 0,
      endArrowhead: "arrow",
      startArrowhead: null,
      // Referencing the shapes by id is what actually binds them: the library
      // fills in startBinding/endBinding *and* registers the arrow in each
      // shape's boundElements, so dragging a box afterwards drags the arrow
      // with it. Writing startBinding by hand only did half of that.
      start: { id: from.id },
      end: { id: to.id },
    };
    if (e.label && total === 1) {
      // A bound label is nicest: Excalidraw breaks the line around the text.
      arrow.label = { text: e.label, fontSize: 14, strokeColor: "#495057" };
    } else if (e.label) {
      // Bound labels always sit at the arrow's midpoint, so parallel edges would
      // stack their labels regardless of how far apart the arrows bow. Place
      // these ones manually: staggered along the edge and offset to one side.
      const LABEL_SIZE = 14;
      let t = total === 2 ? (nth === 0 ? 0.30 : 0.70) : 0.25 + (0.5 * nth) / Math.max(1, total - 1);
      let side = nth % 2 === 0 ? 1 : -1;

      // Opposing edges run in opposite directions, so a fraction along one arrow
      // and the same fraction along the other end up in the same place. Measure
      // from a fixed end of the pair instead.
      if (e.from > e.to) { t = 1 - t; side = -side; }

      const off = 18 * side;
      const px = start.x + (end.x - start.x) * t - uy * off;
      const py = start.y + (end.y - start.y) * t + ux * off;
      elements.push({
        type: "text",
        id: `${arrow.id}-label`,
        x: Math.round(px - (edgeLabelWidths.get(e.label) || 0) / 2),
        y: Math.round(py - LABEL_SIZE),
        text: e.label,
        fontSize: LABEL_SIZE,
        strokeColor: "#495057",
        textAlign: "left",
      });
    }
    elements.push(arrow);
  });

  // Title sits above the graph, aligned to its left edge. Centring it would mean
  // guessing the rendered text width, and a title that is off-centre by 40px
  // looks worse than one that is deliberately flush left.
  if (title) {
    const boxes = [...sized.values()].filter(n => n.box).map(n => n.box);
    const left = Math.min(...boxes.map(b => b.x));
    const top = Math.min(...boxes.map(b => b.y));
    elements.push({
      type: "text",
      id: "diagram-title",
      x: Number.isFinite(left) ? left : 40,
      y: (Number.isFinite(top) ? top : 40) - 70,
      text: title,
      fontSize: 28,
      strokeColor: "#1971c2",
      textAlign: "left",
    });
  }

  // Arrows first so they render behind the boxes they connect.
  const arrows = elements.filter(e => e.type === "arrow");
  const rest = elements.filter(e => e.type !== "arrow");
  return [...arrows, ...rest];
}

const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/**
 * An edge from a node to itself.
 *
 * Start and end coincide, so the generic path produced a zero-length arrow that
 * simply did not appear. Drawn instead as a loop off the right-hand side, with
 * the label beside it rather than bound to it — a bound label would sit in the
 * middle of the loop, on top of the box.
 */
function selfLoop(box, e, id) {
  // Wide enough that the two ends read as separate strands rather than a pinch.
  const R = 72;
  const spread = Math.max(46, box.height * 0.45);
  const mid = box.y + box.height / 2;
  const start = { x: box.x + box.width, y: Math.round(mid - spread / 2) };
  const end = { x: box.x + box.width, y: Math.round(mid + spread / 2) };
  const arrow = {
    type: "arrow",
    id,
    x: start.x,
    y: start.y,
    points: [
      [0, 0],
      [R, -R * 0.35],
      [R, end.y - start.y + R * 0.35],
      [end.x - start.x, end.y - start.y],
    ],
    strokeColor: resolveColor(e.color || "gray"),
    strokeWidth: 2,
    strokeStyle: e.style || "solid",
    roughness: 0,
    endArrowhead: "arrow",
    startArrowhead: null,
    roundness: { type: 2 },
    // Bound at both ends to the same shape, so the loop travels with it.
    start: { id: e.from },
    end: { id: e.from },
  };
  if (!e.label) return [arrow];
  return [
    arrow,
    {
      type: "text",
      id: `${id}-label`,
      x: Math.round(start.x + R + 10),
      y: Math.round((start.y + end.y) / 2 - 9),
      text: e.label,
      fontSize: 14,
      strokeColor: "#495057",
      textAlign: "left",
    },
  ];
}

/**
 * Move boxes out of the way of arrows that would otherwise run through them.
 *
 * dagre routes long edges around intervening nodes and hands back a polyline,
 * but a bent arrow reads worse than a straight one. So the straight line stays
 * and the box that stands in it steps aside instead — sideways within its own
 * rank, where moving it costs nothing structurally.
 *
 * Moving one box can push it into its neighbours, so each pass is followed by a
 * separation pass that restores the gap along the rank. Two or three passes
 * settle every graph seen so far; the cap stops a pathological one from
 * looping.
 */
function clearArrowCorridors(sized, edges, direction) {
  const boxes = [...sized.values()].filter(n => n.box);
  if (boxes.length < 3) return;

  // Ranks run across the flow direction: for a top-down graph a rank is a row,
  // so a node inside it may slide horizontally.
  const horizontal = direction === "LR" || direction === "RL";
  const along = horizontal ? "y" : "x";   // free axis within a rank
  const across = horizontal ? "x" : "y";  // fixed axis — the rank itself
  const size = horizontal ? "height" : "width";

  const ranks = new Map();
  for (const n of boxes) {
    const key = n.box[across];
    if (!ranks.has(key)) ranks.set(key, []);
    ranks.get(key).push(n);
  }

  const real = edges.filter(e => sized.has(e.from) && sized.has(e.to) && e.from !== e.to);

  for (let pass = 0; pass < 4; pass++) {
    let moved = false;

    for (const e of real) {
      const from = sized.get(e.from), to = sized.get(e.to);
      const fc = centre(from.box), tc = centre(to.box);
      const a = edgePoint(from.box, tc.x, tc.y);
      const b = edgePoint(to.box, fc.x, fc.y);

      for (const n of boxes) {
        if (n.id === e.from || n.id === e.to) continue;
        const push = escapeVector(n.box, a, b, along, size);
        if (!push) continue;
        n.box[along] += push;
        moved = true;
      }
    }

    if (!moved) break;
    for (const rank of ranks.values()) separate(rank, along, size);
  }
}

// How much clear space an arrow keeps from a box it passes. Generous on
// purpose: a line that just barely misses a corner still reads as touching it.
const CLEARANCE = 34;

/**
 * Distance the box has to travel along `along` to leave the arrow's corridor,
 * or 0 if it is already clear. Picks the shorter of the two ways out.
 */
function escapeVector(box, a, b, along, size) {
  const lo = box[along] - CLEARANCE;
  const hi = box[along] + box[size] + CLEARANCE;

  // The span the segment occupies on the free axis while it overlaps the box on
  // the other one. Only that stretch can actually collide.
  const other = along === "x" ? "y" : "x";
  const oLo = box[other] - CLEARANCE;
  const oHi = box[other] + (along === "x" ? box.height : box.width) + CLEARANCE;
  const span = segmentSpan(a, b, other, oLo, oHi, along);
  if (!span) return 0;
  if (span.max <= lo || span.min >= hi) return 0;

  const left = span.min - hi;   // negative: move box towards lower coordinates
  const right = span.max - lo;  // positive: move box towards higher coordinates
  return Math.abs(left) <= Math.abs(right) ? Math.round(left) : Math.round(right);
}

/** Range of `axis` covered by segment a→b while `other` stays inside [lo, hi]. */
function segmentSpan(a, b, other, lo, hi, axis) {
  const o0 = a[other], o1 = b[other];
  const d = o1 - o0;
  let t0 = 0, t1 = 1;
  if (d === 0) {
    if (o0 < lo || o0 > hi) return null;
  } else {
    t0 = (lo - o0) / d;
    t1 = (hi - o0) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    t0 = Math.max(0, t0);
    t1 = Math.min(1, t1);
    if (t0 > t1) return null;
  }
  const p0 = a[axis] + (b[axis] - a[axis]) * t0;
  const p1 = a[axis] + (b[axis] - a[axis]) * t1;
  return { min: Math.min(p0, p1), max: Math.max(p0, p1) };
}

/** Restore the minimum gap between boxes sharing a rank after one was moved. */
function separate(rank, along, size) {
  const GAP = 70;
  const sorted = [...rank].sort((p, q) => p.box[along] - q.box[along]);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1].box, cur = sorted[i].box;
    const overlap = prev[along] + prev[size] + GAP - cur[along];
    if (overlap > 0) cur[along] = Math.round(cur[along] + overlap);
  }
}

// Excalidraw's own padding between a container and the text bound inside it.
const BOUND_TEXT_PADDING = 5;
// Extra breathing room on top of that, so labels do not sit on the border.
const PAD = 16;
const LINE_H = 1.25;

const MIN_W = 140;
const MIN_H = 60;
const MAX_W = 260;   // wrap instead of growing endlessly wide

/**
 * Usable text width inside a container of the given outer width.
 *
 * Excalidraw only gives a bound label the full width in a rectangle. An ellipse
 * gets the inscribed rectangle, a diamond only half — which is why diamonds
 * used to clip their labels the hardest.
 */
function textWidthFor(shape, outerWidth) {
  const inner = outerWidth - 2 * PAD;
  if (shape === "ellipse") return Math.round((inner / 2) * Math.SQRT2) - 2 * BOUND_TEXT_PADDING;
  if (shape === "diamond") return Math.round(inner / 2) - 2 * BOUND_TEXT_PADDING;
  return inner - 2 * BOUND_TEXT_PADDING;
}

/** Inverse of textWidthFor: the container needed to hold text of this width. */
function outerFor(shape, textWidth, textHeight) {
  const w = textWidth + 2 * BOUND_TEXT_PADDING;
  const h = textHeight + 2 * BOUND_TEXT_PADDING;
  if (shape === "ellipse") {
    return { width: Math.ceil(w * Math.SQRT2) + 2 * PAD, height: Math.ceil(h * Math.SQRT2) + 2 * PAD };
  }
  if (shape === "diamond") {
    return { width: Math.ceil(w * 2) + 2 * PAD, height: Math.ceil(h * 2) + 2 * PAD };
  }
  return { width: Math.ceil(w) + 2 * PAD, height: Math.ceil(h) + 2 * PAD };
}

/**
 * Size every box from a real measurement of its label.
 *
 * This used to estimate width as characters × fontSize × 0.58, which is not
 * proportional for Excalifont: a label measuring 183px was estimated at 141px,
 * so the box came out too narrow and the label was clipped or broken mid-word.
 * Now the same font the export draws with does the measuring, and a box that
 * cannot fit an unbreakable word grows past MAX_W rather than tearing it apart.
 */
async function sizeNodes(nodes) {
  const wanted = nodes.map((n) => ({
    node: n,
    shape: n.shape || "rectangle",
    fontSize: Number.isFinite(n.fontSize) ? n.fontSize : 16,
    text: n.label || n.id,
  }));

  // First pass: how wide the label wants to be on a single line, and how wide
  // its longest unbreakable word is.
  const natural = await layoutLabels(
    wanted.map(({ text, fontSize }) => ({ text, fontSize, maxTextWidth: Infinity })),
  );

  // Second pass: every candidate wrap width for every node, in one batch.
  const candidates = wanted.map((want, i) => wrapCandidates(want, natural[i]));
  const flat = candidates.flat();
  const measured = await layoutLabels(
    flat.map(({ text, fontSize, maxTextWidth }) => ({ text, fontSize, maxTextWidth })),
  );

  const sized = new Map();
  let cursor = 0;
  wanted.forEach((want, i) => {
    const mine = measured.slice(cursor, cursor + candidates[i].length);
    cursor += candidates[i].length;
    const best = pickShape(want.shape, want.fontSize, mine);

    sized.set(want.node.id, {
      ...want.node,
      shape: want.shape,
      fontSize: want.fontSize,
      text: best.lines.join("\n"),
      width: Math.max(MIN_W, best.width),
      height: Math.max(MIN_H, best.height),
    });
  });
  return sized;
}

/**
 * The wrap widths worth measuring for one label.
 *
 * A rectangle simply wraps at MAX_W. The other shapes do not: Excalidraw gives
 * a diamond's bound label only half the container width, so where the line
 * breaks decides whether the shape comes out as a 7:1 splinter or a diamond.
 * Aiming for a line count instead of a fixed width gives something to choose
 * from.
 */
function wrapCandidates(want, natural) {
  const floor = Math.ceil(natural.widestWord);   // narrower would tear a word
  if (want.shape === "rectangle") {
    return [{ ...want, maxTextWidth: Math.max(floor, textWidthFor("rectangle", MAX_W)) }];
  }
  const out = [];
  for (let lines = 1; lines <= 4; lines++) {
    const width = Math.max(floor, Math.ceil(natural.width / lines));
    if (!out.some((c) => c.maxTextWidth === width)) out.push({ ...want, maxTextWidth: width });
  }
  return out;
}

// How wide a shape should be relative to its height. A diamond much flatter
// than this stops reading as a decision node; much taller wastes vertical room.
const TARGET_RATIO = { diamond: 1.9, ellipse: 2.2, rectangle: 2.6 };

/** Of the measured candidates, the one whose shape reads best. */
function pickShape(shape, fontSize, measurements) {
  const target = TARGET_RATIO[shape] ?? 2.6;
  let best = null;
  for (const m of measurements) {
    const textWidth = Math.max(m.width, m.widestWord);
    const textHeight = m.lines.length * fontSize * LINE_H;
    const outer = outerFor(shape, textWidth, textHeight);
    const ratio = outer.width / outer.height;
    // Being too flat is worse than being too tall, so penalise it harder.
    const off = ratio > target ? ratio / target : (target / ratio) * 0.7;
    const score = off + (outer.width * outer.height) / 4_000_000;
    if (!best || score < best.score) best = { score, lines: m.lines, ...outer };
  }
  return best;
}

/** Rendered widths of the distinct edge labels, for dagre and manual placement. */
async function measureEdgeLabels(edges) {
  const labels = [...new Set(edges.map((e) => e.label).filter(Boolean))];
  const widths = await layoutLabels(
    labels.map((text) => ({ text, fontSize: 14, maxTextWidth: Infinity })),
  );
  return new Map(labels.map((l, i) => [l, widths[i].width]));
}

function edgePoint(box, tx, ty) {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = tx - cx, dy = ty - cy;
  const hw = box.width / 2, hh = box.height / 2;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  if (Math.abs(dx) * hh > Math.abs(dy) * hw) {
    const sx = dx > 0 ? 1 : -1;
    return { x: cx + sx * hw, y: cy + dy * (hw / Math.abs(dx)) };
  }
  const sy = dy > 0 ? 1 : -1;
  return { x: cx + dx * (hh / Math.abs(dy)), y: cy + sy * hh };
}

/**
 * Graph DSL — structure only, no coordinates.
 *
 *   direction LR
 *   title 'Request Pipeline'
 *   node client 'Client' color=blue fill=blue
 *   node api 'Backend' shape=diamond
 *   edge client -> api 'HTTPS'
 */
export function parseGraphDSL(dsl) {
  const nodes = [];
  const edges = [];
  let direction = "TB";
  let title = null;

  const shapeMap = {
    rect: "rectangle", box: "rectangle", rectangle: "rectangle",
    circle: "ellipse", ellipse: "ellipse", oval: "ellipse",
    diamond: "diamond",
  };

  for (const raw of dsl.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    const quoted = [];
    const bare = line.replace(/'([^']*)'|"([^"]*)"/g, (_, a, b) => {
      quoted.push(a ?? b); return "";
    }).trim();
    const tokens = bare.split(/\s+/).filter(Boolean);
    const keyword = tokens[0]?.toLowerCase();

    const props = {};
    for (const t of tokens) {
      const kv = t.match(/^(\w+)=(.+)$/);
      if (kv) props[kv[1]] = kv[2];
    }

    if (keyword === "direction" || keyword === "rankdir") {
      const d = (tokens[1] || "").toUpperCase();
      if (["TB", "BT", "LR", "RL"].includes(d)) direction = d;
    } else if (keyword === "title") {
      title = quoted[0] || tokens.slice(1).join(" ") || null;
    } else if (keyword === "node") {
      const id = tokens[1];
      if (!id) continue;
      nodes.push({
        id,
        label: quoted[0] || id,
        shape: shapeMap[props.shape] || "rectangle",
        color: props.color,
        fill: props.fill || props.color,
        fontSize: props.size ? parseInt(props.size) : 16,
      });
    } else if (keyword === "edge") {
      const arrowIdx = tokens.indexOf("->");
      if (arrowIdx < 1 || !tokens[arrowIdx + 1]) continue;
      edges.push({
        from: tokens[arrowIdx - 1],
        to: tokens[arrowIdx + 1],
        label: quoted[0] || null,
        color: props.color,
        style: props.style,
      });
    }
  }

  return { nodes, edges, direction, title };
}
