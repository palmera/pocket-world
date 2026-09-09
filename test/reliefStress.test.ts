import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { geodesicSubdivide, icosahedron } from "../src/engine/geometry/solids";
import { normalize } from "../src/engine/geometry/vec";
import { extractSphereFaces } from "../src/engine/freestyle/sphereGraph";
import { panelKey } from "../src/world/habitats";
import { applyReliefStroke, createReliefSampler, RELIEF_LIMITS, type ReliefStamp } from "../src/world/relief";
import { headlessWorld } from "./performanceFixtures";
import { disposeExcept } from "../src/scene/renderResources";

const distributedStamps=(count:number)=>{
  let stamps:ReliefStamp[]=[];
  for(let i=0;i<count;i++) {
    const z=1-2*(i+.5)/count,r=Math.sqrt(1-z*z),angle=i*2.399963;
    stamps=applyReliefStroke(stamps,[[r*Math.cos(angle),r*Math.sin(angle),z]],i%3?"raise":"lower","meadow",.075,3.5);
  }
  return stamps;
};
function subdividedWorld() {
  const solid=geodesicSubdivide(icosahedron(),3),verts=solid.vertices.map(v=>[...normalize(v)]),edges=new Map<string,[number,number]>();
  for(const face of solid.faces)for(let i=0;i<face.length;i++) {
    const a=face[i],b=face[(i+1)%face.length];
    edges.set(a<b?`${a},${b}`:`${b},${a}`,[a,b]);
  }
  const graph={verts,edges:[...edges.values()],authoredEdges:[...edges.values()]};
  return {graph,paints:Object.fromEntries(extractSphereFaces(graph.verts,graph.edges).map(face=>[panelKey(face),"meadow"]))};
}
function meshStats(ball:ReturnType<typeof headlessWorld>) {
  let triangles=0,minRadius=Infinity,maxRadius=0;
  for(const mesh of ball.panelMeshes as THREE.Mesh[]) {
    const positions=mesh.geometry.getAttribute("position"),normals=mesh.geometry.getAttribute("normal");
    triangles+=positions.count/3;
    for(let i=0;i<positions.count;i++) {
      const radius=Math.hypot(positions.getX(i),positions.getY(i),positions.getZ(i));
      minRadius=Math.min(minRadius,radius);maxRadius=Math.max(maxRadius,radius);
      assert.ok(Number.isFinite(radius));
      assert.ok(Math.abs(Math.hypot(normals.getX(i),normals.getY(i),normals.getZ(i))-1)<1e-5);
    }
  }
  assert.ok(minRadius>=120+RELIEF_LIMITS.minHeight-1e-4);
  assert.ok(maxRadius<=120+RELIEF_LIMITS.maxHeight+1e-4);
  return {triangles,minRadius,maxRadius};
}

test("20–96 distributed relief edits remain finite, bounded and locally cached on a subdivided sphere",t=>{
  const ball=headlessWorld(subdividedWorld());
  ball.render();
  const baseline=meshStats(ball),measurements=[];
  for(const count of [20,96]) {
    ball.relief=distributedStamps(count);
    const started=performance.now();ball.render();const elapsedMs=performance.now()-started;
    const stats=meshStats(ball);
    assert.equal(ball.relief.length,count);
    assert.ok(stats.triangles<100_000,`unexpected mesh explosion with ${count} stamps`);
    assert.ok(stats.maxRadius>120.5 && stats.minRadius<119.5);
    const geometries=ball.panelMeshes.map((mesh:THREE.Mesh)=>mesh.geometry);
    const cachedAt=performance.now();ball.render();const cachedMs=performance.now()-cachedAt;
    assert.deepEqual(ball.panelMeshes.map((mesh:THREE.Mesh)=>mesh.geometry),geometries,"an unchanged redraw must not refine or allocate new terrain meshes");
    measurements.push({stamps:count,...stats,renderMs:Math.round(elapsedMs),cachedMs:Math.round(cachedMs)});
  }
  t.diagnostic(JSON.stringify({baseline,...measurements.reduce((s,item)=>({...s,[`stamps${item.stamps}`]:item}),{})}));
  disposeExcept(ball.group);
});

