import assert from "node:assert/strict";
import test from "node:test";
import { PointerRouting } from "../src/scene/pointerRouting";

test("Pencil mode routes fingers to camera for every tool",()=>{
  for(const tool of ["move","draw","paint","brush"] as const) {
    const router=new PointerRouting();
    assert.equal(router.down(1,"touch",tool,"pen").owner,"camera");
    assert.equal(router.down(2,"touch",tool,"pen").owner,"camera");
    assert.equal(router.up(1),"camera");
    assert.equal(router.up(2),"camera");
  }
});
test("Pencil edits while Move remains a camera tool",()=>{
  for(const tool of ["draw","paint","brush","move"] as const) {
    const router=new PointerRouting();
    assert.equal(router.down(1,"pen",tool,"pen").owner,tool === "move"?"camera":"edit");
  }
});
test("Hand mode retains touch drawing and painting, and mouse remains usable",()=>{
  for(const type of ["touch","pen","mouse"]) for(const tool of ["draw","paint","brush"] as const) {
    assert.equal(new PointerRouting().down(1,type,tool,"hand").owner,"edit");
  }
  assert.equal(new PointerRouting().down(1,"mouse","draw","pen").owner,"edit");
});
test("a finger cancels active Pencil ink before rotating, without resuming old ink",()=>{
  const router=new PointerRouting();
  router.down(1,"pen","draw","pen");
  assert.deepEqual(router.down(2,"touch","draw","pen"),{owner:"camera",cancelled:1});
  assert.equal(router.owner(1),"ignore");
  router.up(2);
  assert.equal(router.owner(1),"ignore");
  router.up(1);
  assert.equal(router.down(3,"pen","draw","pen").owner,"edit");
});
test("pinch and Pencil cannot edit simultaneously; lifting one finger is insufficient",()=>{
  const router=new PointerRouting();
  router.down(1,"touch","paint","pen"); router.down(2,"touch","paint","pen");
  assert.equal(router.down(3,"pen","paint","pen").owner,"ignore");
  router.up(1); router.up(3);
  assert.equal(router.down(4,"pen","paint","pen").owner,"ignore");
  router.up(2); router.up(4);
  assert.equal(router.down(5,"pen","paint","pen").owner,"edit");
});
test("cancellation and mode changes release editing ownership without affecting camera",()=>{
  const router=new PointerRouting();
  router.down(1,"touch","draw","hand");
  assert.equal(router.cancelEdit(),1);
  assert.equal(router.up(1),"ignore");
  router.down(2,"touch","draw","pen");
  assert.equal(router.cancelEdit(),undefined);
  assert.equal(router.up(2),"camera");
  assert.equal(router.down(3,"pen","draw","pen").owner,"edit");
  assert.equal(router.up(3),"edit");
});
test("secondary edit pointers cannot replace an active stroke",()=>{
  const router=new PointerRouting();
  router.down(1,"touch","draw","hand");
  assert.equal(router.down(2,"touch","draw","hand").owner,"ignore");
  assert.equal(router.owner(1),"edit");
});
