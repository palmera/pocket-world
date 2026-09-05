// Editing operations on the freestyle sphere graph: turning a freehand pen
// stroke (a list of points on the sphere) into vertices + edges, with the
// snapping that lets loops actually close, plus the Cmd (straighten) and Shift
// (15° bearing) constraints. Pure and unit-testable; the Scene feeds it the
// sampled stroke and renders the result.

import { Vec3, sub, add, cross, dot, len, normalize, scale } from "../geometry/vec";
import { arcBounds, overlappingArcs, pointsInBounds } from "./arcBounds";

export interface FreeGraph {
  verts: number[][]; // unit vectors
  edges: [number, number][]; // undirected
  authoredEdges?: [number, number][]; // exact user strokes, never decoratively warped
  bridgeEdges?: [number, number][]; // invisible topology links for inset regions
}

const asV3 = (p: number[]): Vec3 => [p[0], p[1], p[2]];
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// Great-circle (angular) distance between two unit vectors, in radians.
export function angBetween(a: number[], b: number[]): number {
  return Math.acos(clamp(dot(asV3(a), asV3(b)), -1, 1));
}

export const antipode = (p: number[]): number[] => [-p[0], -p[1], -p[2]];

// Spherical midpoint of two unit vectors (their normalized sum; for antipodal
// inputs this is undefined, so fall back to the first point).
export function sphereMidpoint(a: number[], b: number[]): number[] {
  const s = add(asV3(a), asV3(b));
  return Math.hypot(s[0], s[1], s[2]) < 1e-9 ? [...a] : [...normalize(s)];
}

