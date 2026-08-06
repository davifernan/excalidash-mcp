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
 * Convert simplified elements to full Excalidraw elements via the official library.
 * Input: array of simplified elements (shapes with label, arrows with bindings, text)
 * Output: array of fully computed elements with exact dimensions and positioning.
 *
 * Detail text elements (id ending in -details) are passed through as-is since
 * the library doesn't handle free-floating text positioning.
 */
export async function convertElements(simplifiedElements) {
  // Send ALL elements through the library — including free texts.
  // This ensures every element gets proper Excalidraw properties and is
  // recognized by the browser's collaboration state.
  const page = await getPage();
  const converted = await page.evaluate((elements) => {
    return window.convertToExcalidrawElements(elements, { regenerateIds: false });
  }, simplifiedElements);

  return converted;
}

/**
 * Render elements to a PNG data URL using Excalidraw's own export.
 *
 * Screenshotting the editor means fighting its viewport: the drawing sits
 * wherever the canvas happens to be scrolled, and anything outside the window
 * is simply missing. Exporting the elements directly always frames the whole
 * drawing, needs no login, and is far faster.
 */
export async function renderPng(elements, { scale = 2, padding = 32, background = true } = {}) {
  const page = await getPage();
  return page.evaluate(async ({ elements, scale, padding, background }) => {
    const canvas = await window.exportToCanvas({
      elements,
      appState: { exportBackground: background, viewBackgroundColor: "#ffffff", exportPadding: padding },
      files: {},
      getDimensions: (w, h) => ({ width: w * scale, height: h * scale, scale }),
    });
    return canvas.toDataURL("image/png");
  }, { elements, scale, padding, background });
}

/** Release the headless browser held for conversions. */
export async function closeConverter() {
  const browser = _browser;
  _page = null;
  _browser = null;
  if (browser?.isConnected()) await browser.close().catch(() => {});
}
