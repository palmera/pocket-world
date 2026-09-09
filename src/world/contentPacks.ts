import { BASIC_BEHAVIOURS } from "./behaviours";
import { ECOSYSTEMS, MODEL_KEYS, TERRAINS, type EcosystemDetail, type Terrain } from "./ecosystems";

/** Data only: model/motion select trusted engine capabilities, never code or URLs. */
export interface PackInhabitant extends EcosystemDetail { terrain: Terrain; model: NonNullable<EcosystemDetail["model"]>; }
export interface ContentPack {
  schemaVersion: 1;
  id: string;
  label: string;
  inhabitants: readonly PackInhabitant[];
}
const identifiers = /^[a-z][a-z0-9_.-]{0,79}$/i;
const motifs = ["people", "animal", "plant", "vehicle", "flying", "waterlife", "rocklife", "weather", "landmark", "spark"];
const motions = new Set(BASIC_BEHAVIOURS.map(behaviour => behaviour.id));
function object(value: unknown, allowed: readonly string[], location: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${location} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${location} must be plain data`);
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!allowed.includes(key)) throw new Error(`${location}: unsupported field ${key}`);
    const property = Object.getOwnPropertyDescriptor(source, key)!;
    if (property.get || property.set) throw new Error(`${location}: accessors are not data`);
  }
  return source;
}
function text(value: unknown, location: string, id = false): string {
  if (typeof value !== "string" || !value.trim() || value.length > (id ? 80 : 120) || (id && !identifiers.test(value))) throw new Error(`${location} is invalid`);
  return value;
}
export function validateContentPack(value: unknown): ContentPack {
  const source = object(value, ["schemaVersion", "id", "label", "inhabitants"], "pack");
  if (source.schemaVersion !== 1) throw new Error("Unsupported content pack schema version");
  const id = text(source.id, "pack.id", true), label = text(source.label, "pack.label");
  if (!Array.isArray(source.inhabitants) || source.inhabitants.length < 1 || source.inhabitants.length > 256) throw new Error("A pack must contain 1–256 inhabitants");
  const ids = new Set<string>();
  const inhabitants = source.inhabitants.map((value, index): PackInhabitant => {
    const at = `inhabitants[${index}]`;
    const entry = object(value, ["id", "label", "terrain", "model", "motion", "motif", "colors", "stage"], at);
    const entryId = text(entry.id, `${at}.id`, true);
    if (ids.has(entryId)) throw new Error(`Duplicate inhabitant id: ${entryId}`);
    ids.add(entryId);
    if (!(TERRAINS as readonly unknown[]).includes(entry.terrain)) throw new Error(`${at}.terrain is unknown`);
    if (!(MODEL_KEYS as readonly unknown[]).includes(entry.model)) throw new Error(`${at}.model is unknown`);
    if (typeof entry.motion !== "string" || !motions.has(entry.motion)) throw new Error(`${at}.motion is unknown`);
    if (!motifs.includes(String(entry.motif))) throw new Error(`${at}.motif is unknown`);
    if (!Array.isArray(entry.colors) || entry.colors.length < 1 || entry.colors.length > 6 || entry.colors.some(color => !Number.isInteger(color) || color < 0 || color > 0xffffff)) throw new Error(`${at}.colors must be 1–6 RGB integers`);
    if (entry.stage !== undefined && ![0, 1, 2, 3].includes(entry.stage as number)) throw new Error(`${at}.stage must be 0–3`);
    return Object.freeze({ id: entryId, label: text(entry.label, `${at}.label`), terrain: entry.terrain as Terrain, model: entry.model as PackInhabitant["model"], motion: entry.motion, motif: entry.motif as PackInhabitant["motif"], colors: Object.freeze([...entry.colors]) as unknown as number[], stage: (entry.stage ?? 0) as 0 | 1 | 2 | 3 });
  });
  return Object.freeze({ schemaVersion: 1, id, label, inhabitants: Object.freeze(inhabitants) });
}

export const BUILTIN_CONTENT_PACK: ContentPack = validateContentPack({
  schemaVersion: 1, id: "core", label: "Pocket World · Territorios",
  inhabitants: TERRAINS.flatMap(terrain => ECOSYSTEMS[terrain].map(detail => ({ ...detail, id: `${terrain}.${detail.id}`, terrain, model: detail.model ?? "worker" }))),
});

export class ContentPackRegistry {
  private readonly packs = new Map<string, ContentPack>();
  private readonly entries = new Map<string, PackInhabitant>();
  private readonly catalogs = new Map<Terrain, readonly PackInhabitant[]>();
  constructor() { this.register(BUILTIN_CONTENT_PACK); }
  register(input: unknown): ContentPack {
    const pack = validateContentPack(input);
    if (this.packs.has(pack.id)) throw new Error(`Content pack already registered: ${pack.id}`);
    if (this.packs.size >= 16) throw new Error("Content pack limit reached");
    this.packs.set(pack.id, pack);
    for (const inhabitant of pack.inhabitants) {
      const id = `${pack.id}:${inhabitant.id}`;
      this.entries.set(id, Object.freeze({ ...inhabitant, id }));
    }
    this.catalogs.clear();
    return pack;
  }
  /** Removing optional art never removes painted areas or edits a world save. */
  unregister(id: string): boolean {
    if (id === "core") return false;
    const pack = this.packs.get(id);
    if (!pack) return false;
    for (const entry of pack.inhabitants) this.entries.delete(`${id}:${entry.id}`);
    this.packs.delete(id);
    this.catalogs.clear();
    return true;
  }
  list(): readonly ContentPack[] { return [...this.packs.values()]; }
  has(id: string): boolean { return this.entries.has(id); }
  resolve(id: string, terrain: Terrain = "meadow"): PackInhabitant {
    return this.entries.get(id) ?? this.entries.get(`core:${terrain}.${ECOSYSTEMS[terrain][0].id}`)!;
  }
  catalog(terrain: Terrain): readonly PackInhabitant[] {
    let result = this.catalogs.get(terrain);
    if (!result) {
      result = Object.freeze([...this.entries.entries()].filter(([, entry]) => entry.terrain === terrain).map(([id, entry]) => Object.freeze({ ...entry, id })));
      this.catalogs.set(terrain, result);
    }
    return result;
  }
}
export const defaultContentPacks = new ContentPackRegistry();
export function ecosystemForTerrain(terrain: Terrain): readonly PackInhabitant[] { return defaultContentPacks.catalog(terrain); }
