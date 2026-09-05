import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { EcosystemDetail, Terrain } from "../world/ecosystems";

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

class Toy {
  group = new THREE.Group();
  part(geometry: THREE.BufferGeometry, color: number, x: number, y: number, z: number, scale?: [number, number, number]) {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }));
    mesh.position.set(x, y, z);
    if (scale) mesh.scale.set(...scale);
    this.group.add(mesh);
    return mesh;
  }
  ball(color: number, x: number, y: number, z: number, sx: number, sy = sx, sz = sx) {
    return this.part(new THREE.SphereGeometry(1, 16, 12), color, x, y, z, [sx, sy, sz]);
  }
  box(color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number) {
    return this.part(new THREE.BoxGeometry(sx, sy, sz), color, x, y, z);
  }
  cone(color: number, x: number, y: number, z: number, radius: number, height: number, sides = 8) {
    return this.part(new THREE.ConeGeometry(radius, height, sides), color, x, y, z);
  }
  eyes(x: number, y: number, z: number, spread = .15, size = .055) {
    for (const side of [-1, 1]) {
      this.ball(0x202c40, x + spread * side, y, z, size, size * 1.15, size * .65);
      this.ball(0xffffff, x + spread * side - size * .22, y + size * .3, z + size * .5, size * .26);
    }
  }
  finish() { return bakeToy(this.group); }
}

export function makePerson(outfit: number, skin = 0xffcea9, hat = 0xf8c955) {
  const t = new Toy();
  for (const side of [-1, 1]) {
    t.ball(0x273249, side * .21, .14, .09, .18, .14, .27);
    t.ball(0x405d79, side * .20, .38, 0, .13, .32, .14);
    const arm = t.ball(skin, side * .43, .95, .02, .13, .35, .14);
    arm.rotation.z = side * .25;
  }
  t.ball(outfit, 0, .83, 0, .43, .47, .30);
  t.ball(0xfff8df, 0, 1.13, .27, .19, .08, .055);
  for (const y of [.78, .96]) t.ball(0xfff8df, 0, y, .30, .035);
  t.ball(skin, 0, 1.54, 0, .43, .43, .38);
  t.ball(0x644032, 0, 1.77, -.055, .43, .24, .34);
  t.ball(hat, 0, 1.86, -.01, .46, .18, .40);
  t.ball(hat, 0, 1.78, .24, .43, .045, .30);
  t.eyes(0, 1.56, .354, .14, .054);
  t.ball(0xffab96, -.26, 1.44, .30, .07, .04, .025);
  t.ball(0xffab96, .26, 1.44, .30, .07, .04, .025);
  t.ball(0xdd947b, 0, 1.44, .365, .05, .037, .035);
  // Small backpack gives the figure a readable silhouette from the back too.
  t.ball(hat, 0, .9, -.32, .28, .30, .16);
  return t.finish();
}

