/**
 * Checks on what a caller asked for, before any of it reaches the board.
 *
 * These all used to pass silently and show up later as something missing from
 * the drawing: a second node with a name already in use simply replaced the
 * first while the reply still counted both, and `size=foo` became NaN, which
 * propagates through every measurement into an element with no dimensions.
 */

/** Ids the layout generates itself; a caller taking one would collide with it. */
export const RESERVED = new Set(["diagram-title"]);
const GENERATED = /^edge-\d+$/;

/** Names that cannot be used, with the reason. */
export function checkIds(ids, { generatedSuffixes = ["-label"] } = {}) {
  const problems = [];
  const seen = new Set();

  for (const id of ids) {
    if (typeof id !== "string" || !id.trim()) {
      problems.push(`"${id}" is not a usable name.`);
      continue;
    }
    if (seen.has(id)) { problems.push(`"${id}" is used more than once.`); continue; }
    seen.add(id);

    if (RESERVED.has(id)) problems.push(`"${id}" is reserved for the drawing itself.`);
    else if (GENERATED.test(id)) problems.push(`"${id}" looks like a generated edge name — pick another.`);
    else if (generatedSuffixes.some((s) => id.endsWith(s))) {
      problems.push(`"${id}" ends in "${generatedSuffixes.find((s) => id.endsWith(s))}", which is added to generated labels — pick another.`);
    }
  }
  return problems;
}

/** A positive number, or an error naming what was actually passed. */
export function checkNumber(value, label, { min = 1, max = 400 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number, got "${value}".`);
  if (n < min || n > max) throw new Error(`${label} must be between ${min} and ${max}, got ${n}.`);
  return n;
}
