import { regionContainsPoint } from "../engine/freestyle/sphereRegions";
import { findTerrainHabitats, type EdgeOwner } from "./habitats";
import type { Terrain } from "./ecosystems";

// One spacing ledger for residents, scenery AND border stories. Radii include
// the animation envelope, not just the model's origin. Unit sphere distances.
export class PopulationSpace {
  readonly occupied:{point:number[];radius:number}[]=[];
  reserve(point:number[],radius:number):boolean {
    if(this.occupied.length>=96)return false;
    if(this.occupied.some(other=>Math.acos(Math.min(1,Math.max(-1,point.reduce((sum,v,i)=>sum+v*other.point[i],0))))<radius+other.radius))return false;
    this.occupied.push({point,radius});return true;
  }
}
export function planPopulation(faces:number[][],verts:number[][],edges:Iterable<EdgeOwner>,paints:ReadonlyMap<string,string>) {
  const habitats=findTerrainHabitats(faces,verts,edges,paints);
  const area=new Map<Terrain,number>();
  for(const h of habitats)area.set(h.terrain,(area.get(h.terrain)??0)+h.area);
  const counts=new Map<Terrain,number>();
  const space=new PopulationSpace();
  const placements:{point:number[];terrain:Terrain;slot:number;kind:"resident"|"scenery"}[]=[];
  // Stable geographic sites, independent of polygon count/order. More cuts in
  // an unchanged painted surface produce exactly the same population.
  for(let i=0;i<640;i++) {
    const site=(i*241)%640;
    const y=1-2*(site+.5)/640,r=Math.sqrt(1-y*y),theta=site*2.399963229728653;
    const point=[r*Math.cos(theta),y,r*Math.sin(theta)];
    const habitat=habitats.find(h=>h.faces.some(fi=>regionContainsPoint(verts,faces[fi],point)));
    if(!habitat)continue;
    const count=counts.get(habitat.terrain)??0;
    if(count>=Math.floor((area.get(habitat.terrain)??0)/.10))continue;
    const kind=count%2===0?"resident":"scenery";
    if(!space.reserve(point,kind==="resident"?.105:.12))continue;
    placements.push({point,terrain:habitat.terrain,slot:Math.floor(count/2)%habitat.unlockedScenes,kind});
    counts.set(habitat.terrain,count+1);
  }
  return {placements,space};
}
