import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerRouting, spaceCanControlCamera, type InputMode } from "./pointerRouting";
import { nearbyBorder, shouldCloseBorder, visibleSnapEdges } from "./borderSnap";
import { planPopulation } from "../world/population";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { bakeToy, heroModel, makePerson, sceneryModel } from "./worldArt";
import { disposeExcept, FrameCache, joinFloat32 } from "./renderResources";
import { createJellyMeniscus } from "./jellyMeniscus";
import { Vec3, normalize, sub, dot, cross, len, onSphere } from "../engine/geometry/vec";
import { extractSphereFaces } from "../engine/freestyle/sphereGraph";
import { type FreeGraph } from "../engine/freestyle/freestyleGraph";
import { triangulateRegion } from "../engine/freestyle/sphereRegions";
import type { BorderEdit } from "../world/drawBorder";
import type { EditRequest } from "../world/editWorker";
import { paintRegion } from "../world/paintRegion";
import { WORLD_SAVE_VERSION, shouldSeedLegacyWorld } from "../world/saveFormat";
import { History } from "../engine/editor/history";
import { ECOSYSTEMS, borderStoryFor, type BorderStory, type EcosystemDetail } from "../world/ecosystems";
import { findTerrainBorderContacts, isTerrain, panelKey as faceKey } from "../world/habitats";
import { createRandomWorld } from "../world/randomWorld";
import { createBasicBehaviourEngine, type AnimatedDetail, type BehaviourEngine } from "../world/behaviours";

export type KidTool = "draw" | "paint" | "brush" | "move";
export type Biome = "meadow" | "water" | "sand" | "lava" | "stone";
export type WorldStyle = "blank" | "doodle" | "jelly" | "tiny";
export type PaintKind = Biome | "red-crayon" | "blue-crayon" | "yellow-crayon" | "purple-crayon" | "green-crayon" | "strawberry" | "blueberry" | "lemon" | "grape" | "lime" | "charcoal" | "sky" | "sun" | "rose" | "mint";

// Bright, kid-friendly palette used for the always-correct map colouring.
export const KID_PALETTE = [
  0xff6b57, 0xffc24b, 0x35a7ff, 0x9b5de5, 0x57c84d,
  0xff7bac, 0x2ec4b6, 0xfb8b24, 0x4d9de0, 0xf25f5c,
];

type JellyShader = { uniforms: Record<string, { value: unknown }> };
type EditState = { graph: FreeGraph; paints: Record<string,PaintKind> };

const BIOME_COLORS: Record<Biome, number> = {
  meadow: 0x9bcf8c,
  water: 0x42aaa9,
  sand: 0xf2cc98,
  lava: 0xd37d70,
  stone: 0x9fa9c2,
};

const PAINT_COLORS: Record<string, number> = {
  ...BIOME_COLORS,
  "red-crayon": 0xef5a4c, "blue-crayon": 0x3979d3, "yellow-crayon": 0xf3c747, "purple-crayon": 0x9b70c9, "green-crayon": 0x68ae67,
  strawberry: 0xf15c87, blueberry: 0x4f9eea, lemon: 0xf7d548, grape: 0x9b65d0, lime: 0x8dce5f,
  charcoal: 0x45525b, sky: 0x9ad6f2, sun: 0xf7d05c, rose: 0xf49db5, mint: 0x91d6b4,
};

function defaultPaint(style: WorldStyle): PaintKind {
  return style === "tiny" ? "meadow" : style === "doodle" ? "red-crayon" : style === "jelly" ? "strawberry" : "charcoal";
}

const R = 120; // ball radius (mm-ish); fixed — kids don't need sizing

export class KidsBall {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private group = new THREE.Group(); // panels + seams
  private baseSphere: THREE.Mesh;
  private stars: THREE.Points;
  private halo: THREE.Mesh;
  private shadowTexture: THREE.CanvasTexture;
  private paperTexture: THREE.CanvasTexture;
  private waterTime = { value: 0 };
  private container: HTMLElement;

  private graph: FreeGraph = { verts: [], edges: [] };
  private paintByFace = new Map<string, PaintKind>();
  private terrainTextures = new Map<Biome, THREE.CanvasTexture>();
  private selectedPaint: PaintKind = "meadow";
  private worldStyle: WorldStyle = "tiny";
  private tool: KidTool = "draw";
  private inputMode: InputMode = "hand";
  private pointers = new PointerRouting();
  private history = new History<EditState>((state) => JSON.parse(JSON.stringify(state)));
  private exactEdges = new Set<string>();
  private faceGeometry = new FrameCache<THREE.BufferGeometry>();
  private surfaceGeometry = new FrameCache<THREE.BufferGeometry>();
  private toyModels = new FrameCache<THREE.Group>();
  private renderedState?: EditState;
  private panelMeshes: THREE.Mesh[] = [];
  private animatedDetails: AnimatedDetail[] = [];
  private behaviourEngine: BehaviourEngine = createBasicBehaviourEngine();
  private wobbleUntil = 0;
  private jellyShaders: JellyShader[] = [];
  private jellyImpact = new THREE.Vector3(0, 0, 1);
  private jellyImpactAt = -100;
  private jellyImpactEnergy = 0;
  private jellySquash = 0;
  private jellySquashVelocity = 0;
  private lastAnimationTime = performance.now();

  // stroke capture
  private drawing = false;
  private activePointerId?: number;
  private strokePts: Vec3[] = [];
  private strokeStart = new THREE.Vector2();
  private spaceCamera = false;
  private snapEdges: [number,number][] = [];
  private snapGuide?: THREE.Group;
  private strokeStep = .004;
  private preview?: THREE.Line | THREE.Mesh;
  private brushWidth = 24;
  private brushRadius = .025;
  private pendingWorker?: Worker;
  private brushPreviewMaterial = new THREE.MeshBasicMaterial({side:THREE.DoubleSide,depthWrite:false,depthTest:false});
  private previewMaterial = new THREE.LineBasicMaterial({ color: 0x1c2430, depthTest: false });
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private onChange?: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene.background = new THREE.Color(0x050814);

    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
    this.camera.position.set(0, 0, R * 3.2);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(room, .04).texture;
    this.scene.environmentIntensity = .35;
    room.dispose();
    pmrem.dispose();
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = R * 1.6;
    this.controls.maxDistance = R * 4.5;

