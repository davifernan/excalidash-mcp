/**
 * Keeping element relationships consistent when something is removed.
 *
 * Excalidraw stores a relationship twice: an arrow names the shape it is bound
 * to, and the shape lists the arrow in `boundElements`. Deleting one side used
 * to leave the other pointing at a tombstone, which shows up later as an arrow
 * that cannot be dragged or a shape that reports a label it no longer has.
 */

/**
 * Everything that has to go once `ids` do.
 *
 * A shape's label is a separate element bound to it, so deleting the shape and
 * leaving the label would strand text on the canvas. An arrow bound to a
 * deleted shape is left in place on purpose: it is a drawing of its own, and
 * removing an arrow because a box went away is more surprising than leaving it.
 */
export function expandDeletion(elements, ids) {
  const doomed = new Set(ids);
  for (const el of elements) {
    if (el.containerId && doomed.has(el.containerId)) doomed.add(el.id);
  }
  return doomed;
}

/**
 * Strip references to elements that are gone.
 *
 * Returns the elements that changed, so only those need to be sent to the
 * other clients.
 */
export function severReferences(elements, gone) {
  const touched = [];
  const next = elements.map((el) => {
    if (gone.has(el.id)) return el;
    let changed = null;

    const bound = el.boundElements?.filter((b) => !gone.has(b.id));
    if (bound && bound.length !== el.boundElements.length) {
      changed = { ...el, boundElements: bound };
    }
    for (const side of ["startBinding", "endBinding"]) {
      if (el[side] && gone.has(el[side].elementId)) {
        changed = { ...(changed || el), [side]: null };
      }
    }
    if (el.containerId && gone.has(el.containerId)) {
      changed = { ...(changed || el), containerId: null };
    }
    if (!changed) return el;
    touched.push(changed);
    return changed;
  });
  return { elements: next, touched };
}

/** Point every reference to `oldId` at `newId` instead. */
export function retargetReferences(elements, oldId, newId) {
  const touched = [];
  const next = elements.map((el) => {
    if (el.id === oldId) return el;
    let changed = null;

    if (el.containerId === oldId) changed = { ...el, containerId: newId };
    if (el.boundElements?.some((b) => b.id === oldId)) {
      changed = {
        ...(changed || el),
        boundElements: (changed || el).boundElements.map((b) => (b.id === oldId ? { ...b, id: newId } : b)),
      };
    }
    for (const side of ["startBinding", "endBinding"]) {
      if (el[side]?.elementId === oldId) {
        changed = { ...(changed || el), [side]: { ...el[side], elementId: newId } };
      }
    }
    if (!changed) return el;
    touched.push(changed);
    return changed;
  });
  return { elements: next, touched };
}

/**
 * Bring an element's dependants along after it was moved or resized.
 *
 * Excalidraw does this itself when a shape is dragged in the editor, but a
 * scripted write to x/y only writes x/y: the label stays where it was and the
 * arrows keep pointing at the old spot. Verified the ugly way — the assertions
 * all passed and the exported image showed an empty box with its caption
 * sitting somewhere else.
 *
 * Returns the changed elements. Arrows are only recomputed when they are
 * straight and bound at both ends; a bent or hand-drawn arrow keeps its shape,
 * because guessing a new path for it would destroy the one someone drew.
 */
export function reflowDependants(elements, movedId, before, edgePoint, centre) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const after = byId.get(movedId);
  if (!after || !before) return { touched: [], keptArrows: [] };

  const dx = (after.x ?? 0) - (before.x ?? 0);
  const dy = (after.y ?? 0) - (before.y ?? 0);
  const resized = after.width !== before.width || after.height !== before.height;
  if (!dx && !dy && !resized) return { touched: [], keptArrows: [] };

  const touched = [];
  const keptArrows = [];

  for (const el of elements) {
    if (el.containerId === movedId) {
      // A bound label sits centred in its container.
      touched.push({
        ...el,
        x: Math.round(after.x + (after.width - el.width) / 2),
        y: Math.round(after.y + (after.height - el.height) / 2),
      });
      continue;
    }
    if (el.type !== "arrow") continue;
    const startsHere = el.startBinding?.elementId === movedId;
    const endsHere = el.endBinding?.elementId === movedId;
    if (!startsHere && !endsHere) continue;

    const from = byId.get(el.startBinding?.elementId);
    const to = byId.get(el.endBinding?.elementId);
    if (!from || !to || from.id === to.id || el.points?.length !== 2) {
      keptArrows.push(el.id);
      continue;
    }
    const fc = centre(from), tc = centre(to);
    const start = edgePoint(from, tc.x, tc.y);
    const end = edgePoint(to, fc.x, fc.y);
    const len = Math.hypot(end.x - start.x, end.y - start.y) || 1;
    const ux = (end.x - start.x) / len, uy = (end.y - start.y) / len;
    const AIR = 8;
    const s = { x: start.x + ux * AIR, y: start.y + uy * AIR };
    const e = { x: end.x - ux * AIR, y: end.y - uy * AIR };
    touched.push({
      ...el,
      x: Math.round(s.x), y: Math.round(s.y),
      width: Math.round(e.x - s.x), height: Math.round(e.y - s.y),
      points: [[0, 0], [Math.round(e.x - s.x), Math.round(e.y - s.y)]],
    });
  }
  return { touched, keptArrows };
}
