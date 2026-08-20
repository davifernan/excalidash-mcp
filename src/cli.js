#!/usr/bin/env node
import { assertBrowserInstalled, browserLaunchOptions, installBrowser } from "./browser.js";
import { installSkill } from "./skill.js";

function credentialError(env = process.env) {
  if (env.EXCALIDASH_API_KEY || (env.EXCALIDASH_EMAIL && env.EXCALIDASH_PASSWORD)) return null;

  const missing = [];
  if (env.EXCALIDASH_EMAIL && !env.EXCALIDASH_PASSWORD) missing.push("EXCALIDASH_PASSWORD");
  if (env.EXCALIDASH_PASSWORD && !env.EXCALIDASH_EMAIL) missing.push("EXCALIDASH_EMAIL");
  if (missing.length) {
    return `Missing ${missing.join(" and ")}. Set it to complete email/password authentication, ` +
      "or set EXCALIDASH_API_KEY instead.";
  }
  return "Missing ExcaliDash credentials. Set EXCALIDASH_API_KEY, or set both " +
    "EXCALIDASH_EMAIL and EXCALIDASH_PASSWORD.";
}

async function run() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "setup-browser") {
    const withDependencies = rest.length === 1 && rest[0] === "--with-deps";
    if (rest.length && !withDependencies) {
      throw new Error("setup-browser only accepts the optional --with-deps flag.");
    }
    await installBrowser({ withDependencies });
    return;
  }
  if (command === "install-skill") {
    let client = "auto";
    let force = false;
    for (let index = 0; index < rest.length; index += 1) {
      const argument = rest[index];
      if (argument === "--force") {
        force = true;
      } else if (argument === "--client" && rest[index + 1]) {
        client = rest[index + 1];
        index += 1;
      } else {
        throw new Error(
          "install-skill accepts --client codex|claude|all and the optional --force flag.",
        );
      }
    }
    const results = await installSkill({ client, force });
    for (const result of results) {
      const verb = result.status === "current" ? "Already current" : "Installed";
      process.stdout.write(`${verb} for ${result.client}: ${result.target}\n`);
      if (result.backup) process.stdout.write(`Backup: ${result.backup}\n`);
    }
    return;
  }
  if (command) throw new Error(`Unknown command: ${command}`);

  const credentials = credentialError();
  if (credentials) throw new Error(credentials);
  await assertBrowserInstalled();
  browserLaunchOptions();
  await import("./index.js");
}

run().catch((error) => {
  process.stderr.write(`excalidash-mcp: ${error.message}\n`);
  process.exitCode = 1;
});

export { credentialError };
