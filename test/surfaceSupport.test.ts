import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { headlessWorld, nestedWorld } from "./performanceFixtures";
import { applyReliefStroke, createReliefSampler } from "../src/world/relief";
import { disposeExcept } from "../src/scene/renderResources";

test("a flat mountain summit cannot support a building whose footprint overhangs steep terrain",()=>{
  const ball=headlessWorld(nestedWorld(0));ball.render();
  assert.equal(ball.habitatFits([0,0,1],.12,"meadow",1.25),true);
  ball.relief=applyReliefStroke([],[[0,0,1]],"raise","meadow",.045,5);
  ball.reliefSampler=createReliefSampler(ball.relief);
  assert.deepEqual(ball.reliefSampler.normalAt([0,0,1]),[0,0,1],"center slope alone incorrectly suggests a flat building site");
  assert.equal(ball.habitatFits([0,0,1],.12,"meadow",1.25),false);
  disposeExcept(ball.group);
});

test("tiny islands cannot populate models larger than their habitat",()=>{
  const ball=headlessWorld(nestedWorld(1));ball.render();
  const center=[.18,0,Math.sqrt(1-.18*.18)];
  assert.equal(ball.terrainAt(center),"water");
  assert.equal(ball.habitatFits(center,.15,"water"),false);
  assert.equal(ball.habitatFits(center,.02,"water"),true);
  disposeExcept(ball.group);
});

test("authored borders are sampled along relief without moving their endpoints",()=>{
  const ball=headlessWorld(nestedWorld(0));
  const a=new THREE.Vector3(-.2,0,1).normalize().toArray(),b=new THREE.Vector3(.2,0,1).normalize().toArray();
  const original=[a,b];assert.equal(ball.surfaceArc(original),original,"no relief means no extra edge work");
  ball.relief=applyReliefStroke([],[[0,0,1]],"raise","meadow",.075,5);
  ball.reliefSampler=createReliefSampler(ball.relief);
  const arc=ball.surfaceArc(original) as number[][];
  assert.deepEqual(arc[0],a);
  assert.ok(new THREE.Vector3(...arc.at(-1)!).distanceTo(new THREE.Vector3(...b))<1e-12);
  assert.ok(arc.length>20);
  assert.ok(arc.some(point=>Math.hypot(...ball.onSurface(point,.24))>124));
  for(let i=1;i<arc.length;i++)assert.ok(new THREE.Vector3(...arc[i-1]).angleTo(new THREE.Vector3(...arc[i]))<.013);
});
