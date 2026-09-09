import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { naturalSceneryModel, strategyModel } from "../src/scene/worldArt";
import { ECOSYSTEMS, type EcosystemDetail, type Terrain } from "../src/world/ecosystems";
import { createBasicBehaviourEngine, prepareAnimatedDetail, type AnimatedDetail } from "../src/world/behaviours";

const families = ["worker","explorer","sheep","goat","deer","wolf","camel","bird","bat","fish","whale","turtle","crab","sailboat","rowboat","camp","village","farm","market","workshop","watchtower","windmill","quarry","ruins","reeds","oak","pine","palm","rocks","fishing","caravan","forge","watermill"] as const;
const detail = (family: string) => ({ id: family, label: family, motif: "landmark", motion: "sway", colors: [0x798267], model: family } as EcosystemDetail);
function dispose(group: THREE.Group) {
  group.traverse(n=>{if(n instanceof THREE.Mesh) {n.geometry.dispose();(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>m.dispose());}});
}
function triangles(group: THREE.Group) {
  let count=0;group.traverse(n=>{if(n instanceof THREE.Mesh)count+=(n.geometry.index?.count??n.geometry.getAttribute("position").count)/3;});return count;
}

test("every historical model family is finite, spatially budgeted and GPU bounded at every stage", () => {
  for(const family of families) for(let stage=0;stage<4;stage++) {
    const group=strategyModel(detail(family),stage,19);
    assert.equal(group.userData.family,family);
    assert.equal(group.userData.stage,stage);
    assert.ok(triangles(group)>10 && triangles(group)<4500,`${family} triangle budget: ${triangles(group)}`);
    let meshes=0;
    group.traverse(n=>{
      if(!(n instanceof THREE.Mesh))return;
      meshes++;
      const positions=n.geometry.getAttribute("position"),normals=n.geometry.getAttribute("normal"),colors=n.geometry.getAttribute("color");
      assert.equal(positions.count,normals.count);
      assert.equal(positions.count,colors.count);
      assert.ok(Array.from(positions.array).every(Number.isFinite),family);
      assert.ok(Array.from(normals.array).every(Number.isFinite),family);
      assert.ok((n.material as THREE.MeshStandardMaterial).roughness>=.85);
    });
    assert.ok(meshes<=16,`${family} draw-call budget: ${meshes}`);
    const bounds=new THREE.Box3().setFromObject(group);
    assert.ok(bounds.min.y>=-.11,`${family} feet/hull unexpectedly underground: ${bounds.min.y}`);
    assert.ok(bounds.max.y<3.1,`${family} model unexpectedly tall`);
    const reach=Math.hypot(Math.max(Math.abs(bounds.min.x),Math.abs(bounds.max.x)),Math.max(Math.abs(bounds.min.z),Math.abs(bounds.max.z)));
    assert.ok(group.userData.footprintRadius>=reach,`${family} footprint must include all rigged props`);
    assert.ok(group.userData.footprintRadius<3.2,`${family} footprint unexpectedly broad`);
    dispose(group);
  }
});

test("articulation survives batching and remains independent of the body", () => {
  const person=strategyModel(detail("worker"),2,1);
  for(const limb of ["left-arm","right-arm","left-leg","right-leg"]) {
    const rig=person.getObjectByName(`limb-${limb}`)!;
    assert.ok(rig instanceof THREE.Group);
    assert.ok(rig.children[0] instanceof THREE.Mesh);
    assert.equal(rig.userData.restRotation.length,3);
  }
  const arm=person.getObjectByName("limb-right-arm")!;
  person.updateMatrixWorld(true);
  const before=arm.children[0].matrixWorld.clone();
  const body=person.children.find(n=>n instanceof THREE.Mesh)!;
  const bodyBefore=body.matrixWorld.clone();
  arm.rotation.x+=.6;person.updateMatrixWorld(true);
  assert.notDeepEqual(arm.children[0].matrixWorld.elements,before.elements);
  assert.deepEqual(body.matrixWorld.elements,bodyBefore.elements);
  assert.ok(person.userData.height>1.75 && person.userData.height<1.95,"adult human proportions");
  for(const [family,rig] of [["bird","wing-left"],["camel","leg-front-left"],["sailboat","sail"],["windmill","rotor"],["watermill","wheel-right"]]) {
    const model=strategyModel(detail(family),2,3);
    assert.equal(model.getObjectByName(rig)?.userData.rig,true,`${family} has moving ${rig}`);
    dispose(model);
  }
  dispose(person);
});

