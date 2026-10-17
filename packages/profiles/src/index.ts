// Public API of @spider/profiles: load/resolve profiles, validate models, sanitize SVG
// assets, and produce LLM cheat sheets. Built-in profiles live in ../builtin.
export { loadProfiles, emptyProfile, versionMatches, BUILTIN_PROFILES_DIR } from "./load.ts";
export type { LoadOptions, LoadResult } from "./load.ts";
export { validate } from "./validate.ts";
export { sanitizeSvg } from "./sanitize.ts";
export { profileCheatSheet } from "./cheatsheet.ts";
export { matchKind, matchPair } from "./kinds.ts";
