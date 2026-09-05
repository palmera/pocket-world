import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { arcBounds, overlappingArcs, pointsInBounds } from "../src/engine/freestyle/arcBounds";
import { arcArcIntersection, planarize, pointOnArc, regularSphereLoop } from "../src/engine/freestyle/freestyleGraph";
import { drawBorder } from "../src/world/drawBorder";
import { joinFloat32, FrameCache, disposeExcept } from "../src/scene/renderResources";
import { headlessWorld, nestedWorld } from "./performanceFixtures";

const unit=(p:number[])=>{const n=Math.hypot(...p);return p.map(v=>v/n);};

test("geometry joining has no argument-stack limit and preserves every value",()=>{
  const first=Float32Array.from({length:400_000},(_,i)=>i);
  const second=new Float32Array([7,8,9]);
  const joined=joinFloat32([first,second]);
  assert.deepEqual(joined.subarray(0,first.length),first);
  assert.deepEqual(joined.subarray(first.length),second);
  assert.equal(joinFloat32([]).length,0);
});

test("broad phase never drops exact crossings or T junctions, including long/polar arcs",()=>{
  let seed=812;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  const points=Array.from({length:80},()=>unit([random()*2-1,random()*2-1,random()*2-1]));
  const arcs=Array.from({length:40},(_,i)=>[points[i*2],points[i*2+1]]);
  const boxes=arcs.map(([a,b])=>arcBounds(a,b));
  const pairKey=(i:number,j:number)=>[i,j].sort((a,b)=>a-b).join(",");
  const candidates=new Set([...overlappingArcs(boxes)].map(([i,j])=>pairKey(i,j)));
  let crossings=0;
  for(let i=0;i<arcs.length;i++) for(let j=i+1;j<arcs.length;j++) {
    const intersection=arcArcIntersection(arcs[i][0],arcs[i][1],arcs[j][0],arcs[j][1]);
    if(intersection) { assert.ok(candidates.has(pairKey(i,j))); crossings++; }
  }
  assert.ok(crossings>20);
  for(let i=0;i<arcs.length;i++) {
    const [a,b]=arcs[i];
    const samples=Array.from({length:101},(_,j)=>unit(a.map((v,k)=>v*(1-j/100)+b[k]*j/100)));
    const included=new Set(pointsInBounds(samples)(boxes[i]));
    assert.equal(included.size,samples.length);
  }
  const graph=planarize({verts:points,edges:arcs.map((_,i)=>[2*i,2*i+1])});
  // A second pass must not discover missed crossings or interior vertices.
  const again=planarize(graph);
  assert.equal(again.verts.length,graph.verts.length);
  assert.equal(again.edges.length,graph.edges.length);
  for(const [a,b] of graph.edges) for(let k=0;k<graph.verts.length;k++) {
    if(k!==a && k!==b) assert.equal(pointOnArc(graph.verts[k],graph.verts[a],graph.verts[b]),false);
  }
});

test("frame cache reuses current resources, evicts unused edits and rolls back failures",()=>{
  const cache=new FrameCache<object>();
  cache.begin(); const first=cache.get("a",()=>({})); cache.commit();
  cache.begin(); assert.equal(cache.get("a",()=>({})),first); cache.commit();
  cache.begin(); cache.get("b",()=>({})); cache.rollback();
  cache.begin(); assert.equal(cache.get("a",()=>({})),first); cache.commit();
  cache.begin(); cache.commit();
  cache.begin(); assert.notEqual(cache.get("a",()=>({})),first);
});

test("disposal frees obsolete resources once, without freeing reused geometry/materials",()=>{
  const old=new THREE.Group(), next=new THREE.Group();
  const retained=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
  const discarded=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());
  old.add(retained,discarded,discarded.clone()); next.add(retained.clone());
  let freed=0, retainedFreed=0;
  discarded.geometry.addEventListener("dispose",()=>freed++);
  discarded.material.addEventListener("dispose",()=>freed++);
  retained.geometry.addEventListener("dispose",()=>retainedFreed++);
  retained.material.addEventListener("dispose",()=>retainedFreed++);
  disposeExcept(old,next);
  assert.equal(freed,2); assert.equal(retainedFreed,0); assert.equal(old.children.length,0);
  disposeExcept(next); assert.equal(retainedFreed,2);
});

test("12 inset circles render, repaint without remeshing, and survive a failed update",()=>{
  const world=nestedWorld(12), ball=headlessWorld(world);
  ball.render();
  assert.equal(ball.panelMeshes.length,13);
  assert.ok(ball.panelMeshes.some((mesh:THREE.Mesh)=>mesh.geometry.getAttribute("position").count*3>125_000));
  const first=ball.panelMeshes.map((mesh:THREE.Mesh)=>mesh.geometry);
  let remeshed=0;
  const original=ball.faceMesh;
  ball.faceMesh=function(...args:unknown[]){remeshed++;return original.apply(this,args);};
  const target=ball.panelMeshes[0].userData.faceKey;
  ball.paintByFace.set(target,"lava"); ball.render();
  assert.equal(remeshed,0);
  assert.deepEqual(ball.panelMeshes.map((mesh:THREE.Mesh)=>mesh.geometry),first);
  assert.ok(ball.panelMeshes.every((mesh:THREE.Mesh)=>!mesh.visible));
  ball.group.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(new THREE.Vector3(0,0,300),new THREE.Vector3(0,0,-1));
  assert.ok(ray.intersectObjects(ball.panelMeshes,false).length,"hidden targets remain paintable");

  const group=ball.group, children=[...group.children], build=ball.buildWorld;
  ball.buildWorld=function(){build.call(this);throw new Error("simulated mesh failure");};
  ball.paintByFace.set(target,"sand");
  assert.throws(()=>ball.render(),/simulated mesh failure/);
  assert.equal(ball.group,group); assert.deepEqual(group.children,children);
  assert.equal(ball.paintByFace.get(target),"lava");
  ball.buildWorld=build; ball.render();
  assert.equal(remeshed,0);
  // Clearing must release the last cached world, rather than growing a session-long cache.
  let freed=0; first.forEach((geom:THREE.BufferGeometry)=>geom.addEventListener("dispose",()=>freed++));
  ball.graph={verts:[],edges:[]}; ball.paintByFace.clear(); ball.render();
  assert.equal(ball.panelMeshes.length,0); assert.equal(freed,first.length);
  ball.graph=world.graph; ball.paintByFace=new Map(Object.entries(world.paints)); ball.render();
  assert.equal(remeshed,13);
  disposeExcept(ball.group);
});

test("adding a new area remeshes only changed faces; coordinate edits invalidate the cache",()=>{
  const world=nestedWorld(3), ball=headlessWorld(world);
  ball.render();
  let rebuilt=0;
  const original=ball.faceMesh;
  ball.faceMesh=function(...args:unknown[]){rebuilt++;return original.apply(this,args);};
  const next=drawBorder(world.graph,world.paints,regularSphereLoop([0,0,1],.06,[1,0,1],48),true,.001,"sand");
  ball.graph=next.graph; ball.paintByFace=new Map(Object.entries(next.paints)); ball.render();
  assert.equal(ball.panelMeshes.length,5);
  assert.equal(rebuilt,2,"only the enclosing region and the new circle change");
  rebuilt=0;
  ball.graph=JSON.parse(JSON.stringify(ball.graph));
  ball.graph.verts[0]=unit(ball.graph.verts[0].map((v:number,i:number)=>i===0?v+.001:v));
  ball.render();
  assert.ok(rebuilt>0,"same vertex indices with different coordinates must not reuse stale geometry");
  disposeExcept(ball.group);
});
