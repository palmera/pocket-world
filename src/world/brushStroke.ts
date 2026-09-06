import { angBetween, regularSphereLoop, simplifyStroke, type FreeGraph } from "../engine/freestyle/freestyleGraph";
import { cross, normalize, dot, sub, scale, type Vec3 } from "../engine/geometry/vec";
import { extractSphereFaces } from "../engine/freestyle/sphereGraph";
import { regionInteriorPoint } from "../engine/freestyle/sphereRegions";
import { panelKey } from "./habitats";
import { drawBorder } from "./drawBorder";

const v=(p:readonly number[]):Vec3=>[p[0],p[1],p[2]];
export function distanceToStroke(point:readonly number[], path:readonly (readonly number[])[]): number {
  let best=Infinity;
  for(let i=0;i<path.length;i++) {
    best=Math.min(best,angBetween(point,path[i]));
    if(!i) continue;
    const a=v(path[i-1]), b=v(path[i]), n=normalize(cross(a,b));
    if(Math.hypot(...n)<.5) continue;
    const q=normalize(sub(v(point),scale(n,dot(v(point),n))));
    if(angBetween(a,q)+angBetween(q,b)<=angBetween(a,b)+1e-6) best=Math.min(best,angBetween(point,q));
  }
  return best;
}

// A single outline per gesture, not hundreds of stamped circles/graph edits.
// Round caps and bounded miters keep the ribbon faithful at corners.
export function brushOutline(raw:readonly (readonly number[])[], radius:number): number[][] {
  const pts=simplifyStroke(raw.map(p=>[...p]),Math.max(.001,radius*.2));
  if(!pts.length) return [];
  if(pts.length===1 || pts.every(p=>angBetween(p,pts[0])<1e-6)) return regularSphereLoop(pts[0],radius,[1,0,1],32);
  const tangents=pts.map((_,i)=>normalize(sub(v(pts[Math.min(i+1,pts.length-1)]),v(pts[Math.max(0,i-1)]))));
  const sides=pts.map((p,i)=>normalize(cross(v(p),tangents[i])));
  const offset=(p:number[],side:Vec3,angle:number)=>[...normalize([
    p[0]*Math.cos(angle)+side[0]*Math.sin(angle),p[1]*Math.cos(angle)+side[1]*Math.sin(angle),p[2]*Math.cos(angle)+side[2]*Math.sin(angle),
  ])];
  const left=pts.map((p,i)=>offset(p,sides[i],radius));
  const right=pts.map((p,i)=>offset(p,sides[i],-radius));
  const cap=(i:number,sign:number)=>Array.from({length:12},(_,j)=>{
    const a=(j+1)*Math.PI/13;
    const side=v(sides[i].map((n,k)=>sign*(n*Math.cos(a)+tangents[i][k]*Math.sin(a))));
    return offset(pts[i],side,radius);
  });
  return [...left,...cap(pts.length-1,1),...right.reverse(),...cap(0,-1)];
}

export function paintStroke(graph:FreeGraph,paints:Record<string,string>,path:readonly (readonly number[])[],radius:number,paint:string) {
  if(!path.length) return {graph,paints};
  const outline=brushOutline(path,radius);
  const edited=drawBorder(graph,paints,outline,true,Math.max(.0003,radius*.08));
  // A looping brush paints a ring, not the entire enclosed lake. Classify the
  // faces against the swept stroke instead of treating every loop as a fill.
  for(const face of extractSphereFaces(edited.graph.verts,edited.graph.edges)) {
    if(distanceToStroke(regionInteriorPoint(edited.graph.verts,face),path)<=radius*1.12) edited.paints[panelKey(face)]=paint;
  }
  return edited;
}
