import type { Terrain } from "./ecosystems";

/** Relief is a small, independent height field: it never adds graph vertices. */
export type ReliefMode = "raise" | "lower" | "smooth";
export type ReliefKind = "hill" | "crater" | "dune" | "basin" | "ridge" | "volcano" | "caldera" | "hurricane" | "whirlpool" | "island" | "channel" | "glacier" | "crevasse";
export interface ReliefStamp {
  center: [number, number, number];
  /** Angular footprint in radians, not pixels or scene units. */
  radius: number;
  /** Signed intensity in scene units on the 120-unit world. */
  amount: number;
  terrain: Terrain;
  kind: ReliefKind;
}
export interface ReliefSave { version: 1; stamps: ReliefStamp[] }
export const RELIEF_LIMITS = Object.freeze({
  maxStamps: 96, minRadius: .018, maxRadius: .24,
  maxStrength: 5, minAmount: -8, maxAmount: 12,
  minHeight: -5, maxHeight: 15, maxStrokePoints: 4096, maxSamples: 512,
});

const knownTerrains = new Set(["meadow", "water", "sand", "lava", "stone", "forest", "wetland", "snow"]);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const dot = (a: readonly number[], b: readonly number[]) => clamp(a[0]*b[0]+a[1]*b[1]+a[2]*b[2], -1, 1);
function unit(value: unknown): [number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(n => typeof n === "number" && Number.isFinite(n))) return;
  const length = Math.hypot(value[0], value[1], value[2]);
  if (!Number.isFinite(length) || length < 1e-10) return;
  return [value[0]/length, value[1]/length, value[2]/length];
}

export function reliefKind(terrain: Terrain, mode: Exclude<ReliefMode, "smooth">): ReliefKind {
  const pairs: Record<string, readonly [ReliefKind, ReliefKind]> = {
    meadow: ["hill", "crater"], forest: ["hill", "crater"],
    water: ["hurricane", "whirlpool"], sand: ["dune", "basin"],
    stone: ["ridge", "crater"], lava: ["volcano", "caldera"],
    wetland: ["island", "channel"], snow: ["glacier", "crevasse"],
  };
  return (pairs[terrain] ?? pairs.meadow)[mode === "raise" ? 0 : 1];
}
export function reliefLabel(terrain: Terrain, mode: ReliefMode): string {
  if (mode === "smooth") return "Suavizar relieve";
  const labels: Record<ReliefKind, string> = {
    hill: "Montañas", crater: "Cráteres", dune: "Dunas", basin: "Depresiones",
    ridge: "Cordilleras", volcano: "Volcanes", caldera: "Calderas",
    hurricane: "Huracanes", whirlpool: "Remolinos", island: "Islas",
    channel: "Canales", glacier: "Glaciares", crevasse: "Grietas de hielo",
  };
  return labels[reliefKind(terrain, mode)];
}

/** Accept the old plain-array representation as well as the versioned save. */
export function sanitizeRelief(saved: unknown): ReliefStamp[] {
  let values: unknown = saved;
  if (saved && typeof saved === "object" && !Array.isArray(saved)) {
    const data = saved as Partial<ReliefSave>;
    if (data.version !== 1) return [];
    values = data.stamps;
  }
  if (!Array.isArray(values)) return [];
  const result: ReliefStamp[] = [];
  // Scan a bounded number of entries even if an imported document is hostile.
  for (const value of values.slice(0, RELIEF_LIMITS.maxStamps * 4)) {
    if (!value || typeof value !== "object") continue;
    const stamp = value as ReliefStamp, center = unit(stamp.center);
    if (!center || !knownTerrains.has(stamp.terrain) || !Number.isFinite(stamp.radius) || stamp.radius <= 0 || !Number.isFinite(stamp.amount) || Math.abs(stamp.amount) < .015) continue;
    result.push({center, radius: clamp(stamp.radius, RELIEF_LIMITS.minRadius, RELIEF_LIMITS.maxRadius),
      amount: clamp(stamp.amount, RELIEF_LIMITS.minAmount, RELIEF_LIMITS.maxAmount),
      terrain: stamp.terrain, kind: reliefKind(stamp.terrain, stamp.amount >= 0 ? "raise" : "lower")});
    if (result.length === RELIEF_LIMITS.maxStamps) break;
  }
  return result;
}

