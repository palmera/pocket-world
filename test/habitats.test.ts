import assert from "node:assert/strict";
import test from "node:test";
import { BORDER_STORIES, ECOSYSTEMS, borderStoryFor } from "../src/world/ecosystems";
import { findTerrainBorderContacts, findTerrainHabitats, panelKey, unlockedSceneCount } from "../src/world/habitats";
import { createRandomWorld } from "../src/world/randomWorld";
import { extractSphereFaces } from "../src/engine/freestyle/sphereGraph";
import * as THREE from "three";
import { BASIC_BEHAVIOURS, RegistryBehaviourEngine } from "../src/world/behaviours";

function edgeOwnersFor(faces: number[][]) {
  const owners = new Map<string, { a: number; b: number; faces: number[] }>();
  faces.forEach((face, faceIndex) => face.forEach((a, index) => {
    const b = face[(index + 1) % face.length];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const edge = owners.get(key) ?? { a: Math.min(a, b), b: Math.max(a, b), faces: [] };
    edge.faces.push(faceIndex);
    owners.set(key, edge);
  }));
  return owners;
}

const verts = [
  [1, 0, 0], [0, 1, 0], [0, 0, 1], [0, -1, 0],
];
const faces = [[0, 1, 2], [0, 2, 3]];
const joinedEdge = [{ a: 0, b: 2, faces: [0, 1] }];

test("same-terrain neighbouring panels form one habitat", () => {
  const paints = new Map<string, string>(faces.map((face) => [panelKey(face), "meadow"]));
  const habitats = findTerrainHabitats(faces, verts, joinedEdge, paints);
  assert.equal(habitats.length, 1);
  assert.equal(habitats[0].terrain, "meadow");
  assert.deepEqual([...habitats[0].faces].sort(), [0, 1]);
  assert.ok(habitats[0].area > 0);
  assert.ok(habitats[0].unlockedScenes > 1);
});

test("a terrain only joins through a shared edge, never just by colour", () => {
  const paints = new Map<string, string>(faces.map((face) => [panelKey(face), "water"]));
  const habitats = findTerrainHabitats(faces, verts, [], paints);
  assert.equal(habitats.length, 2);
  assert.ok(habitats.every((habitat) => habitat.faces.length === 1));
});

test("area unlocks discoveries progressively and caps at the catalogue size", () => {
  assert.equal(unlockedSceneCount(0, 10), 1);
  assert.equal(unlockedSceneCount(0.5, 10), 2);
  assert.equal(unlockedSceneCount(4.5, 10), 10);
  assert.equal(unlockedSceneCount(99, 10), 10);
});

test("random Tiny and Jelly worlds begin with editable, populated panels", () => {
  const stableRandom = () => 0.37;
  for (const style of ["tiny", "jelly"] as const) {
    const world = createRandomWorld(style, stableRandom);
    assert.ok(world.graph.verts.length > 0);
    assert.ok(world.graph.edges.length > 0);
    const paints = Object.values(world.paints);
    const faces = extractSphereFaces(world.graph.verts, world.graph.edges);
    assert.ok(paints.length >= 20);
    assert.equal(paints.length, faces.length);
    assert.ok(faces.length >= 52 && faces.length <= 64);
    assert.ok(faces.some((face) => face.length > 4));
    assert.equal(new Set(paints).size, 5);
  }
});

test("a random Tiny world grows each terrain as one connected territory", () => {
  const world = createRandomWorld("tiny", () => 0.37);
  const faces = extractSphereFaces(world.graph.verts, world.graph.edges);
  const habitats = findTerrainHabitats(faces, world.graph.verts, edgeOwnersFor(faces).values(), new Map(Object.entries(world.paints)));
  assert.equal(habitats.length, 5);
  assert.equal(new Set(habitats.map((habitat) => habitat.terrain)).size, 5);
});

test("a long shared coastline creates one border story, not one per panel edge", () => {
  const paints = new Map<string, string>([
    [panelKey(faces[0]), "meadow"],
    [panelKey(faces[1]), "water"],
  ]);
  const repeatedCoast = [
    { a: 0, b: 2, faces: [0, 1] },
    { a: 1, b: 3, faces: [0, 1] },
  ];
  const contacts = findTerrainBorderContacts(faces, verts, repeatedCoast, paints);
  assert.equal(contacts.length, 1);
  assert.deepEqual([contacts[0].leftFace, contacts[0].rightFace], [0, 1]);
});

test("the five terrain catalogues contain ten interior stories each", () => {
  assert.deepEqual(Object.values(ECOSYSTEMS).map((stories) => stories.length), [10, 10, 10, 10, 10]);
});

test("all fifty interior micro-scenes name an available behaviour", () => {
  const available = new Set(BASIC_BEHAVIOURS.map((behaviour) => behaviour.id));
  const scenes = Object.values(ECOSYSTEMS).flat();
  assert.equal(scenes.length, 50);
  assert.ok(scenes.every((scene) => available.has(scene.motion)));
});

test("every unordered terrain pair has one border story", () => {
  assert.equal(BORDER_STORIES.length, 10);
  const terrains = ["meadow", "water", "sand", "lava", "stone"] as const;
  for (let left = 0; left < terrains.length; left++) {
    for (let right = left + 1; right < terrains.length; right++) {
      assert.ok(borderStoryFor(terrains[left], terrains[right]));
    }
  }
});

test("a future behaviour can be registered without changing the renderer", () => {
  const engine = new RegistryBehaviourEngine();
  engine.register({ id: "spiral", update: (detail, context) => {
    detail.object.position.x += context.time * detail.amount;
    detail.object.rotation.y += context.time;
  } });
  const object = new THREE.Group();
  engine.update({ object, base: new THREE.Vector3(4, 2, 1), phase: 0, amount: .5, motion: "spiral" }, { time: 3 });
  assert.equal(object.position.x, 5.5);
  assert.equal(object.position.y, 2);
  assert.equal(object.rotation.y, 3);
});
