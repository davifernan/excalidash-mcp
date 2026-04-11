/**
 * File-based provider — reads/writes .excalidraw JSON files.
 * No live updates, no server needed. Works with vanilla Excalidraw.
 *
 * Env vars:
 *   EXCALIDRAW_DIR  (default: ./drawings)
 */
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { BaseProvider } from "./base.js";

export class FileProvider extends BaseProvider {
  constructor(opts = {}) {
    super();
    this.dir = opts.dir || process.env.EXCALIDRAW_DIR || "./drawings";
  }

  get supportsLive() { return false; }

  getUrl(drawingId) { return join(this.dir, `${drawingId}.excalidraw`); }

  #filePath(id) { return join(this.dir, `${id}.excalidraw`); }

  async #ensureDir() {
    await mkdir(this.dir, { recursive: true });
  }

  async getDrawing(id) {
    try {
      const raw = await readFile(this.#filePath(id), "utf-8");
      const data = JSON.parse(raw);
      return { id, name: data.name || id, elements: data.elements || [], appState: data.appState || {}, files: data.files || {} };
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }

  async createDrawing(name, elements = [], appState = {}, files = {}) {
    await this.#ensureDir();
    const id = `drawing-${Date.now()}`;
    const data = { type: "excalidraw", version: 2, source: "excalidraw-mcp", name, elements, appState: { ...appState, viewBackgroundColor: appState.viewBackgroundColor || "#ffffff" }, files };
    await writeFile(this.#filePath(id), JSON.stringify(data, null, 2));
    return { id, name };
  }

  async updateDrawing(id, elements) {
    const existing = await this.getDrawing(id);
    if (!existing) throw new Error(`Drawing ${id} not found`);
    const data = { type: "excalidraw", version: 2, source: "excalidraw-mcp", name: existing.name, elements, appState: existing.appState || { viewBackgroundColor: "#ffffff" }, files: existing.files || {} };
    await writeFile(this.#filePath(id), JSON.stringify(data, null, 2));
    return { id, name: existing.name, elements };
  }

  async listDrawings() {
    await this.#ensureDir();
    const files = await readdir(this.dir);
    const drawings = [];
    for (const f of files) {
      if (!f.endsWith(".excalidraw")) continue;
      const id = basename(f, ".excalidraw");
      try {
        const raw = await readFile(join(this.dir, f), "utf-8");
        const data = JSON.parse(raw);
        drawings.push({ id, name: data.name || id });
      } catch { drawings.push({ id, name: id }); }
    }
    return drawings;
  }
}
