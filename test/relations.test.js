import { test } from "node:test";
import assert from "node:assert/strict";
import { expandDeletion, severReferences, retargetReferences } from "../src/relations.js";

const board = () => [
  { id: "box", boundElements: [{ id: "box-label", type: "text" }, { id: "arrow", type: "arrow" }] },
  { id: "box-label", containerId: "box" },
  { id: "other", boundElements: [{ id: "arrow", type: "arrow" }] },
  { id: "arrow", startBinding: { elementId: "box", focus: 0, gap: 1 },
    endBinding: { elementId: "other", focus: 0, gap: 1 } },
];

test("deleting a shape takes its label with it", () => {
  assert.deepEqual([...expandDeletion(board(), ["box"])].sort(), ["box", "box-label"]);
});

test("deleting a shape leaves arrows in place", () => {
  assert.ok(!expandDeletion(board(), ["box"]).has("arrow"));
});

test("an arrow bound to a deleted shape loses that binding, not the other", () => {
  const gone = expandDeletion(board(), ["box"]);
  const { elements } = severReferences(board(), gone);
  const arrow = elements.find((e) => e.id === "arrow");
  assert.equal(arrow.startBinding, null);
  assert.deepEqual(arrow.endBinding, { elementId: "other", focus: 0, gap: 1 });
});

test("a shape stops advertising an arrow that was deleted", () => {
  const { elements, touched } = severReferences(board(), new Set(["arrow"]));
  assert.deepEqual(elements.find((e) => e.id === "box").boundElements, [{ id: "box-label", type: "text" }]);
  assert.deepEqual(touched.map((e) => e.id).sort(), ["box", "other"]);
});

test("elements without stale references are left untouched", () => {
  const { touched } = severReferences(board(), new Set(["nothing"]));
  assert.deepEqual(touched, []);
});

test("renaming repoints every kind of reference", () => {
  const { elements } = retargetReferences(board(), "box", "frontend");
  assert.equal(elements.find((e) => e.id === "box-label").containerId, "frontend");
  assert.equal(elements.find((e) => e.id === "arrow").startBinding.elementId, "frontend");
});

test("renaming reports exactly which elements changed", () => {
  const { touched } = retargetReferences(board(), "arrow", "flow");
  assert.deepEqual(touched.map((e) => e.id).sort(), ["box", "other"]);
});

import { reflowDependants } from "../src/relations.js";
import { edgePoint, centre } from "../src/geometry.js";

const scene = () => [
  { id: "api", type: "rectangle", x: 0, y: 0, width: 160, height: 80,
    boundElements: [{ id: "api-label", type: "text" }, { id: "flow", type: "arrow" }] },
  { id: "api-label", type: "text", containerId: "api", x: 60, y: 28, width: 40, height: 25 },
  { id: "db", type: "rectangle", x: 0, y: 300, width: 160, height: 80 },
  { id: "flow", type: "arrow", x: 80, y: 88, width: 0, height: 204, points: [[0, 0], [0, 204]],
    startBinding: { elementId: "api" }, endBinding: { elementId: "db" } },
];

test("a moved shape takes its label with it", () => {
  const before = scene().find((e) => e.id === "api");
  const moved = scene().map((e) => (e.id === "api" ? { ...e, x: 500 } : e));
  const { touched } = reflowDependants(moved, "api", before, edgePoint, centre);
  const label = touched.find((e) => e.id === "api-label");
  assert.equal(label.x, 560);   // centred in the box at its new position
  assert.equal(label.y, 28);
});

test("a moved shape re-aims the arrow bound to it", () => {
  const before = scene().find((e) => e.id === "api");
  const moved = scene().map((e) => (e.id === "api" ? { ...e, x: 500 } : e));
  const { touched } = reflowDependants(moved, "api", before, edgePoint, centre);
  const arrow = touched.find((e) => e.id === "flow");
  assert.ok(arrow, "the arrow should have been recomputed");
  assert.ok(arrow.x > 400, `arrow should start near the moved box, got x=${arrow.x}`);
  assert.equal(arrow.points.length, 2);
});

test("a resized shape re-centres its label", () => {
  const before = scene().find((e) => e.id === "api");
  const resized = scene().map((e) => (e.id === "api" ? { ...e, width: 400 } : e));
  const { touched } = reflowDependants(resized, "api", before, edgePoint, centre);
  assert.equal(touched.find((e) => e.id === "api-label").x, 180);
});

test("a bent arrow keeps its shape and is reported instead", () => {
  const before = scene().find((e) => e.id === "api");
  const bent = scene()
    .map((e) => (e.id === "api" ? { ...e, x: 500 } : e))
    .map((e) => (e.id === "flow" ? { ...e, points: [[0, 0], [40, 100], [0, 204]] } : e));
  const { touched, keptArrows } = reflowDependants(bent, "api", before, edgePoint, centre);
  assert.deepEqual(keptArrows, ["flow"]);
  assert.ok(!touched.some((e) => e.id === "flow"));
});

test("an element that did not move changes nothing", () => {
  const before = scene().find((e) => e.id === "api");
  const { touched } = reflowDependants(scene(), "api", before, edgePoint, centre);
  assert.deepEqual(touched, []);
});
