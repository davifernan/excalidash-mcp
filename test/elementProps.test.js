import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewChanges } from "../src/elementProps.js";

test("passes appearance and geometry through", () => {
  const { applied, protectedKeys, unknown } = reviewChanges(
    { strokeColor: "#1971c2", x: 200, width: 40 }, {});
  assert.deepEqual(applied, { strokeColor: "#1971c2", x: 200, width: 40 });
  assert.deepEqual(protectedKeys, []);
  assert.deepEqual(unknown, []);
});

test("refuses to resurrect or bury an element", () => {
  const { applied, protectedKeys } = reviewChanges({ isDeleted: true, strokeColor: "red" }, {});
  assert.deepEqual(applied, { strokeColor: "red" });
  assert.deepEqual(protectedKeys, ["isDeleted"]);
});

test("refuses to rewrite identity or bindings", () => {
  const { applied, protectedKeys } = reviewChanges(
    { id: "other", startBinding: { elementId: "nope" }, containerId: "x" }, {});
  assert.deepEqual(applied, {});
  assert.deepEqual(protectedKeys.sort(), ["containerId", "id", "startBinding"]);
});

test("keeps the ownership marker when customData is replaced", () => {
  const { applied } = reviewChanges(
    { customData: { source: "someone-else", note: "hi" } },
    { customData: { source: "excalidash-mcp", kept: 1 } });
  assert.deepEqual(applied.customData, { source: "excalidash-mcp", kept: 1, note: "hi" });
});

test("merges customData rather than dropping what is there", () => {
  const { applied } = reviewChanges({ customData: { b: 2 } }, { customData: { a: 1 } });
  assert.deepEqual(applied.customData, { a: 1, b: 2 });
});

test("reports properties it does not know", () => {
  const { applied, unknown } = reviewChanges({ colour: "red" }, {});
  assert.deepEqual(applied, {});
  assert.deepEqual(unknown, ["colour"]);
});

test("rejects a number field given a string", () => {
  assert.throws(() => reviewChanges({ x: "200" }, {}), /must be a number/);
});

test("rejects anything that is not an object", () => {
  assert.throws(() => reviewChanges([1, 2], {}), /JSON object/);
  assert.throws(() => reviewChanges(null, {}), /JSON object/);
});
