import { Vec2 } from "../geometry/vec";

// Offset a convex CCW polygon outward by `d` mm to produce the cut line around
// the stitch line. Each edge is pushed out along its outward normal and the
// neighbouring offset edges are re-intersected. Our panels are convex, so this
// is exact and self-intersection-free.
export function offsetPolygon(pts: Vec2[], d: number): Vec2[] {
  if (d === 0) return pts.map((p) => [p[0], p[1]]);
  const n = pts.length;

  // Outward normal of each directed edge i -> i+1 (CCW polygon => outward = right).
  const offsetLines = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const len = Math.hypot(ex, ey) || 1;
    const nx = ey / len; // right normal
    const ny = -ex / len;
    return {
      // A point on the offset line and its direction.
      px: p[0] + nx * d,
      py: p[1] + ny * d,
      dx: ex / len,
      dy: ey / len,
    };
  });

  // Each output vertex i is the intersection of offset line (i-1) and line i.
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const l1 = offsetLines[(i - 1 + n) % n];
    const l2 = offsetLines[i];
    const p = intersect(l1, l2);
    out.push(p);
  }
  return out;
}

interface Line {
  px: number;
  py: number;
  dx: number;
  dy: number;
}

function intersect(l1: Line, l2: Line): Vec2 {
  // Solve l1.p + t*l1.d = l2.p + s*l2.d
  const denom = l1.dx * l2.dy - l1.dy * l2.dx;
  if (Math.abs(denom) < 1e-9) {
    // Parallel (collinear-ish) — fall back to the midpoint of the two anchors.
    return [(l1.px + l2.px) / 2, (l1.py + l2.py) / 2];
  }
  const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / denom;
  return [l1.px + t * l1.dx, l1.py + t * l1.dy];
}

export function boundingBox(pts: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}
