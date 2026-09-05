import { Mesh } from "../mesh";

// Greedy map-colouring of the panels: assign each face the lowest colour index
// not used by any adjacent face (faces sharing an edge). Faces are processed
// most-connected first (Welsh–Powell ordering) to keep the colour count low.
// Planar meshes need ≤6 colours in practice, so any palette of that size or more
// guarantees no two edge-adjacent panels share a colour.
export function panelColoring(mesh: Mesh, seed = 0): number[] {
  const n = mesh.f.length;
  const edgeToFaces = new Map<string, number[]>();
  mesh.f.forEach((f, fi) => {
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      const b = f[(i + 1) % f.length];
      const k = a < b ? `${a},${b}` : `${b},${a}`;
      (edgeToFaces.get(k) ?? edgeToFaces.set(k, []).get(k)!).push(fi);
    }
  });

  const adj: number[][] = mesh.f.map(() => []);
  for (const fs of edgeToFaces.values()) {
    if (fs.length === 2) {
      adj[fs[0]].push(fs[1]);
      adj[fs[1]].push(fs[0]);
    }
  }

  // Welsh–Powell order (most-connected first); `seed` breaks ties differently
  // each press so "recolour" yields a different but still valid colouring.
  const hash = (i: number) => {
    let x = ((i + 1) * 2654435761) ^ (seed * 40503);
    x = (x ^ (x >>> 15)) >>> 0;
    return x;
  };
  const order = mesh.f
    .map((_, i) => i)
    .sort((a, b) => adj[b].length - adj[a].length || hash(a) - hash(b));
  const color = new Array<number>(n).fill(-1);
  for (const fi of order) {
    const used = new Set<number>();
    for (const nb of adj[fi]) if (color[nb] >= 0) used.add(color[nb]);
    let c = 0;
    while (used.has(c)) c++;
    color[fi] = c;
  }
  return color;
}
