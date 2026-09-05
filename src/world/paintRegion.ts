import { extractSphereFaces } from "../engine/freestyle/sphereGraph";
import type { FreeGraph } from "../engine/freestyle/freestyleGraph";
import { panelKey } from "./habitats";

export const regionEdgeKey = (a:number,b:number)=>a<b?`${a}:${b}`:`${b}:${a}`;

// Equal terrain sharing an edge is one place, even across an older pen stroke.
// Temporary barriers are used only while deciding which region a NEW cut made.
export function connectedRegions(graph: FreeGraph, paints: ReadonlyMap<string,string>, barriers: ReadonlySet<string> = new Set()): string[][] {
  const faces = extractSphereFaces(graph.verts,graph.edges);
  const keys = faces.map(panelKey);
  const owners = new Map<string,number[]>();
  faces.forEach((face,i)=>face.forEach((a,j)=>{
    const edge=regionEdgeKey(a,face[(j+1)%face.length]);
    if(!owners.has(edge)) owners.set(edge,[]);
    if(!owners.get(edge)!.includes(i)) owners.get(edge)!.push(i);
  }));
  const neighbours=faces.map(()=>[] as number[]);
  for(const [edge,adjacent] of owners) {
    if(barriers.has(edge) || adjacent.length!==2) continue;
    const [a,b]=adjacent;
    if(paints.get(keys[a])!==paints.get(keys[b])) continue;
    neighbours[a].push(b); neighbours[b].push(a);
  }
  const visited=new Set<number>(), regions:string[][]=[];
  for(let start=0;start<faces.length;start++) {
    if(visited.has(start)) continue;
    const pending=[start], region:string[]=[];
    while(pending.length) {
      const i=pending.pop()!;
      if(visited.has(i)) continue;
      visited.add(i); region.push(keys[i]);
      pending.push(...neighbours[i].filter(n=>!visited.has(n)));
    }
    regions.push(region);
  }
  return regions;
}

export function paintRegion(graph: FreeGraph, paints: ReadonlyMap<string,string>, selected: string): string[] {
  return connectedRegions(graph,paints).find(region=>region.includes(selected)) ?? [];
}
