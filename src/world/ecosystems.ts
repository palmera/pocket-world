import type { BasicBehaviourId } from "./behaviours";

// Pocket World's content catalogue. A joined terrain unlocks entries from left
// to right as it grows. Keeping these as data (rather than hidden conditionals)
// makes the art direction easy to tune without changing the terrain engine.

export const TERRAINS = ["meadow", "water", "sand", "lava", "stone", "forest", "wetland", "snow"] as const;
export type Terrain = typeof TERRAINS[number];
export const MODEL_KEYS = ["worker", "explorer", "sheep", "goat", "deer", "wolf", "camel", "bird", "bat", "fish", "whale", "turtle", "crab", "sailboat", "rowboat", "camp", "village", "farm", "market", "workshop", "watchtower", "windmill", "quarry", "ruins", "reeds", "oak", "pine", "palm", "rocks", "fishing", "caravan", "forge", "watermill"] as const;
export type ModelKey = typeof MODEL_KEYS[number];
export type Motion = BasicBehaviourId;

export interface EcosystemDetail {
  id: string;
  label: string;
  motion: Motion;
  // A compact set of semantic parts; the renderer turns these into layered 3D
  // toy-like models, with a terrain-specific palette.
  motif: "people" | "animal" | "plant" | "vehicle" | "flying" | "waterlife" | "rocklife" | "weather" | "landmark" | "spark";
  colors: number[];
  model?: ModelKey;
  /** Earliest settlement age at which this scene joins the local repertoire. */
  stage?: 0 | 1 | 2 | 3;
}

export interface BorderStory {
  id: string;
  label: string;
  terrains: readonly [Terrain, Terrain];
  motion: Motion;
  colors: readonly number[];
}

const LEGACY_ECOSYSTEMS = {
  meadow: ["walkers", "dogs", "butterflies", "bike", "picnic", "sheep", "flowers", "kite", "buggy", "fireflies"],
  water: ["shoal", "sailboat", "ducks", "turtle", "bubbles", "submarine", "jellyfish", "whale", "seaplane", "rocketbuoy"],
  sand: ["crabs", "tumbleweed", "castle", "buggy", "shells", "lizard", "oasis", "caravan", "glider", "launchpad"],
  lava: ["bubbles", "salamander", "embers", "geyser", "firekite", "hopper", "obsidian", "magmaCart", "smoke", "flareRocket"],
  stone: ["crystals", "goats", "cart", "bats", "climbers", "cablecar", "moss", "drone", "train", "meteor"],
} as const;

// A border is an opportunity for two little worlds to acknowledge one another.
// There is one authored story for every unordered pair of the five terrains.
const LEGACY_BORDER_STORIES: readonly BorderStory[] = [
  { id: "fishing", label: "Fishing at the water's edge", terrains: ["meadow", "water"], motion: "bob", colors: [0xf4b183, 0x55c4e8, 0x5e4025] },
  { id: "beachDay", label: "Sandcastle picnic", terrains: ["meadow", "sand"], motion: "sway", colors: [0xffd166, 0xe8bd7e, 0x79bd58] },
  { id: "firewatch", label: "Campfire lookout", terrains: ["meadow", "lava"], motion: "pulse", colors: [0xffd166, 0xff6b35, 0x293b63] },
  { id: "trailhead", label: "Mountain trailhead", terrains: ["meadow", "stone"], motion: "walk", colors: [0xf4b183, 0x8d8495, 0x79bd58] },
  { id: "tidepool", label: "Tidepool crab", terrains: ["water", "sand"], motion: "glide", colors: [0x3b9fe5, 0xf26b4f, 0xf4c95d] },
  { id: "steam", label: "Steam and obsidian", terrains: ["water", "lava"], motion: "drift", colors: [0xf4f1e8, 0xec714d, 0x3b9fe5] },
  { id: "waterfall", label: "Pocket waterfall", terrains: ["water", "stone"], motion: "bob", colors: [0x8ed8ef, 0x8d8495, 0xffffff] },
  { id: "glassworks", label: "Volcanic glassmaker", terrains: ["sand", "lava"], motion: "pulse", colors: [0xf4c95d, 0xec714d, 0x382f3a] },
  { id: "duneclimb", label: "Dune climber", terrains: ["sand", "stone"], motion: "roll", colors: [0xf4c95d, 0x8d8495, 0xe85d75] },
  { id: "forge", label: "Little lava forge", terrains: ["lava", "stone"], motion: "pulse", colors: [0xec714d, 0x8d8495, 0xffd166] },
];

export function borderStoryFor(left: Terrain, right: Terrain): BorderStory | undefined {
  if (left === right) return undefined;
  return BORDER_STORIES.find((story) => story.terrains.includes(left) && story.terrains.includes(right));
}

