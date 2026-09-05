import { Vec3, add, sub, cross, dot, normalize, centroid, dist, len } from "./vec";

// A polyhedron is a set of 3D vertices plus faces given as ordered index lists.
// Faces are wound counter-clockwise when viewed from OUTSIDE the solid.
export interface Polyhedron {
  vertices: Vec3[];
  faces: number[][];
}

export type Edge = readonly [number, number]; // sorted vertex indices a < b

const edgeKey = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);

// Unique undirected edges of the polyhedron.
export function edges(p: Polyhedron): Edge[] {
  const seen = new Map<string, Edge>();
  for (const f of p.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      const b = f[(i + 1) % f.length];
      const k = edgeKey(a, b);
      if (!seen.has(k)) seen.set(k, a < b ? [a, b] : [b, a]);
    }
  }
  return [...seen.values()];
}

export function faceCentroid(p: Polyhedron, face: number[]): Vec3 {
  return centroid(face.map((i) => p.vertices[i]));
}

// Newell's method — robust normal for a (near-)planar polygon, any vertex count.
export function faceNormal(p: Polyhedron, face: number[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < face.length; i++) {
    const cur = p.vertices[face[i]];
    const nxt = p.vertices[face[(i + 1) % face.length]];
    nx += (cur[1] - nxt[1]) * (cur[2] + nxt[2]);
    ny += (cur[2] - nxt[2]) * (cur[0] + nxt[0]);
    nz += (cur[0] - nxt[0]) * (cur[1] + nxt[1]);
  }
  return normalize([nx, ny, nz]);
}

// Largest distance from the origin to any vertex (circumradius for a solid
// centered at the origin, which all our generated solids are).
export function circumradius(p: Polyhedron): number {
  return Math.max(...p.vertices.map((v) => len(v)));
}

// Ensure every face is wound CCW as seen from outside: its Newell normal must
// point away from the solid's centroid. Reverses faces that point inward.
export function ensureOutwardWinding(p: Polyhedron): Polyhedron {
  const c = centroid(p.vertices);
  const faces = p.faces.map((face) => {
    const n = faceNormal(p, face);
    const outward = sub(faceCentroid(p, face), c);
    return dot(n, outward) < 0 ? [...face].reverse() : face;
  });
  return { vertices: p.vertices, faces };
}

// For a vertex, return its neighboring vertex indices in cyclic (rotational)
// order around it, derived from face adjacency. Works for any closed, oriented
// manifold polyhedron. Used by truncate() and dual().
export function neighborsAround(p: Polyhedron, v: number): number[] {
  // For each face touching v, record the (prev -> next) step around v.
  // In a CCW face ...a, v, b..., walking the vertex fan we map b -> a.
  const step = new Map<number, number>();
  for (const f of p.faces) {
    const i = f.indexOf(v);
    if (i === -1) continue;
    const prev = f[(i - 1 + f.length) % f.length];
    const next = f[(i + 1) % f.length];
    step.set(next, prev);
  }
  if (step.size === 0) return [];
  const start = step.keys().next().value as number;
  const order: number[] = [start];
  let cur = step.get(start);
  while (cur !== undefined && cur !== start && order.length <= step.size) {
    order.push(cur);
    cur = step.get(cur);
  }
  return order;
}

// Faces incident to each vertex, in the same cyclic order as neighborsAround.
// Returns, per requested vertex, the list of face indices around it. Used to
// build the dual polyhedron.
export function facesAround(p: Polyhedron, v: number): number[] {
  const order = neighborsAround(p, v);
  // The face between consecutive neighbors (n_i, n_{i+1}) is the one containing
  // edge (v, n_i) and (v, n_{i+1}). Find it by matching both neighbors.
  const result: number[] = [];
  for (let i = 0; i < order.length; i++) {
    const a = order[i];
    const b = order[(i + 1) % order.length];
    const fi = p.faces.findIndex(
      (f) => f.includes(v) && f.includes(a) && f.includes(b),
    );
    if (fi !== -1) result.push(fi);
  }
  return result;
}

// Maximum deviation of any face from being perfectly planar, as a fraction of
// the solid's circumradius. 0 => all faces exactly flat. Used by the unfolder
// to warn the user how much a curved face had to be approximated.
export function maxPlanarityError(p: Polyhedron): number {
  const r = circumradius(p) || 1;
  let worst = 0;
  for (const face of p.faces) {
    if (face.length <= 3) continue; // triangles are always planar
    const c = faceCentroid(p, face);
    const n = faceNormal(p, face);
    for (const idx of face) {
      const d = Math.abs(dot(sub(p.vertices[idx], c), n));
      if (d > worst) worst = d;
    }
  }
  return worst / r;
}

// Re-center a polyhedron on the origin (so circumradius/scaling behave).
export function center(p: Polyhedron): Polyhedron {
  const c = centroid(p.vertices);
  return { vertices: p.vertices.map((v) => sub(v, c)), faces: p.faces };
}

// Deduplicate near-coincident vertices and remap faces. Tolerance is absolute.
export function weld(p: Polyhedron, tol = 1e-6): Polyhedron {
  const out: Vec3[] = [];
  const map: number[] = [];
  for (const v of p.vertices) {
    let found = -1;
    for (let i = 0; i < out.length; i++) {
      if (dist(out[i], v) < tol) {
        found = i;
        break;
      }
    }
    if (found === -1) {
      found = out.length;
      out.push(v);
    }
    map.push(found);
  }
  const faces = p.faces.map((f) => f.map((i) => map[i]));
  return { vertices: out, faces };
}

export { add, sub, cross, dot, normalize };
