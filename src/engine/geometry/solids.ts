import { Vec3, lerp, onSphere, dist, centroid } from "./vec";
import {
  Polyhedron,
  ensureOutwardWinding,
  neighborsAround,
  facesAround,
  weld,
  faceCentroid,
} from "./Polyhedron";

const PHI = (1 + Math.sqrt(5)) / 2;

// ---------------------------------------------------------------------------
// Base solids whose faces are all triangles → faces auto-detected from coords.
// ---------------------------------------------------------------------------

// Detect triangular faces of an all-triangle solid from vertex coordinates:
// edges = vertex pairs at the minimum pairwise distance; triangles = triples
// that are mutually adjacent. Winding is fixed afterwards.
function triangulateFromPoints(vertices: Vec3[]): Polyhedron {
  let minD = Infinity;
  for (let i = 0; i < vertices.length; i++)
    for (let j = i + 1; j < vertices.length; j++)
      minD = Math.min(minD, dist(vertices[i], vertices[j]));
  const adj: boolean[][] = vertices.map(() => vertices.map(() => false));
  for (let i = 0; i < vertices.length; i++)
    for (let j = i + 1; j < vertices.length; j++)
      if (dist(vertices[i], vertices[j]) <= minD * 1.0001) {
        adj[i][j] = adj[j][i] = true;
      }
  const faces: number[][] = [];
  for (let i = 0; i < vertices.length; i++)
    for (let j = i + 1; j < vertices.length; j++)
      for (let k = j + 1; k < vertices.length; k++)
        if (adj[i][j] && adj[j][k] && adj[i][k]) faces.push([i, j, k]);
  return ensureOutwardWinding({ vertices, faces });
}

export function tetrahedron(): Polyhedron {
  return triangulateFromPoints([
    [1, 1, 1],
    [1, -1, -1],
    [-1, 1, -1],
    [-1, -1, 1],
  ]);
}

export function octahedron(): Polyhedron {
  return triangulateFromPoints([
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ]);
}

export function icosahedron(): Polyhedron {
  const v: Vec3[] = [];
  // All cyclic permutations of (0, ±1, ±φ).
  for (const s1 of [-1, 1])
    for (const s2 of [-1, 1]) {
      v.push([0, s1, s2 * PHI]);
      v.push([s1, s2 * PHI, 0]);
      v.push([s2 * PHI, 0, s1]);
    }
  return triangulateFromPoints(v);
}

// ---------------------------------------------------------------------------
// Conway operators
// ---------------------------------------------------------------------------

// Truncate: cut every vertex at parameter t in (0, 0.5) along each incident
// edge. Each original n-gon face becomes a 2n-gon; each degree-d vertex becomes
// a new d-gon. truncate(icosahedron, 1/3) = the classic soccer-ball solid
// (truncated icosahedron) with all edges equal.
export function truncate(p: Polyhedron, t = 1 / 3): Polyhedron {
  const verts: Vec3[] = [];
  const cutIndex = new Map<string, number>(); // "a->b" => index of point near a
  const key = (a: number, b: number) => `${a}->${b}`;

  const cut = (a: number, b: number): number => {
    const k = key(a, b);
    let idx = cutIndex.get(k);
    if (idx === undefined) {
      idx = verts.length;
      verts.push(lerp(p.vertices[a], p.vertices[b], t)); // point near a
      cutIndex.set(k, idx);
    }
    return idx;
  };

  const faces: number[][] = [];

  // Faces from original faces (corner-cut polygons): per edge, the two cut
  // points near its endpoints.
  for (const f of p.faces) {
    const poly: number[] = [];
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      const b = f[(i + 1) % f.length];
      poly.push(cut(a, b)); // near a
      poly.push(cut(b, a)); // near b
    }
    faces.push(poly);
  }

  // Faces from original vertices: cut points near V around its neighbor fan.
  for (let v = 0; v < p.vertices.length; v++) {
    const ring = neighborsAround(p, v).map((n) => cut(v, n));
    if (ring.length >= 3) faces.push(ring);
  }

  return ensureOutwardWinding({ vertices: verts, faces });
}

// Dual: one vertex per original face (its centroid, placed on the sphere), one
// face per original vertex (its surrounding face-centroids in cyclic order).
export function dual(p: Polyhedron, radius?: number): Polyhedron {
  const r = radius ?? Math.max(...p.vertices.map((v) => Math.hypot(...v)));
  const verts: Vec3[] = p.faces.map((f) => onSphere(faceCentroid(p, f), r));
  const faces: number[][] = [];
  for (let v = 0; v < p.vertices.length; v++) {
    const ring = facesAround(p, v);
    if (ring.length >= 3) faces.push(ring);
  }
  return ensureOutwardWinding({ vertices: verts, faces });
}