/** Uniform angular sampling makes a stroke independent of pointer-event rate. */
function samplePath(points: readonly (readonly number[])[], spacing: number): [number, number, number][] {
  const samples: [number, number, number][] = [];
  let previous: [number, number, number] | undefined, accumulated = 0;
  for (const value of points.slice(0, RELIEF_LIMITS.maxStrokePoints)) {
    const point = unit(value);
    if (!point) continue;
    if (!previous) { previous=point; samples.push(point); continue; }
    const angle = Math.acos(dot(previous, point));
    // An antipodal jump has no unique minor arc; do not raise an arbitrary hemisphere.
    if (angle > Math.PI-.001) { previous=point; accumulated=0; continue; }
    if (angle < 1e-8) { previous=point; continue; }
    let distance = spacing-accumulated, emitted=0;
    const sine = Math.sin(angle);
    while (distance <= angle + 1e-9 && samples.length < RELIEF_LIMITS.maxSamples) {
      const t = Math.min(1,distance/angle), a=Math.sin((1-t)*angle)/sine, b=Math.sin(t*angle)/sine;
      samples.push(unit([previous[0]*a+point[0]*b,previous[1]*a+point[1]*b,previous[2]*a+point[2]*b])!);
      distance += spacing;
      emitted++;
    }
    accumulated = Math.max(0,accumulated+angle-emitted*spacing);
    if (accumulated<1e-8) accumulated=0;
    previous = point;
    if (samples.length === RELIEF_LIMITS.maxSamples) break;
  }
  if (previous && samples.length < RELIEF_LIMITS.maxSamples && dot(samples[samples.length-1],previous)<Math.cos(spacing*.35)) samples.push(previous);
  return samples;
}

/** One invocation is one history entry; callers save the previous array once. */
export function applyReliefStroke(existing: readonly ReliefStamp[], pointsUnit: readonly (readonly number[])[], mode: ReliefMode,
  terrain: Terrain, radiusAngular=.075, strength=2): ReliefStamp[] {
  const stamps = sanitizeRelief(existing);
  if (!knownTerrains.has(terrain) || !["raise","lower","smooth"].includes(mode) || !Number.isFinite(radiusAngular) || !Number.isFinite(strength) || strength<=0) return stamps;
  const radius = clamp(radiusAngular, RELIEF_LIMITS.minRadius, RELIEF_LIMITS.maxRadius);
  const force = clamp(strength, 0, RELIEF_LIMITS.maxStrength);
  const samples = samplePath(pointsUnit, radius*.6);
  if (mode === "smooth") {
    // Apply at most once per stamp per stroke. Repeated event samples cannot
    // accidentally erase the whole mountain; the outer brush rim fades gently.
    return stamps.flatMap(stamp => {
      let nearest = Infinity;
      for (const point of samples) nearest=Math.min(nearest,Math.acos(dot(stamp.center,point)));
      const reach=radius+stamp.radius*.3;
      if (nearest>=reach) return [stamp];
      const influence = 1-nearest/reach, amount=stamp.amount*(1-Math.min(.95,force*.2)*influence*influence*(3-2*influence));
      return Math.abs(amount)<.08 ? [] : [{...stamp,amount}];
    });
  }
  const kind=reliefKind(terrain,mode), amount=force*(mode === "lower" ? -1 : 1);
  for (const center of samples) {
    // Only merge the same landform, with a small enough footprint to preserve
    // channels and mountain ridges. Never move an existing mountain's center.
    const neighbour=stamps.find(stamp => stamp.kind===kind && stamp.terrain===terrain && dot(stamp.center,center)>=Math.cos(Math.min(radius,stamp.radius)*.32));
    if (neighbour) {
      neighbour.amount=clamp(neighbour.amount+amount,RELIEF_LIMITS.minAmount,RELIEF_LIMITS.maxAmount);
      neighbour.radius=Math.max(neighbour.radius,radius);
    } else if (stamps.length<RELIEF_LIMITS.maxStamps) stamps.push({center,radius,amount,terrain,kind});
  }
  return stamps;
}

