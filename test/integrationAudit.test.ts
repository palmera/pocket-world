import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { headlessWorld, nestedWorld } from "./performanceFixtures";
import { History } from "../src/engine/editor/history";
import { createLivingState } from "../src/world/livingWorld";
import { applyReliefStroke } from "../src/world/relief";
import { disposeExcept } from "../src/scene/renderResources";
import { PointerRouting } from "../src/scene/pointerRouting";

function resources(root:THREE.Object3D):Set<THREE.BufferGeometry|THREE.Material> {
  const result=new Set<THREE.BufferGeometry|THREE.Material>();
  root.traverse(node=>{
    const mesh=node as THREE.Mesh;
    if(mesh.geometry)result.add(mesh.geometry);
    if(mesh.material)for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])result.add(material);
  });
  return result;
}

test("age/density refresh replaces only life, retains terrain geometry and disposes obsolete life resources",()=>{
  const ball=headlessWorld(nestedWorld(3));ball.render();
  const group=ball.group,geometry=ball.panelMeshes.map((mesh:THREE.Mesh)=>mesh.geometry);
  const geography=JSON.stringify({graph:ball.graph,paints:Object.fromEntries(ball.paintByFace)});
  let remeshes=0;ball.faceMesh=()=>{remeshes++;throw Error("evolution must not remesh terrain");};
  for(const elapsed of [60,180,480,0,180]){
    const old=ball.lifeGroup,previous=resources(old),disposed=new Set();
    for(const resource of previous)resource.addEventListener("dispose",()=>disposed.add(resource));
    ball.living.elapsed=elapsed;ball.living.density=elapsed===0?"sparse":"balanced";
    ball.refreshTinyLife();
    assert.notEqual(ball.lifeGroup,old);assert.equal(old.children.length,0);
    assert.equal(ball.group,group);
    assert.deepEqual(ball.panelMeshes.map((mesh:THREE.Mesh)=>mesh.geometry),geometry);
    assert.equal(JSON.stringify({graph:ball.graph,paints:Object.fromEntries(ball.paintByFace)}),geography);
    const retained=resources(ball.group);
    for(const resource of previous)assert.equal(disposed.has(resource),!retained.has(resource),"dispose only resources that left the successful scene");
    assert.ok(ball.toyModels.current.size<=96,"life cache remains bounded to current frame content");
  }
  assert.equal(remeshes,0);disposeExcept(ball.group);
});

test("failed life-only evolution is transactional and keeps the previous inhabitants",()=>{
  const ball=headlessWorld(nestedWorld(1));ball.render();
  const previous=ball.lifeGroup,details=ball.animatedDetails,weather=ball.weatherDetails;
  const geometry=new THREE.BoxGeometry(),material=new THREE.MeshBasicMaterial();let disposed=0;
  geometry.addEventListener("dispose",()=>disposed++);material.addEventListener("dispose",()=>disposed++);
  ball.buildTinyLife=()=>{ball.lifeGroup.add(new THREE.Mesh(geometry,material));throw Error("simulated missing artwork");};
  ball.refreshTinyLife();
  assert.equal(ball.lifeGroup,previous);assert.equal(ball.animatedDetails,details);assert.equal(ball.weatherDetails,weather);
  assert.ok(previous.children.length>0);assert.equal(disposed,2);disposeExcept(ball.group);
});

test("save/load preserves relief, paused evolution and painted discovered ecosystems",()=>{
  const world=nestedWorld(1),ball=headlessWorld(world);
  ball.render();const key=ball.panelMeshes[0].userData.faceKey;
  ball.paintByFace.set(key,"forest");
  ball.living=createLivingState({elapsed:220,edits:4,unlocked:["forest"],speed:0,density:"sparse"});
  ball.relief=applyReliefStroke([],[[0,0,1]],"raise","forest",.07,2);
  const saved=JSON.parse(JSON.stringify(ball.getSaveData()));
  const loaded=headlessWorld({graph:{verts:[],edges:[]},paints:{}});
  Object.assign(loaded,{applyWorldBackground:()=>{},controls:{enabled:true},pointers:new PointerRouting(),renderer:{domElement:{hasPointerCapture:()=>false}}});
  assert.equal(loaded.loadSaveData(saved),true);
  assert.deepEqual(loaded.living,ball.living);assert.deepEqual(loaded.relief,ball.relief);
  assert.deepEqual(loaded.graph,ball.graph);assert.equal(loaded.paintByFace.get(key),"forest");
  delete saved.living;
  assert.equal(loaded.loadSaveData(saved),true);
  assert.ok(loaded.living.unlocked.includes("forest"),"existing painted terrain remains usable after progression migration");
  disposeExcept(ball.group);disposeExcept(loaded.group);
});

test("undo and redo restore relief without erasing lifetime discoveries",()=>{
  const ball=headlessWorld(nestedWorld(1));
  Object.assign(ball,{history:new History((state:unknown)=>structuredClone(state))});
  ball.living=createLivingState({elapsed:700,edits:20,unlocked:["forest","wetland","snow"]});ball.render();
  ball.history.push(ball.editState());
  ball.relief=applyReliefStroke([],[[0,0,1]],"raise","meadow",.08,2);ball.render();
  const sculpted=structuredClone(ball.relief),progress=structuredClone(ball.living);
  ball.undo();assert.equal(ball.relief.length,0);assert.deepEqual(ball.living,progress);
  ball.redo();assert.deepEqual(ball.relief,sculpted);assert.deepEqual(ball.living,progress);
  disposeExcept(ball.group);
});

test("starting a new world cancels a held stylus stroke and preserves discoveries",()=>{
  const ball=headlessWorld(nestedWorld(1));
  Object.assign(ball,{
    history:new History((state:unknown)=>structuredClone(state)),pointers:new PointerRouting(),controls:{enabled:false},
    renderer:{domElement:{hasPointerCapture:()=>false}},applyWorldBackground:()=>{},frameWorld:()=>{},
    drawing:true,activePointerId:7,strokePts:[[0,0,120],[1,0,120]],
  });
  ball.living=createLivingState({elapsed:700,edits:20,unlocked:["forest","wetland","snow"],speed:3,density:"sparse"});
  ball.pointers.down(7,"pen","draw","pen");
  ball.newWorld("blank");
  assert.equal(ball.drawing,false);assert.equal(ball.activePointerId,undefined);assert.deepEqual(ball.strokePts,[]);
  assert.equal(ball.pointers.owner(7),"ignore");assert.equal(ball.controls.enabled,true);
  assert.equal(ball.living.elapsed,0);assert.equal(ball.living.edits,0);assert.equal(ball.living.unlocked.length,8);
  assert.equal(ball.living.speed,3);assert.equal(ball.living.density,"sparse");
  disposeExcept(ball.group);
});

test("one successful sculpt commits history, progression and persistence only once",()=>{
  const ball=headlessWorld(nestedWorld(1));ball.render();
  Object.assign(ball,{history:new History((state:unknown)=>structuredClone(state)),reliefMode:"raise",brushRadius:.08,reliefStrength:2});
  let notifications=0;ball.onChange=()=>notifications++;
  ball.commitRelief([[0,0,1]]);
  assert.equal(ball.living.edits,1);assert.equal(notifications,1);assert.ok(ball.relief.length);
  ball.undo();assert.equal(ball.relief.length,0);assert.equal(ball.history.canUndo(),false);
  disposeExcept(ball.group);
});
