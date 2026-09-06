import { Vector3 } from "three";
import { angBetween, type FreeGraph } from "../engine/freestyle/freestyleGraph";
import { extractSphereFaces } from "../engine/freestyle/sphereGraph";
import { panelKey } from "../world/habitats";

export type ProjectPoint = (p:number[]) => {x:number;y:number} | undefined;
export function visibleSnapEdges(graph:FreeGraph, paints:ReadonlyMap<string,string>): [number,number][] {
  const owners=new Map<string,string[]>();
  const key=(a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;
  for(const face of extractSphereFaces(graph.verts,graph.edges)) for(let i=0;i<face.length;i++) {
    const k=key(face[i],face[(i+1)%face.length]);
    const list=owners.get(k)??[];list.push(paints.get(panelKey(face))??"");owners.set(k,list);
  }
  const bridges=new Set((graph.bridgeEdges??[]).map(([a,b])=>key(a,b)));
  return graph.edges.filter(([a,b])=>{
    const adjacent=owners.get(key(a,b));
    return !bridges.has(key(a,b)) && !(adjacent?.length===2 && adjacent[0]===adjacent[1]);
  });
}

// Closest point on a minor great-circle arc, including its endpoints.
export function nearestArcPoint(p:number[], a:number[], b:number[]): number[] {
  const av=new Vector3(...a),bv=new Vector3(...b),n=av.clone().cross(bv).normalize();
  const q=new Vector3(...p).addScaledVector(n,-new Vector3(...p).dot(n)).normalize().toArray();
  const length=angBetween(a,b);
  if(angBetween(a,q)+angBetween(q,b)<=length+1e-7)return q;
  return [...(angBetween(p,a)<angBetween(p,b)?a:b)];
}

export function nearbyBorder(p:number[], graph:FreeGraph, edges:[number,number][], project:ProjectPoint): number[] | undefined {
  const screen=project(p);if(!screen)return;
  let best=20, result:number[]|undefined;
  for(const [a,b] of edges) {
    const q=nearestArcPoint(p,graph.verts[a],graph.verts[b]);
    if(angBetween(p,q)>.12)continue;
    const target=project(q);if(!target)continue;
    const distance=Math.hypot(target.x-screen.x,target.y-screen.y);
    if(distance<best){best=distance;result=q;}
  }
  return result;
}

export function shouldCloseBorder(points:number[][],project:ProjectPoint): boolean {
  if(points.length<6)return false;
  const screens=points.map(project);if(screens.some(p=>!p))return false;
  let length=0;
  for(let i=1;i<screens.length;i++)length+=Math.hypot(screens[i]!.x-screens[i-1]!.x,screens[i]!.y-screens[i-1]!.y);
  const first=screens[0]!,last=screens.at(-1)!;
  const gap=Math.hypot(last.x-first.x,last.y-first.y);
  const span=screens.reduce((max,p)=>Math.max(max,Math.hypot(p!.x-first.x,p!.y-first.y)),0);
  return span>=48 && gap<=24 && gap<=length*.14 && angBetween(points[0],points.at(-1)!)<=.12;
}
