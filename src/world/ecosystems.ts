import type { BasicBehaviourId } from "./behaviours";

// Pocket World's content catalogue. A joined terrain unlocks entries from left
// to right as it grows. Keeping these as data (rather than hidden conditionals)
// makes the art direction easy to tune without changing the terrain engine.

export type Terrain = "meadow" | "water" | "sand" | "lava" | "stone";
export type Motion = BasicBehaviourId;

export interface EcosystemDetail {
  id: string;
  label: string;
  motion: Motion;
  // A compact set of semantic parts; the renderer turns these into layered 3D
  // toy-like models, with a terrain-specific palette.
  motif: "people" | "animal" | "plant" | "vehicle" | "flying" | "waterlife" | "rocklife" | "weather" | "landmark" | "spark";
  colors: number[];
}

export interface BorderStory {
  id: string;
  label: string;
  terrains: readonly [Terrain, Terrain];
  motion: Motion;
  colors: readonly number[];
}

export const ECOSYSTEMS: Record<Terrain, readonly EcosystemDetail[]> = {
  meadow: [
    { id: "walkers", label: "Tiny walkers", motion: "walk", motif: "people", colors: [0x293b63, 0xf4b183, 0xf5d766] },
    { id: "dogs", label: "Dog walkers", motion: "walk", motif: "animal", colors: [0x8a5d3b, 0xf0d3b2] },
    { id: "butterflies", label: "Butterflies", motion: "flutter", motif: "flying", colors: [0xf38ba8, 0xf6cf65, 0x83c5be] },
    { id: "bike", label: "Little bicycle", motion: "roll", motif: "vehicle", colors: [0x48a9a6, 0x28334a] },
    { id: "picnic", label: "Picnic blanket", motion: "pulse", motif: "landmark", colors: [0xe85d75, 0xffe2a5] },
    { id: "sheep", label: "Sheep flock", motion: "hop", motif: "animal", colors: [0xf7f5ed, 0x657d59] },
    { id: "flowers", label: "Wildflowers", motion: "sway", motif: "plant", colors: [0xffd166, 0xf783ac, 0x7eb77f] } as EcosystemDetail,
    { id: "kite", label: "Kite", motion: "flutter", motif: "flying", colors: [0xff6b6b, 0x4d96ff] },
    { id: "buggy", label: "Meadow car", motion: "roll", motif: "vehicle", colors: [0xff9f1c, 0x273043] },
    { id: "fireflies", label: "Fireflies", motion: "orbit", motif: "spark", colors: [0xfff3a3, 0xfefae0] },
  ],
  water: [
    { id: "shoal", label: "Fish shoal", motion: "glide", motif: "waterlife", colors: [0x54c6eb, 0x2f80ed] },
    { id: "sailboat", label: "Sailboat", motion: "bob", motif: "vehicle", colors: [0xfef9ef, 0xe85d75] },
    { id: "ducks", label: "Duck family", motion: "glide", motif: "animal", colors: [0xffcf56, 0xf7f5ed] },
    { id: "turtle", label: "Sea turtle", motion: "glide", motif: "waterlife", colors: [0x4d9560, 0x9bce78] },
    { id: "bubbles", label: "Bubble trail", motion: "bob", motif: "spark", colors: [0xc3f0ff, 0xf6fdff] },
    { id: "submarine", label: "Submarine", motion: "glide", motif: "vehicle", colors: [0xf4cf4d, 0x33415c] },
    { id: "jellyfish", label: "Jellyfish", motion: "pulse", motif: "waterlife", colors: [0xe8a7e9, 0xa0d8ef] },
    { id: "whale", label: "Tiny whale", motion: "bob", motif: "waterlife", colors: [0x516b9f, 0xdce8ff] },
    { id: "seaplane", label: "Seaplane", motion: "zoom", motif: "flying", colors: [0xf6f3e9, 0xeb6f92] },
    { id: "rocketbuoy", label: "Rocket buoy", motion: "zoom", motif: "flying", colors: [0xf5f1dc, 0xf1784d] },
  ],
  sand: [
    { id: "crabs", label: "Crab parade", motion: "walk", motif: "animal", colors: [0xf26b4f, 0xf9c784] },
    { id: "tumbleweed", label: "Tumbleweed", motion: "roll", motif: "plant", colors: [0xa87946, 0xd7a86e] },
    { id: "castle", label: "Sandcastle", motion: "pulse", motif: "landmark", colors: [0xe8bd7e, 0xf7d890] },
    { id: "buggy", label: "Dune buggy", motion: "roll", motif: "vehicle", colors: [0xe85d75, 0x293b63] },
    { id: "shells", label: "Shell collection", motion: "bob", motif: "spark", colors: [0xffd6e0, 0xc7b9ff] },
    { id: "lizard", label: "Sand lizard", motion: "hop", motif: "animal", colors: [0x7eaa5c, 0xdfd17a] },
    { id: "oasis", label: "Pocket oasis", motion: "sway", motif: "plant", colors: [0x53a9b6, 0x5c9b4c] } as EcosystemDetail,
    { id: "caravan", label: "Tiny caravan", motion: "walk", motif: "vehicle", colors: [0xe2a45f, 0x8b5a2b] },
    { id: "glider", label: "Sand glider", motion: "zoom", motif: "flying", colors: [0xfff4dc, 0x51a3a3] },
    { id: "launchpad", label: "Rocket launch", motion: "zoom", motif: "flying", colors: [0xf5f1dc, 0xf06449] },
  ],
  lava: [
    { id: "bubbles", label: "Magma bubbles", motion: "pulse", motif: "spark", colors: [0xffb703, 0xff6b35] },
    { id: "salamander", label: "Fire salamander", motion: "hop", motif: "animal", colors: [0xff7b00, 0x3c2f2f] },
    { id: "embers", label: "Ember beetles", motion: "orbit", motif: "rocklife", colors: [0xffd166, 0xf45b69] },
    { id: "geyser", label: "Lava geyser", motion: "pulse", motif: "weather", colors: [0xff5d3d, 0xffd166] },
    { id: "firekite", label: "Fire kite", motion: "flutter", motif: "flying", colors: [0xff9f1c, 0xffe66d] },
    { id: "hopper", label: "Rock hopper", motion: "hop", motif: "rocklife", colors: [0x554348, 0xff9f1c] },
    { id: "obsidian", label: "Obsidian crystals", motion: "pulse", motif: "landmark", colors: [0x382f3a, 0x8d5a97] },
    { id: "magmaCart", label: "Magma cart", motion: "roll", motif: "vehicle", colors: [0x55303a, 0xffa630] },
    { id: "smoke", label: "Smoke rings", motion: "drift", motif: "weather", colors: [0x554348, 0xcfb9c8] },
    { id: "flareRocket", label: "Flare rocket", motion: "zoom", motif: "flying", colors: [0xfff7e8, 0xf45b69] },
  ],
  stone: [
    { id: "crystals", label: "Crystal sprouts", motion: "pulse", motif: "landmark", colors: [0x8b7bd1, 0xb9a7f4] },
    { id: "goats", label: "Mountain goats", motion: "hop", motif: "animal", colors: [0xf3e4c8, 0x7b6d75] },
    { id: "cart", label: "Mine cart", motion: "roll", motif: "vehicle", colors: [0x5b657a, 0xf4b942] },
    { id: "bats", label: "Cave bats", motion: "flutter", motif: "flying", colors: [0x374151, 0x8290a5] },
    { id: "climbers", label: "Tiny climbers", motion: "walk", motif: "people", colors: [0xe85d75, 0x3b82a0] },
    { id: "cablecar", label: "Cable car", motion: "glide", motif: "vehicle", colors: [0xf2c14e, 0x33415c] },
    { id: "moss", label: "Moss cushions", motion: "sway", motif: "plant", colors: [0x679b5a, 0xa2c98b] } as EcosystemDetail,
    { id: "drone", label: "Explorer drone", motion: "orbit", motif: "flying", colors: [0xe9edf5, 0x5c6f91] },
    { id: "train", label: "Tunnel train", motion: "roll", motif: "vehicle", colors: [0xd94e41, 0x303846] },
    { id: "meteor", label: "Shooting star", motion: "zoom", motif: "spark", colors: [0xffe99b, 0xfdf2cd] },
  ],
};

// A border is an opportunity for two little worlds to acknowledge one another.
// There is one authored story for every unordered pair of the five terrains.
export const BORDER_STORIES: readonly BorderStory[] = [
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
  return BORDER_STORIES.find((story) => story.terrains.includes(left) && story.terrains.includes(right));
}