// Compact-support C1 landforms. Both elevation and slope become zero at the
// footprint edge, including across painted region seams and polar regions.
function profile(kind: ReliefKind, u: number): number {
  const v=1-u*u, smooth=v*v*v;
  switch (kind) {
    case "hurricane": return smooth*.1; // weather, not a solid mountain of water
    case "whirlpool": return smooth*.3;
    case "island": return smooth*.65;
    case "dune": return smooth*.62;
    case "glacier": return smooth*(1+.8*u*u);
    case "volcano": return smooth*(.45+2.4*u*u);
    case "crater": case "caldera": return smooth*(1-3*u*u);
    case "channel": case "crevasse": return smooth*smooth*.72;
    default: return smooth;
  }
}
function profileSlope(kind: ReliefKind, u: number): number {
  const v=1-u*u, smooth=v*v*v, derivative=-6*u*v*v;
  switch (kind) {
    case "hurricane": return derivative*.1;
    case "whirlpool": return derivative*.3;
    case "island": return derivative*.65;
    case "dune": return derivative*.62;
    case "glacier": return derivative*(1+.8*u*u)+smooth*1.6*u;
    case "volcano": return derivative*(.45+2.4*u*u)+smooth*4.8*u;
    case "crater": case "caldera": return derivative*(1-3*u*u)-smooth*6*u;
    case "channel": case "crevasse": return 2*smooth*derivative*.72;
    default: return derivative;
  }
}

export interface ReliefSampler {
  readonly key: string;
  height(point: readonly number[]): number;
  /** Analytic radial normal; shared vertices get identical normals. */
  normalAt(point: readonly number[], baseRadius?: number): [number, number, number];
  /** Only stamps whose influence can intersect this spherical face cap. */
  signature(center: readonly number[], angularRadius: number): string;
}
export function createReliefSampler(input: readonly ReliefStamp[]): ReliefSampler {
  const stamps=sanitizeRelief(input).map(stamp=>({...stamp,cosRadius:Math.cos(stamp.radius),key:JSON.stringify(stamp)}));
  const key=stamps.map(stamp=>stamp.key).join(";");
  return {
    key,
    height(point) {
      const length=Math.hypot(point[0],point[1],point[2]);
      if (!Number.isFinite(length) || length<1e-10) return 0;
      const x=point[0]/length,y=point[1]/length,z=point[2]/length;
      let height=0;
      for (const stamp of stamps) {
        const cosine=clamp(x*stamp.center[0]+y*stamp.center[1]+z*stamp.center[2],-1,1);
        if (cosine<=stamp.cosRadius) continue;
        height+=stamp.amount*profile(stamp.kind,Math.acos(cosine)/stamp.radius);
      }
      return clamp(height,RELIEF_LIMITS.minHeight,RELIEF_LIMITS.maxHeight);
    },
    normalAt(point,baseRadius=120) {
      const p=unit(Array.from(point)) ?? [0,0,1];
      let height=0,gx=0,gy=0,gz=0;
      for (const stamp of stamps) {
        const cosine=dot(p,stamp.center);
        if (cosine<=stamp.cosRadius) continue;
        const angle=Math.acos(cosine),u=angle/stamp.radius;
        height+=stamp.amount*profile(stamp.kind,u);
        // The radially symmetric profile has a zero gradient at its center.
        if (angle<1e-8) continue;
        const derivative=-stamp.amount*profileSlope(stamp.kind,u)/(stamp.radius*Math.sin(angle));
        gx+=derivative*(stamp.center[0]-cosine*p[0]);
        gy+=derivative*(stamp.center[1]-cosine*p[1]);
        gz+=derivative*(stamp.center[2]-cosine*p[2]);
      }
      if (height<RELIEF_LIMITS.minHeight || height>RELIEF_LIMITS.maxHeight) return p;
      const radial=(Number.isFinite(baseRadius)?Math.max(20,baseRadius):120)+height;
      return unit([radial*p[0]-gx,radial*p[1]-gy,radial*p[2]-gz]) ?? p;
    },
    signature(center,angularRadius) {
      const p=unit(Array.from(center));
      if (!p || !Number.isFinite(angularRadius)) return key;
      return stamps.filter(stamp=>angularRadius+stamp.radius>=Math.PI || dot(p,stamp.center)>=Math.cos(Math.max(0,angularRadius)+stamp.radius+1e-7)).map(stamp=>stamp.key).join(";");
    },
  };
}
