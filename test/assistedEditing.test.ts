import test from "node:test";
import assert from "node:assert/strict";
import { nearbyBorder, shouldCloseBorder, visibleSnapEdges } from "../src/scene/borderSnap";
import { PointerRouting, spaceCanControlCamera } from "../src/scene/pointerRouting";
import { regularSphereLoop } from "../src/engine/freestyle/freestyleGraph";
import { extractSphereFaces } from "../src/engine/freestyle/sphereGraph";
import { drawBorder } from "../src/world/drawBorder";
import { panelKey } from "../src/world/habitats";
import { planPopulation } from "../src/world/population";
const unit=(p:number[])=>p.map(v=>v/Math.hypot(...p));
const project=(p:number[])=>({x:p[0]*600,y:p[1]*600});

test("closure uses screen distance and rejects short marks, distant endpoints and hidden targets",()=>{
  const loop=regularSphereLoop([0,0,1],.2,[1,0,1],100).slice(0,98);
  assert.equal(shouldCloseBorder(loop,project),true);
  assert.equal(shouldCloseBorder(loop,p=>({x:p[0]*2000,y:p[1]*2000})),false);
  assert.equal(shouldCloseBorder(loop.slice(0,70),project),false);
  assert.equal(shouldCloseBorder(regularSphereLoop([0,0,1],.01,[1,0,1],50),project),false);
  assert.equal(shouldCloseBorder(loop,()=>undefined),false);
  const result=drawBorder({verts:[],edges:[]},{},loop,shouldCloseBorder(loop,project),.004,"sand");
  assert.equal(result.createdFaces?.length,1);
  assert.equal(result.paints[result.createdFaces![0]],"sand");
});

test("snapping to edge interiors closes a cut and excludes merged invisible borders",()=>{
  const verts=[[-.5,-.5,1],[.5,-.5,1],[.5,.5,1],[-.5,.5,1]].map(unit);
  const graph={verts,edges:[[0,1],[1,2],[2,3],[3,0]] as [number,number][]};
  const paints=Object.fromEntries(extractSphereFaces(verts,graph.edges).map(f=>[panelKey(f),"meadow"]));
  const edges=visibleSnapEdges(graph,new Map(Object.entries(paints)));
  const a=nearbyBorder(unit([-.2,-.48,1]),graph,edges,project)!;
  const b=nearbyBorder(unit([-.2,.48,1]),graph,edges,project)!;
  assert.ok(a && b);
  const result=drawBorder(graph,paints,[a,unit([-.2,0,1]),b],false,.004,"sand");
  assert.equal(result.createdFaces?.length,1);
  assert.equal(result.paints[result.createdFaces![0]],"sand");
  const allMeadow=new Map(extractSphereFaces(result.graph.verts,result.graph.edges).map(f=>[panelKey(f),"meadow"]));
  assert.equal(nearbyBorder(unit([-.2,0,1]),result.graph,visibleSnapEdges(result.graph,allMeadow),project),undefined);
  assert.equal(nearbyBorder(a,graph,edges,()=>undefined),undefined);
});

test("temporary camera owns the whole drag even after Space release, and cancels an edit",()=>{
  const routing=new PointerRouting();
  routing.down(1,"mouse","draw","hand");
  assert.equal(routing.cancelEdit(),1);
  assert.equal(routing.owner(1),"ignore");routing.up(1);
  routing.down(2,"mouse","move","hand");
  assert.equal(routing.owner(2),"camera");
  assert.equal(routing.down(2,"mouse","brush","hand").owner,"camera");
  routing.up(2);
  assert.equal(routing.down(3,"mouse","brush","hand").owner,"edit");
  assert.equal(spaceCanControlCamera(null),true);
  assert.equal(spaceCanControlCamera({closest:()=>({})} as unknown as EventTarget),false);
});

test("subdividing the same painted surface does not multiply inhabitants; all categories share spacing",()=>{
  const points=regularSphereLoop([0,0,1],.65,[1,0,1],50);
  const world=drawBorder({verts:[],edges:[]},{},points,true,.004,"meadow");
  const plan=(w:typeof world)=>{
    const faces=extractSphereFaces(w.graph.verts,w.graph.edges);
    const edges=new Map<string,{a:number;b:number;faces:number[]}>();
    faces.forEach((face,fi)=>face.forEach((a,i)=>{const b=face[(i+1)%face.length],key=[a,b].sort((x,y)=>x-y).join(":");const edge=edges.get(key)??{a,b,faces:[]};edge.faces.push(fi);edges.set(key,edge);}));
    return planPopulation(faces,w.graph.verts,edges.values(),new Map(Object.entries(w.paints)));
  };
  const original=plan(world);let divided=world;
  for(let i=0;i<12;i++)divided=drawBorder(divided.graph,divided.paints,regularSphereLoop(unit([Math.cos(i)*.3,Math.sin(i)*.3,1]),.055,[1,0,1],20),true,.004,"meadow");
  const result=plan(divided);
  assert.deepEqual(result.placements,original.placements);
  assert.ok(result.placements.length>3 && result.placements.length<20);
  assert.equal(result.space.reserve(result.placements[0].point,.17),false,"border stories cannot overlap residents or scenery");
  const placements=result.space.occupied;
  for(let i=0;i<placements.length;i++)for(let j=0;j<i;j++) {
    const a=placements[i],b=placements[j],dot=a.point.reduce((s,v,k)=>s+v*b.point[k],0);
    assert.ok(Math.acos(Math.min(1,dot))>=a.radius+b.radius-1e-9);
  }
});
