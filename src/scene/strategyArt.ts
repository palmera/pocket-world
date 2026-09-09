import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { EcosystemDetail, Terrain } from "../world/ecosystems";

// Models are authored in metres, facing +Z, with their feet at Y=0.  Muted
// pigments, straight silhouettes and low-poly materials keep the world a small
// historical diorama rather than a collection of plush characters.
const P = {
  wood: 0x69503a, darkWood: 0x463c30, timber: 0x92704d, plank: 0xb29469,
  stone: 0x878879, darkStone: 0x545b55, mortar: 0xb0ac94, earth: 0x746444,
  linen: 0xd5c8a1, red: 0x925141, blue: 0x526d7a, green: 0x6d7750,
  thatch: 0xa18b50, ochre: 0xb28d4c, iron: 0x465153, snow: 0xdbe2da,
  leaf: 0x526c3d, leafLight: 0x72804a, pine: 0x354f40, reed: 0x869365,
};

const hash = (seed: number, n = 0) => {
  const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

function geometry(points: number[], indices: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  g.setIndex(indices);
  const flat = g.toNonIndexed(); g.dispose(); flat.computeVertexNormals();
  return flat;
}

/** Batch each static part of a rig, without baking away the named joints.
 * One mesh per articulated limb, not one draw call per finger/roof tile. */
function finish(source: THREE.Group, family: string): THREE.Group {
  source.updateMatrixWorld(true);
  function bake(root: THREE.Object3D): THREE.Group {
    const result = new THREE.Group();
    result.name = root.name;
    result.userData = { ...root.userData };
    const inverse = root.matrixWorld.clone().invert();
    const pieces: THREE.BufferGeometry[] = [];
    function visit(node: THREE.Object3D) {
      if (node !== root && node.userData.rig === true) {
        const rig = bake(node);
        inverse.clone().multiply(node.matrixWorld).decompose(rig.position, rig.quaternion, rig.scale);
        rig.userData.restRotation = [rig.rotation.x, rig.rotation.y, rig.rotation.z];
        result.add(rig);
        return;
      }
      if (node instanceof THREE.Mesh) {
        const material = node.material as THREE.MeshStandardMaterial;
        const g = node.geometry.index ? node.geometry.toNonIndexed() : node.geometry.clone();
        g.applyMatrix4(inverse.clone().multiply(node.matrixWorld));
        g.deleteAttribute("uv");
        if (!g.getAttribute("normal")) g.computeVertexNormals();
        const count = g.getAttribute("position").count;
        const colors = new Float32Array(count * 3);
        const existing = g.getAttribute("color");
        for (let i = 0; i < count; i++) {
          colors[i * 3] = material.color.r * (material.vertexColors && existing ? existing.getX(i) : 1);
          colors[i * 3 + 1] = material.color.g * (material.vertexColors && existing ? existing.getY(i) : 1);
          colors[i * 3 + 2] = material.color.b * (material.vertexColors && existing ? existing.getZ(i) : 1);
        }
        g.setAttribute("color", new THREE.BufferAttribute(colors, 3)); pieces.push(g);
      }
      for (const child of node.children) visit(child);
    }
    visit(root);
    if (pieces.length) {
      const merged = mergeGeometries(pieces)!;
      pieces.forEach(g => g.dispose());
      const mesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: 0, side: THREE.DoubleSide }));
      mesh.castShadow = mesh.receiveShadow = true;
      result.add(mesh);
    }
    return result;
  }
  const result = bake(source);
  source.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    node.geometry.dispose();
    (Array.isArray(node.material) ? node.material : [node.material]).forEach(m => m.dispose());
  });
  result.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(result);
  const radius = Math.hypot(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)), Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)));
  result.userData.family = family;
  result.userData.footprintRadius = Math.max(.25, radius + .13);
  result.userData.height = Math.max(0, bounds.max.y);
  result.userData.artVersion = 2;
  return result;
}

class Model {
  group = new THREE.Group();
  mesh(g: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.group) {
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: .92 }));
    m.position.set(x, y, z); parent.add(m); return m;
  }
  box(color: number, x: number, y: number, z: number, w: number, h: number, d: number, parent?: THREE.Object3D) {
    return this.mesh(new THREE.BoxGeometry(w, h, d), color, x, y, z, parent);
  }
  cyl(color: number, x: number, y: number, z: number, r: number, h: number, parent?: THREE.Object3D, top = r) {
    return this.mesh(new THREE.CylinderGeometry(top, r, h, 6), color, x, y, z, parent);
  }
  rock(color: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, parent?: THREE.Object3D) {
    const m = this.mesh(new THREE.IcosahedronGeometry(1, 0), color, x, y, z, parent); m.scale.set(sx, sy, sz); return m;
  }
  cone(color: number, x: number, y: number, z: number, r: number, h: number, parent?: THREE.Object3D, sides = 6) {
    return this.mesh(new THREE.ConeGeometry(r, h, sides), color, x, y, z, parent);
  }
  joint(name: string, x: number, y: number, z: number, parent: THREE.Object3D = this.group) {
    const g = new THREE.Group(); g.name = name; g.userData.rig = true; g.position.set(x, y, z); parent.add(g); return g;
  }
  beam(color: number, a: [number, number, number], b: [number, number, number], radius = .035, parent?: THREE.Object3D) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
    const m = this.cyl(color, (a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2, radius, direction.length(), parent);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()); return m;
  }
  roof(x: number, y: number, z: number, w: number, h: number, d: number, color = P.thatch, parent?: THREE.Object3D) {
    const a = w / 2, b = d / 2;
    const roof=this.mesh(geometry([-a,0,-b,a,0,-b,0,h,-b,-a,0,b,a,0,b,0,h,b], [0,2,1,3,4,5,0,3,5,0,5,2,1,2,5,1,5,4,0,1,4,0,4,3]), color, x,y,z,parent);
    roof.userData.roof=true;return roof;
  }
  barrel(x: number, z: number, parent?: THREE.Object3D, size = 1) {
    this.cyl(P.timber,x,.22*size,z,.17*size,.44*size,parent,.145*size);
    for (const y of [.09,.32]) this.cyl(P.iron,x,y*size,z,.173*size,.035*size,parent);
  }
}

