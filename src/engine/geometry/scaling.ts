import { Polyhedron, circumradius } from "./Polyhedron";
import { scale } from "./vec";

export interface SizeParams {
  // Target ball circumference in millimetres. Official size 5 is 680–700 mm.
  circumferenceMm: number;
  // Empirical multiplier the builder tunes: flat panels bulge when inflated, so
  // the real ball ends up slightly larger than the polyhedron implies. Start at
  // 1.0, then adjust after the first physical test (e.g. 0.97 if it came out big).
  calibration: number;
}

export const DEFAULT_SIZE: SizeParams = {
  circumferenceMm: 690, // mid of the size-5 range
  calibration: 1.0,
};

// Scale so the polyhedron's circumradius matches the sphere radius implied by
// the target circumference (times the calibration factor). Vertices come out in
// millimetres — the unit the SVG exporter expects.
export function scaleToSize(p: Polyhedron, size: SizeParams): Polyhedron {
  const targetRadius = (size.circumferenceMm / (2 * Math.PI)) * size.calibration;
  const r = circumradius(p) || 1;
  const k = targetRadius / r;
  return { vertices: p.vertices.map((v) => scale(v, k)), faces: p.faces };
}

export function ballRadiusMm(size: SizeParams): number {
  return (size.circumferenceMm / (2 * Math.PI)) * size.calibration;
}
