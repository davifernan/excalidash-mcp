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
let _opening = null;

/**
 * The shared converter page, opened at most once.
 *
 * Two tool calls arriving together each used to launch their own browser and
 * the second overwrote the first, leaving a Chromium running with nobody
 * holding it. And when startup failed halfway, `_page` stayed set, so the next
 * call handed out a page that had never finished loading.
 */
async function getPage() {
  if (_page && !_page.isClosed()) return _page;
  if (!_opening) _opening = openPage().finally(() => { _opening = null; });
  return _opening;
}

async function openPage() {
  const { chromium } = await import("playwright");
  if (!_browser?.isConnected()) {
    _browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  }
  // Kept local until it is actually usable, so a failure leaves nothing behind
  // for the next call to trip over.
  const page = await _browser.newPage();
  try {
    await page.goto(`file://${HTML_PATH}`, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForFunction("window.__READY__ === true", { timeout: 15000 });
    await warmUpFonts(page);
  } catch (err) {
    await page.close().catch(() => {});
    throw err;
  }
  _page = page;
  return page;
}

/**
 * Draw one throwaway element before anything real is measured.
 *
 * Excalidraw registers its own font faces lazily, on the first export. Until
 * that has happened the document has no faces at all, so every measurement
 * falls back to the browser's substitute — which is what made containers come
 * out too small and clip their labels. Measured: a label that should be 183px
 * wide came out as 141px beforehand. One dummy export registers all 230 faces,
 * then wait for the set to settle.
 */
async function warmUpFonts(page) {
  await page.evaluate(async () => {
    const [probe] = window.convertToExcalidrawElements(
      [{ type: "text", x: 0, y: 0, text: "Ag", fontSize: 20 }],
      { regenerateIds: true },
    );
    await window.exportToCanvas({
      elements: [probe],
      appState: { exportBackground: false },
      files: {},
    });
    await document.fonts.ready;
    window.__FONTS_AFTER_WARMUP__ = [...document.fonts].map((f) => `${f.family}:${f.status}`);
  });
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

/**
 * Break labels into lines that fit their `maxTextWidth`, measured in the face
 * the export actually draws with. One round trip for the whole batch.
 *
 * Each result carries two widths: `width` is the widest resulting line, and
 * `widestWord` is the widest single word. A box narrower than `widestWord`
 * makes Excalidraw break that word mid-way, so it is reported separately
 * rather than hidden inside the wrap.
 */
export async function layoutLabels(items) {
  if (!items.length) return [];
  const page = await getPage();
  return page.evaluate((batch) => window.layoutLabels(batch), items);
}

/** Widths of the given strings in the export face. */
export async function measureStrings(strings, fontSize, family) {
  const page = await getPage();
  return page.evaluate(
    ({ strings, fontSize, family }) => window.measureStrings(strings, fontSize, family),
    { strings, fontSize, family },
  );
}

/** Release the headless browser held for conversions. */
export async function closeConverter() {
  const browser = _browser;
  _page = null;
  _browser = null;
  if (browser?.isConnected()) await browser.close().catch(() => {});
}

