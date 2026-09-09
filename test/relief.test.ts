import test from "node:test";
import assert from "node:assert/strict";
import { applyReliefStroke, createReliefSampler, RELIEF_LIMITS, reliefKind, reliefLabel, sanitizeRelief, type ReliefStamp } from "../src/world/relief";
import type { Terrain } from "../src/world/ecosystems";
import * as THREE from "three";
import { animateReliefFeature, createReliefFeature, refineReliefMesh, selectReliefFeatures } from "../src/scene/reliefArt";

const north:[number,number,number]=[0,0,1];
const point=(angle:number):[number,number,number]=>[Math.sin(angle),0,Math.cos(angle)];
const raise=(terrain:Terrain="meadow",amount=2)=>applyReliefStroke([], [north],"raise",terrain,.12,amount);

test("relief is local, continuous and independent of the painted topology",()=>{
  const sampler=createReliefSampler(raise());
  assert.equal(sampler.height(north),2);
  assert.ok(sampler.height(point(.055))>0);
  assert.equal(sampler.height(point(.121)),0);
  assert.equal(sampler.height([0,0,-1]),0);
  assert.ok(Math.abs(sampler.height(point(.12-1e-5))-sampler.height(point(.12+1e-5)))<1e-8);
  assert.equal(sampler.height([0,0,120]),sampler.height(north));
  assert.deepEqual(sampler.normalAt(north),north);
  assert.ok(sampler.normalAt(point(.12-1e-5)).every((n,i)=>Math.abs(n-point(.12-1e-5)[i])<1e-6));
});

test("analytic normals agree with sampled surface slope and remain finite",()=>{
  const sampler=createReliefSampler(raise()),angle=.05,epsilon=1e-5;
  const surface=(a:number)=>point(a).map(n=>n*(120+sampler.height(point(a))));
  const before=surface(angle-epsilon),after=surface(angle+epsilon);
  const dx=after[0]-before[0],dz=after[2]-before[2],length=Math.hypot(dx,dz);
  const expected=[-dz/length,0,dx/length],normal=sampler.normalAt(point(angle));
  normal.forEach((n,i)=>assert.ok(Math.abs(n-expected[i])<1e-5));
  for (const p of [north,[0,0,0],[NaN,0,1],[Infinity,0,0],point(.119999)]) {
    assert.ok(Number.isFinite(sampler.height(p)));
    assert.ok(sampler.normalAt(p).every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...sampler.normalAt(p))-1)<1e-8);
  }
});

test("imported relief is bounded, versioned and cannot introduce nonfinite coordinates",()=>{
  const valid=raise()[0],invalid=[null,{}, {...valid,center:[0,0,0]}, {...valid,center:[NaN,0,1]}, {...valid,center:[0,1]}, {...valid,radius:Infinity}, {...valid,radius:-2}, {...valid,amount:"2"}, {...valid,terrain:"unknown"}];
  assert.deepEqual(sanitizeRelief(invalid),[]);
  assert.deepEqual(sanitizeRelief({version:2,stamps:[valid]}),[]);
  assert.deepEqual(sanitizeRelief({version:1,stamps:[valid]}),raise());
  const sanitized=sanitizeRelief([{...valid,center:[0,0,120],radius:1000,amount:1000,kind:"not-a-landform"}]);
  assert.deepEqual(sanitized[0].center,north);
  assert.equal(sanitized[0].amount,RELIEF_LIMITS.maxAmount);
  assert.equal(sanitized[0].radius,RELIEF_LIMITS.maxRadius);
  assert.equal(sanitized[0].kind,"hill");
  assert.equal(sanitizeRelief(Array.from({length:1000},()=>valid)).length,RELIEF_LIMITS.maxStamps);
});

test("one repeated relief stroke merges stamps without moving an existing peak",()=>{
  const initial=raise(),before=JSON.stringify(initial);
  const grown=applyReliefStroke(initial,[point(.005)],"raise","meadow",.12,2);
  assert.equal(JSON.stringify(initial),before,"the previous undo snapshot was changed");
  assert.equal(grown.length,1);
  assert.equal(grown[0].amount,4);
  assert.deepEqual(grown[0].center,north);
  let world=grown;
  for(let i=0;i<200;i++) world=applyReliefStroke(world,[north],"raise","meadow",.12,5);
  assert.equal(world.length,1);
  assert.equal(world[0].amount,RELIEF_LIMITS.maxAmount);
});

