import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const DISABLE_SANDBOX_ENV = "EXCALIDASH_DISABLE_BROWSER_SANDBOX";
const SETUP_COMMAND = "npx excalidash-mcp setup-browser";
let warnedAboutSandbox = false;

export function browserLaunchOptions(env = process.env) {
  if (env[DISABLE_SANDBOX_ENV] !== "1") return { chromiumSandbox: true };

  if (!warnedAboutSandbox) {
    process.stderr.write(
      `WARNING: ${DISABLE_SANDBOX_ENV}=1 disables Chromium's process sandbox. ` +
      "A compromised page or browser bug could then access the server account and host. " +
      "Prefer running excalidash-mcp as a non-root user with the sandbox enabled.\n",
    );
    warnedAboutSandbox = true;
  }
  return { chromiumSandbox: false };
}

export async function assertBrowserInstalled() {
  const { chromium } = await import("playwright");
  try {
    await access(chromium.executablePath());
  } catch {
    throw new Error(
      `Chromium is not installed for this Playwright version. Run: ${SETUP_COMMAND}`,
    );
  }
}

export async function installBrowser() {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve("playwright/package.json");
  const cli = resolve(dirname(packageJson), "cli.js");

  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cli, "install", "chromium"], {
      stdio: "inherit",
      env: process.env,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Playwright browser setup failed${signal ? ` (${signal})` : ` (exit ${code})`}.`));
    });
  });
}

export { DISABLE_SANDBOX_ENV, SETUP_COMMAND };
