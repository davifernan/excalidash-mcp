/**
 * The agent's cursor on the board.
 *
 * ExcaliDash relays `cursor-move` to everyone in a drawing's room and stamps
 * the sender's presence identity on it, and the editor renders whatever arrives
 * as an Excalidraw collaborator: pointer, button and selection. So the agent
 * can show up like any other person on the board, gliding to what it just
 * changed, without anything new on the ExcaliDash side.
 *
 * The animation runs in the background. A tool returns as soon as the write is
 * done; people watching the board see the cursor arrive a moment later.
 */

const ON = new Set(["on", "true", "1", "yes"]);
const OFF = new Set(["", "off", "false", "0", "no"]);

/** EXCALIDASH_CURSOR, read strictly: a typo should not silently mean "off". */
export function cursorEnabled(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (ON.has(v)) return true;
  if (OFF.has(v)) return false;
  throw new Error(`EXCALIDASH_CURSOR must be "on" or "off", got "${value}".`);
}

/** The box around the elements, arrows and lines included by their points. */
export function boundsOf(elements, { includeDeleted = false } = {}) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    if (!el || (el.isDeleted && !includeDeleted)) continue;
    const x = el.x ?? 0, y = el.y ?? 0;
    const corners = Array.isArray(el.points) && el.points.length
      ? el.points.map(([px, py]) => [x + px, y + py])
      : [[x, y], [x + (el.width ?? 0), y + (el.height ?? 0)]];
    for (const [cx, cy] of corners) {
      minX = Math.min(minX, cx); minY = Math.min(minY, cy);
      maxX = Math.max(maxX, cx); maxY = Math.max(maxY, cy);
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const round = (n) => Math.round(n * 100) / 100;

export class Cursor {
  /** Where the cursor was left on each board, so the next glide starts there. */
  #last = new Map();
  /** One animation per board: a newer call takes over from one still running. */
  #generation = new Map();

  constructor(provider, {
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    stepMs = 40,
    glideSteps = 15,
    holdMs = 2000,
    laserSteps = 28,
  } = {}) {
    this.provider = provider;
    this.sleep = sleep;
    this.stepMs = stepMs;
    this.glideSteps = glideSteps;
    this.holdMs = holdMs;
    this.laserSteps = laserSteps;
  }

  /**
   * Show the cursor on `elements`: glide there, select them, hold, let go.
   * With `laser` it circles them with a laser trail instead of selecting, and
   * `select: false` points without selecting (a bare spot has nothing to select).
   *
   * Resolves once it is known whether the cursor can be shown at all, with
   * `done` for the animation itself. When it cannot, `reason` says why, so the
   * agent does not believe it pointed at something nobody saw.
   */
  async point(boardId, elements, { laser = false, select = true } = {}) {
    await this.provider.joinRoom(boardId);
    if (!this.provider.presenceIn(boardId)) {
      return {
        shown: false,
        reason: "could not join the board's live room (ExcaliDash before 0.6.9 refuses API keys there " +
          "unless the board has a share link)",
        done: Promise.resolve(),
      };
    }

    const live = elements.filter((e) => e && !e.isDeleted);
    const box = boundsOf(live) ?? boundsOf(elements, { includeDeleted: true });
    if (!box) return { shown: false, reason: "nothing to point at", done: Promise.resolve() };

    // A label inside a shape is selected through the shape; selecting it on its
    // own draws a second box inside the first.
    const selected = laser || !select ? {} : Object.fromEntries(
      live.filter((e) => !e.containerId).map((e) => [e.id, true]));

    const generation = (this.#generation.get(boardId) ?? 0) + 1;
    this.#generation.set(boardId, generation);
    const current = () => this.#generation.get(boardId) === generation;

    const done = this.#animate(boardId, box, selected, laser, current).catch(() => {});
    return { shown: true, done };
  }

  async #animate(boardId, box, selected, laser, current) {
    const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    const ring = laser ? this.#ring(box) : null;
    const target = ring ? ring[0] : centre;
    const from = this.#last.get(boardId) ?? { x: target.x - 160, y: target.y - 120 };

    const send = (p, extra = {}) => {
      this.#last.set(boardId, { x: p.x, y: p.y });
      return this.provider.pushCursor(boardId, {
        pointer: { x: round(p.x), y: round(p.y), tool: extra.tool ?? "pointer" },
        button: extra.button ?? "up",
        selectedElementIds: extra.selected ?? {},
      });
    };

    for (let i = 1; i <= this.glideSteps; i++) {
      if (!current()) return;
      const t = ease(i / this.glideSteps);
      const p = { x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t };
      const last = i === this.glideSteps;
      await send(p, { selected: last ? selected : {} });
      if (!last) await this.sleep(this.stepMs);
    }

    if (ring) {
      for (const p of ring) {
        await this.sleep(this.stepMs);
        if (!current()) return;
        await send(p, { tool: "laser", button: "down" });
      }
      // Excalidraw ends a collaborator's laser trail only when the button comes up.
      await send(ring.at(-1), { tool: "laser", button: "up" });
      return;
    }

    await this.sleep(this.holdMs);
    if (!current()) return;
    await send(target, { selected: {} });
  }

  /** An ellipse just outside the box, starting and ending at its left edge. */
  #ring(box) {
    const pad = 24;
    const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) / 2;
    const rx = (box.maxX - box.minX) / 2 + pad, ry = (box.maxY - box.minY) / 2 + pad;
    return Array.from({ length: this.laserSteps + 1 }, (_, i) => {
      const a = Math.PI + (2 * Math.PI * i) / this.laserSteps;
      return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
    });
  }
}
