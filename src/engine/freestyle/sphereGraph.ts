// Freestyle drawing model: a graph embedded on the unit sphere (vertices +
// undirected edges) whose CLOSED loops are the panels. As the user draws and a
// loop closes, a new face appears — that's a panel.
//
// This module is the pure, testable core: given vertices (unit vectors) and
// edges, extract the bounded faces of the spherical planar graph. It's kept
// independent of three.js / the DOM so it runs under node tests.

import { Vec3, sub, cross, dot, normalize, scale } from "../geometry/vec";

export interface SphereGraph {
  verts: number[][]; // unit vectors on the sphere
  edges: [number, number][]; // undirected vertex-index pairs
}

const asV3 = (p: number[]): Vec3 => [p[0], p[1], p[2]];

// Build undirected adjacency sets, dropping self-loops and duplicates.
function adjacency(n: number, edges: [number, number][]): Set<number>[] {
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (const [a, b] of edges) {
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) continue;
    adj[a].add(b);
    adj[b].add(a);
  }
  return adj;
}

// Iteratively strip degree-≤1 vertices: dangling paths and trees carry no face,
// so a stroke that doesn't close contributes nothing until it does. What remains
// is the 2-edge-connected core whose darts trace clean simple polygons.
function pruneDangling(adj: Set<number>[]): Set<number>[] {
  const a = adj.map((s) => new Set(s));
  let changed = true;
  while (changed) {
    changed = false;
    for (let v = 0; v < a.length; v++) {
      if (a[v].size === 1) {
        const [w] = [...a[v]];
        a[v].delete(w);
        a[w].delete(v);
        changed = true;
      }
    }
  }
  return a;
}

// An orthonormal tangent frame (u, w) at a point on the unit sphere whose normal
// is the point itself.
function tangentFrame(n: Vec3): { u: Vec3; w: Vec3 } {
  const seed: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(sub(seed, scale(n, dot(seed, n))));
  const w = cross(n, u);
  return { u, w };
}

// Neighbors of each vertex sorted CCW (as seen from outside the sphere) by their
// bearing in that vertex's tangent plane.
function sortedNeighbors(verts: number[][], adj: Set<number>[]): number[][] {
  return adj.map((nb, v) => {
    if (nb.size === 0) return [];
    const n = asV3(verts[v]);
    const { u, w } = tangentFrame(n);
    const ang = (m: number): number => {
      const d = sub(asV3(verts[m]), n);
      const dt = sub(d, scale(n, dot(d, n))); // project edge dir into tangent plane
      return Math.atan2(dot(dt, w), dot(dt, u));
    };
    return [...nb].sort((p, q) => ang(p) - ang(q));
  });
}

// Signed solid angle of the spherical triangle (a,b,c); >0 when CCW as seen from
// outside. (Van Oosterom–Strackee.)
function solidAngleTri(a: Vec3, b: Vec3, c: Vec3): number {
  const num = dot(a, cross(b, c));
  const den = 1 + dot(a, b) + dot(b, c) + dot(c, a);
  return 2 * Math.atan2(num, den);
}

// Signed spherical area of a face (fan-triangulated). A small CCW-outward panel
// is a small positive value; its complementary "rest of the sphere" comes out
// negative, which is how we drop it.
export function sphericalArea(verts: number[][], face: number[]): number {
  if (face.length < 3) return 0;
  const p = face.map((i) => asV3(verts[i]));
  let s = 0;
  for (let i = 1; i < p.length - 1; i++) s += solidAngleTri(p[0], p[i], p[i + 1]);
  return s;
}

// Extract the bounded panels of the spherical graph. Returns face loops as
// arrays of (original) vertex indices, wound CCW as seen from outside.
export function extractSphereFaces(verts: number[][], edges: [number, number][]): number[][] {
  const n = verts.length;
  const adj = pruneDangling(adjacency(n, edges));
  const nb = sortedNeighbors(verts, adj);

  const key = (u: number, v: number) => `${u}>${v}`;
  // Next dart in a face: arriving at v from u, leave along the neighbor just
  // clockwise of u — i.e. the previous entry in v's CCW order.
  const nextDart = (u: number, v: number): [number, number] => {
    const ring = nb[v];
    const i = ring.indexOf(u);
    return [v, ring[(i - 1 + ring.length) % ring.length]];
  };

  const seen = new Set<string>();
  const faces: number[][] = [];
  for (let v = 0; v < n; v++) {
    for (const w of nb[v]) {
      if (seen.has(key(v, w))) continue;
      const face: number[] = [];
      let [a, b] = [v, w];
      // Guard against pathological non-termination.
      for (let guard = 0; guard < 2 * edges.length + 4; guard++) {
        seen.add(key(a, b));
        face.push(a);
        [a, b] = nextDart(a, b);
        if (a === v && b === w) break;
      }
      if (face.length >= 3) faces.push(face);
    }
  }

  // Keep the real panels (small, positively-oriented regions); drop each loop's
  // complementary "rest of the sphere", which traces with negative area.
  const HALF_SPHERE = 2 * Math.PI;
  return faces.filter((f) => {
    const area = sphericalArea(verts, f);
    return area > 1e-7 && area < HALF_SPHERE - 1e-7;
  });
}

// Convenience: the panels as a {v,f} mesh (same shape the rest of the app uses).
export function graphToMesh(g: SphereGraph): { v: number[][]; f: number[][] } {
  return { v: g.verts.map((p) => [...p]), f: extractSphereFaces(g.verts, g.edges) };
}
