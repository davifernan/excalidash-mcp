import test from "node:test";
import assert from "node:assert/strict";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SKILL_NAME, installSkill } from "../src/skill.js";

function temporaryDirectory() {
  return mkdtempSync(join(tmpdir(), "excalidash-skill-test-"));
}

test("installs the packaged skill and treats a matching copy as current", async (context) => {
  const directory = temporaryDirectory();
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const codexRoot = join(directory, "codex");
  const options = { client: "codex", env: { CODEX_HOME: codexRoot } };

  const first = await installSkill(options);
  assert.equal(first[0].status, "installed");
  const installed = join(codexRoot, "skills", SKILL_NAME, "SKILL.md");
  assert.match(readFileSync(installed, "utf8"), /name: excalidash-diagramming/);

  const second = await installSkill(options);
  assert.equal(second[0].status, "current");
  assert.equal(second[0].backup, undefined);
});

test("protects changes and backs them up only when force is explicit", async (context) => {
  const directory = temporaryDirectory();
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const claudeRoot = join(directory, "claude");
  const options = { client: "claude", env: { CLAUDE_CONFIG_DIR: claudeRoot } };
  await installSkill(options);

  const skillRoot = join(claudeRoot, "skills", SKILL_NAME);
  appendFileSync(join(skillRoot, "SKILL.md"), "\nLocal note\n");
  await assert.rejects(() => installSkill(options), /Refusing to overwrite/);

  const [result] = await installSkill({ ...options, force: true });
  assert.equal(result.status, "installed");
  assert.ok(result.backup);
  assert.match(readFileSync(join(result.backup, "SKILL.md"), "utf8"), /Local note/);
  assert.doesNotMatch(readFileSync(join(skillRoot, "SKILL.md"), "utf8"), /Local note/);
});

test("auto-detection installs only into existing client roots", async (context) => {
  const directory = temporaryDirectory();
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const codexRoot = join(directory, "codex");
  const claudeRoot = join(directory, "claude");
  mkdirSync(codexRoot);

  const results = await installSkill({
    env: { CODEX_HOME: codexRoot, CLAUDE_CONFIG_DIR: claudeRoot },
  });

  assert.deepEqual(results.map(({ client }) => client), ["codex"]);
  assert.equal(existsSync(join(codexRoot, "skills", SKILL_NAME, "SKILL.md")), true);
  assert.equal(existsSync(claudeRoot), false);
});

test("explicit all installs both clients", async (context) => {
  const directory = temporaryDirectory();
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const codexRoot = join(directory, "codex");
  const claudeRoot = join(directory, "claude");

  const results = await installSkill({
    client: "all",
    env: { CODEX_HOME: codexRoot, CLAUDE_CONFIG_DIR: claudeRoot },
  });

  assert.deepEqual(results.map(({ client }) => client), ["codex", "claude"]);
  for (const root of [codexRoot, claudeRoot]) {
    assert.equal(existsSync(join(root, "skills", SKILL_NAME, "SKILL.md")), true);
  }
  assert.equal(readdirSync(join(codexRoot, "skills", SKILL_NAME)).includes("agents"), true);
});
