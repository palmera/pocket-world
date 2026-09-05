import { Vec2, Vec3, sub, dot, centroid } from "../geometry/vec";

// Symmetric 3x3 eigen-decomposition via cyclic Jacobi rotations. Returns
// eigenvalues and eigenvectors (as Vec3) sorted by DESCENDING eigenvalue.
function eigenSym3(m: number[][]): { values: number[]; vectors: Vec3[] } {
  // Work on a copy.
  const a = m.map((r) => r.slice());
  // Accumulated rotation (eigenvectors as columns).
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let iter = 0; iter < 50; iter++) {
    // Largest off-diagonal magnitude.
    let p = 0;
    let q = 1;
    let off = Math.abs(a[0][1]);
    if (Math.abs(a[0][2]) > off) {
      off = Math.abs(a[0][2]);
      p = 0;
      q = 2;
    }
    if (Math.abs(a[1][2]) > off) {
      off = Math.abs(a[1][2]);
      p = 1;
      q = 2;
    }
    if (off < 1e-12) break;

    const phi = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]);
    const c = Math.cos(phi);
    const s = Math.sin(phi);

    // Apply rotation A = Rᵀ A R.
    for (let k = 0; k < 3; k++) {
      const akp = a[k][p];
      const akq = a[k][q];
      a[k][p] = c * akp - s * akq;
      a[k][q] = s * akp + c * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = a[p][k];
      const aqk = a[q][k];
      a[p][k] = c * apk - s * aqk;
      a[q][k] = s * apk + c * aqk;
    }
    // Accumulate eigenvectors.
    for (let k = 0; k < 3; k++) {
      const vkp = v[k][p];
      const vkq = v[k][q];
      v[k][p] = c * vkp - s * vkq;
      v[k][q] = s * vkp + c * vkq;
    }
  }

  const values = [a[0][0], a[1][1], a[2][2]];
  const vectors: Vec3[] = [0, 1, 2].map((i) => [v[0][i], v[1][i], v[2][i]]);
  const order = [0, 1, 2].sort((i, j) => values[j] - values[i]);
  return {
    values: order.map((i) => values[i]),
    vectors: order.map((i) => vectors[i]),
  };
}

// The best-fit plane frame of a set of 3D points: centroid C and the two
// principal in-plane axes u, w (the normal is the third eigenvector). A 2D
// coordinate (x, y) in this frame maps back to 3D as C + x*u + y*w, which is how
// the 2D editor inverts a dragged point back onto the surface.
export interface PlaneFrame {
  C: Vec3;
  u: Vec3;
  w: Vec3;
}

export function bestFitFrame(v3: Vec3[]): PlaneFrame {
  const C = centroid(v3);
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of v3) {
    const d = sub(p, C);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j];
  }
  const { vectors } = eigenSym3(cov);
  return { C, u: vectors[0], w: vectors[1] };
}

// Project 3D points onto their best-fit plane (least squares), returning 2D
// coordinates in that plane's principal-axis frame. Minimises the out-of-plane
// error, so a non-planar panel (e.g. a Goldberg face) is flattened with the
// least possible distortion — the small residual is what the fabric/foam and
// stitch tension absorb. For a perfectly planar face this is exact.
export function flattenToBestFitPlane(v3: Vec3[]): Vec2[] {
  const { C, u, w } = bestFitFrame(v3);
  return v3.map((p): Vec2 => {
    const d = sub(p, C);
    return [dot(d, u), dot(d, w)];
  });
}

// Max distance of any point from its best-fit plane (out-of-plane residual, mm).
export function planeResidual(v3: Vec3[]): number {
  const c = centroid(v3);
  const cov = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of v3) {
    const d = sub(p, c);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) cov[i][j] += d[i] * d[j];
  }
  const { vectors } = eigenSym3(cov);
  const n = vectors[2];
  let worst = 0;
  for (const p of v3) worst = Math.max(worst, Math.abs(dot(sub(p, c), n)));
  return worst;
}