function adult(m: Model, outfit: number, seed: number, role: "worker" | "explorer" = "worker", parent: THREE.Object3D = m.group, skinOverride?: number, hatOverride?: number, tool = true) {
  const skin = skinOverride ?? [0xb98259, 0xd0a274, 0x886047, 0xc3916d][Math.floor(hash(seed, 1)*4)];
  const hair = [0x3c342b,0x5d4830,0x7a6952][Math.floor(hash(seed, 2)*3)];
  const hat = hatOverride ?? (role === "explorer" ? P.green : P.thatch);
  m.box(outfit,0,1.04,0,.35,.48,.23,parent);
  m.box(P.darkWood,0,.845,.008,.36,.055,.245,parent);
  m.box(P.linen,0,1.31,.01,.20,.055,.17,parent);
  m.cyl(skin,0,1.385,0,.062,.10,parent);
  m.rock(skin,0,1.555,.006,.145,.185,.135,parent);
  m.rock(hair,0,1.65,-.018,.15,.11,.139,parent);
  m.box(skin,0,1.535,.135,.048,.07,.05,parent);
  m.cyl(hat,0,1.7,0,.235,.035,parent);
  m.cone(hat,0,1.79,-.018,.147,.17,parent);
  for (const side of [-1,1]) {
    const leg = m.joint(`limb-${side < 0 ? "left" : "right"}-leg`,side*.105,.84,0,parent);
    m.box(P.darkWood,0,-.31,0,.12,.60,.13,leg);
    m.box(0x393a30,0,-.71,.05,.145,.17,.25,leg);
    const arm = m.joint(`limb-${side < 0 ? "left" : "right"}-arm`,side*.225,1.245,0,parent);
    arm.rotation.z = -side*.09;
    m.box(outfit,0,-.145,0,.125,.31,.15,arm);
    m.box(skin,0,-.385,.02,.095,.19,.10,arm);
    m.rock(skin,0,-.49,.035,.064,.075,.063,arm);
    if (side > 0 && role === "worker" && tool) {
      if(Math.abs(seed)%3===1) {
        m.beam(P.wood,[0,-.57,.10],[0,-.22,.10],.025,arm);
        const sickle=m.mesh(new THREE.TorusGeometry(.14,.018,3,9,Math.PI*1.3),P.iron,.09,-.12,.10,arm);sickle.rotation.z=.3;
      } else {
        m.beam(P.wood,[0,-.64,.11],[0,.13,.11],.025,arm);
        m.box(P.iron,.10,.11,.11,Math.abs(seed)%3===2?.32:.24,.10,.055,arm);
      }
    }
  }
  if (role === "explorer") {
    m.box(P.wood,0,1.07,-.21,.27,.34,.18,parent);
    m.cyl(P.linen,0,1.29,-.23,.09,.35,parent).rotation.z = Math.PI/2;
    m.beam(P.wood,[-.35,.04,.15],[-.32,1.21,.17],.026,parent);
  } else {
    m.box(P.linen,0,.91,.135,.25,.36,.015,parent);
  }
}

function resident(m: Model, x: number, z: number, scale: number, seed: number, work = false) {
  const g=new THREE.Group();g.position.set(x,0,z);g.scale.setScalar(scale);m.group.add(g);
  adult(m,seed%2?P.blue:P.green,seed,"worker",g,undefined,undefined,work);
  if(work) {const arm=g.getObjectByName("limb-right-arm")!;arm.rotation.x=-.40;}
  return g;
}

export function makeStrategicPerson(outfit: number, skin?: number, hat?: number): THREE.Group {
  const m = new Model(); adult(m,outfit,13,"worker",m.group,skin,hat); return finish(m.group,"worker");
}

function animal(m: Model, family: string, seed: number) {
  const goat = family === "goat", deer = family === "deer", wolf = family === "wolf", camel = family === "camel";
  const coat = camel ? 0xab8960 : goat ? 0xc1b6a0 : deer ? 0x91704a : wolf ? 0x727363 : 0xc9c4ad;
  const y = camel ? 1.05 : .71, length = camel ? 1.4 : 1.05;
  m.rock(coat,0,y,0,.35,.32,length*.62);
  if (family === "sheep") m.rock(0xd8d2bd,0,y+.10,-.02,.39,.34,.61);
  if (camel) m.rock(coat,0,1.41,-.04,.28,.33,.39);
  const head = m.joint("head",0,y+.13,length*.56);
  m.rock(coat,0,.09,.08,.20,.24,.27,head);
  m.rock(wolf ? 0x464d45 : 0x93826a,0,.035,.29,.135,.11,.18,head);
  for (const side of [-1,1]) {
    m.cone(coat,side*.15,.34,.02,.065,.20,head);
    m.rock(0x343a30,side*.151,.14,.20,.018,.025,.019,head);
    if (goat || deer) {
      m.beam(0x79694e,[side*.11,.25,0],[side*.19,.67,-.12],.025,head);
      if (deer) m.beam(0x79694e,[side*.17,.50,-.06],[side*.34,.63,.07],.018,head);
    }
    for (const front of [true,false]) {
      const leg = m.joint(`leg-${front ? "front" : "rear"}-${side < 0 ? "left" : "right"}`,side*.235,y-.13,front ? length*.35 : -length*.35);
      m.box(coat,0,-(y-.16)/2,0,.085,y-.17,.09,leg);
      m.box(P.darkWood,0,-y+.24,.026,.10,.10,.14,leg);
    }
  }
  const tail = m.joint("tail",0,y+.02,-length*.59); tail.rotation.x = wolf ? -.6 : .1;
  m.rock(coat,0,-.18,-.08,.08,.24,wolf ? .14 : .09,tail);
  if (camel) { m.box(P.red,0,1.38,-.05,.60,.08,.73); m.box(P.wood,.33,1.00,0,.18,.44,.46); }
  if (seed % 2 && family === "sheep") m.rock(0x9a8974,.05,.94,.23,.09,.04,.14);
}

