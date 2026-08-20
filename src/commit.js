import { VersionConflictError } from "./excalidash.js";

/**
 * Read the board, change it, write it back — and start over if someone else
 * wrote in between.
 *
 * Every tool used to do its own read-modify-write over the whole element array
 * with no version attached, so anything a person drew between the read and the
 * write was simply overwritten. The version turns the write into a
 * compare-and-swap; on a conflict the board is read again and `mutate` runs
 * against the newer state, which merges by element id.
 *
 * The broadcast happens after the write succeeds. Broadcasting first meant a
 * failed write left every open editor showing something that was never saved.
 */
export async function commit(provider, boardId, mutate, { attempts = 4 } = {}) {
  await provider.joinRoom(boardId);

  for (let attempt = 1; ; attempt++) {
    const drawing = await provider.getDrawing(boardId);
    if (!drawing) throw new Error(`Board ${boardId} not found`);

    const outcome = await mutate(drawing.elements || [], drawing);
    if (!outcome) return null;

    try {
      await provider.updateDrawing(boardId, outcome.elements, drawing.version);
    } catch (err) {
      if (err instanceof VersionConflictError && attempt < attempts) continue;
      if (err instanceof VersionConflictError) {
        throw new Error(
          `The board kept changing while this was being written (${attempts} attempts). ` +
          `Someone is drawing on it right now — try again in a moment.`);
      }
      throw err;
    }

    const live = outcome.live ?? [];
    if (live.length) {
      const order = outcome.elements.filter((e) => !e.isDeleted).map((e) => e.id);
      await provider.pushLive(boardId, live, order);
    }
    return outcome.value ?? null;
  }
}