// Index of the nearest existing vertex within `tol` radians, or -1.
export function nearestVert(g: FreeGraph, p: number[], tol: number): number {
  let best = -1;
  let bestD = tol;
  for (let i = 0; i < g.verts.length; i++) {
    const d = angBetween(g.verts[i], p);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Drop samples closer than `minStep` radians to the last kept point, so a dense
// pen trail becomes a lean polyline. First and last samples are always kept.
export function simplifyStroke(pts: number[][], minStep: number): number[][] {
  if (pts.length <= 2) return pts.map((p) => [...p]);
  const out: number[][] = [[...pts[0]]];
  for (let i = 1; i < pts.length - 1; i++) {
    if (angBetween(out[out.length - 1], pts[i]) >= minStep) out.push([...pts[i]]);
  }
  out.push([...pts[pts.length - 1]]);
  return out;
}

// Snap the geodesic from `start` to `cur` so its initial bearing is a multiple
// of `stepDeg`, keeping the same arc length. Returns the new endpoint on the
// sphere. (Shift constraint.)
export function snapBearing(start: number[], cur: number[], stepDeg: number): number[] {
  const n = normalize(asV3(start));
  const seed: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(sub(seed, scale(n, dot(seed, n))));
  const w = cross(n, u);
  const c = asV3(cur);
  const t = sub(c, scale(n, dot(c, n))); // tangent direction toward cur
  if (Math.hypot(t[0], t[1], t[2]) < 1e-9) return [...cur];
  const bearing = Math.atan2(dot(t, w), dot(t, u));
  const step = (stepDeg * Math.PI) / 180;
  const snapped = Math.round(bearing / step) * step;
  const theta = angBetween(start, cur); // arc length to preserve
  const dir = add(scale(u, Math.cos(snapped)), scale(w, Math.sin(snapped)));
  return [...normalize(add(scale(n, Math.cos(theta)), scale(dir, Math.sin(theta))))];
}

export interface AddStrokeOpts {
  snapTol: number; // radians; endpoints/samples within this of an existing vertex weld to it
  minStep: number; // radians; stroke simplification step
  straight?: boolean; // Cmd: collapse the stroke to a single start→end segment
  preserveShape?: boolean; // only endpoints may snap; interior samples stay on the ink
}

// Add a freehand stroke to the graph. Returns the new graph plus the indices of
// the resolved vertices along the stroke (handy for the caller to highlight or
// chain). Endpoints (and interior samples) weld to nearby existing vertices, and
// samples weld to vertices created earlier in the same stroke — that self-weld
// is what closes a loop into a panel.
export function addStroke(
  g: FreeGraph,
  rawPts: number[][],
  opts: AddStrokeOpts
): { graph: FreeGraph; path: number[] } {
  const verts = g.verts.map((p) => [...p]);
  const edges = g.edges.map((e) => [...e] as [number, number]);
  const has = new Set(edges.map(([a, b]) => (a < b ? `${a},${b}` : `${b},${a}`)));
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    if (has.has(k)) return;
    has.add(k);
    edges.push([a, b]);
  };

  const pts = opts.straight
    ? [rawPts[0], rawPts[rawPts.length - 1]]
    : simplifyStroke(rawPts, opts.minStep);
  if (pts.length < 2) return { graph: { ...g, verts, edges }, path: [] };

  const tmp: FreeGraph = { verts, edges };
  const resolve = (p: number[], index: number): number => {
    const endpoint = index === 0 || index === pts.length - 1;
    const hit = nearestVert(tmp, p, opts.preserveShape && !endpoint ? 1e-7 : opts.snapTol);
    if (hit >= 0) return hit;
    verts.push([...normalize(asV3(p))]);
    return verts.length - 1;
  };

  const path: number[] = [];
  for (const [i, p] of pts.entries()) {
    const idx = resolve(p, i);
    if (path.length === 0 || path[path.length - 1] !== idx) path.push(idx);
  }
  for (let i = 0; i < path.length - 1; i++) addEdge(path[i], path[i + 1]);

  const authoredEdges = [...(g.authoredEdges ?? [])];
  if (opts.preserveShape) for (let i=1;i<path.length;i++) authoredEdges.push([path[i-1],path[i]]);
  return { graph: { verts, edges, authoredEdges, bridgeEdges: g.bridgeEdges?.map(e=>[...e]) }, path };
}

// A regular polygon (or, with many sides, a circle) centred at `center` on the
// sphere: `sides` vertices each at arc distance `radiusRad` from the center, with
// the first vertex pointing toward `toward`. Returns unit vectors. Used by the
// freestyle shape-stamp tool (click center, drag for size + angle).
export function regularSphereLoop(
  center: number[], radiusRad: number, toward: number[], sides: number,
): number[][] {
  const n = normalize(asV3(center));
  const tw = asV3(toward);
  let u = sub(tw, scale(n, dot(tw, n))); // first-vertex direction in the tangent plane
  if (len(u) < 1e-9) {
    const seed: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    u = sub(seed, scale(n, dot(seed, n)));
  }
  u = normalize(u);
  const w = cross(n, u);
  const cr = Math.cos(radiusRad);
  const sr = Math.sin(radiusRad);
  const out: number[][] = [];
  const k = Math.max(3, Math.round(sides));
  for (let i = 0; i < k; i++) {
    const a = (2 * Math.PI * i) / k;
    const dir = add(scale(u, Math.cos(a)), scale(w, Math.sin(a)));
    out.push([...normalize(add(scale(n, cr), scale(dir, sr)))]);
  }
  return out;
}

// Remove a vertex (and its incident edges), reindexing what remains. Used by the
// freestyle eraser.
export function removeFreeVertex(g: FreeGraph, v: number): FreeGraph {
  const verts = g.verts.filter((_, i) => i !== v).map((p) => [...p]);
  const remap = (i: number) => (i > v ? i - 1 : i);
  const edges = g.edges
    .filter(([a, b]) => a !== v && b !== v)
    .map(([a, b]) => [remap(a), remap(b)] as [number, number]);
  return { verts, edges };
}

// Does p lie on the (minor) great-circle arc from a to b? True when it's on the
// great circle AND between the endpoints (angle sums match).
export function pointOnArc(p: number[], a: number[], b: number[], tol = 1e-6): boolean {
  const ab = angBetween(a, b);
  if (ab < 1e-9) return false;
  // Angle-sum alone is quadratic in cross-track error: nearby parallel pen
  // samples could be mistaken for intersections and split unrelated edges.
  const normal = normalize(cross(asV3(a), asV3(b)));
  if (Math.abs(dot(asV3(p), normal)) > Math.sin(tol)) return false;
  return Math.abs(angBetween(a, p) + angBetween(p, b) - ab) < tol * 2;
}

// Intersection of two great-circle arcs (a1,a2) and (b1,b2), as a unit vector
// interior to both, or null if they don't cross (parallel circles or the meeting
// point falls outside an arc).
export function arcArcIntersection(
  a1: number[], a2: number[], b1: number[], b2: number[], tol = 1e-6,
): number[] | null {
  const na = normalize(cross(asV3(a1), asV3(a2)));
  const nb = normalize(cross(asV3(b1), asV3(b2)));
  const d = cross(na, nb);
  if (Math.hypot(d[0], d[1], d[2]) < 1e-7) return null; // parallel / coincident
  const p1 = normalize(d);
  for (const cand of [[...p1], [...scale(p1, -1)]]) {
    if (pointOnArc(cand, a1, a2, tol) && pointOnArc(cand, b1, b2, tol)) return cand;
  }
  return null;
}

const edgeKey = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
function dedupeEdges(edges: [number, number][]): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const [a, b] of edges) {
    if (a === b) continue;
    const k = edgeKey(a, b);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([a, b]);
  }
  return out;
}

