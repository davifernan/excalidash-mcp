import test from "node:test";
import assert from "node:assert/strict";
import {
  closeConverter,
  convertMermaid,
  converterDiagnostics,
  measureStrings,
} from "../src/converter.js";
import { MERMAID_CONFIG } from "../src/mermaid.js";

test("the bundled converter works offline and measures with warmed Excalifont", async (t) => {
  if (process.getuid?.() === 0 && process.env.EXCALIDASH_DISABLE_BROWSER_SANDBOX !== "1") {
    t.skip("Chromium's sandbox intentionally refuses to run as root");
    return;
  }

  try {
    // Anchored on values measured against the library's own text measurement
    // before the bundle existed: "Beschriftungstext" at 20px is 183 and
    // "Kundenanfragen" is 153. Against the browser's substitute face the first
    // comes out at 141, so a wrong number here means the warm-up did not take
    // and every label would be sized about 30% too small.
    const widths = await measureStrings(
      ["Beschriftungstext", "Kundenanfragen"],
      20,
      "Excalifont",
    );
    const diagnostics = await converterDiagnostics();

    assert.deepEqual(widths.map((w) => Math.round(w)), [183, 153]);
    assert.equal(diagnostics.excalifontReady, true);
    assert.ok(diagnostics.fonts.length >= 200, "the warm-up registered Excalidraw's font faces");
    assert.deepEqual(diagnostics.blockedNetworkRequests, []);
  } catch (error) {
    // Skipping here is invisible in a summary line, so the workflow runs this
    // on a non-root runner where sandboxing does work and treats a skip as a
    // failure. Locally, a machine without user namespaces would otherwise fail
    // every run for a reason that has nothing to do with the code.
    if (/Operation not permitted|sandbox_host_linux|setsockopt: Operation not permitted|sandboxing failed/i.test(error.message)) {
      t.skip("this machine cannot start a sandboxed Chromium; the CI job covers it");
      return;
    }
    throw error;
  } finally {
    await closeConverter();
  }
});

test("the bundled official converter returns editable Mermaid elements offline", async (t) => {
  if (process.getuid?.() === 0 && process.env.EXCALIDASH_DISABLE_BROWSER_SANDBOX !== "1") {
    t.skip("Chromium's sandbox intentionally refuses to run as root");
    return;
  }

  try {
    const { elements, files } = await convertMermaid(
      "flowchart LR\n A[Client] -->|HTTPS| B[API]\n A --> B",
      MERMAID_CONFIG,
    );
    assert.ok(elements.length >= 6);
    assert.equal(Object.keys(files || {}).length, 0);
    assert.equal(elements.some((element) => element.type === "image"), false);
    assert.equal(new Set(elements.map((element) => element.id)).size, elements.length);
    const diagnostics = await converterDiagnostics();
    assert.deepEqual(diagnostics.blockedNetworkRequests, []);
  } catch (error) {
    if (/Operation not permitted|sandbox_host_linux|setsockopt: Operation not permitted|sandboxing failed/i.test(error.message)) {
      t.skip("this machine cannot start a sandboxed Chromium; the CI job covers it");
      return;
    }
    throw error;
  } finally {
    await closeConverter();
  }
});