test("failed relief redraw restores geometry and stamps, then accepts a later successful edit",()=>{
  const ball=headlessWorld(subdividedWorld());ball.relief=distributedStamps(20);ball.render();
  const before=ball.relief,group=ball.group,geometries=ball.panelMeshes.map((mesh:THREE.Mesh)=>mesh.geometry),build=ball.buildWorld;
  let retainedFreed=0;
  geometries.forEach((geometry:THREE.BufferGeometry)=>geometry.addEventListener("dispose",()=>retainedFreed++));
  ball.relief=distributedStamps(21);
  ball.buildWorld=function(){build.call(this);throw new Error("stress audit redraw failure");};
  assert.throws(()=>ball.render(),/stress audit redraw failure/);
  assert.equal(ball.relief,before);
  assert.equal(ball.group,group);
  assert.equal(retainedFreed,0,"rollback disposed a still-visible world resource");
  assert.deepEqual(ball.panelMeshes.map((mesh:THREE.Mesh)=>mesh.geometry),geometries);
  ball.buildWorld=build;
  ball.relief=applyReliefStroke(ball.relief,[[0,0,1]],"raise","meadow",.09,2);ball.render();
  assert.notEqual(ball.group,group);
  assert.notEqual(ball.relief,before);
  meshStats(ball);
  disposeExcept(ball.group);
});

test("raised and recessed terrain stays paintable at its visible radial location",t=>{
  const ball=headlessWorld(subdividedWorld());ball.relief=distributedStamps(96);ball.render();ball.group.updateMatrixWorld(true);
  ball.raycaster=new THREE.Raycaster();
  const sampler=createReliefSampler(ball.relief),started=performance.now();let maxHeightError=0;
  for(const stamp of ball.relief as ReliefStamp[]) {
    const point=new THREE.Vector3(...stamp.center);
    ball.raycaster.set(point.clone().multiplyScalar(220),point.clone().negate());
    const hit=ball.raycaster.intersectObjects(ball.panelMeshes,false)[0];
    assert.ok(hit,"ray missed a visible sculpted region");
    maxHeightError=Math.max(maxHeightError,Math.abs(hit.point.length()-(120+sampler.height(stamp.center))));
    const captured=ball.raySphere();
    assert.ok(captured);
    assert.ok(Math.abs(Math.hypot(...captured)-120)<1e-8);
    const angular=new THREE.Vector3(...captured).normalize().angleTo(point);
    assert.ok(angular<1e-6,"drawing changed geographic location on a raised surface");
  }
  t.diagnostic(`96 paint + pointer ray pairs: ${Math.round(performance.now()-started)} ms; max sampler/mesh error ${maxHeightError.toFixed(3)} scene units`);
  assert.ok(maxHeightError<.05,"the explicitly inserted landform centers must agree with the shared sampler");
  disposeExcept(ball.group);
});

test("maximum-strength relief stays within half a scene unit of the analytic surface",t=>{
  const ball=headlessWorld(subdividedWorld());
  ball.relief=distributedStamps(96).map(stamp=>({...stamp,amount:stamp.amount<0?-8:12}));
  const renderStart=performance.now();ball.render();const renderMs=performance.now()-renderStart;
  ball.group.updateMatrixWorld(true);
  const sampler=createReliefSampler(ball.relief),ray=new THREE.Raycaster();
  let maxError=0,sampled=0;const sampleStart=performance.now();
  for(const stamp of ball.relief as ReliefStamp[]) {
    const n=new THREE.Vector3(...stamp.center),u=new THREE.Vector3(Math.abs(n.x)<.9?1:0,Math.abs(n.x)<.9?0:1,0).cross(n).normalize(),v=n.clone().cross(u);
    const points=[n];
    for(const distance of [.22,.46,.72])for(let i=0;i<6;i++) {
      const angle=i*Math.PI/3,offset=stamp.radius*distance;
      points.push(n.clone().multiplyScalar(Math.cos(offset)).addScaledVector(u,Math.sin(offset)*Math.cos(angle)).addScaledVector(v,Math.sin(offset)*Math.sin(angle)));
    }
    for(const point of points) {
      ray.set(point.clone().multiplyScalar(220),point.clone().negate());
      const hit=ray.intersectObjects(ball.panelMeshes,false)[0];
      assert.ok(hit);
      maxError=Math.max(maxError,Math.abs(hit.point.length()-(120+sampler.height(point.toArray()))));sampled++;
    }
  }
  const stats=meshStats(ball);
  t.diagnostic(JSON.stringify({...stats,renderMs:Math.round(renderMs),sampled,sampleMs:Math.round(performance.now()-sampleStart),maxHeightError:maxError}));
  assert.ok(stats.triangles<100_000,"accuracy refinement must remain local and bounded");
  assert.ok(maxError<.5,"maximum-strength relief visibly diverges from its analytic surface");
  disposeExcept(ball.group);
});
