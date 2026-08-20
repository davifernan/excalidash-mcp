import test from "node:test";
import assert from "node:assert/strict";
import {
  editableMermaidElements,
  MERMAID_CONFIG,
  mermaidErrorMessage,
  stableMermaidIds,
} from "../src/mermaid.js";

test("passes bounded configuration to the official converter", async () => {
  let received = null;
  const elements = await editableMermaidElements("flowchart LR\n A --> B", async (source, config) => {
    received = { source, config };
    return { elements: [{ id: "a", type: "rectangle" }], files: {} };
  });

  assert.equal(elements.length, 1);
  assert.equal(received.source, "flowchart LR\n A --> B");
  assert.deepEqual(received.config, MERMAID_CONFIG);
  assert.equal(received.config.maxEdges, 500);
  assert.equal(received.config.maxTextSize, 50000);
});

test("refuses an image fallback instead of creating a non-editable diagram", async () => {
  await assert.rejects(
    editableMermaidElements("pie title Pets", async () => ({
      elements: [{ id: "picture", type: "image" }],
      files: { file: { id: "file" } },
    })),
    /flat image/,
  );
});

test("refuses duplicate ids before they can corrupt a board", async () => {
  await assert.rejects(
    editableMermaidElements("flowchart LR\n A --> B", async () => ({
      elements: [
        { id: "same", type: "rectangle" },
        { id: "same", type: "arrow" },
      ],
      files: {},
    })),
    /used more than once/,
  );
});

test("sanitises browser stack frames from Mermaid errors", () => {
  const message = mermaidErrorMessage(new Error(
    "page.evaluate: Error: Parse error on line 2\n A --?> B\n    at Parser.parse (/private/converter.bundle.js:1:2)",
  ));
  assert.equal(message, "Parse error on line 2\n A --?> B");
  assert.doesNotMatch(message, /converter\.bundle|\/private/);
});

test("gives redraws stable ids and preserves bindings", () => {
  const remapped = stableMermaidIds([
    { id: "random-shape", type: "rectangle", boundElements: [{ id: "random-text", type: "text" }] },
    { id: "random-text", type: "text", containerId: "random-shape" },
    {
      id: "random-arrow",
      type: "arrow",
      startBinding: { elementId: "random-shape", focus: 0, gap: 1 },
      endBinding: { elementId: "another-shape", focus: 0, gap: 1 },
    },
    { id: "another-shape", type: "rectangle" },
  ]);

  assert.deepEqual(remapped.map((element) => element.id), [
    "mermaid-0", "mermaid-1", "mermaid-2", "mermaid-3",
  ]);
  assert.equal(remapped[0].boundElements[0].id, "mermaid-1");
  assert.equal(remapped[1].containerId, "mermaid-0");
  assert.equal(remapped[2].startBinding.elementId, "mermaid-0");
  assert.equal(remapped[2].endBinding.elementId, "mermaid-3");
});