// Make the graph planar: insert a vertex at every edge-edge crossing and split
// each edge at every vertex that lies on it (crossings AND T-junctions). After
// this, regions bounded by crossing strokes are real faces. Idempotent.
//
// weldTol must stay BELOW the on-arc tolerance (1e-6): a crossing point lies
// exactly on both arcs, so it must NOT snap to a nearby pre-existing vertex that
// sits off the arc (e.g. a circle's dense vertices) — that would drop the split.
export function planarize(g: FreeGraph, weldTol = 1e-7): FreeGraph {
  const verts: number[][] = g.verts.map((p) => [...normalize(asV3(p))]);
  const getOrAdd = (p: number[]): number => {
    for (let i = 0; i < verts.length; i++) if (angBetween(verts[i], p) < weldTol) return i;
    verts.push([...normalize(asV3(p))]);
    return verts.length - 1;
  };

  const edges = dedupeEdges(g.edges);
  const bounds = edges.map(([a,b])=>arcBounds(verts[a],verts[b]));
  // 1. Add a vertex at each crossing of two non-adjacent edges.
  for (const [i,j] of overlappingArcs(bounds)) {
      const [a1, a2] = edges[i];
      const [b1, b2] = edges[j];
      if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) continue; // share an endpoint
      const p = arcArcIntersection(verts[a1], verts[a2], verts[b1], verts[b2]);
      if (p) getOrAdd(p);
  }

  // 2. Rebuild: split every edge at all vertices lying on its interior.
  const out: [number, number][] = [];
  const authored = new Set((g.authoredEdges ?? []).map(([a,b])=>edgeKey(a,b)));
  const bridges = new Set((g.bridgeEdges ?? []).map(([a,b])=>edgeKey(a,b)));
  const authoredEdges: [number,number][] = [], bridgeEdges: [number,number][] = [];
  const candidates = pointsInBounds(verts);
  for (const [edgeIndex, [a, b]] of edges.entries()) {
    const mids: number[] = [];
    for (const k of candidates(bounds[edgeIndex])) {
      if (k === a || k === b) continue;
      if (pointOnArc(verts[k], verts[a], verts[b])) mids.push(k);
    }
    mids.sort((p, q) => angBetween(verts[a], verts[p]) - angBetween(verts[a], verts[q]));
    const chain = [a, ...mids, b];
    for (let i = 0; i < chain.length - 1; i++) {
      const part: [number,number] = [chain[i], chain[i+1]];
      out.push(part);
      if (authored.has(edgeKey(a,b))) authoredEdges.push(part);
      if (bridges.has(edgeKey(a,b))) bridgeEdges.push(part);
    }
  }
  return { verts, edges: dedupeEdges(out), authoredEdges:dedupeEdges(authoredEdges), bridgeEdges:dedupeEdges(bridgeEdges) };
}

// Remove a single undirected edge (leaving its endpoints in place).
export function removeFreeEdge(g: FreeGraph, a: number, b: number): FreeGraph {
  const edges = g.edges.filter(
    ([x, y]) => !((x === a && y === b) || (x === b && y === a))
  );
  return { verts: g.verts.map((p) => [...p]), edges };
}