function bird(m: Model, bat: boolean, heron: boolean, seed: number, swimming = false) {
  const coat = bat ? 0x4a4842 : heron ? 0xb1b8ae : seed % 2 ? 0xc9cebe : 0x738075;
  const y = heron ? .73 : swimming ? .17 : .33;
  m.rock(coat,0,y,0,.15,.16,.32);
  const head = m.joint("head",0,y+.13,.25);
  if (heron) m.beam(coat,[0,0,0],[0,.45,.10],.046,head);
  m.rock(coat,0,heron ? .51 : .08,heron ? .10 : .04,.11,.12,.12,head);
  m.cone(P.ochre,0,heron ? .49 : .05,heron ? .30 : .21,.043,heron ? .33 : .15,head).rotation.x = Math.PI/2;
  for (const side of [-1,1]) {
    const wing = m.joint(`wing-${side < 0 ? "left" : "right"}`,side*.1,y+.04,-.06);
    if(swimming||heron) {
      m.mesh(geometry([0,0,.14,side*.15,-.04,-.10,side*.05,-.025,-.28,-side*.02,.03,-.16], [0,1,2,0,2,3]),coat,0,0,0,wing);
    } else {
      m.mesh(geometry([0,0,0,side*.72,-.04,-.12,side*.53,0,.22,side*.15,0,.32], [0,1,2,0,2,3]), bat ? 0x5d5950 : coat,0,0,0,wing);
      m.beam(bat ? 0x393b34 : 0x667168,[0,0,0],[side*.70,-.035,-.12],.022,wing);
    }
    if (heron) m.beam(P.ochre,[side*.06,.02,0],[side*.055,y-.1,.01],.018);
  }
  m.mesh(geometry([-.08,y,-.23,.08,y,-.23,.15,y-.03,-.47,-.15,y-.03,-.47],[0,1,2,0,2,3]),coat);
}

function aquatic(m: Model, family: string, seed: number) {
  if (family === "crab") {
    m.rock(0x997353,0,.21,0,.34,.16,.24);
    for (const side of [-1,1]) {
      const claw = m.joint(`limb-${side < 0 ? "left" : "right"}-arm`,side*.27,.20,.13);
      m.beam(0xa37c58,[0,0,0],[side*.18,.12,.22],.035,claw);
      m.rock(0xac815d,side*.22,.14,.23,.13,.07,.11,claw);
      for (let i=0;i<3;i++) m.beam(0x8c6b4e,[side*.20,.18,-.17+i*.13],[side*.48,.025,-.25+i*.15],.023);
    }
  } else if (family === "turtle") {
    m.rock(0x627454,0,.25,0,.46,.24,.57);
    m.rock(0x8c9266,0,.20,.62,.14,.12,.21);
    for (const side of [-1,1]) for (const front of [true,false]) {
      const flipper = m.joint(`leg-${front ? "front" : "rear"}-${side < 0 ? "left" : "right"}`,side*.34,.15,front ? .31 : -.32);
      m.rock(0x7e8960,side*.11,-.06,.02,.27,.065,.16,flipper);
    }
    for (let i=0;i<3;i++) m.rock(0x7e8960,0,.445,-.26+i*.25,.17,.025,.11);
  } else {
    const whale = family === "whale", count = whale ? 1 : 3;
    for (let i=0;i<count;i++) {
      const fish = m.joint(`swimmer-${i}`,(i-1)*(whale ? 0 : .43),whale ? .30 : .16,i*.29);
      const length = whale ? 1.75 : .65, width = whale ? .39 : .12;
      const coat = whale ? 0x526773 : [0x7d9691,0x687f87,0xaaa16f][(i+Math.abs(seed))%3];
      m.rock(coat,0,0,0,width,width*.72,length*.5,fish);
      m.rock(whale ? 0xaeb8ae : 0xb6ba9e,0,-width*.33,.09,width*.78,width*.3,length*.32,fish);
      const tail = m.joint("tail",0,0,-length*.43,fish);
      m.mesh(geometry([0,0,0,-width*.92,.02,-length*.26,width*.92,.02,-length*.26],[0,1,2]),coat,0,0,0,tail);
      for (const side of [-1,1]) m.mesh(geometry([side*width*.6,-width*.1,.09,side*width*1.8,-width*.25,-.2,side*width*.6,-width*.1,-.23],[0,1,2]),coat,0,0,0,fish);
      m.cone(coat,0,width*.72,-.10,width*.36,width*.55,fish,4);
    }
  }
}

