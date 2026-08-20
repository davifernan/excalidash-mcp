import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_NAME = "excalidash-diagramming";
const sourceDirectory = fileURLToPath(new URL(`../skills/${SKILL_NAME}`, import.meta.url));

function clientRoots(env = process.env, home = homedir()) {
  return {
    codex: resolve(env.CODEX_HOME || join(home, ".codex")),
    claude: resolve(env.CLAUDE_CONFIG_DIR || join(home, ".claude")),
  };
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function fileList(directory, base = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await fileList(path, base));
    } else if (entry.isFile()) {
      files.push(relative(base, path));
    } else {
      throw new Error(`Skill contains an unsupported file type: ${path}`);
    }
  }
  return files.sort();
}

async function directoriesMatch(left, right) {
  const [leftFiles, rightFiles] = await Promise.all([fileList(left), fileList(right)]);
  if (leftFiles.length !== rightFiles.length) return false;
  if (leftFiles.some((file, index) => file !== rightFiles[index])) return false;

  const comparisons = leftFiles.map(async (file) => {
    const [leftContent, rightContent] = await Promise.all([
      readFile(join(left, file)),
      readFile(join(right, file)),
    ]);
    return leftContent.equals(rightContent);
  });
  return (await Promise.all(comparisons)).every(Boolean);
}

async function inspectTarget(target) {
  try {
    const metadata = await lstat(target);
    if (!metadata.isDirectory()) {
      return { state: "conflict" };
    }
    return { state: await directoriesMatch(sourceDirectory, target) ? "current" : "changed" };
  } catch (error) {
    if (error.code === "ENOENT") return { state: "missing" };
    throw error;
  }
}

async function stageSkill(target) {
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const stagingRoot = await mkdtemp(join(parent, `.${SKILL_NAME}-install-`));
  const staged = join(stagingRoot, SKILL_NAME);
  try {
    await cp(sourceDirectory, staged, { recursive: true, errorOnExist: true, force: false });
    return { staged, stagingRoot };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

async function installTarget(target, state) {
  if (state === "current") return { status: "current", target };

  const { staged, stagingRoot } = await stageSkill(target);
  let backup;
  try {
    if (state !== "missing") {
      backup = `${target}.backup-${Date.now()}`;
      await rename(target, backup);
    }
    await rename(staged, target);
    return { status: "installed", target, backup };
  } catch (error) {
    if (backup && !await exists(target)) await rename(backup, target);
    throw error;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

async function selectedClients(client, roots) {
  if (client === "all") return ["codex", "claude"];
  if (client === "codex" || client === "claude") return [client];
  if (client !== "auto") {
    throw new Error("--client must be codex, claude, or all.");
  }

  const detected = [];
  for (const name of ["codex", "claude"]) {
    if (await exists(roots[name])) detected.push(name);
  }
  if (!detected.length) {
    throw new Error(
      "Could not detect Codex or Claude. Choose a target with --client codex, --client claude, or --client all.",
    );
  }
  return detected;
}

async function installSkill({ client = "auto", force = false, env = process.env, home } = {}) {
  const roots = clientRoots(env, home);
  const clients = await selectedClients(client, roots);
  const targets = clients.map((name) => ({
    client: name,
    target: join(roots[name], "skills", SKILL_NAME),
  }));

  const inspected = [];
  for (const item of targets) {
    inspected.push({ ...item, ...(await inspectTarget(item.target)) });
  }

  const protectedTarget = inspected.find(({ state }) => state === "changed" || state === "conflict");
  if (protectedTarget && !force) {
    throw new Error(
      `Refusing to overwrite the existing ${protectedTarget.client} skill at ${protectedTarget.target}. ` +
      "Re-run with --force to back it up and install the packaged version.",
    );
  }

  const results = [];
  for (const item of inspected) {
    results.push({
      client: item.client,
      ...(await installTarget(item.target, item.state)),
    });
  }
  return results;
}

export { SKILL_NAME, clientRoots, installSkill };
