import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { advanceLivingWorld, createLivingState, ECOSYSTEM_UNLOCKS, livingStage, nextUnlock, recordWorldEdit } from "../src/world/livingWorld";
import { ContentPackRegistry, defaultContentPacks, validateContentPack } from "../src/world/contentPacks";
import { BASIC_BEHAVIOURS, createBasicBehaviourEngine, prepareAnimatedDetail, type AnimatedDetail } from "../src/world/behaviours";
import { ECOSYSTEMS, TERRAINS } from "../src/world/ecosystems";
import { PopulationSpace, planPopulation } from "../src/world/population";
import { drawBorder } from "../src/world/drawBorder";
import { regularSphereLoop } from "../src/engine/freestyle/freestyleGraph";
import { extractSphereFaces } from "../src/engine/freestyle/sphereGraph";

test("living world uses active time, speed and age transitions; pause is stable", () => {
  const state = createLivingState();
  assert.equal(livingStage(state), 0);
  for (let i=0;i<59;i++) advanceLivingWorld(state,1);
  assert.equal(advanceLivingWorld(state,1).stageChanged,true);
  assert.equal(livingStage(state),1);
  state.speed=0;
  for(let i=0;i<200;i++)advanceLivingWorld(state,1);
  assert.equal(state.elapsed,60);
  state.speed=3;
  for(let i=0;i<40;i++)advanceLivingWorld(state,1);
  assert.equal(livingStage(state),2);
  for(let i=0;i<100;i++)advanceLivingWorld(state,1);
  assert.equal(livingStage(state),3);
  assert.equal(state.elapsed,480);
});

test("ecosystems require both active play and world edits; discoveries remain monotonic",()=>{
  const state=createLivingState();
  for(let i=0;i<600;i++)advanceLivingWorld(state,1);
  assert.equal(state.unlocked.length,5);
  for(let i=0;i<2;i++)assert.deepEqual(recordWorldEdit(state),[]);
  assert.deepEqual(recordWorldEdit(state),["forest"]);
  assert.deepEqual(advanceLivingWorld(state,0).unlocked,[]);
  const later=[];
  for(let i=3;i<15;i++)later.push(...recordWorldEdit(state));
  assert.deepEqual(later,["wetland","snow"]);
  assert.deepEqual(advanceLivingWorld(state,0).unlocked,[]);
  assert.equal(nextUnlock(state),undefined);
  const reset=createLivingState({...state,elapsed:0,edits:0});
  assert.deepEqual(reset.unlocked,TERRAINS);
  assert.equal(livingStage(reset),0);
  assert.equal(ECOSYSTEM_UNLOCKS.length,3);
});

test("the final required edit unlocks immediately while the living clock is paused",()=>{
  const state=createLivingState({elapsed:120,edits:2,speed:0});
  assert.equal(state.unlocked.includes("forest"),false);
  assert.deepEqual(recordWorldEdit(state),["forest"]);
  assert.equal(state.unlocked.includes("forest"),true);
  assert.equal(state.elapsed,120);assert.equal(state.speed,0);
  const restored=createLivingState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.unlocked.includes("forest"),true);
  assert.deepEqual(recordWorldEdit(state),[],"the same discovery is never emitted twice");
  assert.deepEqual(advanceLivingWorld(state,1).unlocked,[]);
});

test("living save validation rejects nonfinite counters and never awards offline hours",()=>{
  const state=createLivingState({elapsed:NaN,edits:-4,speed:99,density:"flood",unlocked:["forest","forest","unknown"]});
  assert.equal(state.elapsed,0);assert.equal(state.edits,0);assert.equal(state.speed,1);assert.equal(state.density,"balanced");
  assert.equal(state.unlocked.filter(id=>id==="forest").length,1);
  advanceLivingWorld(state,86400);
  assert.equal(state.elapsed,2);
  advanceLivingWorld(state,Infinity);advanceLivingWorld(state,-2);
  assert.equal(state.elapsed,2);
  assert.deepEqual(createLivingState(JSON.parse(JSON.stringify(state))),state);
  assert.equal(nextUnlock(state)?.terrain,"wetland");
  assert.equal(createLivingState({version:999,elapsed:600,edits:15}).elapsed,0);
});

const examplePack=()=>({schemaVersion:1,id:"woodland-crafts",label:"Woodland crafts",inhabitants:[{id:"reed-gatherer",label:"Reed gatherer",terrain:"wetland",model:"worker",motion:"gather",motif:"people",colors:[0x64553e,0xb9aa82],stage:1}]});
test("content packs are validated data with stable namespaces and safe missing-pack fallback",()=>{
  const registry=new ContentPackRegistry();
  for(const terrain of TERRAINS)assert.equal(registry.catalog(terrain).length,10);
  registry.register(examplePack());
  assert.equal(registry.catalog("wetland").length,11);
  assert.equal(registry.has("woodland-crafts:reed-gatherer"),true);
  assert.equal(registry.resolve("woodland-crafts:reed-gatherer").model,"worker");
  assert.equal(registry.resolve("woodland-crafts:reed-gatherer").id,"woodland-crafts:reed-gatherer");
  assert.throws(()=>registry.register(examplePack()),/already registered/);
  assert.equal(registry.unregister("core"),false);
  assert.equal(registry.unregister("woodland-crafts"),true);
  assert.equal(registry.catalog("wetland").length,10);
  assert.equal(registry.resolve("woodland-crafts:reed-gatherer","wetland").model,"reeds");
  assert.equal(registry.resolve("missing:unknown").model,"worker");
  assert.equal(defaultContentPacks.catalog("meadow")[0].id,"core:meadow.walkers");
});