function tree(m: Model, family: string, seed: number, x = 0, z = 0, size = 1) {
  const root = new THREE.Group(); root.position.set(x,0,z); root.scale.setScalar(size); m.group.add(root);
  if (family === "reeds") {
    const sway = m.joint("foliage",0,0,0,root);
    for (let i=0;i<12;i++) {
      const a = i*2.4, r=.2+.27*hash(seed,i), h=.55+.54*hash(seed,i+20), px=Math.cos(a)*r,pz=Math.sin(a)*r;
      m.beam(P.reed,[px,0,pz],[px+.035,h,pz],.014,sway);
      m.cyl(P.wood,px+.035,h-.05,pz,.033,.22,sway);
      m.mesh(geometry([px,.1,pz,px+.18,h*.67,pz-.08,px+.015,h*.50,pz],[0,1,2]),P.leafLight,0,0,0,sway);
    }
  } else if (family === "pine") {
    m.cyl(P.wood,0,1,0,.09,2,root,.047);
    const sway = m.joint("foliage",0,.38,0,root);
    for(let i=0;i<4;i++) {
      const r=.66-i*.12, cy=.34+i*.43;
      m.cone(i%2 ? P.pine : 0x456044,0,cy,0,r,.93,sway,7);
      if (seed % 4 === 0) m.cone(P.snow,0,cy+.13,0,r*.78,.69,sway,7);
    }
  } else if (family === "palm") {
    m.beam(P.timber,[0,0,0],[.16,1.75,0],.08,root);
    const crown = m.joint("foliage",.16,1.72,0,root);
    for(let i=0;i<7;i++) {
      const a=i*Math.PI*2/7, dx=Math.cos(a), dz=Math.sin(a);
      m.mesh(geometry([0,0,0,dx*.47-dz*.14,.16,dz*.47+dx*.14,dx*1.04,-.16,dz*1.04,dx*.47+dz*.14,.16,dz*.47-dx*.14],[0,1,2,0,2,3]),i%2?0x637c4b:0x758457,0,0,0,crown);
    }
  } else {
    m.cyl(P.wood,0,.74,0,.13,1.48,root,.075);
    const crown = m.joint("foliage",0,1.14,0,root);
    for (let i=0;i<7;i++) {
      const a=i*2.4, r=.29+.15*hash(seed,i), px=Math.cos(a)*r,pz=Math.sin(a)*r, y=.18+(i%3)*.25;
      m.beam(P.wood,[0,-.32,0],[px,y,pz],.035,crown);
      const leaf = m.rock(i%3 ? P.leaf : P.leafLight,px,y+.11,pz,.38+.12*hash(seed,i+10),.28,.36,crown);
      leaf.rotation.set(hash(seed,i)*.5,a,hash(seed,i+2)*.4);
    }
  }
}

function rocks(m: Model, seed: number, snow = false, volcanic = false) {
  for(let i=0;i<5;i++) {
    const a=i*2.4, r=i?.5:0, h=.35+.43*hash(seed,i);
    const rock = m.rock(volcanic ? (i%2 ? 0x4e4840 : 0x655749) : (i%2 ? P.stone : P.darkStone),Math.cos(a)*r,h*.50,Math.sin(a)*r,.36,h*.60,.32);
    rock.rotation.y = a;
    if(snow) m.rock(P.snow,Math.cos(a)*r,h*.79,Math.sin(a)*r,.29,h*.17,.27);
    if(volcanic && i<2) m.box(0xb16c3e,Math.cos(a)*r,h*.28,.30,.035,.035,.39).rotation.y=a;
  }
}

function tent(m: Model, x: number, z: number, color = P.linen, scale = 1) {
  const g = new THREE.Group(); g.position.set(x,0,z);g.scale.setScalar(scale);m.group.add(g);
  m.roof(0,.04,0,1.05,.80,1.15,color,g);
  // Dark opening and ridge beam make this read as a canvas tent, not a pyramid.
  m.mesh(geometry([-.27,0,.58,.27,0,.58,0,.57,.58],[0,1,2]),P.darkWood,0,.045,0,g);
  m.beam(P.wood,[0,0,-.69],[0,.90,-.69],.027,g);
  m.beam(P.wood,[0,0,.69],[0,.90,.69],.027,g);
  m.beam(P.wood,[0,.87,-.69],[0,.87,.69],.025,g);
}

function cottage(m: Model, x: number, z: number, stage: number, seed: number, stilt = false) {
  const floor = stilt ? .42 : 0;
  if(stilt) for(const a of [-.47,.47]) for(const b of [-.45,.45]) m.box(P.wood,x+a,.22,z+b,.08,.44,.08);
  m.box(P.darkStone,x,floor+.075,z,1.07,.15,1.02);
  m.box(stage>2 ? P.mortar : P.linen,x,floor+.57,z,.96,.88,.91);
  for(const a of [-.49,.49]) m.box(P.wood,x+a,floor+.57,z+.462,.055,.88,.04);
  m.box(P.wood,x,floor+.70,z+.463,.96,.045,.035);
  m.box(P.darkWood,x+.10,floor+.37,z+.467,.26,.58,.025);
  m.box(P.darkWood,x-.28,floor+.73,z+.469,.16,.19,.026);
  m.box(P.timber,x-.28,floor+.73,z+.49,.025,.20,.02);
  m.roof(x,floor+1.02,z,1.20,.60,1.16,seed%3===0?P.wood:P.thatch);
  if(stage>=2) m.box(P.stone,x+.34,floor+1.46,z-.23,.17,.62,.19);
  if(stage>=3) { m.box(P.wood,x-.80,floor+.62,z,.075,1.2,.075); m.box(P.wood,x-.6,floor+1.13,z,.42,.055,.07); m.box(P.red,x-.73,floor+.93,z+.035,.25,.31,.055); }
}

