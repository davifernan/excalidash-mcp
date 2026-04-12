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

export async function convertElements(simplifiedElements) {
  const page = await getPage();
  const result = await page.evaluate((elements) => {
    return window.convertToExcalidrawElements(elements);
  }, simplifiedElements);
  return result;
}

/**
 * Determine arrow fixedPoint based on relative position of source and target shapes.
 * Returns [startFixedPoint, endFixedPoint] normalized coordinates.
 */
function computeFixedPoints(fromShape, toShape) {
  const fcx = fromShape.x + (fromShape.width || 0) / 2;
  const fcy = fromShape.y + (fromShape.height || 0) / 2;
  const tcx = toShape.x + (toShape.width || 0) / 2;
  const tcy = toShape.y + (toShape.height || 0) / 2;

  const dx = tcx - fcx;
  const dy = tcy - fcy;

  // Determine primary direction
  if (Math.abs(dx) > Math.abs(dy)) {
    // Horizontal: left-right
    return dx > 0
      ? [[1, 0.5], [0, 0.5]]     // from right edge → to left edge
      : [[0, 0.5], [1, 0.5]];    // from left edge → to right edge
  } else {
    // Vertical: top-bottom
    return dy > 0
      ? [[0.5, 1], [0.5, 0]]     // from bottom edge → to top edge
      : [[0.5, 0], [0.5, 1]];    // from top edge → to bottom edge
  }
}

/**
 * Check if a shape is a "container" (large background shape with children inside).
 * These should NOT use label (which centers text) — instead pass label as free text.
 */
function isContainerShape(el, allElements) {
  const area = (el.width || 0) * (el.height || 0);
  if (area < 80000) return false; // smaller than ~280x280 → normal shape

  // Check if other shapes are positioned inside this one
  const childCount = allElements.filter(e =>
    e !== el &&
    ["rectangle", "ellipse", "diamond"].includes(e.type) &&
    e.x >= el.x && e.y >= el.y &&
    e.x + (e.width || 0) <= el.x + (el.width || 0) &&
    e.y + (e.height || 0) <= el.y + (el.height || 0)
  ).length;

  return childCount >= 1;
}

/**
 * Build simplified element input for convertToExcalidrawElements from our DSL output.
 */
export function toSimplifiedFormat(elements) {
  const shapeElements = elements.filter(e => ["rectangle", "ellipse", "diamond"].includes(e.type));
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

      const labelEl = elements.find(e => e.id === `${el.id}-label`);
      const detailEl = elements.find(e => e.id === `${el.id}-details`);
      const isContainer = isContainerShape(el, shapeElements);
      const hasDetails = !!detailEl;

      // Use label property ONLY for shapes without details and not containers
      // (label centers text, which conflicts with detail text below)
      if (labelEl && !hasDetails && !isContainer) {
        shape.label = { text: labelEl.text, fontSize: labelEl.fontSize || 16 };
      }

      simplified.push(shape);

      // For shapes with details OR containers: emit label as positioned free text
      if (labelEl && (hasDetails || isContainer)) {
        const labelY = hasDetails ? el.y + 10 : el.y + 10;
        simplified.push({
          type: "text",
          id: `${el.id}-label`,
          x: el.x + (el.width - (labelEl.text.length * (labelEl.fontSize || 16) * 0.6)) / 2,
          y: labelY,
          text: labelEl.text,
          fontSize: labelEl.fontSize || 16,
          strokeColor: labelEl.strokeColor || el.strokeColor,
          textAlign: "center",
        });
      }

      // Emit detail text below the label
      if (detailEl) {
        const labelHeight = labelEl ? (labelEl.fontSize || 16) * 1.25 + 6 : 0;
        simplified.push({
          type: "text",
          id: detailEl.id,
          x: el.x + 12,
          y: el.y + 10 + labelHeight,
          text: detailEl.text,
          fontSize: detailEl.fontSize || 12,
          textAlign: "left",
          strokeColor: detailEl.strokeColor || "#868e96",
        });
      }

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

      // Compute fixedPoints based on relative shape positions
      if (el.startBinding && el.endBinding) {
        const fromShape = shapeElements.find(s => s.id === el.startBinding.elementId);
        const toShape = shapeElements.find(s => s.id === el.endBinding.elementId);
        if (fromShape && toShape) {
          const [startFP, endFP] = computeFixedPoints(fromShape, toShape);
          arrow.startBinding = {
            elementId: el.startBinding.elementId,
            fixedPoint: startFP,
            gap: 10,
          };
          arrow.endBinding = {
            elementId: el.endBinding.elementId,
            fixedPoint: endFP,
            gap: 10,
          };
        }
      } else {
        if (el.startBinding) {
          arrow.startBinding = {
            elementId: el.startBinding.elementId,
            fixedPoint: el.startBinding.fixedPoint || [1, 0.5],
            gap: 10,
          };
        }
        if (el.endBinding) {
          arrow.endBinding = {
            elementId: el.endBinding.elementId,
            fixedPoint: el.endBinding.fixedPoint || [0, 0.5],
            gap: 10,
          };
        }
      }

      simplified.push(arrow);

    } else if (el.type === "text") {
      // Skip label/details — already handled above with shapes
      if (el.id?.endsWith("-label") || el.id?.endsWith("-details")) continue;

      // Arrow label: attach to preceding arrow
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
