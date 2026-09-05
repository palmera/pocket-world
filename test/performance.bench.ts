import { drawBorder, type BorderEdit } from "../src/world/drawBorder";
import { regularSphereLoop } from "../src/engine/freestyle/freestyleGraph";
import { headlessWorld, nestedWorld } from "./performanceFixtures";
import { disposeExcept } from "../src/scene/renderResources";

let world:BorderEdit={graph:{verts:[],edges:[]},paints:{}};
for(let i=0;i<20;i++) {
  const z=.85-i*.05, a=i*2.399, r=Math.sqrt(1-z*z);
  const start=performance.now();
  world=drawBorder(world.graph,world.paints,regularSphereLoop([r*Math.cos(a),r*Math.sin(a),z],.17,[1,0,1],96),true,.001,i%2?"water":"meadow");
  if([0,4,9,19].includes(i)) console.log({circles:i+1,vertices:world.graph.verts.length,editMs:Math.round(performance.now()-start)});
}
const ball=headlessWorld(nestedWorld(12));
let start=performance.now(); ball.render();
console.log({insetCircles:12,initialSceneMs:Math.round(performance.now()-start)});
start=performance.now(); ball.render();
console.log({cachedSceneMs:Math.round(performance.now()-start)});
disposeExcept(ball.group);