function camp(m: Model, stage: number, seed: number) {
  if(stage===0) {
    for(let i=0;i<5;i++) m.rock(P.stone,Math.cos(i*1.256)*.28,.07,Math.sin(i*1.256)*.28,.10,.08,.09);
    m.beam(P.wood,[-.19,.11,-.06],[.18,.11,.07],.045);
    m.cyl(P.linen,.52,.10,-.21,.10,.45).rotation.z=Math.PI/2;
  } else {
    tent(m,-.35,-.12,seed%2?P.linen:P.ochre);
    m.barrel(.47,.22);
    resident(m,.39,.63,.48,seed);
    if(stage>=2) { m.box(P.wood,.55,.34,-.47,.55,.065,.37); for(const x of [.35,.75]) m.box(P.wood,x,.17,-.47,.045,.34,.29); }
    if(stage>=3) { m.beam(P.timber,[.81,0,.30],[.81,1.3,.30],.035); m.box(P.red,.94,1.12,.30,.26,.31,.025); }
  }
}

function village(m: Model, stage: number, seed: number, stilt: boolean) {
  if(stage<2) { camp(m,stage+1,seed); return; }
  cottage(m,-.32,-.18,stage,seed,stilt);
  resident(m,.28,.57,.51,seed).position.y=stilt?.12:0;
  const awning = new THREE.Group(); awning.position.set(.72,0,.16); awning.scale.setScalar(.50); m.group.add(awning);
  m.box(P.wood,0,.47,0,.65,.055,.55,awning);
  for(const x of [-.28,.28]) m.box(P.wood,x,.24,0,.05,.48,.45,awning);
  for(let i=0;i<3;i++) m.rock(P.ochre,-.21+i*.21,.56,0,.10,.10,.13,awning);
  if(stage>=3) {
    m.cyl(P.stone,.75,.20,-.64,.25,.40); m.cyl(P.darkStone,.75,.408,-.64,.17,.017);
    for(const x of [.52,.98]) m.box(P.wood,x,.61,-.64,.045,.77,.045);
    m.roof(.75,.93,-.64,.64,.22,.56,P.thatch);
    m.box(P.plank,.75,.39,.54,.62,.08,.035);
  }
}

function boat(m: Model, sailboat: boolean, stage: number, seed: number) {
  const length = sailboat ? 2.15 : 1.67, half=length/2;
  const hull = geometry([-.38,.12,-half*.73,.38,.12,-half*.73,.42,.20,half*.55,0,.28,half,-.42,.20,half*.55,0,-.08,-half*.53,0,-.08,half*.52], [0,1,5,1,2,6,1,6,5,2,3,6,3,4,6,4,0,5,4,5,6]);
  m.mesh(hull,P.wood);
  m.box(P.plank,0,.13,-.06,.59,.06,length*.67);
  for(const z of [-.43,.08,.44]) m.box(P.timber,0,.235,z,.66,.055,.13);
  if(sailboat) {
    m.beam(P.wood,[0,.1,0],[0,2.05,0],.036);
    m.beam(P.wood,[-.62,1.8,0],[.63,1.8,0],.026);
    const sail = m.joint("sail",0,1.1,0);
    m.mesh(geometry([-.60,.68,0,.60,.68,0,-.56,-.37,.05,.57,-.37,.05,0,.14,.16],[0,1,4,0,4,2,1,3,4,2,4,3]),P.linen,0,0,0,sail);
    if(stage>=2) m.box(seed%2 ? P.red : P.blue,0,1.45,.125,.22,.42,.008);
    m.box(P.red,.11,2.08,0,.22,.12,.018);
    m.barrel(.08,-.60,m.group,.72);
  } else {
    for(const side of [-1,1]) {
      const oar = m.joint(`limb-${side<0?"left":"right"}-arm`,side*.33,.26,0);
      m.beam(P.wood,[0,0,0],[side*.57,-.16,.38],.023,oar);
      m.box(P.plank,side*.58,-.17,.39,.13,.028,.26,oar).rotation.y = -side*.48;
    }
    m.barrel(.0,-.37,m.group,.60);
    if(stage>=2) { const net=m.joint("sail",0,.30,.38); m.box(P.reed,0,.12,0,.4,.2,.3,net); }
  }
}

function farm(m: Model, stage: number, seed: number) {
  m.box(0x756344,0,.025,0,1.95,.05,1.64);
  const crop=m.joint("foliage",0,0,0);
  for(let row=0;row<5;row++) {
    const x=-.77+row*.38;
    m.box(0x544b35,x,.057,0,.025,.045,1.58);
    for(let col=0;col<5;col++) {
      const z=-.64+col*.31,h=(stage ? .26 : .12)+hash(seed,row*9+col)*.15;
      m.beam(stage>1 ? P.ochre : P.leaf,[x+.12,.04,z],[x+.12,h,z],.012,crop);
      m.rock(stage>1 ? P.thatch : P.leafLight,x+.12,h,z,.047,.07,.038,crop);
    }
  }
  for(const x of [-.98,.98]) { m.box(P.timber,x,.17,-.87,.055,.34,.055); m.box(P.timber,x,.17,.87,.055,.34,.055); }
  for(const z of [-.87,.87]) m.box(P.wood,0,.25,z,2.02,.05,.055);
  if(stage>=2) m.cone(P.thatch,.74,.39,.69,.26,.61);
  if(stage>=1) resident(m,1.10,-.32,.48,seed,true).rotation.y=-Math.PI/2;
}

