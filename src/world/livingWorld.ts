import { TERRAINS, type Terrain } from "./ecosystems";

export type PopulationDensity = "sparse" | "balanced" | "rich";
export interface LivingState {
  version: 1;
  /** Simulated active seconds, never wall-clock/offline time. */
  elapsed: number;
  edits: number;
  unlocked: Terrain[];
  speed: 0 | 1 | 3;
  density: PopulationDensity;
}
export const INITIAL_TERRAINS: readonly Terrain[] = ["meadow", "water", "sand", "lava", "stone"];
export const LIVING_STAGES = [
  { stage: 0, at: 0, label: "Exploración", description: "Fauna, senderos y primeros campamentos" },
  { stage: 1, at: 60, label: "Asentamiento", description: "Cultivos, canteras y embarcaciones" },
  { stage: 2, at: 180, label: "Comunidad", description: "Talleres, mercados y molinos" },
  { stage: 3, at: 480, label: "Civilización", description: "Aldeas consolidadas, atalayas y ruinas" },
] as const;
export const TERRAIN_METADATA: Record<Terrain, { label: string; color: string; description: string }> = {
  meadow: { label: "Pradera", color: "#819260", description: "Pastores, cultivos y aldeas" },
  water: { label: "Agua", color: "#4b8790", description: "Peces, navegación y costas" },
  sand: { label: "Desierto", color: "#c3a572", description: "Caravanas, oasis y ruinas" },
  lava: { label: "Volcánico", color: "#985f46", description: "Basalto, canteras y forjas" },
  stone: { label: "Montaña", color: "#7d827e", description: "Cabras, senderos y ciudadelas" },
  forest: { label: "Bosque", color: "#466744", description: "Ciervos, carpinteros y robles" },
  wetland: { label: "Humedal", color: "#64877a", description: "Juncales, garzas y aldeas fluviales" },
  snow: { label: "Nieve", color: "#cbd4ce", description: "Abetos, lobos y refugios alpinos" },
};
export const ECOSYSTEM_UNLOCKS = [
  { terrain: "forest", seconds: 120, edits: 3 },
  { terrain: "wetland", seconds: 300, edits: 8 },
  { terrain: "snow", seconds: 600, edits: 15 },
] as const;

const finite = (value: unknown, fallback: number, max: number): number => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(max, value)) : fallback;
export function createLivingState(saved?: unknown): LivingState {
  const raw = saved && typeof saved === "object" && !Array.isArray(saved) ? saved as Record<string, unknown> : {};
  const value = raw.version === undefined || raw.version === 1 ? raw : {};
  const savedUnlocked = Array.isArray(value.unlocked) ? value.unlocked.filter((entry): entry is Terrain => typeof entry === "string" && (TERRAINS as readonly string[]).includes(entry)) : [];
  const state: LivingState = {
    version: 1,
    elapsed: finite(value.elapsed, 0, 31_536_000),
    edits: Math.floor(finite(value.edits, 0, 1_000_000)),
    unlocked: TERRAINS.filter(terrain => INITIAL_TERRAINS.includes(terrain) || savedUnlocked.includes(terrain)),
    speed: value.speed === 0 || value.speed === 3 ? value.speed : 1,
    density: value.density === "sparse" || value.density === "rich" ? value.density : "balanced",
  };
  // Repair saves that reached an unlock just before persistence, while keeping
  // discoveries monotonic when a fresh world resets its own elapsed time.
  discover(state);
  return state;
}
export function livingStage(state: Pick<LivingState, "elapsed">): 0 | 1 | 2 | 3 {
  return state.elapsed >= 480 ? 3 : state.elapsed >= 180 ? 2 : state.elapsed >= 60 ? 1 : 0;
}
function discover(state: LivingState): Terrain[] {
  const newlyUnlocked: Terrain[] = [];
  for (const rule of ECOSYSTEM_UNLOCKS) {
    if (state.elapsed >= rule.seconds && state.edits >= rule.edits && !state.unlocked.includes(rule.terrain)) {
      state.unlocked.push(rule.terrain);
      newlyUnlocked.push(rule.terrain);
    }
  }
  return newlyUnlocked;
}
export function advanceLivingWorld(state: LivingState, dtActiveSeconds: number): { stageChanged: boolean; unlocked: Terrain[] } {
  const previous = livingStage(state);
  // A suspended tab or delayed frame must not award hours of evolution. Caller
  // also skips hidden documents and non-Tiny worlds. Speed is applied once here.
  const dt = Number.isFinite(dtActiveSeconds) ? Math.min(2, Math.max(0, dtActiveSeconds)) : 0;
  state.elapsed = Math.min(31_536_000, state.elapsed + dt * state.speed);
  return { stageChanged: previous !== livingStage(state), unlocked: discover(state) };
}
export function recordWorldEdit(state: LivingState): Terrain[] {
  state.edits = Math.min(1_000_000, state.edits + 1);
  return discover(state);
}
export function nextUnlock(state: LivingState): { terrain: Terrain; seconds: number; edits: number; secondsRemaining: number; editsRemaining: number; progress: number; label: string } | undefined {
  const next = ECOSYSTEM_UNLOCKS.find(rule => !state.unlocked.includes(rule.terrain));
  if (!next) return undefined;
  return { ...next, secondsRemaining: Math.max(0, next.seconds - state.elapsed), editsRemaining: Math.max(0, next.edits - state.edits), progress: Math.min(1, state.elapsed / next.seconds, state.edits / next.edits), label: TERRAIN_METADATA[next.terrain].label };
}
