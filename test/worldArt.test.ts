import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { bakeToy, heroModel, makePerson, sceneryModel } from "../src/scene/worldArt";
import { ECOSYSTEMS, type Terrain } from "../src/world/ecosystems";

test("nested painted models retain distinct colours after draw-call batching", () => {
  const scene = new THREE.Group();
  const person = makePerson(0xef5678);
  person.position.set(3,0,0); scene.add(person);
  const baked = bakeToy(scene);
  const mesh = baked.children[0] as THREE.Mesh;
  const positions = mesh.geometry.getAttribute("position");
  const colors = mesh.geometry.getAttribute("color");
  assert.equal(colors.count, positions.count);
  const unique = new Set<string>();
  for(let i=0;i<colors.count;i++) unique.add([colors.getX(i),colors.getY(i),colors.getZ(i)].join(","));
  assert.ok(unique.size >= 6, "face, outfit and accessories must not turn white when nested");
  mesh.geometry.computeBoundingBox();
  assert.ok(mesh.geometry.boundingBox!.min.x > 2);
});

test("all authored residents and landscapes produce finite visible geometry", () => {
  const models = Object.values(ECOSYSTEMS).flat().map(heroModel).filter((m): m is THREE.Group => !!m);
  for(const terrain of Object.keys(ECOSYSTEMS) as Terrain[]) models.push(sceneryModel(terrain,2));
  assert.ok(models.length >= 15);
  for(const model of models) {
    assert.ok(model.children.length > 0);
    model.traverse(node => {
      if(!(node instanceof THREE.Mesh)) return;
      const geometry = node.geometry;
      assert.ok(Array.from(geometry.getAttribute("position").array).every(Number.isFinite));
      geometry.computeBoundingSphere();
      assert.ok(geometry.boundingSphere!.radius > .1 && geometry.boundingSphere!.radius < 5);
    });
  }
});

test("batching preserves line details such as fishing rods and kite strings", () => {
  const group = new THREE.Group();
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,1,0)]),new THREE.LineBasicMaterial());
  line.position.x=2; group.add(line);
  const baked = bakeToy(group);
  const result = baked.children[0] as THREE.Line;
  assert.ok(result instanceof THREE.Line);
  assert.equal(result.geometry.getAttribute("position").getX(0),2);
});
