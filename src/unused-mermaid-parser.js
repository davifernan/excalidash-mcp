// Excalidraw's public entry imports its optional Mermaid converter even though
// this package only uses element conversion and canvas export. Keeping a local
// stub lets the browser bundle stay closed over its dependencies; this path is
// unreachable from the APIs exposed by converter-app.js.
export function parse() {
  throw new Error("Mermaid parsing is not included in excalidash-mcp's converter bundle.");
}

export function isEmResetFrame() {
  return false;
}
