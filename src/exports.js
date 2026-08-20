/**
 * Guards for the PNG export.
 *
 * Both inputs used to be taken as given: `output` was any path the process
 * could write, and `url` was anything fetchable. Neither is safe when the
 * caller is an agent acting on board content, which is text other people can
 * write — a board can ask for an export of a cloud metadata endpoint, or for
 * one written over a config file.
 */
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

/** Directory exports are written to. Everything else is refused. */
export const exportDir = () => resolve(process.env.EXCALIDASH_EXPORT_DIR || tmpdir());

/**
 * Absolute path for an export, or an error if it would land outside the export
 * directory. A caller may choose the file name, not the location.
 */
export function exportPath(output, dir = exportDir()) {
  if (!output) return join(dir, `excalidash-export-${Date.now()}.png`);
  const full = resolve(dir, output);
  if (full !== dir && !full.startsWith(dir + sep)) {
    throw new Error(
      `Exports are written inside ${dir}. "${output}" points outside it. ` +
      `Pass a plain file name, or set EXCALIDASH_EXPORT_DIR.`);
  }
  return full;
}

/** The url, if it is an http(s) address on this instance. Otherwise an error. */
export function checkedUrl(url, publicUrl) {
  let target;
  try { target = new URL(url); } catch { throw new Error(`"${url}" is not a URL.`); }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error(`Only http(s) URLs can be exported, got "${target.protocol}".`);
  }
  const own = new URL(publicUrl);
  if (target.host !== own.host) {
    throw new Error(
      `Only boards on ${own.host} can be exported, "${target.host}" is somewhere else. ` +
      `Pass board_id instead of url.`);
  }
  return target.toString();
}