// Paint and legacy scene identifiers remain stable in saves. The same scene
// now resolves to grounded art: no modern vehicles, rockets or candy pigments.
const linen = [0xb9aa82, 0x64553e, 0x807749], timber = [0x755d41, 0xc3af7e, 0x3e5340];
const water = [0x4d7479, 0xc4b891, 0x4e514d], stone = [0x747775, 0xb8ae92, 0x615d52], sand = [0xb6935d, 0x71513a, 0xc9ba93];
const d = (id: string, label: string, model: ModelKey, motion: Motion, motif: EcosystemDetail["motif"], colors: number[], stage: 0 | 1 | 2 | 3 = 0): EcosystemDetail => ({ id, label, model, motion, motif, colors: [...colors], stage });
type HistoricalEntry = [ModelKey, string, Motion, EcosystemDetail["motif"], (0 | 1 | 2 | 3)?];
const historical: Record<keyof typeof LEGACY_ECOSYSTEMS, HistoricalEntry[]> = {
  meadow: [
    ["worker", "Pobladores y senderos", "walk", "people"], ["wolf", "Lobos de la pradera", "graze", "animal"],
    ["bird", "Aves de la campiña", "flutter", "flying"], ["farm", "Cosecha de la campiña", "work", "landmark", 1],
    ["camp", "Campamento de colonos", "work", "landmark"], ["sheep", "Rebaño de ovejas", "graze", "animal"],
    ["farm", "Campos cultivados", "sway", "plant", 1], ["windmill", "Molino de viento", "turn", "landmark", 2],
    ["market", "Mercado de la aldea", "work", "landmark", 2], ["village", "Aldea de la llanura", "work", "landmark", 3],
  ],
  water: [
    ["fish", "Banco de peces", "glide", "waterlife"], ["sailboat", "Velero mercante", "bob", "vehicle", 1],
    ["bird", "Aves acuáticas", "glide", "animal"], ["turtle", "Tortugas marinas", "glide", "waterlife"],
    ["rocks", "Rocas del arrecife", "still", "landmark"], ["rowboat", "Barca de pescadores", "row", "vehicle"],
    ["fish", "Peces del arrecife", "glide", "waterlife"], ["whale", "Paso de ballenas", "bob", "waterlife", 1],
    ["bird", "Aves migratorias", "flutter", "flying", 2], ["watchtower", "Atalaya costera", "still", "landmark", 3],
  ],
  sand: [
    ["crab", "Cangrejos de la costa", "walk", "animal"], ["palm", "Palmeras al viento", "sway", "plant"],
    ["camp", "Campamento del desierto", "work", "landmark"], ["market", "Comerciantes de las dunas", "work", "landmark", 2],
    ["rocks", "Piedras de la costa", "still", "landmark"], ["goat", "Cabras del desierto", "graze", "animal"],
    ["palm", "Palmeras del oasis", "sway", "plant"], ["camel", "Caravana de camellos", "walk", "animal", 1],
    ["explorer", "Exploradores del desierto", "walk", "people", 2], ["ruins", "Ruinas de arenisca", "still", "landmark", 3],
  ],
  lava: [
    ["rocks", "Afloramientos de basalto", "still", "landmark"], ["explorer", "Exploradores del volcán", "walk", "people"],
    ["quarry", "Cantera volcánica", "work", "landmark", 1], ["rocks", "Fumarolas y peñascos", "still", "weather"],
    ["bird", "Aves sobre las calderas", "flutter", "flying"], ["goat", "Cabras de las laderas", "graze", "animal"],
    ["rocks", "Obsidiana", "still", "landmark"], ["workshop", "Taller de canteros", "work", "landmark", 2],
    ["camp", "Campamento geológico", "work", "landmark", 1], ["watchtower", "Fortaleza de basalto", "still", "landmark", 3],
  ],
  stone: [
    ["rocks", "Vetas de mineral", "still", "landmark"], ["goat", "Cabras de montaña", "graze", "animal"],
    ["quarry", "Cantera de montaña", "work", "landmark", 1], ["bat", "Murciélagos de las cuevas", "flutter", "flying"],
    ["explorer", "Exploradores de las cumbres", "walk", "people"], ["camp", "Puesto del paso montañoso", "work", "landmark", 1],
    ["pine", "Pinos de las laderas", "sway", "plant"], ["bird", "Aves de presa", "orbit", "flying"],
    ["workshop", "Taller de piedra", "work", "landmark", 2], ["watchtower", "Ciudadela de montaña", "still", "landmark", 3],
  ],
};
const palettes = { meadow: timber, water, sand, lava: stone, stone };
const legacy = Object.fromEntries(Object.entries(LEGACY_ECOSYSTEMS).map(([terrain, entries]) => [terrain, entries.map((entry, i) => {
  const [model, label, motion, motif, stage = 0] = historical[terrain as keyof typeof historical][i];
  return d(entry, label, model, motion, motif, palettes[terrain as keyof typeof palettes], stage);
})])) as unknown as Record<keyof typeof LEGACY_ECOSYSTEMS, readonly EcosystemDetail[]>;

