import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const cli = resolve("src/cli.js");

function run(args = [], env = {}) {
  return new Promise((resolvePromise, reject) => {
    const directory = mkdtempSync(`${tmpdir()}/excalidash-cli-test-`);
    const stdoutPath = resolve(directory, "stdout");
    const stderrPath = resolve(directory, "stderr");
    const stdoutFd = openSync(stdoutPath, "w");
    const stderrFd = openSync(stderrPath, "w");
    const child = spawn(process.execPath, [cli, ...args], {
      env: {
        PATH: process.env.PATH,
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
        ...env,
      },
      stdio: ["ignore", stdoutFd, stderrFd],
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      closeSync(stdoutFd);
      closeSync(stderrFd);
      const stdout = readFileSync(stdoutPath, "utf8");
      const stderr = readFileSync(stderrPath, "utf8");
      rmSync(directory, { recursive: true });
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

test("startup without credentials is clear and keeps stdout clean", async () => {
  const result = await run();
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /EXCALIDASH_API_KEY/);
  assert.match(result.stderr, /EXCALIDASH_EMAIL/);
  assert.match(result.stderr, /EXCALIDASH_PASSWORD/);
});

test("startup names the browser setup command when Chromium is absent", async () => {
  const result = await run([], {
    EXCALIDASH_API_KEY: "test-only",
    PLAYWRIGHT_BROWSERS_PATH: resolve("test/fixtures/no-browsers-here"),
  });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /npx excalidash-mcp setup-browser/);
});

test("install-skill runs without credentials or a browser", async (context) => {
  const directory = mkdtempSync(`${tmpdir()}/excalidash-cli-skill-test-`);
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const result = await run(["install-skill", "--client", "codex"], {
    CODEX_HOME: directory,
    PLAYWRIGHT_BROWSERS_PATH: resolve("test/fixtures/no-browsers-here"),
  });

  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Installed for codex/);
  assert.equal(
    existsSync(resolve(directory, "skills/excalidash-diagramming/SKILL.md")),
    true,
  );
});