test("content pack schema rejects executable fields, unknown engine keys and duplicates",()=>{
  assert.throws(()=>validateContentPack({...examplePack(),script:"https://example.test/execute.js"}),/unsupported field/);
  const duplicate=examplePack();duplicate.inhabitants.push({...duplicate.inhabitants[0]});
  assert.throws(()=>validateContentPack(duplicate),/Duplicate/);
  const badModel=examplePack();badModel.inhabitants[0].model="eval";
  assert.throws(()=>validateContentPack(badModel),/model is unknown/);
  const badColor=examplePack();badColor.inhabitants[0].colors=[NaN];
  assert.throws(()=>validateContentPack(badColor),/colors/);
  assert.throws(()=>validateContentPack({...examplePack(),schemaVersion:2}),/version/);
  const source=examplePack(),valid=validateContentPack(source);
  source.inhabitants[0].colors[0]=0;
  assert.equal(valid.inhabitants[0].colors[0],0x64553e);
  assert.equal(Object.isFrozen(valid.inhabitants[0]),true);
});

test("naturalistic behaviours articulate cached joints without whole-object squashing",()=>{
  const engine=createBasicBehaviourEngine();
  const object=new THREE.Group();
  const arm=new THREE.Group();arm.name="limb-left-arm";arm.userData.restRotation=[.2,0,0];object.add(arm);
  const leg=new THREE.Group();leg.name="limb-left-leg";object.add(leg);
  const detail:AnimatedDetail={object,base:new THREE.Vector3(2,4,6),baseScale:new THREE.Vector3(3,3,3),phase:.8,amount:.5,motion:"walk"};
  prepareAnimatedDetail(detail);
  let traversals=0;object.traverse=()=>{traversals++;};
  for(const behaviour of BASIC_BEHAVIOURS){
    detail.motion=behaviour.id;
    for(let i=0;i<60;i++){
      engine.update(detail,{time:i*.2,stage:2});
      assert.deepEqual(object.scale.toArray(),[3,3,3]);
      assert.ok(object.position.toArray().every(Number.isFinite));
      assert.ok(object.position.distanceTo(detail.base)<2);
    }
  }
  assert.equal(traversals,0,"the animation loop must not traverse model trees");
  detail.motion="work";engine.update(detail,{time:3,stage:1});
  assert.notEqual(arm.rotation.x,.2);
  engine.update(detail,{time:3,stage:1});const first=arm.rotation.x;
  engine.update(detail,{time:3,stage:1});assert.equal(arm.rotation.x,first,"joint poses must not accumulate");
});

test("all ecology content has trusted historical/natural model keys and age-gated variety",()=>{
  for(const terrain of TERRAINS){
    assert.ok(ECOSYSTEMS[terrain].every(entry=>entry.model));
    assert.ok(ECOSYSTEMS[terrain].some(entry=>entry.stage===0));
    assert.ok(ECOSYSTEMS[terrain].some(entry=>entry.stage===3));
  }
  assert.equal(new Set(Object.values(ECOSYSTEMS).flat().map(entry=>entry.model)).size>=24,true);
  const space=new PopulationSpace(1);
  assert.equal(space.reserve([NaN,0,1],.1),false);
  assert.equal(space.reserve([0,0,1],.1),true);
  assert.equal(space.reserve([0,0,-1],.1),false,"shared population ledger has a global cap");
});

test("density controls and settlement ages preserve geographic sites and spacing",()=>{
  const world=drawBorder({verts:[],edges:[]},{},regularSphereLoop([0,0,1],.8,[1,0,1],50),true,.004,"meadow");
  const faces=extractSphereFaces(world.graph.verts,world.graph.edges);
  const edges=new Map<string,{a:number;b:number;faces:number[]}>();
  faces.forEach((face,fi)=>face.forEach((a,i)=>{
    const b=face[(i+1)%face.length],key=[a,b].sort((x,y)=>x-y).join(":");
    const edge=edges.get(key)??{a,b,faces:[]};edge.faces.push(fi);edges.set(key,edge);
  }));
  const paints=new Map(Object.entries(world.paints));
  const sparse=planPopulation(faces,world.graph.verts,edges.values(),paints,{density:"sparse",stage:0});
  const balanced=planPopulation(faces,world.graph.verts,edges.values(),paints,{density:"balanced",stage:0});
  const rich=planPopulation(faces,world.graph.verts,edges.values(),paints,{density:"rich",stage:0});
  assert.ok(sparse.placements.length<balanced.placements.length);
  assert.ok(balanced.placements.length<=rich.placements.length);
  assert.ok(balanced.placements.length>5);
  const mature=planPopulation(faces,world.graph.verts,edges.values(),paints,{density:"balanced",stage:3});
  assert.deepEqual(mature.placements.map(p=>[p.id,p.point]),balanced.placements.map(p=>[p.id,p.point]));
  assert.ok(balanced.placements.every(p=>(defaultContentPacks.resolve(p.contentId).stage??0)===0));
  assert.ok(mature.placements.some(p=>(defaultContentPacks.resolve(p.contentId).stage??0)>0));
  for(const plan of [sparse,balanced,rich])for(let i=0;i<plan.placements.length;i++)for(let j=0;j<i;j++){
    const a=plan.placements[i],b=plan.placements[j];
    const distance=Math.acos(Math.min(1,a.point.reduce((sum,v,k)=>sum+v*b.point[k],0)));
    assert.ok(distance>=a.radius+b.radius-1e-9);
  }
});
