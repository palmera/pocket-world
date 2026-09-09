# Living World architecture

Tiny World is an environment sandbox, not an RTS unit controller. The player
paints, divides and sculpts the sphere; local wildlife, workers and settlements
respond through deterministic geographic sites, environment restrictions and age.

## Boundaries between systems

- **Geometry and saves:** the spherical graph, colors and relief remain the
  source of truth. Inhabitants are derived, so removing artwork cannot erase land.
- **Living clock:** `src/world/livingWorld.ts` validates versioned state, advances
  active time, applies 0×/1×/3× speed, and records meaningful world edits. The
  renderer pauses simulation outside Tiny/when the document is hidden. Delayed
  ticks are capped; there is no offline catch-up economy.
- **Evolution:** exploration → settlement → community → civilization at
  0/60/180/480 simulation seconds. Scene entries specify their minimum age, and
  art families can change construction details with stage. Rebuild the life layer
  at a transition, not the terrain mesh on each animation frame.
- **Population:** `planPopulation` samples a stable geographic lattice. Surface
  area and density control budgets, not the count of painted faces. Its returned
  `id`, `point` and `radius` permit a shared spacing ledger for scenery, residents
  and border stories. Renderer placement also considers actual model footprints,
  relief slope and environmental features. This is a bounded diorama simulation,
  not a pathfinding or economic simulation with thousands of agents.
- **Motion:** named joints are collected once by `prepareAnimatedDetail`; each
  update resets cached rest rotations and applies gait, work, grazing, wings,
  sails, wheels or windmill motion. No per-frame model traversal or whole-building
  squash/stretch. Local paths include pauses and stay inside their reserved area.
- **Packs:** the renderer consumes `ecosystemForTerrain`, backed by
  `defaultContentPacks`. Namespaced IDs remain stable and missing optional pack
  entries fall back to built-in content. JSON schema/registration example and
  validation limits are in [docs/content-packs.md](docs/content-packs.md). This is
  an integration seam, not a marketplace, payment flow or remote script loader.

## Content and unlocks

There are 80 terrain catalogue entries over 8 ecosystems, 29 natural/historical
interior model families, and 28 pairwise border-story definitions. Four additional
trusted art families support fishing, caravans, forging and watermills at borders.
Entries reuse families with seeded materials and stage variants; this is not a
claim of 80 independent motion engines or unique high-poly character models.

The five original ecosystems remain available. Forest needs 120 simulated active
seconds plus 3 edits; wetland needs 300 seconds plus 8 edits; snow needs 600 seconds
plus 15 edits. Discoveries remain unlocked when a fresh world restarts its age.

Legacy scene IDs intentionally survive even where art changed (for example
`rocketbuoy` now means a coastal watchtower). These are compatibility identifiers,
not descriptions of the current graphics. Prefix every ID with `core:<terrain>.`:

| Ecosystem | Stable scene IDs |
| --- | --- |
| meadow | walkers, dogs, butterflies, bike, picnic, sheep, flowers, kite, buggy, fireflies |
| water | shoal, sailboat, ducks, turtle, bubbles, submarine, jellyfish, whale, seaplane, rocketbuoy |
| sand | crabs, tumbleweed, castle, buggy, shells, lizard, oasis, caravan, glider, launchpad |
| lava | bubbles, salamander, embers, geyser, firekite, hopper, obsidian, magmaCart, smoke, flareRocket |
| stone | crystals, goats, cart, bats, climbers, cablecar, moss, drone, train, meteor |
| forest | foresters, deer, wolves, woodlandBirds, forestCamp, sawmill, oldOak, forestVillage, forestRuins, woodlandCaravan |
| wetland | reeds, herons, marshFish, marshTurtles, reedGatherers, reedBoat, stiltVillage, marshMarket, migratingBirds, wetlandRuins |
| snow | pines, alpineGoats, snowWolves, snowExplorers, winterCamp, snowQuarry, winterVillage, snowBirds, mountainWatch, ancientKeep |

## Verification scope

Tests cover clock speed/pause, stage transitions, unlocks requiring both time and
edits, save sanitation and round trips, persistent discoveries, content namespace
and validation rules, missing-pack fallback, immutable catalogue snapshots,
terrain-subdivision invariance, density/age placement, shared spacing budgets,
cached animation joints and bounded motion. These are deterministic unit and
integration checks; they do not substitute for physical tablet frame-rate or
long-session usability testing.