export const ECOSYSTEMS: Record<Terrain, readonly EcosystemDetail[]> = {
  ...legacy,
  forest: [
    d("foresters", "Recolectores del bosque", "worker", "gather", "people", timber),
    d("deer", "Ciervos del claro", "deer", "graze", "animal", timber),
    d("wolves", "Lobos del bosque", "wolf", "walk", "animal", stone),
    d("woodlandBirds", "Aves del dosel", "bird", "flutter", "flying", linen),
    d("forestCamp", "Campamento forestal", "camp", "work", "landmark", timber),
    d("sawmill", "Taller de carpinteros", "workshop", "work", "landmark", timber, 1),
    d("oldOak", "Robles centenarios", "oak", "sway", "plant", timber),
    d("forestVillage", "Aldea entre los árboles", "village", "work", "landmark", timber, 2),
    d("forestRuins", "Ruinas cubiertas de bosque", "ruins", "still", "landmark", stone, 3),
    d("woodlandCaravan", "Mercado del bosque", "market", "work", "landmark", linen, 2),
  ],
  wetland: [
    d("reeds", "Juncales", "reeds", "sway", "plant", timber), d("herons", "Garzas de la laguna", "bird", "graze", "animal", linen),
    d("marshFish", "Peces de los canales", "fish", "glide", "waterlife", water), d("marshTurtles", "Tortugas de la marisma", "turtle", "glide", "waterlife", timber),
    d("reedGatherers", "Recolectores de juncos", "worker", "gather", "people", linen), d("reedBoat", "Barcas de los canales", "rowboat", "row", "vehicle", timber, 1),
    d("stiltVillage", "Aldea del humedal", "village", "work", "landmark", timber, 2), d("marshMarket", "Mercado fluvial", "market", "work", "landmark", sand, 2),
    d("migratingBirds", "Bandada migratoria", "bird", "flutter", "flying", linen, 1), d("wetlandRuins", "Ruinas entre las aguas", "ruins", "still", "landmark", stone, 3),
  ],
  snow: [
    d("pines", "Abetos nevados", "pine", "sway", "plant", timber), d("alpineGoats", "Cabras alpinas", "goat", "graze", "animal", linen),
    d("snowWolves", "Lobos del invierno", "wolf", "walk", "animal", stone), d("snowExplorers", "Exploradores de la nieve", "explorer", "walk", "people", linen),
    d("winterCamp", "Refugio de invierno", "camp", "work", "landmark", timber), d("snowQuarry", "Cantera alpina", "quarry", "work", "landmark", stone, 1),
    d("winterVillage", "Aldea de montaña", "village", "work", "landmark", timber, 2), d("snowBirds", "Aves de las cumbres", "bird", "flutter", "flying", stone),
    d("mountainWatch", "Atalaya del paso", "watchtower", "still", "landmark", stone, 2), d("ancientKeep", "Antigua fortaleza", "ruins", "still", "landmark", stone, 3),
  ],
};

const addedStories: BorderStory[] = [];
for (let a = 0; a < TERRAINS.length; a++) for (let b = a + 1; b < TERRAINS.length; b++) {
  const left = TERRAINS[a], right = TERRAINS[b];
  if (LEGACY_BORDER_STORIES.some(story => story.terrains.includes(left) && story.terrains.includes(right))) continue;
  const waterside = left === "water" || left === "wetland" || right === "water" || right === "wetland";
  addedStories.push({ id: `${left}-${right}`, label: waterside ? "Intercambio en la ribera" : "Sendero entre ecosistemas", terrains: [left, right], motion: waterside ? "row" : "walk", colors: waterside ? water : timber });
}
export const BORDER_STORIES: readonly BorderStory[] = [
  ...LEGACY_BORDER_STORIES.map(story => ({ ...story, colors: story.terrains.includes("water") ? water : timber, motion: story.motion === "pulse" ? "work" : story.motion })),
  ...addedStories,
];
export function availableScenes(terrain: Terrain, stage: number): readonly EcosystemDetail[] {
  return ECOSYSTEMS[terrain].filter(scene => (scene.stage ?? 0) <= stage);
}
