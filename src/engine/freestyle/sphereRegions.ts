import { ShapeUtils, Vector2 } from "three";
import { cross, dot, normalize, sub, scale, type Vec3 } from "../geometry/vec";
import { sphericalArea } from "./sphereGraph";
const asV3 = (p: readonly number[]): Vec3 => [p[0],p[1],p[2]];

// A face surrounding an inset loop walks the connecting bridge twice. Split
// that weakly-simple walk into an outer ring and holes before triangulating.
export function faceLoops(face: number[]): number[][] {
  const loops: number[][] = [];
  let stack: number[] = [];
  for (const vertex of [...face, face[0]]) {
    const previous = stack.indexOf(vertex);
    if (previous < 0) stack.push(vertex);
    else {
      const loop = stack.slice(previous);
      if (loop.length >= 3) loops.push(loop);
      stack = stack.slice(0, previous + 1);
    }
  }
  return loops;
}

export function regionContainsPoint(verts: readonly (readonly number[])[], face: number[], point: readonly number[]): boolean {
  const p = normalize(asV3(point));
  let winding = 0;
  for (let i=0;i<face.length;i++) {
    const a = asV3(verts[face[i]]), b = asV3(verts[face[(i+1)%face.length]]);
    const ta = sub(a,scale(p,dot(a,p))), tb = sub(b,scale(p,dot(b,p)));
    winding += Math.atan2(dot(p,cross(ta,tb)),dot(ta,tb));
  }
  return winding > Math.PI;
}

export function triangulateRegion(
  verts: readonly (readonly number[])[], face: number[],
  edgePoints?: (a:number,b:number)=>Vec3[],
): { points: Vec3[]; triangles: number[][] } {
  const loopArea = (loop:number[]) => sphericalArea(loop.map(i=>[...normalize(asV3(verts[i]))]),loop.map((_,i)=>i));
  const loops = faceLoops(face).sort((a,b)=>Math.abs(loopArea(b))-Math.abs(loopArea(a)));
  if (!loops.length) return { points:[],triangles:[] };
  const rings = loops.map(loop => edgePoints
    ? loop.flatMap((a,i)=>edgePoints(a,loop[(i+1)%loop.length]).slice(0,-1))
    : loop.map(i=>asV3(verts[i])));
  const normal = normalize(rings[0].reduce<Vec3>((s,p)=>[s[0]+p[0],s[1]+p[1],s[2]+p[2]],[0,0,0]));
  const seed: Vec3 = Math.abs(normal[0]) < .9 ? [1,0,0] : [0,1,0];
  const u = normalize(sub(seed,scale(normal,dot(seed,normal)))), v = cross(normal,u);
  // Gnomonic projection maps every great-circle edge to a straight segment.
  // Normalising also makes the helper work with both unit and scene vertices.
  const projected = rings.map(ring=>ring.map(raw=>{
    const p = normalize(raw), denominator = Math.max(1e-4,dot(p,normal));
    return new Vector2(dot(p,u)/denominator,dot(p,v)/denominator);
  }));
  return { points:rings.flat(),triangles:ShapeUtils.triangulateShape(projected[0],projected.slice(1)) };
}

export function regionInteriorPoint(verts: number[][], face: number[]): Vec3 {
  const {points,triangles} = triangulateRegion(verts,face);
  let best: Vec3 = normalize(asV3(verts[face[0]])), largest = 0;
  for(const [a,b,c] of triangles) {
    const area = Math.abs(dot(points[a],cross(points[b],points[c])));
    if(area <= largest) continue;
    largest=area;
    best=normalize([points[a][0]+points[b][0]+points[c][0],points[a][1]+points[b][1]+points[c][1],points[a][2]+points[b][2]+points[c][2]]);
  }
  return best;
}