function cart(m: Model, seed: number) {
  m.box(P.wood,0,.34,0,.59,.08,.90);
  for(const side of [-1,1]) {
    m.box(P.timber,side*.30,.49,0,.055,.25,.91);
    const wheel=m.joint(`wheel-${side<0?"left":"right"}`,side*.38,.28,0);
    const ring=m.mesh(new THREE.TorusGeometry(.25,.038,4,10),P.wood,0,0,0,wheel);ring.rotation.y=Math.PI/2;
    for(let i=0;i<3;i++) { const spoke=m.box(P.wood,0,0,0,.035,.47,.035,wheel);spoke.rotation.x=i*Math.PI/3; }
    m.beam(P.wood,[side*.24,.37,.35],[side*.28,.30,1.04],.027);
  }
  m.box(P.timber,0,.49,-.43,.59,.25,.055);
  for(let i=0;i<3;i++) m.rock(seed%2?P.stone:P.ochre,(i-1)*.17,.51,i%2*.25,.15,.15,.18);
}

function market(m: Model, stage: number, seed: number) {
  const color=seed%2 ? P.red : P.blue;
  for(const x of [-.62,.62]) for(const z of [-.40,.40]) m.box(P.wood,x,.68,z,.045,1.36,.045);
  m.roof(0,1.24,0,1.45,.30,1.08,P.linen);
  for(const x of [-.43,0,.43]) m.box(color,x,1.24,.53,.18,.20,.025);
  m.box(P.plank,0,.63,.19,1.29,.085,.47);
  for(let i=0;i<5;i++) m.rock(i%2 ? P.ochre : P.green,-.50+i*.24,.75,.16,.095,.12,.105);
  m.box(P.wood,-.38,.23,.18,.39,.44,.33);
  resident(m,.10,-.23,.62,seed);
  m.barrel(.69,-.08);
  if(stage>=3) { m.cyl(0x9c6a4c,-.80,.24,.27,.18,.43,m.group,.09); m.cyl(0x9c6a4c,-.80,.47,.27,.085,.12); }
}

function workshop(m: Model, stage: number, seed: number, woodworking = false) {
  cottage(m,-.22,-.24,Math.max(2,stage),seed);
  if(woodworking) {
    m.box(P.plank,.57,.49,.27,.54,.09,.82);
    for(const x of [.35,.78]) for(const z of [-.06,.58]) m.box(P.wood,x,.24,z,.06,.48,.06);
    for(let i=0;i<3;i++) m.cyl(P.timber,.50+i*.11,.60,.20,.07,.79).rotation.x=Math.PI/2;
    const saw=m.joint("sail",.47,.88,.45);m.box(P.iron,0,-.18,0,.04,.37,.24,saw);
    m.box(P.wood,0,.04,0,.07,.05,.32,saw);
    resident(m,.19,.77,.51,seed,true).rotation.y=.7;
    return;
  }
  m.box(P.stone,.58,.30,.22,.64,.59,.60);
  m.box(P.darkWood,.58,.43,.527,.34,.27,.018);
  m.box(0xb77a45,.58,.36,.54,.19,.07,.02);
  m.box(P.stone,.73,.98,.13,.24,1.36,.24);
  m.box(P.iron,.29,.48,.63,.34,.17,.19);
  m.box(P.wood,.29,.20,.63,.26,.39,.22);
  resident(m,-.14,.76,.52,seed,true).rotation.y=.40;
  if(stage>=3) { const banner=m.joint("sail",-.73,1.24,.31);m.box(P.ochre,0,-.17,0,.21,.34,.022,banner); }
}

function watchtower(m: Model, stage: number, seed: number) {
  const stone=stage>=3, height=stone?1.82:1.52;
  m.box(P.darkStone,0,.075,0,.95,.15,.89);
  if(stone) {
    m.box(P.stone,0,.86,0,.74,1.63,.72);
    m.box(P.darkWood,0,.32,.369,.22,.47,.025);
    m.box(P.darkWood,0,1.24,.369,.10,.28,.025);
  } else {
    for(const x of [-.34,.34]) for(const z of [-.32,.32]) m.box(P.wood,x,.80,z,.075,1.52,.075);
    for(const z of [-.32,.32]) {m.beam(P.timber,[-.34,.18,z],[.34,1.45,z],.04);m.beam(P.timber,[.34,.18,z],[-.34,1.45,z],.04);}
  }
  m.box(P.timber,0,height,0,1.02,.095,.94);
  for(const x of [-.47,.47]) m.box(stone?P.stone:P.wood,x,height+.19,0,.065,.30,.92);
  for(const z of [-.44,.44]) m.box(stone?P.stone:P.wood,0,height+.19,z,.94,.30,.065);
  if(stone) for(const x of [-.37,0,.37]) for(const z of [-.44,.44]) m.box(P.stone,x,height+.42,z,.17,.17,.11);
  else m.roof(0,height+.45,0,1.22,.39,1.12,seed%2?P.wood:P.thatch);
}

function windmill(m: Model, stage: number, seed: number) {
  m.cyl(P.mortar,0,.83,0,.44,1.65,m.group,.32);
  m.cone(P.wood,0,1.92,0,.51,.59);
  m.box(P.darkWood,0,.30,.421,.21,.48,.025);
  const rotor=m.joint("rotor",0,1.53,.48);
  rotor.rotation.z=.22;
  for(let i=0;i<4;i++) {
    const blade=new THREE.Group();blade.rotation.z=i*Math.PI/2;rotor.add(blade);
    m.box(P.wood,0,.62,0,.035,1.27,.04,blade);
    m.box(P.linen,.11,.79,-.015,.20,.62,.027,blade);
    for(let j=0;j<4;j++) m.box(P.timber,.10,.54+j*.16,.008,.23,.018,.027,blade);
  }
  m.cyl(P.wood,0,1.53,.52,.08,.10).rotation.x=Math.PI/2;
  if(stage>=3) m.barrel(.58,.14);
  if(seed%2) m.barrel(-.52,-.12,m.group,.8);
}

