// Public API of @spider/engine (browser-safe): the diagram pipeline shared by every host.
// Hosts with file access (CLI, dev server, future MCP server) use @spider/engine/node.
export {
  allDiagnostics,
  analyze,
  layoutDiagnostics,
  type Analysis,
  type AnalyzeOptions,
  type LoadedProfile,
  type ProfileSource,
} from "./pipeline.ts";
