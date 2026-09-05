import { Polyhedron, faceNormal, edges as polyEdges } from "../geometry/Polyhedron";
import { Vec2, Vec3, sub, dot, cross, normalize, dist } from "../geometry/vec";
import { flattenToBestFitPlane } from "../editor/bestFitFlatten";

export interface PanelEdge {
  // The two endpoints of this edge in the panel's 2D frame.
  a: Vec2;
  b: Vec2;
  lengthMm: number;
  // Global edge key "i,j" (sorted) — identifies which other panel shares it.
  edgeKey: string;
  // 1-based index of this edge within its global edge (for the match label).
  matchId: number;
}

export interface Panel {
  index: number; // 1-based panel number
  vertexCount: number;
  kindLabel: string; // "Pentágono" | "Hexágono" | ...
  points: Vec2[]; // CCW outline in mm, centred on its own centroid
  edges: PanelEdge[];
}

const KIND: Record<number, string> = {
  3: "Triángulo",
  4: "Cuadrilátero",
  5: "Pentágono",
  6: "Hexágono",
  7: "Heptágono",
  8: "Octágono",
};

const ek = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);

// Signed area (shoelace). Positive => CCW.
function signedArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

// Flatten every face of the (scaled, in-mm) polyhedron to a 2D panel, preserving
// true edge lengths. With bestFit (default) each face is projected onto its
// least-squares best-fit plane, minimising distortion for non-planar faces
// (e.g. Goldberg / hand-edited panels). Without it, a simpler frame built from
// the Newell normal and first edge is used.
export function unfold(p: Polyhedron, opts: { bestFit?: boolean } = {}): Panel[] {
  const bestFit = opts.bestFit ?? true;
  // Assign each global edge a stable id so the two panels sharing it print the
  // same match number.
  const edgeMatch = new Map<string, number>();
  polyEdges(p).forEach((e, i) => edgeMatch.set(ek(e[0], e[1]), i + 1));

  return p.faces.map((face, fi) => {
    const v3: Vec3[] = face.map((i) => p.vertices[i]);

    let pts: Vec2[];
    if (bestFit) {
      pts = flattenToBestFitPlane(v3);
    } else {
      const origin = v3[0];
      const u = normalize(sub(v3[1], origin));
      const n = faceNormal(p, face);
      const w = normalize(cross(n, u)); // in-plane, perpendicular to u
      pts = v3.map((v): Vec2 => {
        const d = sub(v, origin);
        return [dot(d, u), dot(d, w)];
      });
    }

    // Make CCW so seam-offset normals point outward consistently.
    let order = face;
    if (signedArea(pts) < 0) {
      pts = [...pts].reverse();
      order = [...face].reverse();
    }

    // Centre on centroid for tidy layout.
    const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length;
    const cy = pts.reduce((s, q) => s + q[1], 0) / pts.length;
    const centred: Vec2[] = pts.map((q) => [q[0] - cx, q[1] - cy]);

    const edges: PanelEdge[] = centred.map((a, i): PanelEdge => {
      const b = centred[(i + 1) % centred.length];
      const key = ek(order[i], order[(i + 1) % order.length]);
      return {
        a,
        b,
        lengthMm: dist([a[0], a[1], 0], [b[0], b[1], 0]),
        edgeKey: key,
        matchId: edgeMatch.get(key) ?? 0,
      };
    });

    return {
      index: fi + 1,
      vertexCount: face.length,
      kindLabel: KIND[face.length] ?? `${face.length}-gono`,
      points: centred,
      edges,
    };
  });
}
