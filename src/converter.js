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
  // Separate free-positioned texts (library doesn't handle these well)
  const freeTexts = simplifiedElements.filter(e =>
    e.id?.endsWith("-details") || e.id?.endsWith("-title")
  );
  const forLibrary = simplifiedElements.filter(e =>
    !e.id?.endsWith("-details") && !e.id?.endsWith("-title")
  );

  const page = await getPage();
  const converted = await page.evaluate((elements) => {
    return window.convertToExcalidrawElements(elements);
  }, forLibrary);

  // Enrich free texts with required Excalidraw properties
  const enrichedFreeTexts = freeTexts.map(t => ({
    angle: 0,
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 2147483647),
    version: 2,
    versionNonce: Math.floor(Math.random() * 2147483647),
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
    fontFamily: 3,
    verticalAlign: "top",
    containerId: null,
    originalText: t.text,
    autoResize: true,
    lineHeight: 1.25,
    baseline: Math.round((t.fontSize || 14) * 0.89),
    backgroundColor: "transparent",
    width: (t.text || "").split("\n").reduce((max, line) => Math.max(max, line.length), 0) * (t.fontSize || 14) * 0.6,
    height: (t.text || "").split("\n").length * (t.fontSize || 14) * 1.25,
    ...t,
  }));

  return [...converted, ...enrichedFreeTexts];
}
