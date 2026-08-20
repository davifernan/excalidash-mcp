#!/usr/bin/env node
import { assertBrowserInstalled, browserLaunchOptions, installBrowser } from "./browser.js";

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
    if (rest.length) throw new Error("setup-browser does not accept arguments.");
    await installBrowser();
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
