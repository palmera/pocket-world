// Minimal 3D vector helpers. Kept independent of three.js so the geometry core
// stays pure and unit-testable under node (no WebGL/DOM).

export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const len = (a: Vec3): number => Math.sqrt(dot(a, a));
export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));

export const normalize = (a: Vec3): Vec3 => {
  const l = len(a);
  return l === 0 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};

export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export const centroid = (pts: Vec3[]): Vec3 => {
  const s = pts.reduce<Vec3>((acc, p) => add(acc, p), [0, 0, 0]);
  return scale(s, 1 / pts.length);
};

// Project a point onto the sphere of the given radius (centered at origin).
export const onSphere = (a: Vec3, radius = 1): Vec3 => scale(normalize(a), radius);

// 2D helpers
export const sub2 = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const len2 = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const dist2 = (a: Vec2, b: Vec2): number => len2(sub2(a, b));
