/**
 * Base provider interface.
 * All providers must implement these methods.
 */
export class BaseProvider {
  /** Get a drawing by ID. Returns { elements, name, ...} or null. */
  async getDrawing(id) { throw new Error("Not implemented"); }

  /** Create a new drawing. Returns { id, name, ... }. */
  async createDrawing(name, elements, appState, files) { throw new Error("Not implemented"); }

  /** Update drawing elements. Returns updated drawing. */
  async updateDrawing(id, elements) { throw new Error("Not implemented"); }

  /** List all drawings. Returns [{ id, name }, ...]. */
  async listDrawings() { throw new Error("Not implemented"); }

  /** Push live update (if supported). No-op for file-based providers. */
  async pushLive(drawingId, elements, elementOrder) {}

  /** Join a collaboration room (if supported). No-op for file-based providers. */
  async joinRoom(drawingId) {}

  /** Get library items. Returns [{ name, elements }, ...] or []. */
  async getLibrary() { return []; }

  /** Whether this provider supports live updates. */
  get supportsLive() { return false; }

  /** Get the public URL for a drawing (if applicable). */
  getUrl(drawingId) { return null; }
}
