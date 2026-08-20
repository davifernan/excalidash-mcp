import { test } from "node:test";
import assert from "node:assert/strict";
import { commit } from "../src/commit.js";
import { VersionConflictError } from "../src/excalidash.js";

/**
 * A board that behaves like the backend: writes carry the version they were
 * based on, and a stale one is refused.
 */
function fakeBoard(initial = []) {
  const state = { version: 1, elements: initial, live: [], writes: 0, joined: 0 };
  return {
    state,
    joinRoom: async () => { state.joined++; },
    getDrawing: async () => ({ version: state.version, elements: state.elements }),
    updateDrawing: async (_id, elements, version) => {
      state.writes++;
      if (version !== undefined && version !== state.version) {
        throw new VersionConflictError(state.version);
      }
      state.elements = elements;
      state.version++;
    },
    pushLive: async (_id, els) => { state.live.push(els.map((e) => e.id)); },
    getUrl: (id) => `https://example.test/editor/${id}`,
    /** What a person drawing in the browser does between the read and the write. */
    somebodyElseDraws(el) {
      state.elements = [...state.elements, el];
      state.version++;
    },
  };
}

const el = (id) => ({ id, type: "rectangle", version: 1 });

test("writes through when nothing else changed", async () => {
  const board = fakeBoard([el("old")]);
  const value = await commit(board, "b", (els) => ({
    elements: [...els, el("new")], live: [el("new")], value: "done",
  }));

  assert.equal(value, "done");
  assert.deepEqual(board.state.elements.map((e) => e.id), ["old", "new"]);
});

test("keeps what someone drew between the read and the write", async () => {
  const board = fakeBoard([el("old")]);
  let first = true;

  const value = await commit(board, "b", (els) => {
    if (first) { first = false; board.somebodyElseDraws(el("by-hand")); }
    return { elements: [...els, el("new")], live: [el("new")], value: "done" };
  });

  assert.equal(value, "done");
  // Without the version the second write would simply have replaced the board
  // and "by-hand" would be gone.
  assert.deepEqual(board.state.elements.map((e) => e.id).sort(), ["by-hand", "new", "old"]);
});

test("runs the change again against the newer board, not the stale one", async () => {
  const board = fakeBoard([el("old")]);
  const seen = [];
  let first = true;

  await commit(board, "b", (els) => {
    seen.push(els.map((e) => e.id));
    if (first) { first = false; board.somebodyElseDraws(el("by-hand")); }
    return { elements: [...els, el("new")], live: [], value: 1 };
  });

  assert.deepEqual(seen, [["old"], ["old", "by-hand"]]);
});

test("gives up with an explanation rather than looping forever", async () => {
  const board = fakeBoard([el("old")]);
  await assert.rejects(
    commit(board, "b", (els) => {
      board.somebodyElseDraws(el(`x${board.state.version}`));
      return { elements: [...els, el("new")], live: [], value: 1 };
    }, { attempts: 3 }),
    /kept changing/);
});

test("broadcasts only after the write landed", async () => {
  const board = fakeBoard([el("old")]);
  let first = true;
  await commit(board, "b", (els) => {
    if (first) { first = false; board.somebodyElseDraws(el("by-hand")); }
    return { elements: [...els, el("new")], live: [el("new")], value: 1 };
  });

  // One broadcast, not one per attempt: an editor never saw the refused write.
  assert.equal(board.state.live.length, 1);
});

test("broadcasts nothing when the change was refused outright", async () => {
  const board = fakeBoard([el("old")]);
  await assert.rejects(
    commit(board, "b", () => { throw new Error("Element not found"); }),
    /not found/);
  assert.deepEqual(board.state.live, []);
  assert.equal(board.state.writes, 0);
});

test("a mutate that declines to act writes nothing", async () => {
  const board = fakeBoard([el("old")]);
  assert.equal(await commit(board, "b", () => null), null);
  assert.equal(board.state.writes, 0);
});