test("catalogue and all eight natural ecosystems use strategy art without unsupported legacy fallbacks", () => {
  for(const entry of Object.values(ECOSYSTEMS).flat()) {
    const model=strategyModel(entry,2,5);
    assert.ok(families.includes(model.userData.family),`${entry.id}: ${model.userData.family}`);
    dispose(model);
  }
  for(const terrain of ["meadow","water","sand","lava","stone","forest","wetland","snow"] as Terrain[]) {
    const model=naturalSceneryModel(terrain,4);
    assert.equal(model.userData.family,`scenery-${terrain}`);
    assert.ok(triangles(model)<1600,`${terrain} scenery budget: ${triangles(model)}`);
    assert.ok(model.userData.footprintRadius>0 && Number.isFinite(model.userData.footprintRadius));
    dispose(model);
  }
});

test("settlements evolve structurally and art remains deterministic on save restoration", () => {
  const counts=[0,1,2,3].map(stage=>{
    const model=strategyModel(detail("village"),stage,9),count=triangles(model);dispose(model);return count;
  });
  assert.equal(new Set(counts).size,4,"each era has a distinct settlement silhouette");
  const a=strategyModel(detail("workshop"),3,42),b=strategyModel(detail("workshop"),3,42);
  assert.equal(a.userData.footprintRadius,b.userData.footprintRadius);
  assert.equal(triangles(a),triangles(b));
  assert.deepEqual(new THREE.Box3().setFromObject(a),new THREE.Box3().setFromObject(b));
  dispose(a);dispose(b);
});

test("composite settlement workers animate without moving buildings or plots", () => {
  const engine=createBasicBehaviourEngine();
  for(const family of ["camp","village","farm","market","workshop","quarry","fishing","forge"]) {
    const object=strategyModel(detail(family),3,12);
    object.position.set(3,0,4);object.rotation.y=.7;object.scale.setScalar(5.4);
    const animated:AnimatedDetail=prepareAnimatedDetail({object,base:object.position.clone(),baseScale:object.scale.clone(),baseRotation:object.rotation.clone(),phase:0,amount:.6,motion:"work"});
    const arm=object.getObjectByName("limb-right-arm");
    assert.ok(arm,`${family} contains an articulated worker`);
    engine.update(animated,{time:2});const before=arm.rotation.x;
    engine.update(animated,{time:3});
    assert.notEqual(arm.rotation.x,before,`${family} worker actually moves`);
    assert.deepEqual(object.position.toArray(),[3,0,4],`${family} architecture cannot walk`);
    assert.deepEqual(object.scale.toArray(),[5.4,5.4,5.4],`${family} architecture cannot squash`);
    assert.equal(object.rotation.y,.7);
    dispose(object);
  }
});

test("forests sway at foliage pivots while boats and mills use their mechanical joints", () => {
  const engine=createBasicBehaviourEngine();
  for(const [kind,motion,joint,axis] of [["forest","sway","foliage","z"],["sailboat","bob","sail","y"],["windmill","turn","rotor","z"],["watermill","turn","wheel-right","x"]] as const) {
    const object=kind==="forest"?naturalSceneryModel("forest",5):strategyModel(detail(kind),3,2);
    const animated=prepareAnimatedDetail({object,base:object.position.clone(),baseScale:object.scale.clone(),baseRotation:object.rotation.clone(),phase:0,amount:.6,motion});
    const rig=object.getObjectByName(joint)!;assert.ok(rig);
    engine.update(animated,{time:1});const before=rig.rotation[axis];
    engine.update(animated,{time:2});assert.notEqual(rig.rotation[axis],before,`${kind} animates ${joint}`);
    if(kind==="forest")assert.deepEqual(object.rotation.toArray(),[0,0,0,"XYZ"]);
    dispose(object);
  }
});

test("catalogue archetypes have distinct visible geometry, with era and biome variations", () => {
  function signature(object:THREE.Group) {
    const parts:string[]=[];
    object.traverse(n=>{if(n instanceof THREE.Mesh)parts.push(Array.from(n.geometry.getAttribute("position").array).join(",")+":"+Array.from(n.geometry.getAttribute("color").array).join(","));});
    return parts.join("/");
  }
  const signatures=new Set<string>();
  for(const family of families) {const model=strategyModel(detail(family),3,6);signatures.add(signature(model));dispose(model);}
  assert.ok(signatures.size>=31,"model keys must not collapse into a handful of generic props");
  for(const [a,b] of [["snowWolves","wolves"],["winterVillage","forestVillage"],["reedBoat","submarine"],["herons","woodlandBirds"]]) {
    const entries=Object.values(ECOSYSTEMS).flat(),left=entries.find(d=>d.id===a)!,right=entries.find(d=>d.id===b)!;
    const ma=strategyModel(left,3,6),mb=strategyModel(right,3,6);
    assert.notEqual(signature(ma),signature(mb),`${a} has biome-specific art`);
    dispose(ma);dispose(mb);
  }
});