function quarry(m: Model, stage: number, seed: number) {
  rocks(m,seed);
  for(const x of [-.61,.61]) m.box(P.wood,x,.78,-.37,.085,1.56,.085);
  m.box(P.timber,0,1.55,-.37,1.42,.10,.10);
  m.beam(P.wood,[-.6,1.22,-.37],[-.25,1.55,-.37],.045);
  const rope=m.joint("sail",.27,1.51,-.37);
  m.beam(P.darkWood,[0,0,0],[0,-.85,0],.013,rope);
  m.box(P.wood,0,-.94,0,.24,.19,.24,rope);
  if(stage>=2) { const c=new Model();cart(c,seed);c.group.scale.setScalar(.57);c.group.position.set(.30,0,.74);m.group.add(c.group); }
  if(stage>=1) resident(m,-.57,.60,.48,seed,true).rotation.y=.60;
}

function ruins(m: Model, stage: number, seed: number) {
  m.box(P.darkStone,0,.065,0,1.56,.13,1.12);
  for(let i=0;i<3;i++) {
    const x=(i-1)*.55,h=i===1?.49:1.08;
    m.cyl(P.stone,x,h/2+.1,0,.13,h,m.group,.11);
    m.box(P.mortar,x,h+.11,0,.31,.10,.30);
    m.box(P.mortar,x,.16,0,.32,.14,.31);
  }
  m.box(P.stone,-.28,1.25,0,.88,.17,.29).rotation.z=-.06;
  for(let i=0;i<4;i++) m.rock(i%2 ? P.stone : P.leaf,(i-1.5)*.38,.12,.40+hash(seed,i)*.19,.18,.12,.16);
  if(stage>=3) m.rock(P.leaf,-.53,.87,-.09,.19,.30,.14);
}

function fishing(m: Model, stage: number, seed: number) {
  // A shore economy, not a directly controllable character: jetty, nets and an
  // autonomous fisher all occupy one measured footprint.
  m.box(P.plank,0,.12,.19,1.12,.11,1.02);
  for(const x of [-.49,.49]) for(const z of [-.23,.61]) m.box(P.wood,x,.18,z,.09,.36,.09);
  for(let i=0;i<7;i++) m.box(P.wood,-.46+i*.155,.18,.19,.016,.02,.96);
  const person = new THREE.Group();person.scale.setScalar(.71);person.position.set(-.18,.18,-.03);m.group.add(person);
  adult(m,P.green,seed,"explorer",person);
  const arm = person.getObjectByName("limb-right-arm")!;
  arm.rotation.x=-.56;
  m.beam(P.wood,[0,-.45,.04],[.03,.14,1.28],.018,arm);
  const line=m.joint("sail",.03,.14,1.28,arm);
  m.beam(P.linen,[0,0,0],[0,-.91,.05],.008,line);
  m.barrel(.36,.10,m.group,.8);
  if(stage>=2) {m.box(P.reed,.36,.23,.48,.27,.10,.27);m.cyl(P.wood,.36,.29,.48,.09,.035);}
}

function caravan(m: Model, stage: number, seed: number) {
  const pack=new Model();animal(pack,"camel",seed);pack.group.scale.setScalar(.88);pack.group.position.set(-.38,0,-.17);m.group.add(pack.group);
  const guide=new THREE.Group();guide.position.set(.35,0,.57);guide.scale.setScalar(.63);m.group.add(guide);adult(m,P.ochre,seed+1,"explorer",guide);
  m.beam(P.linen,[-.36,.88,.38],[.20,.60,.65],.012);
  if(stage>=3) m.box(P.blue,-.38,1.16,-.17,.56,.08,.49);
}

function watermill(m: Model, stage: number, seed: number) {
  cottage(m,-.27,-.12,Math.max(2,stage),seed);
  m.box(P.stone,.49,.13,.0,.50,.26,1.25);
  const wheel=m.joint("wheel-right",.66,.64,.06);
  for(const x of [-.12,.12]) {
    const ring=m.mesh(new THREE.TorusGeometry(.53,.045,4,12),P.wood,x,0,0,wheel);ring.rotation.y=Math.PI/2;
    for(let i=0;i<4;i++) {const spoke=m.box(P.wood,x,0,0,.036,1.04,.04,wheel);spoke.rotation.x=i*Math.PI/4;}
  }
  for(let i=0;i<12;i++) {
    const a=i*Math.PI/6, paddle=m.box(P.plank,0,Math.cos(a)*.52,Math.sin(a)*.52,.35,.105,.13,wheel);
    paddle.rotation.x=a;
  }
  m.box(P.wood,.64,.64,.06,.52,.095,.095);
  m.box(0x688781,.68,.053,.12,.42,.028,1.51);
}

/** Independent resident-pack art entry point. Models are selected by declared
 * semantic key, never by loading executable code from a content pack. */
