import assert from "node:assert/strict";
import test from "node:test";
import { regularSphereLoop, pointOnArc, type FreeGraph } from "../src/engine/freestyle/freestyleGraph";
import { extractSphereFaces, sphericalArea } from "../src/engine/freestyle/sphereGraph";
import { faceLoops, regionContainsPoint, triangulateRegion } from "../src/engine/freestyle/sphereRegions";
import { drawBorder } from "../src/world/drawBorder";
import { panelKey } from "../src/world/habitats";
import { paintRegion } from "../src/world/paintRegion";

const unit = (p:number[])=>{const l=Math.hypot(...p);return p.map(v=>v/l);};
function cube() {
  const verts = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]].map(unit);
  const edges: [number,number][] = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
  const graph:FreeGraph={verts,edges};
  const paints=Object.fromEntries(extractSphereFaces(verts,edges).map(face=>[panelKey(face),face.every(i=>verts[i][2]<0)?"water":"meadow"]));
  return {graph,paints};
}
const circle = (radius=.22,center=[0,0,1])=>regularSphereLoop(center,radius,[1,0,1],120);

test("one drawn circle creates one round region, not three rotated copies",()=>{
  const result=drawBorder({verts:[],edges:[]},{},circle(),true);
  const faces=extractSphereFaces(result.graph.verts,result.graph.edges);
  assert.equal(faces.length,1);
  const expected=2*Math.PI*(1-Math.cos(.22));
  assert.ok(Math.abs(sphericalArea(result.graph.verts,faces[0])-expected)/expected<.005);
  assert.ok(result.graph.verts.every(p=>Math.abs(Math.acos(p[2])-.22)<1e-6));
});

test("nearby pen samples are not false intersections with a short arc",()=>{
  assert.equal(pointOnArc(unit([.01,.002,1]),unit([0,0,1]),unit([.02,0,1])),false);
  assert.equal(pointOnArc(unit([.01,0,1]),unit([0,0,1]),unit([.02,0,1])),true);
});

test("an inset circle cuts a paintable hole without overlapping or bleaching the parent",()=>{
  const initial=cube(), result=drawBorder(initial.graph,initial.paints,circle(),true);
  const faces=extractSphereFaces(result.graph.verts,result.graph.edges);
  assert.equal(faces.length,7);
  assert.ok(faces.every(face=>result.paints[panelKey(face)]));
  assert.ok(Math.abs(faces.reduce((s,f)=>s+sphericalArea(result.graph.verts,f),0)-4*Math.PI)<1e-6);
  assert.equal(faces.filter(face=>regionContainsPoint(result.graph.verts,face,[0,0,1])).length,1);
  const surrounding=faces.find(f=>faceLoops(f).length===2)!;
  assert.ok(surrounding,"enclosing region must contain a hole");
  const {points,triangles}=triangulateRegion(result.graph.verts,surrounding);
  for(const [a,b,c] of triangles) {
    const center=unit(points[a].map((v,i)=>v+points[b][i]+points[c][i]));
    assert.ok(Math.acos(center[2])>.215,"outside mesh must not cover the drawn circle");
  }
});

test("nested circles and circles crossing existing borders conserve coverage and terrain",()=>{
  const initial=cube();
  let result=drawBorder(initial.graph,initial.paints,circle(),true);
  result=drawBorder(result.graph,result.paints,circle(.11),true);
  result=drawBorder(result.graph,result.paints,circle(.18,unit([1,0,1])),true);
  const faces=extractSphereFaces(result.graph.verts,result.graph.edges);
  assert.ok(faces.length>=9);
  assert.ok(faces.every(face=>result.paints[panelKey(face)]));
  assert.ok(Math.abs(faces.reduce((s,f)=>s+sphericalArea(result.graph.verts,f),0)-4*Math.PI)<1e-6);
  assert.equal(faces.filter(face=>regionContainsPoint(result.graph.verts,face,[0,0,1])).length,1);
});

