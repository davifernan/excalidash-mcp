import { test } from "node:test";
import assert from "node:assert/strict";
import { exportPath, checkedUrl } from "../src/exports.js";

const DIR = "/var/exports";

test("names a file when none was given", () => {
  assert.match(exportPath(null, DIR), /^\/var\/exports\/excalidash-export-\d+\.png$/);
});

test("keeps a plain name inside the export directory", () => {
  assert.equal(exportPath("board.png", DIR), "/var/exports/board.png");
  assert.equal(exportPath("nested/board.png", DIR), "/var/exports/nested/board.png");
});

test("refuses a path that climbs out", () => {
  assert.throws(() => exportPath("../../etc/passwd", DIR), /points outside/);
});

test("refuses an absolute path elsewhere", () => {
  assert.throws(() => exportPath("/etc/passwd", DIR), /points outside/);
});

test("refuses a sibling directory that merely starts with the same letters", () => {
  assert.throws(() => exportPath("../exports-other/x.png", DIR), /points outside/);
});

test("accepts a url on the instance", () => {
  assert.equal(
    checkedUrl("https://draw.example.com/editor/abc", "https://draw.example.com"),
    "https://draw.example.com/editor/abc");
});

test("refuses another host", () => {
  assert.throws(() => checkedUrl("https://evil.test/x", "https://draw.example.com"), /somewhere else/);
});

test("refuses the metadata endpoint", () => {
  assert.throws(
    () => checkedUrl("http://169.254.169.254/latest/meta-data/", "https://draw.example.com"),
    /somewhere else/);
});

test("refuses non-http schemes", () => {
  assert.throws(() => checkedUrl("file:///etc/passwd", "https://draw.example.com"), /http\(s\)/);
  assert.throws(() => checkedUrl("gopher://x/", "https://draw.example.com"), /http\(s\)/);
});

test("refuses something that is not a url at all", () => {
  assert.throws(() => checkedUrl("not a url", "https://draw.example.com"), /not a URL/);
});