export function strategyModel(detail: EcosystemDetail, stage: number, seed: number): THREE.Group {
  const m = new Model();
  stage=Math.max(0,Math.min(3,Math.floor(Number.isFinite(stage)?stage:0)));
  seed=Number.isFinite(seed)?Math.trunc(seed):0;
  const declared = (detail as EcosystemDetail & { model?: string }).model;
  const aliases: Record<string,string> = {
    walkers:"worker",climbers:"explorer",dogs:"wolf",goats:"goat",sheep:"sheep",lizard:"turtle",salamander:"turtle",crabs:"crab",ducks:"bird",shoal:"fish",whale:"whale",turtle:"turtle",jellyfish:"fish",
    sailboat:"sailboat",submarine:"rowboat",seaplane:"bird",rocketbuoy:"bird",bike:"worker",buggy:"camel",picnic:"camp",flowers:"reeds",butterflies:"bird",kite:"bird",fireflies:"reeds",tumbleweed:"reeds",castle:"watchtower",shells:"rocks",oasis:"palm",caravan:"camel",glider:"bird",launchpad:"ruins",bubbles:"rocks",embers:"rocks",geyser:"rocks",firekite:"bird",hopper:"goat",obsidian:"rocks",magmaCart:"quarry",smoke:"rocks",flareRocket:"bird",crystals:"rocks",cart:"quarry",bats:"bat",cablecar:"quarry",moss:"reeds",drone:"bird",train:"quarry",meteor:"rocks",
  };
  const family=declared ?? aliases[detail.id] ?? (detail.motif==="people"?"worker":detail.motif==="landmark"?"village":detail.motif==="plant"?"oak":detail.motif==="waterlife"?"fish":"bird");
  const winter=/snow|winter|alpine|^pines$|mountainWatch|ancientKeep/i.test(detail.id);
  switch(family) {
    case "worker": case "explorer": adult(m,seed%3===0?P.blue:seed%3===1?P.ochre:P.green,seed,family);break;
    case "sheep":case "goat":case "deer":case "wolf":case "camel":animal(m,family,seed);break;
    case "bird":case "bat":bird(m,family==="bat",/heron/i.test(detail.id),seed,/ducks|waterfowl/i.test(detail.id));break;
    case "fish":case "whale":case "turtle":case "crab":aquatic(m,family,seed);break;
    case "sailboat":case "rowboat":boat(m,family==="sailboat",stage,seed);break;
    case "oak":case "pine":case "palm":case "reeds":tree(m,family,winter?seed-seed%4:seed);break;
    case "camp":camp(m,stage,seed);break;
    case "village":village(m,stage,seed,/stilt|marsh/i.test(detail.id));break;
    case "farm":farm(m,stage,seed);break;
    case "market":market(m,stage,seed);break;
    case "workshop":workshop(m,stage,seed,/sawmill|carpenter/i.test(detail.id));break;
    case "watchtower":watchtower(m,stage,seed);break;
    case "windmill":windmill(m,stage,seed);break;
    case "quarry":quarry(m,stage,seed);break;
    case "ruins":ruins(m,stage,seed);break;
    case "fishing":fishing(m,stage,seed);break;
    case "caravan":caravan(m,stage,seed);break;
    case "forge":workshop(m,stage,seed);break;
    case "watermill":watermill(m,stage,seed);break;
    default:rocks(m,seed,/snow|winter/i.test(detail.id),/lava|magma|obsidian|embers/i.test(detail.id));
  }
  const accent=new THREE.Color(detail.colors[0]??P.blue),hsl={h:0,s:0,l:0};accent.getHSL(hsl);
  accent.setHSL(hsl.h,Math.min(.36,hsl.s),THREE.MathUtils.clamp(hsl.l,.25,.58));
  m.group.traverse(node=>{
    if(!(node instanceof THREE.Mesh))return;
    const material=node.material as THREE.MeshStandardMaterial,hex=material.color.getHex();
    if(hex===P.red||hex===P.blue)material.color.copy(accent);
    if(winter) {
      if(node.userData.roof)material.color.setHex(P.snow);
      else if(hex===0x727363||hex===0xc1b6a0)material.color.setHex(0xc1c8bb);
    }
    if(/reedBoat/i.test(detail.id)&&(hex===P.wood||hex===P.plank||hex===P.timber))material.color.setHex(hex===P.wood?0x7e8054:0xa3a273);
  });
  const result=finish(m.group,family);
  result.userData.stage=stage;
  result.userData.detailId=detail.id;
  return result;
}

export function naturalSceneryModel(terrain: Terrain, seed: number): THREE.Group {
  const m=new Model();
  const kind=String(terrain);
  if(kind==="meadow") {
    if(seed%3===0) {tree(m,"oak",seed,0,0,.83);rocks(m,seed);}
    else { tree(m,"oak",seed,0,0,.83+hash(seed)*.17); }
  } else if(kind==="forest") {
    tree(m,seed%3===0?"pine":"oak",seed,-.27,-.05,.90);
    tree(m,"pine",seed+3,.40,.27,.61);
  } else if(kind==="sand") {
    if(seed%3) tree(m,"palm",seed,0,0,.91);
    else rocks(m,seed);
  } else if(kind==="wetland") tree(m,"reeds",seed);
  else if(kind==="snow") {tree(m,"pine",seed-seed%4,0,0,.93);}
  else if(kind==="stone" || kind==="lava") rocks(m,seed,false,kind==="lava");
  else {
    // Low-profile reeds and weathered shore stones, not conspicuous decorative
    // ripple rings everywhere. Actual water motion belongs to the water shader.
    for(let i=0;i<3;i++) m.rock(0x718579,(i-1)*.31,.015,-.10+i*.13,.14,.045,.18);
  }
  const result=finish(m.group,`scenery-${kind}`);
  result.userData.terrain=terrain;
  return result;
}
