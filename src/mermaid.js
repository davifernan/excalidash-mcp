import { convertMermaid } from "./converter.js";
import { checkIds } from "./validate.js";

export const MERMAID_CONFIG = Object.freeze({
  startOnLoad: false,
  maxEdges: 500,
  maxTextSize: 50000,
  themeVariables: { fontSize: "20px" },
});

/**
 * Turn Mermaid source into native, editable Excalidraw elements.
 *
 * Mermaid supports more diagram types than its Excalidraw converter can turn
 * into shapes. For those types the upstream library deliberately returns one
 * image and a binary file. ExcaliDash could store that, but doing so would
 * break the core promise of this tool: editable boxes, arrows and labels.
 */
export async function editableMermaidElements(source, converter = convertMermaid) {
  const definition = String(source ?? "").trim();
  if (!definition) throw new Error("The Mermaid definition is empty.");

  const { elements = [], files = {} } = await converter(definition, MERMAID_CONFIG);
  const images = elements.filter((element) => element.type === "image");
  if (images.length || Object.keys(files).length) {
    throw new Error(
      "This Mermaid definition can only be rendered as a flat image. " +
      "Use a flowchart, sequenceDiagram, classDiagram, stateDiagram or erDiagram to keep the board editable.",
    );
  }
  if (!elements.length) throw new Error("Mermaid produced no elements.");

  const problems = checkIds(elements.map((element) => element.id));
  if (problems.length) throw new Error(`Mermaid produced invalid element ids: ${problems.join(" ")}`);
  return elements;
}

/**
 * Reuse ids when a Mermaid diagram is redrawn in replace mode.
 *
 * The upstream converter intentionally generates fresh random ids. That is
 * right for inserting a new diagram in the editor, but a server-side redraw
 * would otherwise leave a fresh set of tombstones on every call. References
 * are remapped with the elements so bindings remain intact.
 */
export function stableMermaidIds(elements, prefix = "mermaid") {
  const renamed = new Map(elements.map((element, index) => [element.id, `${prefix}-${index}`]));
  const id = (value) => renamed.get(value) || value;
  return elements.map((element, index) => ({
    ...element,
    id: `${prefix}-${index}`,
    ...(element.containerId ? { containerId: id(element.containerId) } : {}),
    ...(element.frameId ? { frameId: id(element.frameId) } : {}),
    ...(element.boundElements ? {
      boundElements: element.boundElements.map((binding) => ({ ...binding, id: id(binding.id) })),
    } : {}),
    ...(element.startBinding ? {
      startBinding: { ...element.startBinding, elementId: id(element.startBinding.elementId) },
    } : {}),
    ...(element.endBinding ? {
      endBinding: { ...element.endBinding, elementId: id(element.endBinding.elementId) },
    } : {}),
  }));
}

/** Keep browser internals and local file paths out of MCP error responses. */
export function mermaidErrorMessage(error) {
  return String(error?.message || error || "Unknown conversion error")
    .replace(/^page\.evaluate:\s*/, "")
    .replace(/^Error:\s*/, "")
    .split(/\n\s+at\s/)[0]
    .slice(0, 1200);
}
