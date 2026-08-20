import { convertToExcalidrawElements, exportToCanvas } from "@excalidraw/excalidraw";
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";

window.convertToExcalidrawElements = convertToExcalidrawElements;
window.exportToCanvas = exportToCanvas;
window.parseMermaidToExcalidraw = async (definition, config) => {
  const { elements, files = {} } = await parseMermaidToExcalidraw(definition, config);
  return {
    // This is the same finalisation step used by Excalidraw's own Mermaid
    // dialog. Regenerating ids also works around duplicate edge ids produced
    // by some valid Mermaid graphs with parallel connections.
    elements: convertToExcalidrawElements(elements, { regenerateIds: true }),
    files,
  };
};

const measurementContext = document.createElement("canvas").getContext("2d");
const fontOf = (size, family) => `${size}px ${family || "Excalifont"}`;

const ensureLoaded = async (font, text) => {
  try {
    await document.fonts.load(font, text);
  } catch {
    // The caller still gets a deterministic measurement if a glyph has no bundled face.
  }
};

window.measureStrings = async (strings, fontSize, family) => {
  const font = fontOf(fontSize, family);
  await ensureLoaded(font, strings.join(""));
  measurementContext.font = font;
  return strings.map((string) => measurementContext.measureText(string).width);
};

window.layoutLabels = async (items) => {
  const allText = items.map((item) => String(item.text)).join("");
  await Promise.all(
    [...new Set(items.map((item) => fontOf(item.fontSize, item.family)))]
      .map((font) => ensureLoaded(font, allText)),
  );

  return items.map(({ text, fontSize, maxTextWidth, family }) => {
    measurementContext.font = fontOf(fontSize, family);
    const widthOf = (string) => measurementContext.measureText(string).width;
    const lines = [];
    let widestWord = 0;

    for (const paragraph of String(text).split("\n")) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (!words.length) {
        lines.push("");
        continue;
      }
      let line = "";
      for (const word of words) {
        widestWord = Math.max(widestWord, widthOf(word));
        const candidate = line ? `${line} ${word}` : word;
        if (line && widthOf(candidate) > maxTextWidth) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      lines.push(line);
    }

    const width = lines.reduce((maximum, line) => Math.max(maximum, widthOf(line)), 0);
    return { lines, width, widestWord };
  });
};

window.__READY__ = true;