export function heroModel(detail: EcosystemDetail): THREE.Group | undefined {
  const t = new Toy();
  const [c1, c2 = c1] = detail.colors;
  if (detail.motif === "people") {
    const left = makePerson(c1), right = makePerson(c2, 0xe8af89, 0xe87972);
    left.position.x = -.64; right.position.set(.65, 0, -.25); right.rotation.y = -.30;
    t.group.add(left, right);
    return t.finish();
  }
  if (["sheep", "dogs", "goats", "lizard", "salamander"].includes(detail.id)) {
    const wool = detail.id === "sheep";
    const body = wool ? 0xfff5df : c1;
    t.ball(body, 0, .67, 0, .70, .45, .40);
    if (wool) for (let i = 0; i < 8; i++) t.ball(body, Math.cos(i * 2.4) * .47, .77 + (i % 3) * .12, Math.sin(i * 2.4) * .25, .24);
    for (const x of [-.40, .40]) for (const z of [-.24, .24]) {
      t.ball(wool ? 0x665b65 : c2, x, .27, z, .12, .26, .12);
      t.ball(0x354052, x, .095, z + .035, .13, .09, .16);
    }
    t.ball(wool ? 0x665b65 : c2, .52, 1.00, .12, .34, .36, .34);
    t.ball(wool ? 0x665b65 : c1, .25, 1.27, .06, .12, .23, .13).rotation.z = .5;
    t.ball(wool ? 0x665b65 : c1, .76, 1.27, .06, .12, .23, .13).rotation.z = -.5;
    t.eyes(.52, 1.06, .431, .13, .052);
    t.ball(0x273249, .52, .91, .445, .075, .05, .04);
    t.ball(body, -.70, .82, 0, .24, .13, .13).rotation.z = -.65;
    if (detail.id === "goats") for (const x of [.33, .70]) t.cone(0xc3a582, x, 1.47, 0, .09, .33);
    return t.finish();
  }
  if (detail.id === "ducks") {
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * .75, y = i === 0 ? .15 : 0;
      t.ball(i ? 0xffd76b : 0xfff5e3, x, .35 + y, 0, .43, .28, .30);
      t.ball(0xffd76b, x + .20, .69 + y, .08, .24);
      t.ball(0xef9346, x + .20, .63 + y, .31, .16, .06, .16);
      t.eyes(x + .20, .74 + y, .287, .09, .035);
    }
    return t.finish();
  }
  if (detail.id === "crabs") {
    t.ball(c1, 0, .42, 0, .65, .28, .40);
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) t.ball(c1, side * .61, .22, (i - 1) * .24, .37, .055, .065).rotation.z = side * .4;
      t.ball(c1, side * .72, .65, .15, .13, .3, .13).rotation.z = -side * .6;
      t.ball(0xffaa76, side * .9, .83, .15, .21, .23, .14);
      t.ball(c1, side * .24, .74, .13, .07, .25, .07);
      t.ball(0xfff3dc, side * .24, .91, .16, .115);
    }
    t.eyes(0, .93, .262, .24, .058);
    return t.finish();
  }
  if (["shoal", "whale", "turtle", "jellyfish"].includes(detail.id)) {
    if (detail.id === "jellyfish") {
      t.ball(0xd998db, 0, 1.0, 0, .70, .54, .60);
      t.ball(0xffc7e3, 0, .84, 0, .72, .12, .62);
      for (let i = 0; i < 5; i++) t.ball(0xcf91d7, (i - 2) * .24, .46, 0, .065, .36, .065);
      t.eyes(0, 1.03, .574, .23, .065);
    } else if (detail.id === "turtle") {
      t.ball(0x3d9175, 0, .57, 0, .72, .40, .63);
      t.ball(0xa6cf76, 0, .52, .60, .29, .23, .28);
      for (const x of [-.59, .59]) for (const z of [-.42, .42]) t.ball(0x7cbb83, x, .31, z, .27, .12, .24);
      for (const x of [-.23, .23]) t.ball(0x87b879, x, .90, 0, .19, .04, .24);
      t.eyes(0, .60, .85, .12, .045);
    } else {
      t.ball(detail.id === "whale" ? 0x6488bd : 0xffb766, 0, .75, 0, .90, .5, .46);
      t.ball(0xf3eddf, .12, .51, .25, .66, .22, .23);
      for (const side of [-1, 1]) t.ball(c2, -.87, .77, side * .23, .28, .09, .35).rotation.y = side * .6;
      t.ball(c2, .03, .55, .43, .38, .095, .18).rotation.z = -.5;
      t.eyes(.36, .88, .433, .15, .055);
      if (detail.id === "whale") for (let i = 0; i < 3; i++) t.ball(0xc1eeeb, .1 + i * .14, 1.45 + Math.sin(i) * .4, 0, .075 + i * .012);
    }
    return t.finish();
  }
  if (detail.id === "sailboat") {
    t.ball(0xc77d54, 0, .24, 0, 1.0, .25, .44);
    t.box(0xffebcd, 0, .37, 0, 1.6, .08, .65);
    t.part(new THREE.CylinderGeometry(.045, .045, 1.9, 8), 0x775344, 0, 1.25, 0);
    t.cone(0xfff7e6, -.38, 1.22, 0, .65, 1.45, 3).scale.z = .09;
    t.cone(0xe88a7f, .38, 1.04, 0, .47, 1.0, 3).scale.z = .09;
    t.box(0xe88a7f, .15, 2.14, 0, .35, .17, .035);
    return t.finish();
  }
  return undefined;
}

export function sceneryModel(terrain: Terrain, variant: number): THREE.Group {
  const t = new Toy();
  if (terrain === "meadow") {
    t.part(new THREE.CylinderGeometry(.12, .20, 1.1, 8), 0x9d6749, 0, .55, 0);
    for (const [x,y,z,s] of [[0,1.5,0,.68],[-.4,1.15,.08,.46],[.37,1.3,.05,.5],[0,1.13,-.36,.44]])
      t.ball(variant % 3 === 0 ? 0xe2a4aa : variant % 2 ? 0x85ba73 : 0x4f9b7a, x, y, z, s, s * 1.05, s);
    for (let i = 0; i < 3; i++) {
      t.ball(0x73a960, .6 + i * .13, .14, .36, .22, .14, .2);
      t.ball(0xffe7a0, .65 + i * .14, .33, .40, .07);
    }
  } else if (terrain === "sand") {
    t.part(new THREE.CylinderGeometry(.08,.15,1.5,8),0xba855a,0,.75,0).rotation.z = -.12;
    for (let i = 0; i < 5; i++) {
      const leaf = t.ball(0x79a575, Math.cos(i * 1.26) * .40, 1.5, Math.sin(i * 1.26) * .4, .59,.1,.22);
      leaf.rotation.set(0,-i*1.26,.15);
    }
    t.ball(0xa3734a,0,1.35,.15,.16);
    t.ball(0xefc999,.40,.12,.15,.35,.12,.27);
  } else if (terrain === "stone" || terrain === "lava") {
    const lava = terrain === "lava";
    t.cone(lava ? 0x6d5265 : 0x9aadc0, 0,.67,0,.8,1.65,5);
    t.cone(lava ? 0xe88969 : 0xf6efe2,0,1.26,0,.31,.59,5);
    t.cone(lava ? 0x806077 : 0x7c94ab,.68,.31,.12,.48,.92,5);
    if (lava) t.ball(0xffca77,0,1.32,0,.22,.08,.22);
    else for (let i=0;i<3;i++) t.cone(0xc5a4df,-.6+i*.2,.3+i*.13,.4,.14,.6+i*.26,5);
  } else {
    for (let i=0;i<3;i++) {
      const ripple = t.part(new THREE.TorusGeometry(.55 + i*.27,.025,4,24,Math.PI * 1.15),0xa6e0da,0,.03+i*.015,0);
      ripple.rotation.x = -Math.PI/2;
    }
  }
  return t.finish();
}
