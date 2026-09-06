import test from "node:test";
import assert from "node:assert/strict";
import { headlessWorld } from "./performanceFixtures";
import { History } from "../src/engine/editor/history";

test("undo cancels a pending brush calculation and ignores stale worker replies",()=>{
  const original=globalThis.Worker;
  class FakeWorker {
    terminated=false;
    onmessage?: (event:unknown)=>void;
    onerror?: ()=>void;
    request?:unknown;
    postMessage(request:unknown){this.request=request;}
    terminate(){this.terminated=true;}
  }
  Object.assign(globalThis,{Worker:FakeWorker});
  try {
    const initial={graph:{verts:[],edges:[]},paints:{}};
    const ball=headlessWorld(initial);
    Object.assign(ball,{container:new EventTarget(),controls:{enabled:false},tool:"brush",brushRadius:.03,strokeStep:.004,strokeStart:{x:0,y:0},drawing:true,activePointerId:1,strokePts:[[0,0,120]],history:new History((s:unknown)=>structuredClone(s)),renderer:{domElement:{hasPointerCapture:()=>false}},captureStrokePoint:()=>false});
    ball.onUp({pointerId:1,clientX:0,clientY:0});
    const worker=ball.pendingWorker as FakeWorker;
    assert.ok(worker?.request);assert.equal(ball.controls.enabled,true);
    assert.equal(ball.history.canUndo(),false,"history is committed only after successful calculation");
    ball.undo();assert.equal(worker.terminated,true);assert.equal(ball.pendingWorker,undefined);
    worker.onmessage?.({data:{edit:{graph:{verts:[[0,0,1]],edges:[]},paints:{}}}});
    assert.equal(ball.graph,initial.graph,"cancelled worker must not replace the current world");
  } finally {Object.assign(globalThis,{Worker:original});}
});
