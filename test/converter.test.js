import test from "node:test";
import assert from "node:assert/strict";
import {
  closeConverter,
  converterDiagnostics,
  measureStrings,
} from "../src/converter.js";

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
    if (/Operation not permitted|sandbox_host_linux|setsockopt: Operation not permitted/.test(error.message)) {
      t.skip("this test runner blocks Chromium processes at the OS boundary");
      return;
    }
    throw error;
  } finally {
    await closeConverter();
  }
});
