import test from "node:test";
import assert from "node:assert/strict";
import { paintStroke } from "../src/world/brushStroke";
import { drawBorder } from "../src/world/drawBorder";
import { regularSphereLoop } from "../src/engine/freestyle/freestyleGraph";
import { extractSphereFaces } from "../src/engine/freestyle/sphereGraph";
import { regionContainsPoint } from "../src/engine/freestyle/sphereRegions";
import { panelKey } from "../src/world/habitats";
import { jellyMeniscus } from "../src/scene/jellyMeniscus";
import { normalize } from "../src/engine/geometry/vec";

const start=()=>drawBorder({verts:[],edges:[]},{},regularSphereLoop([0,0,1],.7,[1,0,1],64),true,.004,"meadow");
const paintAt=(w:ReturnType<typeof paintStroke>,p:readonly number[])=>{
  const face=extractSphereFaces(w.graph.verts,w.graph.edges).find(f=>regionContainsPoint(w.graph.verts,f,p));
  return face?w.paints[panelKey(face)]:undefined;
};
test("brush makes a strip with round ends, leaving surrounding terrain alone",()=>{
  const initial=start(), path=[normalize([-.3,0,1]),normalize([0,0,1]),normalize([.3,0,1])];
  const w=paintStroke(initial.graph,initial.paints,path,.04,"water");
  assert.equal(paintAt(w,[0,0,1]),"water");
  assert.equal(paintAt(w,normalize([0,.12,1])),"meadow");
  assert.equal(paintAt(w,normalize([.32,0,1])),"water");
  assert.equal(paintAt(w,normalize([.4,0,1])),"meadow");
  const saved=JSON.parse(JSON.stringify(w));assert.equal(paintAt(saved,[0,0,1]),"water");
});
test("a brush tap creates a dot",()=>{
  const w=paintStroke(start().graph,start().paints,[[0,0,1]],.045,"lava");
  assert.equal(paintAt(w,[0,0,1]),"lava");
  assert.equal(paintAt(w,normalize([0,.12,1])),"meadow");
});
test("looping the brush paints a ring, not its interior",()=>{
  const initial=start(), path=regularSphereLoop([0,0,1],.22,[1,0,1],64);path.push(path[0]);
  const w=paintStroke(initial.graph,initial.paints,path,.025,"sand");
  assert.equal(paintAt(w,[0,0,1]),"meadow");
  for(const p of path.slice(1,-1))assert.equal(paintAt(w,p),"sand");
  assert.equal(paintAt(w,normalize([.4,0,1])),"meadow");
});
test("jelly is lower at boundaries with finite slope normals; merged surfaces have no groove",()=>{
  const samples=[normalize([0,0,1]),normalize([0,.03,1]),normalize([0,.2,1])];
  const pos=samples.flatMap(p=>p.map(n=>n*120));
  const shaped=jellyMeniscus(pos,[[normalize([-.4,0,1]),normalize([.4,0,1])]]);
  const radius=(i:number)=>Math.hypot(...shaped.positions.slice(i*3,i*3+3));
  assert.ok(radius(0)<120);assert.ok(radius(1)>radius(0));assert.ok(radius(2)>radius(1));
  assert.ok(shaped.normals.every(Number.isFinite));
  const smooth=jellyMeniscus(pos,[]);assert.ok(Math.abs(Math.hypot(...smooth.positions.slice(0,3))-120.45)<1e-6);
});
