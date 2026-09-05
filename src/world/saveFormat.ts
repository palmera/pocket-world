import type { FreeGraph } from "../engine/freestyle/freestyleGraph";

export const WORLD_SAVE_VERSION = 1;

// Only pre-versioned saves need the old starter-world migration. An explicitly
// cleared current world must remain empty after a reload.
export function shouldSeedLegacyWorld(saved: {version?: number; style?: string; graph: FreeGraph}): boolean {
  return saved.version === undefined && (saved.style === "tiny" || saved.style === "jelly") && saved.graph.edges.length === 0;
}
