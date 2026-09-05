import test from "node:test";
import assert from "node:assert/strict";
import { WORLD_SAVE_VERSION, shouldSeedLegacyWorld } from "../src/world/saveFormat";
import { drawBorder } from "../src/world/drawBorder";
import { regularSphereLoop } from "../src/engine/freestyle/freestyleGraph";
import { History } from "../src/engine/editor/history";

test("an intentional empty Tiny world remains empty through save/restore",()=>{
  const saved=JSON.parse(JSON.stringify({version:WORLD_SAVE_VERSION,style:"tiny",graph:{verts:[],edges:[]},paints:{}}));
  assert.equal(shouldSeedLegacyWorld(saved),false);
  assert.deepEqual(saved.graph,{verts:[],edges:[]});
});
test("legacy starter worlds still migrate without changing normal or versioned saves",()=>{
  for(const style of ["tiny","jelly"]) {
    assert.equal(shouldSeedLegacyWorld({style,graph:{verts:[],edges:[]}}),true);
    assert.equal(shouldSeedLegacyWorld({style,version:WORLD_SAVE_VERSION,graph:{verts:[],edges:[]}}),false);
  }
  assert.equal(shouldSeedLegacyWorld({style:"blank",graph:{verts:[],edges:[]}}),false);
});
test("a first circle on an empty world creates the selected terrain and can be undone",()=>{
  const empty={graph:{verts:[],edges:[]},paints:{}};
  const history=new History<ReturnType<typeof drawBorder>>(state=>JSON.parse(JSON.stringify(state)));
  history.push(empty);
  const drawn=drawBorder(empty.graph,empty.paints,regularSphereLoop([0,0,1],.2,[1,0,1],64),true,.004,"meadow");
  assert.equal(drawn.createdFaces?.length,1);
  assert.equal(drawn.paints[drawn.createdFaces![0]],"meadow");
  assert.deepEqual(history.undo(drawn),empty);
  assert.deepEqual(history.redo(empty),drawn);
});
