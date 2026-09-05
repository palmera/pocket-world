import * as THREE from "three";
import { KidsBall } from "../src/scene/KidsBall";
import { FrameCache } from "../src/scene/renderResources";
import { drawBorder, type BorderEdit } from "../src/world/drawBorder";
import { regularSphereLoop } from "../src/engine/freestyle/freestyleGraph";

export function nestedWorld(count: number): BorderEdit {
  let world=drawBorder({verts:[],edges:[]},{},regularSphereLoop([0,0,1],.8,[1,0,1],96),true,.001,"meadow");
  for(let i=0;i<count;i++) {
    const r=.18+.04*i, a=i*2.399;
    const center=[r*Math.cos(a),r*Math.sin(a),Math.sqrt(1-r*r)];
    world=drawBorder(world.graph,world.paints,regularSphereLoop(center,.035,[1,0,1],96),true,.0001,"water");
  }
  return world;
}

// Exercise the production scene assembly without a DOM/WebGL context. Only
// canvas textures/material shaders are replaced; geometry and disposal are real.
export function headlessWorld(world: BorderEdit) {
  const ball=Object.create(KidsBall.prototype);
  Object.assign(ball,{
    graph:world.graph, paintByFace:new Map(Object.entries(world.paints)), worldStyle:"tiny",
    scene:new THREE.Scene(), group:new THREE.Group(), panelMeshes:[], animatedDetails:[],
    jellyShaders:[], exactEdges:new Set(), faceGeometry:new FrameCache(), surfaceGeometry:new FrameCache(), toyModels:new FrameCache(),
    shadowTexture:new THREE.Texture(), panelMaterial:()=>new THREE.MeshStandardMaterial(),
  });
  ball.scene.add(ball.group);
  return ball;
}
