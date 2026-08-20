import test from "node:test";
import assert from "node:assert/strict";
import { excalidrawRoute } from "../src/layout.js";

test("keeps Dagre waypoints for a routed back edge", () => {
  const route = excalidrawRoute([
    { x: 100, y: 80 },
    { x: 160, y: 80 },
    { x: 160, y: 240 },
    { x: 220, y: 240 },
  ]);

  assert.equal(route.points.length, 4);
  assert.deepEqual(route.points[0], [0, 0]);
  assert.deepEqual(route.points[1], [52, 0]);
  assert.deepEqual(route.points[2], [52, 160]);
  assert.deepEqual(route.points[3], [104, 160]);
});

test("insets each end along its own segment", () => {
  const route = excalidrawRoute([
    { x: 10, y: 20 },
    { x: 10, y: 100 },
    { x: 90, y: 100 },
  ]);

  assert.deepEqual(route.start, { x: 10, y: 28 });
  assert.deepEqual(route.end, { x: 82, y: 100 });
});

test("rejects a route without two usable points", () => {
  assert.throws(
    () => excalidrawRoute([{ x: 1, y: 1 }, { x: 1, y: 1 }]),
    /two distinct finite points/,
  );
});