test("sparse and dense pointer event streams generate the same relief field",()=>{
  const sparse=applyReliefStroke([],[point(0),point(.4)],"raise","stone",.08,2);
  const dense=applyReliefStroke([],Array.from({length:101},(_,i)=>point(i*.004)),"raise","stone",.08,2);
  assert.equal(sparse.length,dense.length);
  const a=createReliefSampler(sparse),b=createReliefSampler(dense);
  for(let i=0;i<100;i++) assert.ok(Math.abs(a.height(point(i*.005))-b.height(point(i*.005)))<1e-7);
  for(let i=0;i<80;i++) assert.ok(a.height(point(i*.005))>.5,"a long stroke has gaps");
});

test("world complexity and accumulated height are hard bounded",()=>{
  let world:ReliefStamp[]=[];
  for(let i=0;i<220;i++) {
    const z=1-2*(i+.5)/220,r=Math.sqrt(1-z*z),angle=i*2.399963;
    world=applyReliefStroke(world,[[Math.cos(angle)*r,Math.sin(angle)*r,z]],"raise","meadow",.03,5);
  }
  assert.equal(world.length,RELIEF_LIMITS.maxStamps);
  const positive=createReliefSampler(Array.from({length:96},()=>({...raise()[0],amount:12})));
  const negative=createReliefSampler(Array.from({length:96},()=>({...raise()[0],amount:-8,kind:"crater" as const})));
  assert.equal(positive.height(north),RELIEF_LIMITS.maxHeight);
  assert.equal(negative.height(north),RELIEF_LIMITS.minHeight);
  assert.ok(positive.normalAt(north).every(Number.isFinite));
});

test("smoothing is local, strength-based, event-rate independent and undo-safe",()=>{
  const initial=applyReliefStroke(raise(),[point(.5)],"raise","stone",.1,2),before=JSON.stringify(initial);
  const once=applyReliefStroke(initial,[north],"smooth","meadow",.1,2);
  const noisy=applyReliefStroke(initial,Array.from({length:1000},()=>north),"smooth","meadow",.1,2);
  assert.deepEqual(once,noisy);
  assert.ok(once[0].amount<initial[0].amount && once[0].amount>0);
  assert.equal(once[1].amount,initial[1].amount);
  assert.equal(JSON.stringify(initial),before);
  let flattened=once;
  for(let i=0;i<20;i++) flattened=applyReliefStroke(flattened,[north],"smooth","meadow",.1,3);
  assert.equal(flattened.length,1);
  assert.equal(flattened[0].terrain,"stone");
});

test("each biome gives relief a distinct meaning and water is never a solid mountain",()=>{
  const pairs:Record<string,string[]>={meadow:["hill","crater"],forest:["hill","crater"],water:["hurricane","whirlpool"],sand:["dune","basin"],stone:["ridge","crater"],lava:["volcano","caldera"],wetland:["island","channel"],snow:["glacier","crevasse"]};
  for(const [terrain,pair] of Object.entries(pairs)) {
    assert.equal(reliefKind(terrain as Terrain,"raise"),pair[0]);
    assert.equal(reliefKind(terrain as Terrain,"lower"),pair[1]);
    assert.ok(reliefLabel(terrain as Terrain,"raise").length>0);
  }
  assert.ok(createReliefSampler(raise("water")).height(north)<createReliefSampler(raise("meadow")).height(north)*.2);
  const crater=createReliefSampler(applyReliefStroke([], [north],"lower","meadow",.12,2));
  assert.ok(crater.height(north)<0);
  assert.ok(crater.height(point(.09))>0,"a crater should have a raised rim");
  const volcano=createReliefSampler(raise("lava"));
  assert.ok(volcano.height(point(.04))>volcano.height(north),"a volcano should have a summit opening");
});

test("only local surface caches are invalidated by a new relief stamp",()=>{
  const before=createReliefSampler(raise());
  const after=createReliefSampler(applyReliefStroke(raise(),[[0,0,-1]],"raise","stone",.1,2));
  assert.equal(before.signature(north,.2),after.signature(north,.2));
  assert.notEqual(before.signature([0,0,-1],.2),after.signature([0,0,-1],.2));
  assert.notEqual(before.key,after.key);
  assert.equal(after.signature([1,0,0],.1),"");
  assert.equal(after.signature(north,Math.PI),after.key);
});

test("invalid strokes do not erase existing relief or introduce arbitrary antipodal arcs",()=>{
  const initial=raise();
  assert.deepEqual(applyReliefStroke(initial,[],"raise","meadow"),initial);
  assert.deepEqual(applyReliefStroke(initial,[north],"raise","meadow",.1,NaN),initial);
  assert.deepEqual(applyReliefStroke(initial,[[NaN,0,1]],"smooth","meadow"),initial);
  const opposite=applyReliefStroke([], [north,[0,0,-1]],"raise","meadow",.02,2);
  assert.ok(opposite.length<=2);
  assert.equal(createReliefSampler(opposite).height([1,0,0]),0);
});

