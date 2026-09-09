import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { EcosystemDetail, Terrain } from "../world/ecosystems";
import { makeStrategicPerson, strategyModel, naturalSceneryModel } from "./strategyArt";
export { strategyModel, naturalSceneryModel } from "./strategyArt";

// Bake painted toy parts into one draw call. Vertex colours keep the palette
// rich without a new material (and draw call) for every eye, leaf and button.
export function bakeToy(source: THREE.Group): THREE.Group {
  source.updateMatrixWorld(true);
  const pieces: THREE.BufferGeometry[] = [];
  source.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const material = node.material as THREE.MeshStandardMaterial;
    if (!material.color || material.transparent) return;
    const geometry = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
    geometry.applyMatrix4(node.matrixWorld);
    geometry.deleteAttribute("uv");
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    const colors = new Float32Array(geometry.getAttribute("position").count * 3);
    const existing = geometry.getAttribute("color");
    for (let i = 0; i < colors.length; i += 3) {
      if (material.vertexColors && existing) {
        colors[i] = existing.getX(i/3) * material.color.r;
        colors[i+1] = existing.getY(i/3) * material.color.g;
        colors[i+2] = existing.getZ(i/3) * material.color.b;
      } else material.color.toArray(colors, i);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    pieces.push(geometry);
  });
  const result = new THREE.Group();
  source.traverse((node) => {
    if (!(node instanceof THREE.Line)) return;
    const line = node.clone();
    line.geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
    line.position.set(0,0,0); line.rotation.set(0,0,0); line.scale.setScalar(1);
    line.material = Array.isArray(node.material) ? node.material.map(m=>m.clone()) : node.material.clone();
    result.add(line);
  });
  if (pieces.length) {
    const geometry = mergeGeometries(pieces)!;
    pieces.forEach((piece) => piece.dispose());
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .57 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    result.add(mesh);
  }
  source.traverse((node) => {
    if (!(node instanceof THREE.Mesh || node instanceof THREE.Line)) return;
    node.geometry.dispose();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => material.dispose());
  });
  return result;
}


// Compatibility entry points intentionally share the strategy art catalogue.
// Loading an old world cannot bring back plush inhabitants or modern vehicles.
export function makePerson(outfit: number, skin?: number, hat?: number): THREE.Group {
  return makeStrategicPerson(outfit, skin, hat);
}

export function heroModel(detail: EcosystemDetail): THREE.Group | undefined {
  return strategyModel(detail, detail.stage ?? 2, 0);
}

export function sceneryModel(terrain: Terrain, variant: number): THREE.Group {
  return naturalSceneryModel(terrain, variant);
}
