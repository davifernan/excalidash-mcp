import { test } from "node:test";
import assert from "node:assert/strict";
import { checkIds, checkNumber } from "./validate.js";

test("accepts ordinary names", () => {
  assert.deepEqual(checkIds(["api", "db", "worker"]), []);
});

test("catches a name used twice", () => {
  assert.deepEqual(checkIds(["api", "api"]), ['"api" is used more than once.']);
});

test("catches the title's own name", () => {
  assert.match(checkIds(["diagram-title"])[0], /reserved/);
});

test("catches names the layout generates", () => {
  assert.match(checkIds(["edge-0"])[0], /generated edge name/);
  assert.match(checkIds(["api-label"])[0], /generated labels/);
});

test("catches an empty or missing name", () => {
  assert.equal(checkIds(["", null]).length, 2);
});

test("reports every problem, not just the first", () => {
  assert.equal(checkIds(["api", "api", "diagram-title"]).length, 2);
});

test("accepts a font size in range", () => {
  assert.equal(checkNumber("24", "size"), 24);
});

test("rejects a font size that is not a number", () => {
  assert.throws(() => checkNumber("foo", "size"), /must be a number, got "foo"/);
});

test("rejects a font size outside the range", () => {
  assert.throws(() => checkNumber(0, "size"), /between 1 and 400/);
  assert.throws(() => checkNumber(10000, "size"), /between 1 and 400/);
});