test("water features have bounded finite meshes and allocation-free reversible motion",()=>{
  assert.equal(createReliefFeature(raise()[0]),undefined);
  for (const mode of ["raise","lower"] as const) {
    const stamp=applyReliefStroke([], [north],mode,"water",.12,3)[0];
    const feature=createReliefFeature(stamp)!;
    let triangles=0,meshes=0;
    const geometries:THREE.BufferGeometry[]=[];
    feature.traverse(child=>{
      if (!(child instanceof THREE.Mesh)) return;
      meshes++;
      geometries.push(child.geometry);
      assert.ok(Array.from(child.geometry.getAttribute("position").array).every(Number.isFinite));
      assert.ok(Array.from(child.geometry.getAttribute("normal").array).every(Number.isFinite));
      triangles+=(child.geometry.index?.count ?? child.geometry.getAttribute("position").count)/3;
    });
    assert.ok(triangles<800);
    assert.ok(meshes<=3);
    animateReliefFeature(feature,10);
    assert.notEqual(feature.children[0].rotation.y,0);
    animateReliefFeature(feature,10,true);
    assert.equal(feature.children[0].rotation.y,0);
    let index=0;
    feature.traverse(child=>{if(child instanceof THREE.Mesh) assert.equal(child.geometry,geometries[index++]);});
  }
});

test("a dense water sculpt stroke produces spaced weather systems, not one per sample",()=>{
  const stamps=applyReliefStroke([],Array.from({length:200},(_,i)=>point(i*.005)),"raise","water",.07,2);
  const chosen=selectReliefFeatures(stamps);
  assert.ok(chosen.length<stamps.length/2);
  assert.ok(chosen.length>1);
  for(let i=0;i<chosen.length;i++) for(let j=i+1;j<chosen.length;j++) {
    const a=chosen[i],b=chosen[j],cosine=a.center.reduce((sum,n,index)=>sum+n*b.center[index],0);
    assert.ok(Math.acos(Math.max(-1,Math.min(1,cosine)))>=(a.radius+b.radius)*.85-1e-6);
  }
  assert.equal(selectReliefFeatures(stamps,2).length,2);
  assert.equal(selectReliefFeatures(stamps,0).length,0);
  assert.deepEqual(selectReliefFeatures(stamps),chosen);
});

const norm=(p:number[]):[number,number,number]=>{const length=Math.hypot(...p);return [p[0]/length,p[1]/length,p[2]/length];};
test("local refinement finds even a tiny relief tap inside a large coarse triangle",()=>{
  const positions=[norm([-.7,-.4,1]),norm([.7,-.4,1]),norm([0,.8,1])].flatMap(p=>p.map(n=>n*120));
  const stamp=applyReliefStroke([], [north],"raise","meadow",.018,3);
  const refined=refineReliefMesh(positions,stamp),sampler=createReliefSampler(stamp);
  let max=0;
  for(let i=0;i<refined.length;i+=3)max=Math.max(max,sampler.height(refined.slice(i,i+3)));
  assert.ok(max>2.99,"the peak was missed by all geometry vertices");
  assert.ok(refined.length/9<1500,"local refinement should not tessellate the whole face uniformly");
  assert.ok(refined.every(Number.isFinite));
  const away=refineReliefMesh(positions,applyReliefStroke([],[[0,0,-1]],"raise","stone",.018,3));
  assert.equal(away.length,positions.length);
});

test("separately refined adjacent faces share every boundary sample and deformed normal",()=>{
  const a=norm([-.65,0,1]),b=norm([.65,0,1]),up=norm([0,.65,1]),down=norm([0,-.65,1]);
  const stamps=applyReliefStroke([], [norm([.11,.006,1])],"raise","meadow",.07,3),sampler=createReliefSampler(stamps);
  const left=refineReliefMesh([a,b,up].flatMap(p=>p.map(n=>n*120)),stamps);
  const right=refineReliefMesh([b,a,down].flatMap(p=>p.map(n=>n*120)),stamps);
  const boundary=(positions:number[])=>{
    const samples=new Map<string,string>();
    for(let i=0;i<positions.length;i+=3) {
      const p=norm(positions.slice(i,i+3));
      if(Math.abs(p[1])>1e-10)continue;
      const key=p.map(n=>n.toFixed(9)).join(",");
      samples.set(key,[...p.map(n=>n*(120+sampler.height(p))),...sampler.normalAt(p)].map(n=>n.toFixed(8)).join(","));
    }
    return [...samples.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  };
  assert.ok(boundary(left).length>3);
  assert.deepEqual(boundary(left),boundary(right),"a T-junction would leave a crack between separately cached faces");
});
