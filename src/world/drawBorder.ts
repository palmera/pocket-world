import { addStroke, angBetween, planarize, pointOnArc, type FreeGraph } from "../engine/freestyle/freestyleGraph";
import { extractSphereFaces, sphericalArea } from "../engine/freestyle/sphereGraph";
import { regionContainsPoint, regionInteriorPoint } from "../engine/freestyle/sphereRegions";
import { panelKey } from "./habitats";
import { connectedRegions, regionEdgeKey } from "./paintRegion";

export interface BorderEdit {
  graph: FreeGraph;
  paints: Record<string,string>;
  createdFaces?: string[];
}

// One gesture is one border, in exactly the place where the pen travelled.
export function drawBorder(graph: FreeGraph, paints: Record<string,string>, stroke: number[][], close: boolean, sampleStep = .004, selectedPaint?: string): BorderEdit {
  if(stroke.length < 2) return {graph,paints};
  const points = stroke.map(p=>[...p]);
  if(close) points.push([...points[0]]);
  const oldFaces = extractSphereFaces(graph.verts,graph.edges);
  const pen = planarize(addStroke({verts:[],edges:[]},points,{snapTol:Math.min(.003,sampleStep*.5),minStep:sampleStep,preserveShape:true}).graph);
  const penFaces = extractSphereFaces(pen.verts,pen.edges);
  const addition = addStroke(graph,points,{snapTol: Math.min(.003,sampleStep*.5),minStep:sampleStep,preserveShape:true});
  let next = planarize(addition.graph);

  // An isolated loop must carve a hole in its enclosing region, otherwise the
  // old filled face lies underneath it and wins some hit tests / depth tests.
  if(penFaces.length && addition.path.length >= 3) {
    const neighbours = next.verts.map(()=>[] as number[]);
    next.edges.forEach(([a,b])=>{neighbours[a].push(b);neighbours[b].push(a);});
    const component = new Set<number>(), pending = [addition.path[0]];
    while(pending.length) {
      const v = pending.pop()!;
      if(component.has(v)) continue;
      component.add(v); pending.push(...neighbours[v].filter(n=>!component.has(n)));
    }
    if(![...component].some(v=>v<graph.verts.length)) {
      const parent = oldFaces.find(face=>regionContainsPoint(graph.verts,face,next.verts[addition.path[0]]));
      if(parent) {
        let best: [number,number] = [addition.path[0],parent[0]], distance = Infinity;
        for(const a of component) for(const b of parent) {
          const d = angBetween(next.verts[a],next.verts[b]);
          if(d<distance) {distance=d;best=[a,b];}
        }
        next.edges.push(best);
        next.bridgeEdges = [...(next.bridgeEdges ?? []),best];
        next = planarize(next);
      }
    }
  }

  const inherited: Record<string,string> = {};
  const faces = extractSphereFaces(next.verts,next.edges);
  const parents = new Map<string,string>();
  const witnesses = new Map<string,number[]>();
  for(const face of faces) {
    const key = panelKey(face);
    const point = regionInteriorPoint(next.verts,face);
    witnesses.set(key,[...point]);
    const parent = oldFaces.find(previous=>panelKey(previous)===key) ?? oldFaces.find(previous=>regionContainsPoint(graph.verts,previous,point));
    if(parent) parents.set(key,panelKey(parent));
    if(parent && paints[panelKey(parent)]) inherited[key]=paints[panelKey(parent)];
  }

  const created = new Set<string>();
  if(penFaces.length) {
    // Works for either drawing direction and for a loop closed by crossing its
    // own beginning. Select the whole interior, across old terrain boundaries.
    for(const face of faces) {
      const key=panelKey(face);
      if(penFaces.some(loop=>regionContainsPoint(pen.verts,loop,witnesses.get(key)!))) created.add(key);
    }
  } else {
    // A line has no intrinsic "inside". Split visible places at the new ink;
    // keep the largest remnant and treat the smaller cut-off parts as new.
    const barriers = new Set(next.edges.filter(([a,b])=>pen.edges.some(([p,q])=>
      pointOnArc(next.verts[a],pen.verts[p],pen.verts[q]) && pointOnArc(next.verts[b],pen.verts[p],pen.verts[q])
    )).map(([a,b])=>regionEdgeKey(a,b)));
    const oldRegions = connectedRegions(graph,new Map(Object.entries(paints)));
    const oldRegionOf = new Map(oldRegions.flatMap((region,i)=>region.map(key=>[key,i] as const)));
    const parts = new Map<number,string[][]>();
    for(const region of connectedRegions(next,new Map(Object.entries(inherited)),barriers)) {
      const parent = oldRegionOf.get(parents.get(region[0])!);
      if(parent===undefined) continue;
      if(!parts.has(parent)) parts.set(parent,[]);
      parts.get(parent)!.push(region);
    }
    const areas = new Map(faces.map(face=>[panelKey(face),sphericalArea(next.verts,face)]));
    const area = (region:string[])=>region.reduce((sum,key)=>sum+(areas.get(key) ?? 0),0);
    for(const siblings of parts.values()) {
      siblings.sort((a,b)=>area(b)-area(a));
      siblings.slice(1).flat().forEach(key=>created.add(key));
    }
  }
  if(selectedPaint) for(const key of created) inherited[key]=selectedPaint;
  return {graph:next,paints:inherited,createdFaces:[...created]};
}