    // A warm, broad key and cool sky bounce make the planet feel like a small
    // treasured object, rather than a technical map under neutral studio light.
    this.scene.add(new THREE.HemisphereLight(0xfff3db, 0x788fc2, 1.15));
    const key = new THREE.DirectionalLight(0xffedd6, 2.3);
    key.position.set(-220, 300, 340);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -165, right: 165, top: 165, bottom: -165, near: 100, far: 800 });
    key.shadow.bias = -.0005;
    key.shadow.normalBias = .35;
    key.shadow.radius = 3;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x91d6f5, 2.0);
    rim.position.set(170, 90, -170);
    this.scene.add(rim);

    // Panels are curved from small flat triangles; keep the neutral sphere
    // safely underneath them so it never peeks through as pale "patches".
    const baseGeom = new THREE.SphereGeometry(R * 0.94, 64, 48);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xe9eef5, roughness: 0.95 });
    this.baseSphere = new THREE.Mesh(baseGeom, baseMat);
    this.baseSphere.receiveShadow = true;
    this.scene.add(this.baseSphere);
    this.stars = this.makeStarField();
    this.scene.add(this.stars);
    this.scene.add(this.group);
    this.shadowTexture = this.makeSoftTexture();
    const paper = document.createElement("canvas"); paper.width = paper.height = 128;
    const paperContext = paper.getContext("2d")!;
    const paperNoise = seededRandom(1414);
    for (let y=0;y<128;y++) for (let x=0;x<128;x++) {
      const value = 160 + Math.floor(paperNoise()*80);
      paperContext.fillStyle = `rgb(${value},${value},${value})`;
      paperContext.fillRect(x,y,1,1);
    }
    this.paperTexture = new THREE.CanvasTexture(paper);
    this.paperTexture.wrapS = this.paperTexture.wrapT = THREE.RepeatWrapping;
    this.paperTexture.repeat.set(12,8);
    this.halo = new THREE.Mesh(new THREE.SphereGeometry(R * 1.09, 48, 32), new THREE.ShaderMaterial({
      uniforms: { tint: { value: new THREE.Color(0x67b9d3) } },
      vertexShader: `varying vec3 n; varying vec3 v; void main(){ vec4 p = modelViewMatrix * vec4(position,1.); n = normalize(normalMatrix * normal); v = normalize(-p.xyz); gl_Position = projectionMatrix * p; }`,
      fragmentShader: `uniform vec3 tint; varying vec3 n; varying vec3 v; void main(){ float a = pow(abs(dot(normalize(n),normalize(v))),3.0); gl_FragColor=vec4(tint,a*.18); }`,
      transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.scene.add(this.halo);

    this.onResize();
    window.addEventListener("resize", () => this.onResize());
    const el = this.renderer.domElement;
    el.style.touchAction = "none";
    el.tabIndex = 0;
    el.title = "Mantené Espacio y arrastrá para mover la cámara";
    const releaseSpace=()=>{this.spaceCamera=false;el.style.cursor="";};
    window.addEventListener("keydown",e=>{
      if(e.code==="Space" && this.spaceCamera){e.preventDefault();return;}
      if(e.code!=="Space" || e.repeat || !spaceCanControlCamera(e.target) || e.ctrlKey || e.metaKey || e.altKey)return;
      e.preventDefault();this.spaceCamera=true;el.style.cursor="grab";
      this.pointers.cancelEdit();this.cancelStroke();
    });
    window.addEventListener("keyup",e=>{if(e.code==="Space"){if(this.spaceCamera)e.preventDefault();releaseSpace();}});
    window.addEventListener("blur",()=>{releaseSpace();this.pointers.cancelEdit();this.cancelStroke();});
    document.addEventListener("visibilitychange",()=>{if(document.hidden)releaseSpace();});
    // Capture runs BEFORE OrbitControls' bubble listeners, regardless of the
    // order in which they were installed. Pen strokes cannot rotate the camera.
    el.addEventListener("pointerdown", (e) => {
      el.focus({preventScroll:true});
      const route=this.pointers.down(e.pointerId,e.pointerType,this.spaceCamera?"move":this.tool,this.inputMode);
      if(route.cancelled !== undefined) this.cancelStroke();
      if(route.owner === "camera") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if(route.owner === "edit") {
        el.setPointerCapture(e.pointerId);
        this.onDown(e);
      }
    },true);
    el.addEventListener("pointermove", (e) => {
      const owner=this.pointers.owner(e.pointerId);
      if(owner === "camera") return;
      e.stopImmediatePropagation();
      if(owner === "edit") this.onMove(e);
    },true);
    const finish = (e:PointerEvent,cancelled:boolean) => {
      const owner=this.pointers.up(e.pointerId);
      if(owner === "camera") return;
      e.stopImmediatePropagation();
      if(owner === "edit") this.onUp(e,cancelled);
      if(el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    el.addEventListener("pointerup", e=>finish(e,false),true);
    el.addEventListener("pointercancel", e=>finish(e,true),true);
    el.addEventListener("lostpointercapture", e=>{
      if(this.pointers.owner(e.pointerId) === "edit") finish(e,true);
    },true);
    this.animate();
  }

  // ---- public API ----------------------------------------------------------
  setChangeHandler(fn: () => void) { this.onChange = fn; }
  setTool(t: KidTool) { this.pointers.cancelEdit(); this.cancelStroke(); this.tool = t; }
  setInputMode(mode: InputMode) { this.pointers.cancelEdit(); this.cancelStroke(); this.inputMode=mode; }
  setPaint(paint: PaintKind) { this.selectedPaint = paint; }
  setBrushWidth(width:number) { this.brushWidth=THREE.MathUtils.clamp(width,12,60); }
  setBehaviourEngine(engine: BehaviourEngine) { this.behaviourEngine = engine; }
  getWorldStyle() { return this.worldStyle; }
  setWorldStyle(style: WorldStyle) {
    this.cancelPendingEdit();
    this.worldStyle = style;
    this.resetJellyPhysics();
    this.applyWorldBackground();
    this.render();
  }
  newWorld(style: WorldStyle) {
    this.cancelPendingEdit();
    this.history.clear();
    this.worldStyle = style;
    this.resetJellyPhysics();
    this.selectedPaint = defaultPaint(style);
    if (style === "jelly" || style === "tiny") {
      const random = createRandomWorld(style);
      this.graph = random.graph;
      this.paintByFace = new Map(Object.entries(random.paints) as [string, PaintKind][]);
    } else {
      this.graph = { verts: [], edges: [] };
      this.paintByFace.clear();
    }
    this.applyWorldBackground();
    this.frameWorld();
    this.render();
  }
  randomWorld() {
    if (this.worldStyle === "jelly" || this.worldStyle === "tiny") this.newWorld(this.worldStyle);
  }
  clearTinyWorld() {
    if(this.worldStyle !== "tiny") return;
    this.cancelPendingEdit();
    this.pointers.cancelEdit();
    this.cancelStroke();
    this.history.push(this.editState());
    this.graph={verts:[],edges:[]};
    this.paintByFace.clear();
    this.frameWorld();
    this.render();
  }
  getSaveData() {
    return {
      version: WORLD_SAVE_VERSION,
      graph: this.getGraph(),
      paints: Object.fromEntries(this.paintByFace),
      style: this.worldStyle,
    };
  }
  loadSaveData(data: unknown) {
    this.cancelPendingEdit();
    const saved = data as { version?: number; graph?: FreeGraph; paints?: Record<string, PaintKind>; biomes?: Record<string, Biome>; style?: WorldStyle };
    if (!saved?.graph || !Array.isArray(saved.graph.verts) || !Array.isArray(saved.graph.edges)) return false;
    // Upgrade an old empty Jelly/Tiny save into the new playable starter world.
    // A child can still replace it at any time with the Random button.
    if (shouldSeedLegacyWorld({...saved,graph:saved.graph})) {
      this.newWorld(saved.style === "jelly" ? "jelly" : "tiny");
      return true;
    }
    this.graph = JSON.parse(JSON.stringify(saved.graph));
    this.paintByFace = new Map(Object.entries(saved.paints ?? saved.biomes ?? {}));
    this.worldStyle = saved.style ?? "tiny";
    this.resetJellyPhysics();
    this.selectedPaint = defaultPaint(this.worldStyle);
    this.applyWorldBackground();
    this.render();
    return true;
  }
  private applyWorldBackground() {
    const dark = this.worldStyle === "tiny" || this.worldStyle === "jelly";
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    const gradient = ctx.createRadialGradient(240,220,30,256,256,350);
    gradient.addColorStop(0, dark ? this.worldStyle === "jelly" ? "#443053" : "#274552" : "#fffcf3");
    gradient.addColorStop(1, dark ? "#111b2b" : "#dedacb");
    ctx.fillStyle = gradient; ctx.fillRect(0,0,512,512);
    if (this.scene.background instanceof THREE.Texture) this.scene.background.dispose();
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = texture;
    this.halo.visible = dark;
    (this.halo.material as THREE.ShaderMaterial).uniforms.tint.value.set(this.worldStyle === "jelly" ? 0xdc8bb5 : 0x67b9d3);
    document.body.dataset.world = this.worldStyle;
    const material = this.baseSphere.material as THREE.MeshStandardMaterial;
    material.color.set(this.worldStyle === "doodle" ? 0xfff1cc : 0xf3ece0);
    material.roughness = this.worldStyle === "blank" ? .32 : .8;
    this.stars.visible = this.worldStyle === "tiny" || this.worldStyle === "jelly";
  }

  private makeStarField() {
    const random = seededRandom(8080);
    const positions: number[] = [];
    const colors: number[] = [];
    for (let i = 0; i < 280; i++) {
      const theta = random() * Math.PI * 2;
      const z = random() * 2 - 1;
      const radius = 940 + random() * 420;
      const ring = Math.sqrt(1 - z * z);
      positions.push(Math.cos(theta) * ring * radius, z * radius, Math.sin(theta) * ring * radius);
      const tint = random() > .84 ? new THREE.Color(0x9fc8ff) : random() > .68 ? new THREE.Color(0xffdd9a) : new THREE.Color(0xffffff);
      colors.push(tint.r, tint.g, tint.b);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({ size: 4.2, map: this.makeSoftTexture(), sizeAttenuation: true, transparent: true, opacity: .7, vertexColors: true, depthWrite: false }));
  }
  private makeSoftTexture() {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d")!;
    const gradient = context.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,"rgba(255,255,255,.45)"); gradient.addColorStop(.4,"rgba(255,255,255,.26)"); gradient.addColorStop(1,"rgba(255,255,255,0)");
    context.fillStyle = gradient; context.fillRect(0,0,64,64);
    return new THREE.CanvasTexture(canvas);
  }
  private addContactShadow(anchor: THREE.Group, radius: number) {
    if (radius <= 0) return;
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(radius*2,radius*2),new THREE.MeshBasicMaterial({ color: 0x29434b, map: this.shadowTexture, transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-1 }));
    shadow.rotation.x=-Math.PI/2; shadow.position.y=.08;
    anchor.add(shadow);
  }
  private frameWorld() {
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, 0, this.framingDistance());
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
  }
  private framingDistance() {
    const halfFov = THREE.MathUtils.degToRad(this.camera.fov / 2);
    const limitingFov = Math.atan(Math.tan(halfFov) * Math.min(1,this.camera.aspect));
    return Math.max(R*3.2, R / Math.sin(limitingFov) * 1.17);
  }
  getGraph(): FreeGraph { return JSON.parse(JSON.stringify(this.graph)); }
  private editState(): EditState { return {graph:this.graph,paints:Object.fromEntries(this.paintByFace)}; }
  private restoreEdit(state: EditState) {
    this.graph=state.graph;
    this.paintByFace=new Map(Object.entries(state.paints));
    this.render();
  }

  setGraph(g: FreeGraph, pushHistory = true) {
    this.cancelPendingEdit();
    if (pushHistory) this.history.push(this.editState());
    this.graph = JSON.parse(JSON.stringify(g));
    this.render();
  }

  clear() { this.setGraph({ verts: [], edges: [] }); }

  undo() { if(this.pendingWorker) {this.cancelPendingEdit();return;} const r = this.history.undo(this.editState()); if (r) this.restoreEdit(r); }
  redo() { this.cancelPendingEdit(); const r = this.history.redo(this.editState()); if (r) this.restoreEdit(r); }

  // Snapshot the current view as a PNG data URL (for saving to Photos).
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  panelCount(): number { return extractSphereFaces(this.graph.verts, this.graph.edges).length; }

  // ---- rendering ------------------------------------------------------------
  private render() {
    const previous = { group: this.group, panels: this.panelMeshes, details: this.animatedDetails, shaders: this.jellyShaders, exact: this.exactEdges };
    const caches = [this.faceGeometry, this.surfaceGeometry, this.toyModels];
    caches.forEach(cache=>cache.begin());
    this.group = new THREE.Group();
    this.group.scale.copy(previous.group.scale);
    this.jellyShaders = [];
    try {
      this.buildWorld();
    } catch (error) {
      disposeExcept(this.group, previous.group);
      this.group=previous.group;
      this.panelMeshes=previous.panels;
      this.animatedDetails=previous.details;
      this.jellyShaders=previous.shaders;
      this.exactEdges=previous.exact;
      caches.forEach(cache=>cache.rollback());
      if(this.renderedState) {
        this.graph=this.renderedState.graph;
        this.paintByFace=new Map(Object.entries(this.renderedState.paints));
      }
      throw error;
    }
    caches.forEach(cache=>cache.commit());
    this.scene.add(this.group);
    this.scene.remove(previous.group);
    disposeExcept(previous.group, this.group);
    this.renderedState={graph:this.graph,paints:Object.fromEntries(this.paintByFace)};
    this.onChange?.();
  }

  private buildWorld() {
    this.panelMeshes = [];
    this.animatedDetails = [];
    const g = this.graph;
    const edgeId = (a:number,b:number)=>a<b?`${a},${b}`:`${b},${a}`;
    this.exactEdges = new Set([...(g.authoredEdges ?? []),...(g.bridgeEdges ?? [])].map(([a,b])=>edgeId(a,b)));
    const bridges = new Set((g.bridgeEdges ?? []).map(([a,b])=>edgeId(a,b)));
    const faces = extractSphereFaces(g.verts, g.edges);
    const faceKeys = faces.map(faceKey);
    const facePaints = faceKeys.map(key=>this.paintByFace.get(key));
    const vertsMm = g.verts.map((v) => [v[0] * R, v[1] * R, v[2] * R] as Vec3);
    const edgeOwners = new Map<string, { a: number; b: number; faces: number[] }>();
    faces.forEach((face,fi)=>face.forEach((a,i)=>{
      const b=face[(i+1)%face.length], key=edgeId(a,b);
      const owner=edgeOwners.get(key)??{a:Math.min(a,b),b:Math.max(a,b),faces:[]};
      owner.faces.push(fi);edgeOwners.set(key,owner);
    }));
    const isJellyBoundary=(a:number,b:number)=>{
      if(bridges.has(edgeId(a,b))) return false;
      const owners=edgeOwners.get(edgeId(a,b))?.faces??[];
      return owners.length!==2 || facePaints[owners[0]]!==facePaints[owners[1]];
    };
    // All panels sample the same height field, including hidden same-colour
    // subdivisions near a coast. Per-face fields would tear at those seams.
    const jellyBorders:[Vec3,Vec3][]=[];
    if(this.worldStyle==="jelly") for(const [a,b] of g.edges) {
      if(!isJellyBoundary(a,b))continue;
      const points=this.organicEdge(vertsMm[a],vertsMm[b],a,b).map(p=>normalize(p));
      for(let j=1;j<points.length;j++)jellyBorders.push([points[j-1],points[j]]);
    }
    const jellyInfluences=jellyBorders.map(pair=>{
      const center=normalize([pair[0][0]+pair[1][0],pair[0][1]+pair[1][1],pair[0][2]+pair[1][2]]);
      return {center,halfAngle:Math.acos(Math.max(-1,Math.min(1,dot(pair[0],pair[1]))))*.5,key:JSON.stringify(pair)};
    });
    const shapeJelly=this.worldStyle==="jelly"?createJellyMeniscus(jellyBorders):undefined;
    const terrainSurfaces = new Map<PaintKind | "empty", THREE.BufferGeometry[]>();
    let hitMaterial: THREE.MeshBasicMaterial | undefined;

    faces.forEach((face, fi) => {
      const key = faceKeys[fi];
      let jellySignature="";
      if(shapeJelly) {
        const center=normalize(face.reduce<Vec3>((sum,i)=>[sum[0]+g.verts[i][0],sum[1]+g.verts[i][1],sum[2]+g.verts[i][2]],[0,0,0]));
        let angularRadius=0;
        for(const i of face)angularRadius=Math.max(angularRadius,Math.acos(Math.max(-1,Math.min(1,dot(center,vertsMm[i])/R))));
        // A spherical cap contains the face and its curved edges. Only nearby
        // visible borders can change its meniscus (including neighbouring faces).
        jellySignature=jellyInfluences.filter(border=>angularRadius>=Math.PI/2 || dot(center,border.center)>=Math.cos(Math.min(Math.PI,angularRadius+.14+border.halfAngle))).map(border=>border.key).join(";");
      }
      // Include coordinates and exact-edge flags: undo, imported worlds and
      // moving vertices may reuse indices while changing the actual surface.
      const signature = `${this.worldStyle}:${face.map((a,i)=>`${a}:${g.verts[a].join(",")}:${this.exactEdges.has(edgeId(a,face[(i+1)%face.length]))?1:0}`).join(";")}:${jellySignature}`;
      const geom = this.faceGeometry.get(signature, ()=>{
        let positions = this.faceMesh(vertsMm, face);
        let normals:number[];
        if(shapeJelly) {
          const shaped=shapeJelly(positions);positions=shaped.positions;normals=shaped.normals;
        } else normals=this.sphericalNormals(positions);
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions,3));
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(this.sphericalUvs(positions),2));
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals,3));
        return geometry;
      });
      const paint = this.paintByFace.get(key);
      const surfaceKey = paint ?? "empty";
      const surface = terrainSurfaces.get(surfaceKey) ?? [];
      surface.push(geom);
      terrainSurfaces.set(surfaceKey, surface);

      // Raycaster intersects invisible meshes; keep them in the transform tree
      // without submitting a transparent draw call for every editable face.
      const mesh = new THREE.Mesh(geom, hitMaterial ??= new THREE.MeshBasicMaterial());
      mesh.visible = false;
      mesh.userData.faceKey = key;
      this.panelMeshes.push(mesh);
      this.group.add(mesh);
    });

    // One material surface per colour makes adjacent places genuinely merge.
    // The invisible meshes above retain the editable face-level hit targets.
    for (const [paint, parts] of terrainSurfaces) {
      const geom = this.surfaceGeometry.get(`${paint}:${parts.map(part=>part.uuid).join(",")}`, ()=>{
        const geometry = new THREE.BufferGeometry();
        for(const [attribute,size] of [["position",3],["uv",2],["normal",3]] as const) {
          const chunks=parts.map(part=>part.getAttribute(attribute).array as Float32Array);
          geometry.setAttribute(attribute,new THREE.BufferAttribute(joinFloat32(chunks),size));
        }
        return geometry;
      });
      const surface = new THREE.Mesh(geom, this.panelMaterial(paint === "empty" ? undefined : paint));
      surface.receiveShadow = true;
      surface.frustumCulled = false;
      this.group.add(surface);
    }

    // Jelly boundaries are carved into the surface itself, without tube meshes.
    if (g.edges.length && this.worldStyle !== "tiny" && this.worldStyle !== "jelly") {
      const pos: number[] = [];
      for (const [a, b] of g.edges) {
        if(bridges.has(edgeId(a,b))) continue;
        const adjacent = edgeOwners.get(edgeId(a,b));
        if(adjacent?.faces.length===2) {
          const left=facePaints[adjacent.faces[0]];
          if(left && left===facePaints[adjacent.faces[1]]) continue;
        }
        const va = vertsMm[a], vb = vertsMm[b];
        if (!va || !vb) continue;
        const A = onSphere(va, R * 1.004), B = onSphere(vb, R * 1.004);
        const segs = Math.max(1, Math.round(len(sub(B, A)) / (R * 0.12)));
        let prev = A;
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          const p = onSphere([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t], R * 1.004);
          pos.push(...prev, ...p); prev = p;
        }
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      this.group.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2e3a })));
    }
    if (this.worldStyle === "tiny") {
      // Authored geometry stays exact, but equal terrain has no visible seam.
      const ink: number[] = [];
      for(const [a,b] of g.authoredEdges ?? []) {
        const adjacent=edgeOwners.get(edgeId(a,b));
        if(adjacent?.faces.length===2 && facePaints[adjacent.faces[0]]===facePaints[adjacent.faces[1]]) continue;
        ink.push(...onSphere(vertsMm[a],R*1.002),...onSphere(vertsMm[b],R*1.002));
      }
      const inkGeometry = new THREE.BufferGeometry();
      inkGeometry.setAttribute("position",new THREE.Float32BufferAttribute(ink,3));
      this.group.add(new THREE.LineSegments(inkGeometry,new THREE.LineBasicMaterial({color:0xfff6dc,transparent:true,opacity:.9})));
      const population=planPopulation(faces,g.verts,edgeOwners.values(),this.paintByFace);
      population.placements.forEach(({point,terrain,slot,kind},fi) => {
        if(kind==="resident") {
          this.addTerrainDetail(ECOSYSTEMS[terrain][slot],[0],[point],slot,1);
          return;
        }
        const center = new THREE.Vector3(...point);
        const anchor = new THREE.Group();
        anchor.position.copy(center).multiplyScalar(R + .35);
        anchor.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),center);
        const scenery = this.toyModels.get(`scenery:${terrain}:${slot%4}`,()=>sceneryModel(terrain,slot%4)).clone(true);
        scenery.scale.setScalar(terrain === "water" ? 6 : 7);
        scenery.rotation.y = fi * 2.399;
        anchor.add(scenery);
        this.addContactShadow(anchor, terrain === "water" ? 0 : 7);
        this.group.add(anchor);
      });
      const coast: number[] = [];
      for (const edge of edgeOwners.values()) {
        if (edge.faces.length !== 2) continue;
        const left = facePaints[edge.faces[0]];
        const right = facePaints[edge.faces[1]];
        if (left === right || (left !== "water" && right !== "water")) continue;
        const points = this.organicEdge(vertsMm[edge.a],vertsMm[edge.b],edge.a,edge.b);
        for (let i=1;i<points.length;i++) coast.push(...onSphere(points[i-1],R+.3),...onSphere(points[i],R+.3));
      }
      const coastGeometry = new THREE.BufferGeometry();
      coastGeometry.setAttribute("position",new THREE.Float32BufferAttribute(coast,3));
      this.group.add(new THREE.LineSegments(coastGeometry,new THREE.LineBasicMaterial({color:0xdbf3d9,transparent:true,opacity:.75})));
      for (const contact of findTerrainBorderContacts(faces, g.verts, edgeOwners.values(), this.paintByFace)) {
        const left = facePaints[contact.leftFace];
        const right = facePaints[contact.rightFace];
        if (isTerrain(left) && isTerrain(right) && left !== right) {
          const story = borderStoryFor(left, right);
          const midpoint=new THREE.Vector3(...g.verts[contact.a]).add(new THREE.Vector3(...g.verts[contact.b])).normalize().toArray();
          if (story && population.space.reserve(midpoint,.17)) this.addBorderStory(story, vertsMm[contact.a], vertsMm[contact.b]);
        }
      }
    }
  }

  private panelMaterial(paint?: PaintKind): THREE.MeshStandardMaterial {
    const base = paint ? PAINT_COLORS[paint] : this.worldStyle === "blank" ? 0xffffff : 0xe9eef5;
    if (this.worldStyle === "tiny" && isTerrain(paint)) {
      const water = paint === "water";
      const material = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.terrainTexture(paint), bumpMap: this.terrainTexture(paint), bumpScale: water ? .20 : .11, roughness: water ? .23 : .86, metalness: water ? .16 : 0, emissive: paint === "lava" ? 0xa42d12 : 0, emissiveIntensity:.18, side: THREE.DoubleSide });
      if (water) {
        material.onBeforeCompile = shader => {
          shader.uniforms.waterTime = this.waterTime;
          shader.fragmentShader = shader.fragmentShader.replace("#include <common>","#include <common>\nuniform float waterTime;").replace("#include <normal_fragment_maps>",`#include <normal_fragment_maps>
            normal = normalize(normal + vec3(sin(vMapUv.y*170.0 + waterTime*.8)*.025,cos(vMapUv.x*130.0 + waterTime*.6)*.025,0.0));`);
        };
        material.customProgramCacheKey = () => "pocket-water-v1";
      }
      return material;
    }
    if (this.worldStyle === "jelly") {
      return this.jellyMaterial(base);
    }
    if (this.worldStyle === "doodle") {
      return new THREE.MeshStandardMaterial({ color: base, roughness: 1, bumpMap: this.paperTexture, bumpScale: .18, side: THREE.DoubleSide });
    }
    return new THREE.MeshStandardMaterial({ color: base, roughness: 0.62, side: THREE.DoubleSide });
  }

  // Jelly is not just a glossy paint job: every surface receives the same
  // travelling impact wave, while a small spring keeps the whole planet
  // squishy after a brush stroke or colour tap.
  private jellyMaterial(color: number) {
    const material = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.18,
      clearcoat: 0.9,
      clearcoatRoughness: 0.1,
      transmission: 0,
      thickness: 1.25,
      ior: 1.36,
      envMapIntensity: 1.3,
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (shader) => {
      const jellyShader = shader as unknown as JellyShader;
      shader.uniforms.jellyTime = { value: performance.now() / 1000 };
      shader.uniforms.jellyImpact = { value: this.jellyImpact };
      shader.uniforms.jellyImpactTime = { value: this.jellyImpactAt };
      shader.uniforms.jellyImpactEnergy = { value: this.jellyImpactEnergy };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", `#include <common>
          uniform float jellyTime;
          uniform vec3 jellyImpact;
          uniform float jellyImpactTime;
          uniform float jellyImpactEnergy;
          varying float vJellyRidge;`)
        .replace("#include <begin_vertex>", `#include <begin_vertex>
          vec3 jellyDirection = normalize(position);
          float jellyAge = max(0.0, jellyTime - jellyImpactTime);
          float jellyDistance = acos(clamp(dot(jellyDirection, jellyImpact), -1.0, 1.0));
          float jellyRing = sin(jellyDistance * 24.0 - jellyAge * 17.0)
            * exp(-jellyDistance * 3.2) * exp(-jellyAge * 1.15);
          float jellyBreath = sin(jellyDirection.x * 7.0 + jellyDirection.y * 9.0 + jellyTime * 2.2) * 0.22;
          transformed += jellyDirection * (jellyBreath + jellyRing * jellyImpactEnergy * 1.5);
          vJellyRidge = max(0.0, jellyRing * jellyImpactEnergy);`);
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vJellyRidge;")
        .replace("vec4 diffuseColor = vec4( diffuse, opacity );", "vec4 diffuseColor = vec4( diffuse, opacity );\ndiffuseColor.rgb += vJellyRidge * vec3(0.16, 0.11, 0.18);");
      this.jellyShaders.push(jellyShader);
    };
    material.customProgramCacheKey = () => "pocket-world-jelly-ripple-v1";
    return material;
  }

  private triggerJellyImpact(point: THREE.Vector3, energy = 0.8) {
    this.jellyImpact.copy(point).normalize();
    this.jellyImpactAt = performance.now() / 1000;
    this.jellyImpactEnergy = Math.min(1.35, this.jellyImpactEnergy * 0.45 + energy);
    this.jellySquashVelocity = Math.min(4.5, this.jellySquashVelocity + energy * 1.65);
    this.wobbleUntil = performance.now() + 760;
  }

  private resetJellyPhysics() {
    this.jellyImpactEnergy = 0;
    this.jellySquash = 0;
    this.jellySquashVelocity = 0;
    this.wobbleUntil = 0;
    this.group.scale.setScalar(1);
  }

  private sphericalUvs(positions: number[]): number[] {
    const uvs: number[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i], y = positions[i + 1], z = positions[i + 2];
      const radius = Math.hypot(x, y, z) || 1;
      uvs.push(0.5 + Math.atan2(z, x) / (Math.PI * 2), 0.5 - Math.asin(y / radius) / Math.PI);
    }
    // Each triangle is emitted as three consecutive vertices. Unwrap the
    // longitude seam locally so texture interpolation never draws a giant
    // straight slash across a territory that happens to cross u = 0 / 1.
    for (let i = 0; i < uvs.length; i += 6) {
      const us = [uvs[i], uvs[i + 2], uvs[i + 4]];
      if (Math.max(...us) - Math.min(...us) > 0.5) {
        for (const offset of [0, 2, 4]) if (uvs[i + offset] < 0.5) uvs[i + offset] += 1;
      }
    }
    return uvs;
  }

  private sphericalNormals(positions: number[]): number[] {
    const normals: number[] = [];
    for (let i = 0; i < positions.length; i += 3) {
      const length = Math.hypot(positions[i], positions[i + 1], positions[i + 2]) || 1;
      normals.push(positions[i] / length, positions[i + 1] / length, positions[i + 2] / length);
    }
    return normals;
  }

  private terrainTexture(terrain: Biome): THREE.CanvasTexture {
    const existing = this.terrainTextures.get(terrain);
    if (existing) return existing;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 160;
    const ctx = canvas.getContext("2d")!;
    const base = new THREE.Color(BIOME_COLORS[terrain]);
    const accent = base.clone().offsetHSL(0, terrain === "lava" ? 0.05 : -0.05, terrain === "stone" ? 0.11 : -0.1);
    const highlight = base.clone().offsetHSL(0, -0.1, 0.15);
    const random = seededRandom(BIOME_COLORS[terrain]);
    ctx.fillStyle = base.getStyle();
    ctx.fillRect(0, 0, 160, 160);

    if (terrain === "water") {
      ctx.strokeStyle = highlight.getStyle(); ctx.globalAlpha = 0.42; ctx.lineWidth = 2;
      for (let y = 14; y < 160; y += 19) {
        ctx.beginPath();
        for (let x = -8; x <= 168; x += 8) {
          const wave = y + Math.sin((x + y) * 0.11) * 3;
          if (x === -8) ctx.moveTo(x, wave); else ctx.lineTo(x, wave);
        }
        ctx.stroke();
      }
    } else if (terrain === "meadow") {
      ctx.strokeStyle = accent.getStyle(); ctx.globalAlpha = 0.45; ctx.lineWidth = 1.25;
      for (let i = 0; i < 180; i++) {
        const x = random() * 160, y = random() * 160;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (random() - .5) * 3, y - 4 - random() * 5); ctx.stroke();
      }
      ctx.fillStyle = highlight.getStyle(); ctx.globalAlpha = 0.45;
      for (let i = 0; i < 42; i++) ctx.fillRect(random() * 160, random() * 160, 1.5, 1.5);
    } else if (terrain === "sand") {
      ctx.fillStyle = accent.getStyle(); ctx.globalAlpha = 0.3;
      for (let i = 0; i < 260; i++) {
        const radius = .5 + random() * 1.6;
        ctx.beginPath(); ctx.arc(random() * 160, random() * 160, radius, 0, Math.PI * 2); ctx.fill();
      }
    } else if (terrain === "lava") {
      ctx.strokeStyle = highlight.getStyle(); ctx.globalAlpha = 0.58; ctx.lineWidth = 1.8;
      for (let i = 0; i < 16; i++) {
        let x = random() * 160, y = random() * 160;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let step = 0; step < 5; step++) { x += (random() - .35) * 17; y += (random() - .5) * 16; ctx.lineTo(x, y); }
        ctx.stroke();
      }
    } else { // stone
      ctx.fillStyle = accent.getStyle(); ctx.globalAlpha = 0.38;
      for (let i = 0; i < 48; i++) {
        const x = random() * 160, y = random() * 160, radius = 2 + random() * 5;
        ctx.beginPath(); ctx.moveTo(x + radius, y);
        for (let side = 1; side <= 6; side++) {
          const angle = (Math.PI * 2 * side) / 6;
          ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius * .7);
        }
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3.5, 3.5);
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    this.terrainTextures.set(terrain, texture);
    return texture;
  }

  private edgeAnchor(a: Vec3, b: Vec3) {
    const p = new THREE.Vector3(a[0] + b[0], a[1] + b[1], a[2] + b[2]).normalize().multiplyScalar(R * 1.035);
    const icon = new THREE.Group();
    icon.position.copy(p);
    icon.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p.clone().normalize());
    this.group.add(icon);
    return icon;
  }

  private addTinyPerson(group: THREE.Group, x: number, z: number, outfit: number, skin = 0xffd1a4) {
    const person = makePerson(outfit, skin);
    person.position.set(x,0,z);
    group.add(person);
  }

  // Every pair of terrains has a tiny border story. They are scaled as small
  // figures seen from afar, so the planet reads as a world rather than a toy
  // shelf full of oversized characters.
  private addBorderStory(story: BorderStory, a: Vec3, b: Vec3) {
    const icon = this.edgeAnchor(a, b);
    const scene = new THREE.Group();
    const [c1, c2, c3] = story.colors;
    const mesh = (geometry: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0) => {
      const object = new THREE.Mesh(geometry, this.detailMaterial(color));
      object.position.set(x, y, z);
      scene.add(object);
      return object;
    };
    const fish = (x: number, y: number) => {
      const object = mesh(new THREE.SphereGeometry(0.3, 8, 6), c2, x, y, 0.2);
      object.scale.set(1.65, 0.62, 0.55);
    };

    switch (story.id) {
      case "fishing": {
        this.addTinyPerson(scene, -1.05, 0, c1);
        scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.78, 0.82, 0), new THREE.Vector3(1.32, 1.62, 0), new THREE.Vector3(1.58, 0.38, 0)]), new THREE.LineBasicMaterial({ color: c3 })));
        fish(1.05, 0.25); fish(1.65, 0.5);
        break;
      }
      case "beachDay": {
        mesh(new THREE.BoxGeometry(1.55, 0.08, 0.92), c1, -0.45, 0.07, 0);
        for (const x of [0.65, 1.05]) mesh(new THREE.CylinderGeometry(0.19, 0.22, 0.72, 6), c2, x, 0.36, 0);
        mesh(new THREE.ConeGeometry(0.26, 0.3, 5), c2, 0.65, 0.87, 0);
        this.addTinyPerson(scene, -0.68, 0.1, c3);
        break;
      }
      case "firewatch": {
        this.addTinyPerson(scene, -0.72, 0, c3);
        mesh(new THREE.ConeGeometry(0.38, 0.9, 7), c2, 0.62, 0.45, 0);
        mesh(new THREE.SphereGeometry(0.24, 8, 6), c1, 0.62, 0.85, 0);
        break;
      }
      case "trailhead": {
        this.addTinyPerson(scene, -0.74, 0, c1);
        const goat = mesh(new THREE.SphereGeometry(0.36, 8, 6), c2, 0.58, 0.37, 0);
        goat.scale.set(1.45, 0.72, 0.72);
        mesh(new THREE.ConeGeometry(0.18, 0.42, 5), c3, 0.9, 0.78, 0);
        break;
      }
      case "tidepool": {
        mesh(new THREE.TorusGeometry(0.72, 0.09, 6, 14), c1, 0, 0.11, 0).rotation.x = Math.PI / 2;
        const crab = mesh(new THREE.SphereGeometry(0.28, 8, 6), c2, 0.1, 0.36, 0);
        crab.scale.set(1.45, 0.65, 0.8);
        for (const x of [-0.26, 0.36]) mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 5), c2, x, 0.22, 0);
        break;
      }
      case "steam": {
        for (const [x, y, size] of [[-0.42, 0.72, 0.34], [0.08, 1.2, 0.48], [0.56, 1.62, 0.3]] as [number, number, number][]) {
          mesh(new THREE.SphereGeometry(size, 10, 8), c1, x, y, 0).scale.set(1.2, 0.8, 0.8);
        }
        mesh(new THREE.DodecahedronGeometry(0.34), c2, -0.18, 0.25, 0);
        break;
      }
      case "waterfall": {
        mesh(new THREE.CylinderGeometry(0.48, 0.6, 1.5, 7), c2, 0, 0.75, 0);
        mesh(new THREE.BoxGeometry(0.52, 1.3, 0.12), c1, 0.15, 0.7, 0.47);
        for (const x of [-0.45, 0.45]) mesh(new THREE.DodecahedronGeometry(0.32), c2, x, 0.2, 0);
        break;
      }
      case "glassworks": {
        this.addTinyPerson(scene, -0.72, 0, c1);
        mesh(new THREE.DodecahedronGeometry(0.38), c3, 0.52, 0.44, 0);
        mesh(new THREE.SphereGeometry(0.22, 8, 6), c2, 0.52, 0.93, 0);
        break;
      }
      case "duneclimb": {
        mesh(new THREE.BoxGeometry(1.22, 0.38, 0.7), c3, 0, 0.42, 0);
        mesh(new THREE.BoxGeometry(0.62, 0.3, 0.56), c1, -0.12, 0.78, 0);
        for (const x of [-0.42, 0.42]) mesh(new THREE.TorusGeometry(0.19, 0.045, 6, 8), c2, x, 0.2, 0.34).rotation.x = Math.PI / 2;
        break;
      }
      default: { // forge
        mesh(new THREE.CylinderGeometry(0.65, 0.76, 0.35, 7), c2, 0, 0.18, 0);
        mesh(new THREE.SphereGeometry(0.36, 9, 7), c1, 0, 0.56, 0);
        mesh(new THREE.ConeGeometry(0.27, 0.62, 5), c3, 0, 0.98, 0);
        this.addTinyPerson(scene, -0.92, 0, c2);
      }
    }
    scene.scale.setScalar(3.6);
    icon.add(scene);
    this.animatedDetails.push({ object: scene, base: scene.position.clone(), baseScale: scene.scale.clone(), baseRotation: scene.rotation.clone(), phase: a[0] * 0.41 + b[1] * 0.67, amount: 0.34, motion: story.motion });
  }

  private addTerrainDetail(detail: EcosystemDetail, face: number[], verts: number[][], slot: number, count: number) {
    const normal = new THREE.Vector3();
    for (const index of face) normal.add(new THREE.Vector3(verts[index][0], verts[index][1], verts[index][2]));
    normal.normalize();
    const anchor = new THREE.Group();
    anchor.position.copy(normal).multiplyScalar(R + .6);
    anchor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    // Spread multiple discoveries across the joined habitat, rather than piling
    // them at its centre. The deterministic phase keeps a saved world stable.
    const phase = (slot + 1) * 2.399 + face[0] * 0.617;
    const spread = Math.min(3, 1 + count * .15);
    anchor.rotateY(phase);
    this.group.add(anchor);

    const model = this.toyModels.get(`detail:${detail.id}`,()=>heroModel(detail) ?? bakeToy(this.makeTerrainModel(detail))).clone(true);
    // People are the emotional focus of Tiny World, so they intentionally
    // break the old miniature scale. Other discoveries grow too, preserving
    // a coherent toy-world silhouette instead of isolated giant characters.
    const scale = detail.motif === "people" ? 5.8 : detail.motif === "animal" || detail.motif === "waterlife" ? 6.2 : 5.2;
    model.scale.setScalar(scale);
    const airborne = detail.motif === "flying" || detail.motif === "weather";
    model.position.set(Math.cos(phase * 1.7) * spread, airborne ? 10 : .2, Math.sin(phase * 1.7) * spread * .6);
    model.rotation.y = phase * 0.8;
    anchor.add(model);
    this.addContactShadow(anchor, scale * 1.4);
    this.animatedDetails.push({ object: model, base: model.position.clone(), baseScale: model.scale.clone(), baseRotation: model.rotation.clone(), phase, amount: 1.2 + (slot % 3) * .2, motion: detail.motion === "roll" && detail.motif === "vehicle" ? "walk" : detail.motion });
  }

  private detailMaterial(color: number, emissive = 0) {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.58, emissive, emissiveIntensity: emissive ? 0.35 : 0 });
  }

  // These are deliberately multi-part toy models, not emoji billboards. Their
  // silhouettes remain readable when they are only a few pixels tall on iPad.
  private makeTerrainModel(detail: EcosystemDetail): THREE.Group {
    const group = new THREE.Group();
    const [c1, c2 = c1, c3 = c2] = detail.colors;
    const add = (geometry: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, scale?: [number, number, number]) => {
      const mesh = new THREE.Mesh(geometry, this.detailMaterial(color));
      mesh.position.set(x, y, z);
      if (scale) mesh.scale.set(...scale);
      group.add(mesh);
      return mesh;
    };
    const sphere = (color: number, x = 0, y = 0, z = 0, scale: [number, number, number] = [1, 1, 1]) => add(new THREE.SphereGeometry(0.72, 10, 8), color, x, y, z, scale);
    const cone = (color: number, x = 0, y = 0, z = 0, scale: [number, number, number] = [1, 1, 1]) => add(new THREE.ConeGeometry(0.62, 1.5, 7), color, x, y, z, scale);

    if (detail.id === "tumbleweed") {
      for (const angle of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
        const ring = add(new THREE.TorusGeometry(0.72, 0.08, 6, 12), c1, 0, 0.78, 0);
        ring.rotation.set(angle, angle * 0.7, 0.35);
      }
      sphere(c2, 0.15, 0.85, 0, [0.22, 0.22, 0.22]);
      return group;
    }
    if (detail.id === "kite" || detail.id === "firekite") {
      const diamond = add(new THREE.ConeGeometry(0.78, 1.35, 4), c1, 0, 1.15, 0, [1, 1, 0.12]);
      diamond.rotation.z = Math.PI / 4;
      const tail = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.45, 0.65, 0), new THREE.Vector3(-1.0, 0.1, 0), new THREE.Vector3(-0.55, -0.25, 0)]), new THREE.LineBasicMaterial({ color: c2 }));
      group.add(tail);
      sphere(c3, -1, 0.08, 0, [0.16, 0.16, 0.16]);
      return group;
    }
    if (detail.id === "bike") {
      for (const x of [-0.58, 0.58]) {
        const wheel = add(new THREE.TorusGeometry(0.4, 0.07, 6, 10), 0x263238, x, 0.42, 0, [1, 1, 0.3]);
        wheel.rotation.x = Math.PI / 2;
      }
      const frame = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.58, 0.42, 0), new THREE.Vector3(0, 1.0, 0), new THREE.Vector3(0.58, 0.42, 0), new THREE.Vector3(-0.58, 0.42, 0)]), new THREE.LineBasicMaterial({ color: c1 }));
      group.add(frame);
      sphere(c2, 0, 1.62, 0, [0.35, 0.35, 0.35]);
      return group;
    }
    if (detail.id === "castle") {
      for (const [x, h] of [[-0.52, 1.25], [0, 1.75], [0.52, 1.2]] as [number, number][]) {
        add(new THREE.CylinderGeometry(0.28, 0.32, h, 6), c1, x, h / 2, 0);
        cone(c2, x, h + 0.36, 0, [0.48, 0.5, 0.48]);
      }
      add(new THREE.BoxGeometry(1.45, 0.72, 0.55), c1, 0, 0.37, 0);
      return group;
    }
    if (detail.id === "whale") {
      sphere(c1, 0, 0.85, 0, [1.7, 0.72, 0.72]);
      const tail = cone(c2, -1.2, 0.92, 0, [0.75, 0.48, 0.2]);
      tail.rotation.z = -Math.PI / 2;
      const fin = cone(c2, 0.2, 1.3, -0.28, [0.35, 0.45, 0.15]);
      fin.rotation.z = 0.5;
      sphere(0x1f2937, 0.95, 1.05, 0.38, [0.1, 0.1, 0.1]);
      return group;
    }
    if (detail.id === "rocketbuoy" || detail.id === "launchpad" || detail.id === "flareRocket") {
      add(new THREE.CylinderGeometry(0.26, 0.34, 1.65, 8), c1, 0, 1.05, 0);
      cone(c2, 0, 2.02, 0, [0.44, 0.5, 0.44]);
      for (const x of [-0.28, 0.28]) {
        const fin = cone(c2, x, 0.6, 0, [0.26, 0.45, 0.2]);
        fin.rotation.z = x < 0 ? 0.5 : -0.5;
      }
      cone(0xffc857, 0, 0.05, 0, [0.28, 0.65, 0.28]).rotation.z = Math.PI;
      return group;
    }
    if (detail.id === "cablecar") {
      const cable = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.15, 2.0, 0), new THREE.Vector3(1.15, 2.0, 0)]), new THREE.LineBasicMaterial({ color: 0x33415c }));
      group.add(cable);
      add(new THREE.BoxGeometry(0.9, 0.62, 0.65), c1, 0.18, 1.25, 0);
      add(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 5), c2, 0.18, 1.68, 0);
      return group;
    }

    // The early discoveries get their own small cast. These layered clusters
    // make a grown habitat feel busier before its larger landmarks unlock.
    if (detail.id === "walkers" || detail.id === "climbers") {
      this.addTinyPerson(group, -0.52, 0.12, c1);
      this.addTinyPerson(group, 0.16, -0.08, c2, c3);
      this.addTinyPerson(group, 0.72, 0.16, c3, c2);
      return group;
    }
    if (detail.id === "dogs") {
      this.addTinyPerson(group, -0.5, 0, c2, 0xffd1a4);
      sphere(c1, 0.47, 0.3, 0, [0.72, 0.4, 0.42]);
      sphere(c1, 0.95, 0.48, 0, [0.27, 0.24, 0.24]);
      return group;
    }
    if (detail.id === "butterflies") {
      for (const [x, y, color] of [[-0.58, 0.82, c1], [0.05, 1.25, c2], [0.63, 0.66, c3]] as [number, number, number][]) {
        const wings = add(new THREE.SphereGeometry(0.34, 7, 6), color, x, y, 0, [1.35, 0.58, 0.2]);
        wings.rotation.z = x * 0.45;
        add(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 5), 0x28334a, x, y - 0.04, 0);
      }
      return group;
    }
    if (detail.id === "sheep") {
      for (const [x, size] of [[-0.55, 0.55], [0.08, 0.68], [0.68, 0.48]] as [number, number][]) {
        sphere(c1, x, size * 0.8, 0, [size, size * 0.62, size * 0.56]);
        sphere(c2, x + size * 0.55, size * 0.88, 0.22, [size * 0.28, size * 0.26, size * 0.25]);
      }
      return group;
    }
    if (detail.id === "flowers") {
      for (const [x, height, color] of [[-0.48, 1.2, c1], [0, 1.55, c2], [0.48, 1.05, c3]] as [number, number, number][]) {
        add(new THREE.CylinderGeometry(0.035, 0.05, height, 5), 0x4b8b57, x, height / 2, 0);
        for (let petal = 0; petal < 5; petal++) {
          const angle = (Math.PI * 2 * petal) / 5;
          sphere(color, x + Math.cos(angle) * 0.16, height + Math.sin(angle) * 0.16, 0, [0.16, 0.16, 0.1]);
        }
      }
      return group;
    }
    if (detail.id === "shoal") {
      for (const [x, y, size] of [[-0.62, 0.68, 0.44], [-0.18, 1.02, 0.34], [0.32, 0.58, 0.42], [0.72, 1.12, 0.27]] as [number, number, number][]) {
        sphere(c1, x, y, 0, [size * 1.55, size * 0.62, size * 0.55]);
        const tail = cone(c2, x - size * 0.62, y, 0, [size * 0.48, size * 0.48, size * 0.18]);
        tail.rotation.z = -Math.PI / 2;
      }
      return group;
    }
    if (detail.id === "ducks") {
      for (const [x, scale] of [[-0.38, 0.72], [0.36, 0.42], [0.72, 0.3]] as [number, number][]) {
        sphere(c1, x, 0.52, 0, [scale, scale * 0.45, scale * 0.48]);
        sphere(c2, x + scale * 0.45, 0.7, 0, [scale * 0.3, scale * 0.26, scale * 0.28]);
      }
      return group;
    }
    if (detail.id === "turtle") {
      sphere(c1, 0, 0.72, 0, [1.15, 0.46, 0.78]);
      for (const [x, z] of [[-0.58, -0.48], [-0.58, 0.48], [0.55, -0.48], [0.55, 0.48]] as [number, number][]) sphere(c2, x, 0.58, z, [0.28, 0.12, 0.28]);
      sphere(c2, 0.9, 0.76, 0, [0.27, 0.2, 0.22]);
      return group;
    }
    if (detail.id === "seaplane") {
      sphere(c1, 0, 0.78, 0, [1.25, 0.32, 0.3]);
      add(new THREE.BoxGeometry(1.65, 0.06, 0.5), c2, 0, 0.8, 0);
      add(new THREE.BoxGeometry(0.45, 0.08, 0.85), c2, -0.64, 0.91, 0);
      for (const z of [-0.34, 0.34]) add(new THREE.CylinderGeometry(0.05, 0.05, 0.85, 5), c3, -0.18, 0.32, z).rotation.z = Math.PI / 2;
      return group;
    }
    if (detail.id === "crabs") {
      for (const [x, size] of [[-0.5, 0.46], [0.12, 0.62], [0.68, 0.36]] as [number, number][]) {
        sphere(c1, x, size * 0.64, 0, [size, size * 0.42, size * 0.55]);
        for (const dx of [-1, 1]) add(new THREE.CylinderGeometry(0.025, 0.025, size * 0.54, 5), c2, x + dx * size * 0.45, size * 0.34, 0).rotation.z = dx * 0.8;
      }
      return group;
    }
    if (detail.id === "salamander") {
      sphere(c1, 0, 0.48, 0, [1.35, 0.38, 0.42]);
      sphere(c2, 0.92, 0.6, 0, [0.35, 0.28, 0.28]);
      const tail = cone(c2, -1.0, 0.47, 0, [0.48, 0.28, 0.16]);
      tail.rotation.z = -Math.PI / 2;
      for (const x of [-0.38, 0.35]) sphere(c2, x, 0.22, 0.36, [0.18, 0.08, 0.16]);
      return group;
    }
    if (detail.id === "train") {
      add(new THREE.BoxGeometry(1.32, 0.55, 0.7), c1, 0, 0.6, 0);
      add(new THREE.BoxGeometry(0.52, 0.58, 0.64), c2, -0.32, 1.13, 0);
      for (const x of [-0.42, 0.42]) sphere(0x303846, x, 0.24, 0.38, [0.2, 0.2, 0.2]);
      sphere(c3, 0.68, 0.67, 0, [0.12, 0.12, 0.12]);
      return group;
    }
    if (detail.id === "meteor") {
      sphere(c1, 0.45, 1.05, 0, [0.43, 0.43, 0.43]);
      for (let i = 0; i < 4; i++) {
        const trail = cone(i % 2 ? c2 : c1, -0.1 - i * 0.36, 0.9 - i * 0.18, 0, [0.19, 0.48, 0.16]);
        trail.rotation.z = -Math.PI / 2;
      }
      return group;
    }

    if (detail.motif === "people") {
      for (const x of [-0.55, 0.55]) {
        cone(c1, x, 0.82, 0, [0.58, 0.85, 0.5]);
        sphere(c2, x, 1.7, 0, [0.44, 0.44, 0.44]);
        add(new THREE.CylinderGeometry(0.08, 0.08, 0.95, 5), c3, x + 0.42, 1.05, 0);
      }
    } else if (detail.motif === "animal") {
      sphere(c1, 0, 0.72, 0, [1.35, 0.7, 0.68]);
      sphere(c2, 0.88, 0.96, 0, [0.58, 0.56, 0.55]);
      for (const x of [-0.55, 0.45]) add(new THREE.CylinderGeometry(0.08, 0.1, 0.62, 5), c3, x, 0.2, 0.3);
      sphere(0x1f2937, 1.13, 1.08, 0.33, [0.11, 0.11, 0.11]);
    } else if (detail.motif === "plant") {
      add(new THREE.CylinderGeometry(0.11, 0.16, 1.65, 6), c2, 0, 0.82, 0);
      for (let i = 0; i < 4; i++) {
        const leaf = cone(c1, 0, 1.6, 0, [0.5, 0.7, 0.28]);
        leaf.rotation.z = (Math.PI * 2 * i) / 4 + 0.55;
        leaf.position.x = Math.cos((Math.PI * 2 * i) / 4) * 0.42;
        leaf.position.z = Math.sin((Math.PI * 2 * i) / 4) * 0.42;
      }
      sphere(c3, 0, 1.95, 0, [0.42, 0.42, 0.42]);
    } else if (detail.motif === "vehicle") {
      if (detail.id === "sailboat") {
        add(new THREE.BoxGeometry(1.85, 0.38, 0.7), c1, 0, 0.45, 0);
        add(new THREE.CylinderGeometry(0.06, 0.06, 2.1, 6), c2, 0, 1.5, 0);
        const sail = add(new THREE.ConeGeometry(0.75, 1.4, 3), c2, 0.38, 1.65, 0, [1, 1, 0.12]);
        sail.rotation.z = -Math.PI / 2;
      } else if (detail.id === "submarine") {
        sphere(c1, 0, 0.65, 0, [1.45, 0.58, 0.58]);
        add(new THREE.CylinderGeometry(0.07, 0.07, 0.75, 6), c2, 0, 1.28, 0);
        sphere(c2, 0, 1.65, 0, [0.23, 0.23, 0.23]);
      } else {
        add(new THREE.BoxGeometry(1.65, 0.52, 0.88), c1, 0, 0.55, 0);
        add(new THREE.BoxGeometry(0.78, 0.42, 0.78), c2, -0.18, 1.0, 0);
        for (const x of [-0.55, 0.55]) sphere(0x293241, x, 0.28, 0.45, [0.28, 0.28, 0.28]);
      }
    } else if (detail.motif === "flying") {
      const wing = add(new THREE.ConeGeometry(0.82, 1.75, 3), c1, 0, 0.95, 0, [1.2, 0.4, 0.9]);
      wing.rotation.z = Math.PI / 2;
      sphere(c2, 0.58, 1.0, 0, [0.42, 0.42, 0.42]);
      add(new THREE.CylinderGeometry(0.08, 0.08, 1.1, 5), c3, -0.85, 0.9, 0).rotation.z = Math.PI / 2;
    } else if (detail.motif === "waterlife") {
      sphere(c1, 0, 0.8, 0, [1.4, 0.6, 0.55]);
      const tail = cone(c2, -0.95, 0.8, 0, [0.55, 0.55, 0.25]);
      tail.rotation.z = -Math.PI / 2;
      sphere(0x1f2937, 0.72, 0.96, 0.33, [0.1, 0.1, 0.1]);
      if (detail.id === "jellyfish") for (const x of [-0.35, 0, 0.35]) add(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 5), c2, x, 0.18, 0);
    } else if (detail.motif === "rocklife") {
      add(new THREE.DodecahedronGeometry(0.8, 0), c1, 0, 0.7, 0, [1.25, 0.85, 0.85]);
      sphere(c2, 0.48, 0.92, 0.43, [0.15, 0.15, 0.15]);
      sphere(c2, 0.72, 0.92, 0.35, [0.15, 0.15, 0.15]);
    } else if (detail.motif === "weather") {
      for (const [x, y, scale] of [[-0.45, 0.7, 0.55], [0, 1.05, 0.75], [0.5, 0.72, 0.52]] as [number, number, number][]) sphere(c1, x, y, 0, [scale, scale, scale]);
      for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.04, 0.04, 0.65, 5), c2, -0.28 + i * 0.28, 0.08, 0);
    } else if (detail.motif === "landmark") {
      for (let i = 0; i < 3; i++) {
        const crystal = cone(i === 1 ? c2 : c1, (i - 1) * 0.48, 0.75 + (i === 1 ? 0.28 : 0), 0, [0.55, 1.25, 0.55]);
        crystal.rotation.z = (i - 1) * 0.18;
      }
      add(new THREE.CylinderGeometry(0.82, 0.98, 0.25, 7), c3, 0, 0.12, 0);
    } else { // spark
      for (let i = 0; i < 5; i++) sphere(i % 2 ? c2 : c1, Math.cos(i * 1.26) * 0.68, 0.72 + Math.sin(i * 1.26) * 0.35, Math.sin(i * 1.26) * 0.2, [0.21, 0.21, 0.21]);
      sphere(c3, 0, 0.9, 0, [0.32, 0.32, 0.32]);
    }
    return group;
  }

  // Fan/ear-clip a face and project each triangle onto the sphere so panels
  // curve out to the ball surface. Tiny World expands every shared graph edge
  // into the same deterministic soft coastline before triangulating, so the
  // visual boundary is curved while each original region stays editable.
  private faceMesh(verts: Vec3[], face: number[]): number[] {
    const out: number[] = [];
    const organic = this.worldStyle === "tiny" || this.worldStyle === "jelly";
    const {points,triangles} = triangulateRegion(verts,face,organic ? (a,b)=>this.organicEdge(verts[a],verts[b],a,b) : undefined);
    for (const [a, b, c] of triangles) {
      this.subTri(onSphere(points[a], R), onSphere(points[b], R), onSphere(points[c], R), this.worldStyle === "jelly" ? 3 : 2, out);
    }
    return out;
  }

  private organicEdge(a: Vec3, b: Vec3, aIndex: number, bIndex: number): Vec3[] {
    const id = aIndex<bIndex?`${aIndex},${bIndex}`:`${bIndex},${aIndex}`;
    if(this.exactEdges.has(id)) return [a,b];
    const lowIndex = Math.min(aIndex, bIndex);
    const highIndex = Math.max(aIndex, bIndex);
    const start = normalize(aIndex === lowIndex ? a : b);
    const end = normalize(aIndex === lowIndex ? b : a);
    const cosine = Math.max(-1, Math.min(1, dot(start, end)));
    const angle = Math.acos(cosine);
    if (angle < 1e-5) return [a, b];

    const side = normalize(cross(start, end));
    const random = seededRandom((lowIndex * 73856093) ^ (highIndex * 19349663));
    const phase = random() * Math.PI * 2;
    const amplitude = Math.min(0.018, angle * 0.16);
    const segments = Math.max(4, Math.ceil(angle / 0.035));
    const canonical: Vec3[] = [];
    const sine = Math.sin(angle);
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const fromStart = Math.sin((1 - t) * angle) / sine;
      const fromEnd = Math.sin(t * angle) / sine;
      const base = normalize([
        start[0] * fromStart + end[0] * fromEnd,
        start[1] * fromStart + end[1] * fromEnd,
        start[2] * fromStart + end[2] * fromEnd,
      ]);
      const wave = Math.sin(Math.PI * t) * (0.72 + 0.28 * Math.sin(Math.PI * 2 * t + phase));
      const offset = wave * amplitude;
      const p = normalize([
        base[0] * Math.cos(offset) + side[0] * Math.sin(offset),
        base[1] * Math.cos(offset) + side[1] * Math.sin(offset),
        base[2] * Math.cos(offset) + side[2] * Math.sin(offset),
      ]);
      canonical.push([p[0] * R, p[1] * R, p[2] * R]);
    }
    return aIndex === lowIndex ? canonical : canonical.reverse();
  }

  private subTri(p0: Vec3, p1: Vec3, p2: Vec3, depth: number, out: number[]) {
    if (depth <= 0) {
      // Face extraction can return either winding. Always point the rendered
      // triangle away from the planet so double-sided lighting cannot create
      // accidental dark polygon patches inside one ecosystem.
      const facesOutward = dot(cross(sub(p1, p0), sub(p2, p0)), [p0[0] + p1[0] + p2[0], p0[1] + p1[1] + p2[1], p0[2] + p1[2] + p2[2]]) >= 0;
      if (facesOutward) out.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
      else out.push(p0[0], p0[1], p0[2], p2[0], p2[1], p2[2], p1[0], p1[1], p1[2]);
      return;
    }
    const mid = (a: Vec3, b: Vec3): Vec3 => onSphere([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], R);
    const m01 = mid(p0, p1), m12 = mid(p1, p2), m20 = mid(p2, p0);
    this.subTri(p0, m01, m20, depth - 1, out);
    this.subTri(m01, p1, m12, depth - 1, out);
    this.subTri(m20, m12, p2, depth - 1, out);
    this.subTri(m01, m12, m20, depth - 1, out);
  }

  // ---- drawing --------------------------------------------------------------
  private setNdc(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }

  private raySphere(): Vec3 | null {
    const o = this.raycaster.ray.origin, d = this.raycaster.ray.direction;
    const b = 2 * (o.x * d.x + o.y * d.y + o.z * d.z);
    const c = o.x * o.x + o.y * o.y + o.z * o.z - R * R;
    const disc = b * b - 4 * c;
    if (disc < 0) return null;
    const t = (-b - Math.sqrt(disc)) / 2;
    const p: Vec3 = [o.x + d.x * t, o.y + d.y * t, o.z + d.z * t];
    return onSphere(p, R);
  }

  private onDown(e: PointerEvent) {
    if (this.tool === "move") return; // let OrbitControls handle it
    if (this.pendingWorker) return;
    this.setNdc(e);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    if (this.tool === "paint") {
      const hit = this.raycaster.intersectObjects(this.panelMeshes, false)[0];
      if (hit?.object.userData.faceKey) {
        e.preventDefault();
        if(this.paintByFace.get(hit.object.userData.faceKey) === this.selectedPaint) {
          if (this.worldStyle === "jelly") this.triggerJellyImpact(hit.point, 0.85);
          return;
        }
        this.history.push(this.editState());
        const keys = paintRegion(this.graph,this.paintByFace,hit.object.userData.faceKey);
        keys.forEach(key=>this.paintByFace.set(key,this.selectedPaint));
        if (this.worldStyle === "jelly") this.triggerJellyImpact(hit.point, 0.85);
        this.render();
      }
      return;
    }
    const p = this.raySphere();
    if (!p) return; // off the ball → let orbit handle it
    e.preventDefault();
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.activePointerId = e.pointerId;
    this.drawing = true;
    this.strokePts = [p];
    if(this.tool==="draw") {
      this.snapEdges=visibleSnapEdges(this.graph,this.paintByFace);
      const start=nearbyBorder([...normalize(p)],this.graph,this.snapEdges,q=>this.projectSnapPoint(q));
      if(start)this.strokePts=[onSphere([start[0],start[1],start[2]],R)];
    }
    this.strokeStart.set(e.clientX,e.clientY);
    const height = this.renderer.domElement.getBoundingClientRect().height;
    const distance = this.camera.position.distanceTo(new THREE.Vector3(...p));
    this.strokeStep = THREE.MathUtils.clamp(distance * 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov/2)) / height / R * 1.5,.0005,.008);
    this.brushRadius=THREE.MathUtils.clamp(this.strokeStep/1.5*this.brushWidth/2,.003,.12);
    this.controls.enabled = false;
    this.updatePreview();
  }

  private cancelStroke() {
    const id=this.activePointerId;
    this.activePointerId=undefined;
    this.drawing=false;
    this.strokePts=[];
    this.removePreview();
    this.controls.enabled=true;
    if(id !== undefined && this.renderer.domElement.hasPointerCapture(id)) this.renderer.domElement.releasePointerCapture(id);
  }

  private onMove(e: PointerEvent) {
    if (!this.drawing || e.pointerId !== this.activePointerId) return;
    let changed = false;
    const coalesced = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
    const samples = coalesced.length ? coalesced : [e];
    for (const sample of samples) changed = this.captureStrokePoint(sample) || changed;
    if (changed) this.updatePreview();
  }

  private captureStrokePoint(e: PointerEvent): boolean {
    this.setNdc(e);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const p = this.raySphere();
    if(!p) return false;
    const last = this.strokePts[this.strokePts.length - 1];
    if (!last || len(sub(p, last)) > R * this.strokeStep) {
      this.strokePts.push(p);
      return true;
    }
    return false;
  }

  private onUp(e: PointerEvent, cancelled = false) {
    if (!this.drawing || e.pointerId !== this.activePointerId) return;
    if(!cancelled) this.captureStrokePoint(e);
    this.drawing = false;
    this.activePointerId = undefined;
    if (this.renderer.domElement.hasPointerCapture(e.pointerId)) this.renderer.domElement.releasePointerCapture(e.pointerId);
    this.controls.enabled = true;
    const pts = this.strokePts.map((p) => [...normalize(p)]);
    const close = this.tool==="draw" && shouldCloseBorder(pts,q=>this.projectSnapPoint(q));
    if(this.tool==="draw" && !close && pts.length>1) {
      const end=nearbyBorder(pts.at(-1)!,this.graph,this.snapEdges,q=>this.projectSnapPoint(q));
      if(end)pts[pts.length-1]=end;
    }
    this.strokePts = [];
    if (cancelled || pts.length < (this.tool==="brush"?1:2)) {this.removePreview();return;}
    const request:EditRequest={graph:this.graph,paints:Object.fromEntries(this.paintByFace),points:pts,close,step:this.strokeStep,paint:this.selectedPaint,brushRadius:this.tool==="brush"?this.brushRadius:undefined};
    try {
      const worker=new Worker(new URL("../world/editWorker.ts",import.meta.url),{type:"module"});
      this.pendingWorker=worker;
      this.container.dispatchEvent(new CustomEvent("world-processing",{detail:"Incorporando trazo…"}));
      const fail=(message:string)=>{if(this.pendingWorker!==worker)return;this.cancelPendingEdit();this.container.dispatchEvent(new CustomEvent("world-processing",{detail:message}));};
      worker.onerror=()=>fail("No se pudo incorporar el trazo. Tu mundo sigue intacto.");
      worker.onmessage=(event:MessageEvent<{edit?:BorderEdit;error?:string}>)=>{
        if(this.pendingWorker!==worker)return;
        if(!event.data.edit){fail("No se pudo incorporar el trazo. Probá uno más corto.");return;}
        this.history.push(this.editState());
        const edited=event.data.edit;
        this.graph=edited.graph;this.paintByFace=new Map(Object.entries(edited.paints) as [string,PaintKind][]);
        this.cancelPendingEdit();
        try {this.render();} catch {this.container.dispatchEvent(new CustomEvent("world-processing",{detail:"No se pudo dibujar el cambio. Tu mundo anterior se conservó."}));}
        if(this.worldStyle==="jelly")this.triggerJellyImpact(new THREE.Vector3().fromArray(pts[pts.length-1]),1.15);
      };
      worker.postMessage(request);
    } catch {this.cancelPendingEdit();this.container.dispatchEvent(new CustomEvent("world-processing",{detail:"No se pudo iniciar el trazo. Tu mundo sigue intacto."}));}
  }

  private cancelPendingEdit() {
    this.pendingWorker?.terminate();this.pendingWorker=undefined;this.removePreview();
    this.container.dispatchEvent(new CustomEvent("world-processing",{detail:""}));
  }

  private updatePreview() {
    if(this.tool==="brush") {
      const pos:number[]=[], radius=this.brushRadius;
      const rings=this.strokePts.map(raw=>{
        const n=new THREE.Vector3(...raw).normalize();
        const side=new THREE.Vector3(Math.abs(n.x)<.9?1:0,Math.abs(n.x)<.9?0:1,0).cross(n).normalize();
        const up=n.clone().cross(side);
        const ring=Array.from({length:16},(_,i)=>n.clone().multiplyScalar(Math.cos(radius)).addScaledVector(side,Math.sin(radius)*Math.cos(i*Math.PI/8)).addScaledVector(up,Math.sin(radius)*Math.sin(i*Math.PI/8)).multiplyScalar(R+.7));
        for(let i=0;i<16;i++)pos.push(...n.clone().multiplyScalar(R+.7).toArray(),...ring[i].toArray(),...ring[(i+1)%16].toArray());
        return n;
      });
      for(let i=1;i<rings.length;i++) {
        const a=rings[i-1],b=rings[i],side=a.clone().cross(b).normalize();
        const corner=(p:THREE.Vector3,s:number)=>p.clone().multiplyScalar(Math.cos(radius)).addScaledVector(side,s*Math.sin(radius)).multiplyScalar(R+.7).toArray();
        const al=corner(a,1),ar=corner(a,-1),bl=corner(b,1),br=corner(b,-1);
        pos.push(...al,...ar,...bl,...ar,...br,...bl);
      }
      if(!this.preview){this.preview=new THREE.Mesh(new THREE.BufferGeometry(),this.brushPreviewMaterial);this.preview.renderOrder=999;this.scene.add(this.preview);}
      this.brushPreviewMaterial.color.setHex(PAINT_COLORS[this.selectedPaint]);
      this.preview.geometry.dispose();this.preview.geometry=new THREE.BufferGeometry();
      this.preview.geometry.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
      return;
    }
    if (this.strokePts.length < 2) return;
    const pos: number[] = [];
    for (const q of this.strokePts) { const p = onSphere(q, R * 1.002); pos.push(p[0], p[1], p[2]); }
    if (!this.preview) {
      this.preview = new THREE.Line(new THREE.BufferGeometry(), this.previewMaterial);
      this.preview.renderOrder = 999;
      this.scene.add(this.preview);
    }
    this.preview.geometry.dispose();this.preview.geometry=new THREE.BufferGeometry();
    this.preview.geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    this.preview.geometry.computeBoundingSphere();
    this.updateSnapGuide();
  }
  private projectSnapPoint(point:number[]) {
    const world=new THREE.Vector3(...point).normalize().multiplyScalar(R);
    if(world.dot(this.camera.position.clone().sub(world))<=0)return;
    const projected=world.project(this.camera),rect=this.renderer.domElement.getBoundingClientRect();
    return {x:(projected.x+1)*rect.width/2,y:(1-projected.y)*rect.height/2};
  }
  private clearSnapGuide() {
    if(!this.snapGuide)return;
    this.scene.remove(this.snapGuide);disposeExcept(this.snapGuide);this.snapGuide=undefined;
  }
  private updateSnapGuide() {
    this.clearSnapGuide();
    const points=this.strokePts.map(p=>[...normalize(p)]),last=points.at(-1);
    if(!last)return;
    const target=shouldCloseBorder(points,q=>this.projectSnapPoint(q))?points[0]:nearbyBorder(last,this.graph,this.snapEdges,q=>this.projectSnapPoint(q));
    if(!target)return;
    const group=new THREE.Group(),a=new THREE.Vector3(...last),b=new THREE.Vector3(...target);
    const bridge=Array.from({length:13},(_,i)=>a.clone().lerp(b,i/12).normalize().multiplyScalar(R*1.004));
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(bridge),new THREE.LineDashedMaterial({color:0xffdd65,dashSize:1,gapSize:.7,depthTest:false}));
    line.computeLineDistances();line.renderOrder=1000;group.add(line);
    const marker=new THREE.Mesh(new THREE.RingGeometry(1.2,1.8,24),new THREE.MeshBasicMaterial({color:0xffdd65,side:THREE.DoubleSide,depthTest:false}));
    marker.position.copy(b).multiplyScalar(R*1.005);marker.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),b);marker.renderOrder=1001;group.add(marker);
    this.snapGuide=group;this.scene.add(group);
  }
  private removePreview() { this.clearSnapGuide();if (this.preview) { this.scene.remove(this.preview); this.preview.geometry.dispose(); this.preview = undefined; } }

  private onResize() {
    // The browser may expose a high-density backing-store width through
    // clientWidth. Layout bounds are always CSS pixels, which is what the
    // camera aspect ratio and the visible canvas need.
    const bounds = this.container.getBoundingClientRect();
    const w = Math.max(1, bounds.width), h = Math.max(1, bounds.height);
    const oldDistance = this.framingDistance();
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h || 1;
    this.camera.updateProjectionMatrix();
    const newDistance = this.framingDistance();
    this.camera.position.multiplyScalar(newDistance / oldDistance);
    this.controls.maxDistance = Math.max(R*4.5,newDistance*1.25);
    this.controls.update();
  }

  private animate = () => {
    requestAnimationFrame(this.animate);
    const t = performance.now() / 1000;
    this.waterTime.value = t;
    const dt = Math.min(0.05, Math.max(0.001, t - this.lastAnimationTime / 1000));
    this.lastAnimationTime = t * 1000;
    const remaining = this.wobbleUntil - performance.now();
    if (this.worldStyle === "jelly") {
      // A damped spring supplies the large soft-body response; the shader
      // handles the quick local ripple so the entire ball never moves as one
      // rigid, uniformly-scaled object.
      this.jellySquashVelocity += (-22 * this.jellySquash - 6.2 * this.jellySquashVelocity) * dt;
      this.jellySquashVelocity = THREE.MathUtils.clamp(this.jellySquashVelocity, -4.5, 4.5);
      this.jellySquash = THREE.MathUtils.clamp(this.jellySquash + this.jellySquashVelocity * dt, -0.11, 0.11);
      if (remaining <= 0 && Math.abs(this.jellySquash) < 0.0003) { this.jellySquash = 0; this.jellySquashVelocity = 0; }
      const settlePulse = remaining > 0 ? Math.sin(remaining * 0.018) * (remaining / 760) * 0.013 : 0;
      const squash = this.jellySquash * 0.04 + settlePulse;
      this.group.scale.set(1 + squash, 1 - squash * 0.72, 1 + squash * 0.46);
      for (const shader of this.jellyShaders) {
        shader.uniforms.jellyTime.value = t;
        shader.uniforms.jellyImpactTime.value = this.jellyImpactAt;
        shader.uniforms.jellyImpactEnergy.value = this.jellyImpactEnergy;
      }
      this.jellyImpactEnergy *= Math.exp(-dt * 0.85);
    } else {
      this.group.scale.setScalar(1);
    }
    this.stars.rotation.y = t * 0.008;
    for (const detail of this.animatedDetails) this.behaviourEngine.update(detail, { time: t });
    if(!this.drawing) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
