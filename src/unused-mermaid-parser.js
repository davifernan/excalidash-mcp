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

// Mermaid's optional railroad diagrams construct their parser services when
// their lazy chunks are evaluated. Keep those chunks linkable as Mermaid adds
// diagram types, while still failing clearly if an unreachable parser is ever
// invoked through this converter-only bundle.
export class MermaidParseError extends Error {}

const unavailableParser = {
  parse() {
    throw new Error("Mermaid parsing is not included in excalidash-mcp's converter bundle.");
  },
};

function railroadServices(name) {
  return { [name]: { parser: { LangiumParser: unavailableParser } } };
}

export function createRailroadServices() {
  return railroadServices("Railroad");
}

export function createRailroadEbnfServices() {
  return railroadServices("RailroadEbnf");
}

export function createRailroadAbnfServices() {
  return railroadServices("RailroadAbnf");
}

export function createRailroadPegServices() {
  return railroadServices("RailroadPeg");
}