test("painting a circle crosses hidden tessellation but stops at the drawn outline",()=>{
  const initial=cube(), center=unit([1,0,1]);
  const result=drawBorder(initial.graph,initial.paints,circle(.18,center),true,.004,"sand");
  const faces=extractSphereFaces(result.graph.verts,result.graph.edges);
  const inside=faces.filter(f=>sphericalArea(result.graph.verts,f)<.1);
  assert.equal(inside.length,2,"circle crosses two internal panels");
  const filled=paintRegion(result.graph,new Map(Object.entries(result.paints)),panelKey(inside[0]));
  assert.deepEqual(new Set(filled),new Set(inside.map(panelKey)));
  const saved=JSON.parse(JSON.stringify(result));
  assert.deepEqual(paintRegion(saved.graph,new Map(Object.entries(saved.paints)),filled[0]).sort(),filled.sort());
});

test("a closed area immediately gets the selected terrain, in either drawing direction",()=>{
  for(const stroke of [circle(),circle().reverse()]) {
    const initial=cube(), result=drawBorder(initial.graph,initial.paints,stroke,true,.004,"lava");
    const faces=extractSphereFaces(result.graph.verts,result.graph.edges);
    assert.equal(result.createdFaces?.length,1);
    for(const face of faces) {
      const key=panelKey(face);
      if(regionContainsPoint(result.graph.verts,face,[0,0,1])) assert.equal(result.paints[key],"lava");
      else assert.notEqual(result.paints[key],"lava");
    }
  }
});

test("a loop crossing different terrains paints its entire interior only",()=>{
  const initial=cube(), center=unit([1,0,-1]);
  const result=drawBorder(initial.graph,initial.paints,circle(.18,center),true,.004,"sand");
  assert.equal(result.createdFaces?.length,2);
  const faces=extractSphereFaces(result.graph.verts,result.graph.edges);
  const sand=faces.filter(f=>result.paints[panelKey(f)]==="sand");
  assert.equal(sand.length,2);
  assert.ok(Math.abs(sand.reduce((area,f)=>area+sphericalArea(result.graph.verts,f),0)-2*Math.PI*(1-Math.cos(.18)))<.0001);
});

test("an open cut selects the smaller piece of a visible region, not hidden panels",()=>{
  const initial=cube();
  const front=extractSphereFaces(initial.graph.verts,initial.graph.edges).find(f=>f.every(i=>initial.graph.verts[i][2]>0))!;
  initial.paints[panelKey(front)]="lava";
  const stroke=[unit([-.5,-1,1]),unit([-.5,0,1]),unit([-.5,1,1])];
  const result=drawBorder(initial.graph,initial.paints,stroke,false,.004,"sand");
  assert.equal(result.createdFaces?.length,1);
  const faces=extractSphereFaces(result.graph.verts,result.graph.edges);
  const at=(point:number[])=>result.paints[panelKey(faces.find(f=>regionContainsPoint(result.graph.verts,f,unit(point)))!)];
  assert.equal(at([-.8,0,1]),"sand");
  assert.equal(at([.5,0,1]),"lava");
  assert.equal(at([0,0,-1]),"water");
});

test("equal adjacent terrain merges across old ink and fills as one place",()=>{
  const initial=cube(), result=drawBorder(initial.graph,initial.paints,circle(),true,.004,"lava");
  const paints=new Map(Object.entries(result.paints));
  const inside=result.createdFaces![0];
  paints.set(inside,"meadow");
  const merged=paintRegion(result.graph,paints,inside);
  assert.ok(merged.length>1);
  assert.ok(merged.every(key=>paints.get(key)==="meadow"));
  assert.deepEqual(new Set(paintRegion(result.graph,paints,merged[1])),new Set(merged));
});

test("a dangling line changes no terrain and a self-crossing loop still creates an area",()=>{
  const initial=cube();
  const dangling=drawBorder(initial.graph,initial.paints,[unit([-.1,0,1]),unit([.1,0,1])],false,.004,"sand");
  assert.deepEqual(dangling.paints,initial.paints);
  assert.equal(dangling.createdFaces?.length,0);
  const loop=circle();
  const crossed=[...loop,...loop.slice(0,4)];
  const result=drawBorder(initial.graph,initial.paints,crossed,false,.004,"sand");
  assert.equal(result.createdFaces?.length,1);
  assert.equal(result.paints[result.createdFaces![0]],"sand");
});