// ---------------------------------------------------------------------------
// Geodesic subdivision (Class I) of a triangulated solid, projected to sphere.
// dual(geodesicSubdivide(icosahedron, f)) = Goldberg polyhedron GP(f, 0).
// ---------------------------------------------------------------------------
export function geodesicSubdivide(p: Polyhedron, freq: number): Polyhedron {
  const f = Math.max(1, Math.floor(freq));
  const r = Math.max(...p.vertices.map((v) => Math.hypot(...v)));
  const verts: Vec3[] = [];
  const faces: number[][] = [];

  for (const tri of p.faces) {
    const A = p.vertices[tri[0]];
    const B = p.vertices[tri[1]];
    const C = p.vertices[tri[2]];
    // Local grid of points indexed by (i, j) with i + j <= f.
    const local: number[][] = [];
    for (let i = 0; i <= f; i++) {
      local[i] = [];
      for (let j = 0; j <= f - i; j++) {
        const wA = (f - i - j) / f;
        const wB = i / f;
        const wC = j / f;
        const pt: Vec3 = [
          wA * A[0] + wB * B[0] + wC * C[0],
          wA * A[1] + wB * B[1] + wC * C[1],
          wA * A[2] + wB * B[2] + wC * C[2],
        ];
        local[i][j] = verts.push(onSphere(pt, r)) - 1;
      }
    }
    for (let i = 0; i < f; i++) {
      for (let j = 0; j < f - i; j++) {
        faces.push([local[i][j], local[i + 1][j], local[i][j + 1]]);
        if (i + j < f - 1) {
          faces.push([local[i + 1][j], local[i + 1][j + 1], local[i][j + 1]]);
        }
      }
    }
  }
  // Weld the duplicated points along shared triangle edges.
  return ensureOutwardWinding(weld({ vertices: verts, faces }, r * 1e-4));
}

// ---------------------------------------------------------------------------
// Named soccer-ball patterns
// ---------------------------------------------------------------------------

// The classic 32-panel ball (12 pentagons + 20 hexagons), exact Archimedean
// solid with all 90 edges equal. This is Goldberg GP(1,1).
export function truncatedIcosahedron(): Polyhedron {
  return truncate(icosahedron(), 1 / 3);
}

export function dodecahedron(): Polyhedron {
  return dual(icosahedron()); // Goldberg GP(1,0)
}

export function cube(): Polyhedron {
  return dual(octahedron());
}

export function truncatedOctahedron(): Polyhedron {
  return truncate(octahedron(), 1 / 3);
}

export function truncatedTetrahedron(): Polyhedron {
  return truncate(tetrahedron(), 1 / 3);
}

// Goldberg GP(m, 0): pentagons + hexagons, m controls how many hexagons.
// GP(1,0) = dodecahedron, GP(2,0), GP(3,0)... give progressively finer balls.
export function goldbergClassI(m: number): Polyhedron {
  return dual(geodesicSubdivide(icosahedron(), m));
}

export interface PatternDef {
  id: string;
  label: string;
  build: () => Polyhedron;
}

// The catalogue offered in the UI.
export const PATTERNS: PatternDef[] = [
  { id: "truncated-icosahedron", label: "Clásica (icosaedro truncado · 32 paneles)", build: truncatedIcosahedron },
  { id: "goldberg-2", label: "Goldberg GP(2,0) · 42 paneles", build: () => goldbergClassI(2) },
  { id: "goldberg-3", label: "Goldberg GP(3,0) · 92 paneles", build: () => goldbergClassI(3) },
  { id: "goldberg-4", label: "Goldberg GP(4,0) · 162 paneles", build: () => goldbergClassI(4) },
  { id: "goldberg-6", label: "Goldberg GP(6,0) · 362 paneles", build: () => goldbergClassI(6) },
  { id: "goldberg-8", label: "Goldberg GP(8,0) · 642 paneles", build: () => goldbergClassI(8) },
  { id: "goldberg-10", label: "Goldberg GP(10,0) · 1002 paneles (mapa fino)", build: () => goldbergClassI(10) },
  { id: "dodecahedron", label: "Dodecaedro · 12 paneles", build: dodecahedron },
  { id: "truncated-octahedron", label: "Octaedro truncado · 14 paneles", build: truncatedOctahedron },
  { id: "truncated-tetrahedron", label: "Tetraedro truncado · 8 paneles", build: truncatedTetrahedron },
  { id: "icosahedron", label: "Icosaedro · 20 paneles triangulares", build: icosahedron },
  { id: "octahedron", label: "Octaedro · 8 paneles triangulares", build: octahedron },
];

export function getPattern(id: string): PatternDef {
  return PATTERNS.find((p) => p.id === id) ?? PATTERNS[0];
}

// Re-export for callers that want the raw centroid helper.
export { centroid };
