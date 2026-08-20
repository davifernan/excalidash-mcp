/**
 * What `update_element` is allowed to change.
 *
 * It used to merge whatever JSON it was handed straight into the element, so a
 * call could set `isDeleted`, rewrite `id`, repoint a binding at a shape that
 * does not exist, or drop the marker that tells this server which elements are
 * its own. Those are not properties of a drawing, they are the bookkeeping the
 * board depends on. Only appearance and geometry are open.
 */
const APPEARANCE = [
  "strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle",
  "roughness", "opacity", "roundness", "angle",
];
const GEOMETRY = ["x", "y", "width", "height"];
const TEXT = ["fontSize", "fontFamily", "textAlign", "verticalAlign", "lineHeight", "text"];
const LINK = ["link"];

export const EDITABLE = new Set([...APPEARANCE, ...GEOMETRY, ...TEXT, ...LINK]);

/**
 * Fields that would break the board rather than restyle it. Named separately so
 * a caller trying one gets told why instead of a generic "unknown field".
 */
export const PROTECTED = new Set([
  "id", "type", "isDeleted", "version", "versionNonce", "updated", "seed",
  "containerId", "boundElements", "startBinding", "endBinding", "frameId", "index",
]);

/**
 * Split the requested changes into what will be applied and what will not.
 *
 * `customData` is merged rather than replaced: replacing it drops the ownership
 * marker, after which `replace` no longer recognises the element as its own and
 * leaves it behind forever.
 */
export function reviewChanges(changes, current = {}) {
  if (changes === null || typeof changes !== "object" || Array.isArray(changes)) {
    throw new Error("Properties must be a JSON object, e.g. {\"strokeColor\": \"#1971c2\"}.");
  }
  const applied = {};
  const protectedKeys = [];
  const unknown = [];

  for (const [key, value] of Object.entries(changes)) {
    if (key === "customData") {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("customData must be a JSON object.");
      }
      // The marker stays whatever it already was.
      const { source, ...rest } = value;
      applied.customData = { ...(current.customData || {}), ...rest };
      continue;
    }
    if (PROTECTED.has(key)) { protectedKeys.push(key); continue; }
    if (!EDITABLE.has(key)) { unknown.push(key); continue; }
    if (GEOMETRY.includes(key) || key === "fontSize" || key === "strokeWidth" || key === "opacity" || key === "angle") {
      if (!Number.isFinite(value)) throw new Error(`"${key}" must be a number, got ${JSON.stringify(value)}.`);
    }
    applied[key] = value;
  }
  return { applied, protectedKeys, unknown };
}
