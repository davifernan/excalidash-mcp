import { test } from "node:test";
import assert from "node:assert/strict";
import { Cursor, cursorEnabled, boundsOf } from "../src/cursor.js";

/**
 * A room as ExcaliDash runs it: the server joins the socket and acks with a
 * presence identity, or refuses and sends nothing back.
 */
function fakeRoom({ joins = true } = {}) {
  const sent = [];
  return {
    sent,
    joinRoom: async () => {},
    presenceIn: () => (joins ? { id: "user-1", name: "Agent" } : null),
    pushCursor: async (_boardId, payload) => { sent.push(payload); },
  };
}

/** Timers the test releases by hand, so "in the background" can be checked. */
function manualClock() {
  let release;
  let gate = new Promise((r) => { release = r; });
  return {
    sleep: () => gate,
    open() { release(); gate = Promise.resolve(); },
  };
}

const instant = { sleep: async () => {} };
const rect = (id, x, y, w, h, extra = {}) => ({ id, type: "rectangle", x, y, width: w, height: h, ...extra });

test("the cursor is off unless switched on", () => {
  assert.equal(cursorEnabled(undefined), false);
  assert.equal(cursorEnabled(""), false);
  assert.equal(cursorEnabled("off"), false);
  assert.equal(cursorEnabled("on"), true);
  assert.equal(cursorEnabled("true"), true);
  assert.throws(() => cursorEnabled("sometimes"), /EXCALIDASH_CURSOR/);
});

test("bounds cover shapes and the points of arrows, not deleted elements", () => {
  const b = boundsOf([
    rect("a", 100, 100, 50, 50),
    { id: "arrow", type: "arrow", x: 0, y: 200, width: 300, height: 0, points: [[0, 0], [300, -20]] },
    rect("gone", -500, -500, 10, 10, { isDeleted: true }),
  ]);
  assert.deepEqual(b, { minX: 0, minY: 100, maxX: 300, maxY: 200 });
  assert.equal(boundsOf([]), null);
});

test("glides to what was changed and selects it, then lets go", async () => {
  const room = fakeRoom();
  const cursor = new Cursor(room, instant);

  const r = await cursor.point("b", [rect("api", 100, 100, 200, 100), rect("db", 400, 100, 200, 100)]);
  await r.done;

  assert.equal(r.shown, true);
  assert.ok(room.sent.length > 2, "a glide, not a jump");
  assert.ok(room.sent.every((p) => p.pointer.tool === "pointer"));

  const arrived = room.sent.at(-2);
  assert.deepEqual([arrived.pointer.x, arrived.pointer.y], [350, 150]);
  assert.deepEqual(arrived.selectedElementIds, { api: true, db: true });
  assert.deepEqual(room.sent.at(-1).selectedElementIds, {});
});

test("does not select a label on its own, only the shape holding it", async () => {
  const room = fakeRoom();
  await (await new Cursor(room, instant).point("b", [
    rect("api", 0, 0, 100, 50),
    { id: "api-label", type: "text", x: 10, y: 10, width: 80, height: 20, containerId: "api" },
  ])).done;
  assert.deepEqual(room.sent.at(-2).selectedElementIds, { api: true });
});

test("points at where deleted elements were, without selecting them", async () => {
  const room = fakeRoom();
  await (await new Cursor(room, instant).point("b", [rect("old", 0, 0, 100, 100, { isDeleted: true })])).done;
  const arrived = room.sent.at(-2);
  assert.deepEqual([arrived.pointer.x, arrived.pointer.y], [50, 50]);
  assert.deepEqual(arrived.selectedElementIds, {});
});

test("the next glide starts where the last one ended", async () => {
  const room = fakeRoom();
  const cursor = new Cursor(room, instant);
  await (await cursor.point("b", [rect("a", 0, 0, 100, 100)])).done;
  const before = room.sent.length;
  await (await cursor.point("b", [rect("z", 1000, 0, 100, 100)])).done;
  const first = room.sent[before].pointer;
  assert.ok(first.x > 50 && first.x < 1050, `first step ${first.x} should be on the way from 50 to 1050`);
});

test("returns before the animation has finished", async () => {
  const room = fakeRoom();
  const clock = manualClock();
  const r = await new Cursor(room, clock).point("b", [rect("a", 0, 0, 100, 100)]);

  assert.equal(r.shown, true);
  const sentSoFar = room.sent.length;
  clock.open();
  await r.done;
  assert.ok(room.sent.length > sentSoFar, "the rest of the glide arrives after the tool returned");
});

test("says why when the room would not take it, and sends nothing", async () => {
  const room = fakeRoom({ joins: false });
  const r = await new Cursor(room, instant).point("b", [rect("a", 0, 0, 100, 100)]);
  await r.done;
  assert.equal(r.shown, false);
  assert.match(r.reason, /join/);
  assert.equal(room.sent.length, 0);
});

test("a laser draws a trail around the target and ends it", async () => {
  const room = fakeRoom();
  await (await new Cursor(room, instant).point("b", [rect("a", 0, 0, 100, 100)], { laser: true })).done;

  const laser = room.sent.filter((p) => p.pointer.tool === "laser");
  assert.ok(laser.length > 4, "a trail needs several points");
  assert.ok(laser.slice(0, -1).every((p) => p.button === "down"));
  assert.equal(laser.at(-1).button, "up", "Excalidraw only ends a collaborator's trail on button up");
});

test("a newer call on the same board takes over from one still running", async () => {
  const room = fakeRoom();
  const clock = manualClock();
  const cursor = new Cursor(room, clock);
  const first = await cursor.point("b", [rect("a", 0, 0, 100, 100)]);
  const second = await cursor.point("b", [rect("z", 1000, 0, 100, 100)]);
  clock.open();
  await Promise.all([first.done, second.done]);

  const selections = room.sent.map((p) => Object.keys(p.selectedElementIds).join());
  assert.ok(!selections.includes("a"), "the superseded glide never arrived");
  assert.ok(selections.includes("z"));
});

test("points at a bare spot without selecting anything", async () => {
  const room = fakeRoom();
  await (await new Cursor(room, instant).point("b", [{ id: "spot", x: 300, y: 40, width: 0, height: 0 }], { select: false })).done;
  const arrived = room.sent.at(-2);
  assert.deepEqual([arrived.pointer.x, arrived.pointer.y], [300, 40]);
  assert.deepEqual(arrived.selectedElementIds, {});
});
