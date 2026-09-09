import { regionContainsPoint } from "../engine/freestyle/sphereRegions";
import { findTerrainHabitats, type EdgeOwner } from "./habitats";
import type { Terrain } from "./ecosystems";
import { ecosystemForTerrain } from "./contentPacks";
import type { PopulationDensity } from "./livingWorld";

// One spacing ledger for residents, scenery AND border stories. Radii include
// the animation envelope, not just the model's origin. Unit sphere distances.
export class PopulationSpace {
  readonly occupied:{point:number[];radius:number}[]=[];
  constructor(private readonly limit = 96) {}
  reserve(point:number[],radius:number):boolean {
    if(this.occupied.length>=this.limit || point.length!==3 || !point.every(Number.isFinite) || !Number.isFinite(radius) || radius<=0)return false;
    if(this.occupied.some(other=>Math.acos(Math.min(1,Math.max(-1,point.reduce((sum,v,i)=>sum+v*other.point[i],0))))<radius+other.radius))return false;
    this.occupied.push({point,radius});return true;
  }
}
export interface PopulationOptions { density?: PopulationDensity; stage?: number; elapsed?: number; }
export interface PopulationPlacement {
  id: string; point: number[]; terrain: Terrain; slot: number;
  kind: "resident" | "scenery"; radius: number; contentId: string;
}
export function planPopulation(faces:number[][],verts:number[][],edges:Iterable<EdgeOwner>,paints:ReadonlyMap<string,string>,options:PopulationOptions={}) {
  const habitats=findTerrainHabitats(faces,verts,edges,paints);
  const area=new Map<Terrain,number>();
  for(const h of habitats)area.set(h.terrain,(area.get(h.terrain)??0)+h.area);
  const counts=new Map<Terrain,number>();
  const density = options.density ?? "balanced";
  const stage = Math.max(0, Math.min(3, options.stage ?? 0));
  const divisor = density === "sparse" ? .18 : density === "rich" ? .075 : .10;
  const space=new PopulationSpace(density === "sparse" ? 48 : density === "rich" ? 96 : 72);
  const placements:PopulationPlacement[]=[];
  const catalogs = new Map<Terrain, ReturnType<typeof ecosystemForTerrain>>();
  const sceneSlots = new Map<Terrain, number[]>();
  for (const terrain of area.keys()) {
    const catalog = ecosystemForTerrain(terrain);
    catalogs.set(terrain, catalog);
    // Area limits population, not repertoire: even a small viable habitat can
    // host varied wildlife. Age gates buildings and later discoveries only.
    sceneSlots.set(terrain, catalog.map((scene, i) => (scene.stage ?? 0) <= stage ? i : -1).filter(i => i >= 0));
  }
  // Stable geographic sites, independent of polygon count/order. More cuts in
  // an unchanged painted surface produce exactly the same population.
  for(let i=0;i<640;i++) {
    const site=(i*241)%640;
    const y=1-2*(site+.5)/640,r=Math.sqrt(1-y*y),theta=site*2.399963229728653;
    const point=[r*Math.cos(theta),y,r*Math.sin(theta)];
    const habitat=habitats.find(h=>h.faces.some(fi=>regionContainsPoint(verts,faces[fi],point)));
    if(!habitat)continue;
    const count=counts.get(habitat.terrain)??0;
    if(count>=Math.floor((area.get(habitat.terrain)??0)/divisor))continue;
    const kind=count%2===0?"resident":"scenery";
    const radius = (kind === "resident" ? .105 : .12) * (density === "sparse" ? 1.3 : density === "rich" ? .93 : 1);
    if(!space.reserve(point,radius))continue;
    const slots = sceneSlots.get(habitat.terrain)!;
    const slot = slots[(Math.floor(count/2) + Math.floor(stage) * 2) % slots.length] ?? 0;
    placements.push({id:`site-${site}`,point,terrain:habitat.terrain,slot,kind,radius,contentId:catalogs.get(habitat.terrain)![slot].id});
    counts.set(habitat.terrain,count+1);
  }
  return {placements,space};
}
