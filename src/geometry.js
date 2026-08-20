/** Where a line from the centre of `box` towards (tx, ty) crosses its border. */
export function edgePoint(box, tx, ty) {
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

export const centre = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
