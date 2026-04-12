/**
 * Excalidraw element converter using Playwright + @excalidraw/excalidraw.
 * Runs convertToExcalidrawElements() in a headless browser for pixel-perfect results.
 */
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const HTML_PATH = resolve(__dirname, "converter.html");

let _browser = null;
let _page = null;

async function getPage() {
  if (_page && !_page.isClosed()) return _page;

  const { chromium } = await import("playwright");
  if (!_browser?.isConnected()) {
    _browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  }
  _page = await _browser.newPage();
  await _page.goto(`file://${HTML_PATH}`, { waitUntil: "networkidle", timeout: 30000 });
  await _page.waitForFunction("window.__READY__ === true", { timeout: 15000 });
  return _page;
}

/**
 * Convert simplified Excalidraw elements to full elements using the official library.
 *
 * Input format (simplified):
 *   - Shapes: { type, id, x, y, width, height, backgroundColor, label: { text, fontSize } }
 *   - Arrows: { type: "arrow", id, x, y, width, height, points, startBinding, endBinding, label }
 *   - Text:   { type: "text", id, x, y, text, fontSize }
 *
 * Returns fully computed elements with exact text dimensions, centered labels,
 * proper bindings, and all required Excalidraw properties.
 */
export async function convertElements(simplifiedElements) {
  const page = await getPage();

  const result = await page.evaluate((elements) => {
    return window.convertToExcalidrawElements(elements);
  }, simplifiedElements);

  return result;
}

/**
 * Build simplified element input for convertToExcalidrawElements from our DSL output.
 * Maps our internal format to the official simplified format.
 */
export function toSimplifiedFormat(elements) {
  // Track which IDs are shapes (for arrow binding references)
  const shapeIds = new Set();
  const idMap = new Map(); // our ID -> our element

  for (const el of elements) {
    if (el.id) idMap.set(el.id, el);
    if (["rectangle", "ellipse", "diamond"].includes(el.type)) {
      shapeIds.add(el.id);
    }
  }

  const simplified = [];

  for (const el of elements) {
    if (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") {
      const shape = {
        type: el.type,
        id: el.id,
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        backgroundColor: el.backgroundColor || "transparent",
        strokeColor: el.strokeColor || "#1e1e1e",
        fillStyle: el.fillStyle || "solid",
        strokeWidth: el.strokeWidth || 2,
        roughness: el.roughness ?? 0,
        opacity: el.opacity || 100,
        roundness: el.roundness || { type: 3 },
      };

      // Find associated label text (id-label)
      const labelEl = elements.find(e => e.id === `${el.id}-label`);
      if (labelEl) {
        shape.label = { text: labelEl.text, fontSize: labelEl.fontSize || 16 };
      }

      simplified.push(shape);

    } else if (el.type === "arrow" || el.type === "line") {
      const arrow = {
        type: el.type,
        id: el.id,
        x: el.x,
        y: el.y,
        width: el.width || 0,
        height: el.height || 0,
        points: el.points || [[0, 0], [el.width || 100, el.height || 0]],
        strokeColor: el.strokeColor || "#1e1e1e",
        strokeWidth: el.strokeWidth || 2,
        strokeStyle: el.strokeStyle || "solid",
        roughness: el.roughness ?? 0,
      };

      if (el.type === "arrow") {
        arrow.endArrowhead = el.endArrowhead ?? "arrow";
        arrow.startArrowhead = el.startArrowhead ?? null;
      }

      if (el.startBinding) {
        arrow.startBinding = {
          elementId: el.startBinding.elementId,
          fixedPoint: el.startBinding.fixedPoint || [1, 0.5],
          gap: el.startBinding.gap || 10,
        };
      }
      if (el.endBinding) {
        arrow.endBinding = {
          elementId: el.endBinding.elementId,
          fixedPoint: el.endBinding.fixedPoint || [0, 0.5],
          gap: el.endBinding.gap || 10,
        };
      }

      simplified.push(arrow);

    } else if (el.type === "text") {
      // Skip label/details texts handled via shape.label
      if (el.id?.endsWith("-label") || el.id?.endsWith("-details")) continue;

      // Check if this text is an arrow label (small font, near an arrow)
      // If so, attach it to the preceding arrow via label property
      const prevArrow = simplified[simplified.length - 1];
      if (prevArrow && (prevArrow.type === "arrow" || prevArrow.type === "line") && el.fontSize && el.fontSize <= 14) {
        prevArrow.label = { text: el.text, fontSize: el.fontSize };
        continue;
      }

      simplified.push({
        type: "text",
        id: el.id,
        x: el.x,
        y: el.y,
        text: el.text,
        fontSize: el.fontSize || 20,
        textAlign: el.textAlign || "left",
        strokeColor: el.strokeColor || "#1e1e1e",
      });
    }
  }

  return simplified;
}
