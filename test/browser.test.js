import test from "node:test";
import assert from "node:assert/strict";
import { browserInstallArgs } from "../src/browser.js";

test("browser setup installs only Chromium by default", () => {
  assert.deepEqual(browserInstallArgs(), ["install", "chromium"]);
});

test("browser setup can include Linux system dependencies", () => {
  assert.deepEqual(
    browserInstallArgs({ withDependencies: true }),
    ["install", "--with-deps", "chromium"],
  );
});
