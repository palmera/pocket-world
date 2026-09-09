import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerRouting, spaceCanControlCamera, type InputMode } from "./pointerRouting";
import { nearbyBorder, shouldCloseBorder, visibleSnapEdges } from "./borderSnap";
import { planPopulation } from "../world/population";
import { PopulationSpace } from "../world/population";
import { advanceLivingWorld, createLivingState, livingStage, recordWorldEdit, type LivingState } from "../world/livingWorld";
import { applyReliefStroke, createReliefSampler, sanitizeRelief, RELIEF_LIMITS, type ReliefMode, type ReliefStamp } from "../world/relief";
import { createReliefFeature, animateReliefFeature, selectReliefFeatures, refineReliefMesh } from "./reliefArt";
import { ecosystemForTerrain } from "../world/contentPacks";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { strategyModel, naturalSceneryModel } from "./worldArt";
import { disposeExcept, FrameCache, joinFloat32 } from "./renderResources";
import { createJellyMeniscus } from "./jellyMeniscus";
import { Vec3, normalize, sub, dot, cross, len, onSphere } from "../engine/geometry/vec";
import { extractSphereFaces } from "../engine/freestyle/sphereGraph";
import { type FreeGraph } from "../engine/freestyle/freestyleGraph";
import { regionContainsPoint, triangulateRegion } from "../engine/freestyle/sphereRegions";
import type { BorderEdit } from "../world/drawBorder";
import type { EditRequest } from "../world/editWorker";
import { paintRegion } from "../world/paintRegion";
import { WORLD_SAVE_VERSION, shouldSeedLegacyWorld } from "../world/saveFormat";
import { History } from "../engine/editor/history";
import { borderStoryFor, type BorderStory, type EcosystemDetail } from "../world/ecosystems";
import { findTerrainBorderContacts, isTerrain, panelKey as faceKey } from "../world/habitats";
import { createRandomWorld } from "../world/randomWorld";
import { createBasicBehaviourEngine, type AnimatedDetail, type BehaviourEngine } from "../world/behaviours";

export type KidTool = "draw" | "paint" | "brush" | "move" | "relief";
export type Biome = "meadow" | "water" | "sand" | "lava" | "stone" | "forest" | "wetland" | "snow";
export type WorldStyle = "blank" | "doodle" | "jelly" | "tiny";
export type PaintKind = Biome | "red-crayon" | "blue-crayon" | "yellow-crayon" | "purple-crayon" | "green-crayon" | "strawberry" | "blueberry" | "lemon" | "grape" | "lime" | "charcoal" | "sky" | "sun" | "rose" | "mint";

// Bright, kid-friendly palette used for the always-correct map colouring.
export const KID_PALETTE = [
  0xff6b57, 0xffc24b, 0x35a7ff, 0x9b5de5, 0x57c84d,
  0xff7bac, 0x2ec4b6, 0xfb8b24, 0x4d9de0, 0xf25f5c,
];

type JellyShader = { uniforms: Record<string, { value: unknown }> };
type EditState = { graph: FreeGraph; paints: Record<string,PaintKind>; relief?: ReliefStamp[] };
type LifeContext = {faces:number[][];edgeOwners:Map<string,{a:number;b:number;faces:number[]}>;vertsMm:Vec3[]};

const BIOME_COLORS: Record<Biome, number> = {
  meadow: 0x788653,
  water: 0x356b75,
  sand: 0xbfa573,
  lava: 0x69534a,
  stone: 0x82867b,
  forest: 0x405d46,
  wetland: 0x5d7c6d,
  snow: 0xc3c9c4,
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
  private living: LivingState = createLivingState();
  private relief: ReliefStamp[] = [];
  private reliefMode: ReliefMode = "raise";
  private reliefSize = 80;
  private reliefStrength = 2.5;
  private reliefSampler = createReliefSampler([]);
  private lifeGroup = new THREE.Group();
  private lifeContext?: LifeContext;
  private evolutionDirty = false;
  private progressTick = 0;
  private weatherDetails: THREE.Group[] = [];
  private reducedMotion = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    this.scene.add(new THREE.HemisphereLight(0xe7e9d9, 0x424b56, 1.05));
    const key = new THREE.DirectionalLight(0xffecd0, 2.0);
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
  setReliefMode(mode:ReliefMode) {this.reliefMode=mode;}
  setReliefSize(size:number) {this.reliefSize=THREE.MathUtils.clamp(size,32,160);}
  setReliefStrength(strength:number) {this.reliefStrength=THREE.MathUtils.clamp(strength,.5,5);}
  getLivingState():LivingState {return structuredClone(this.living);}
  setWorldSpeed(speed:0|1|3) {this.living.speed=speed;this.notifyLiving();}
  setLifeDensity(density:LivingState["density"]) {this.living.density=density;this.evolutionDirty=true;this.notifyLiving();}
  private notifyLiving() {this.container?.dispatchEvent(new CustomEvent("world-living",{detail:this.getLivingState()}));}
  private completeWorldEdit() {if(recordWorldEdit(this.living).length)this.evolutionDirty=true;this.notifyLiving();this.onChange?.();}
  setBehaviourEngine(engine: BehaviourEngine) { this.behaviourEngine = engine; }
  getWorldStyle() { return this.worldStyle; }
  setWorldStyle(style: WorldStyle) {
    this.pointers.cancelEdit();this.cancelStroke();
    this.cancelPendingEdit();
    this.worldStyle = style;
    this.resetJellyPhysics();
    this.applyWorldBackground();
    this.render();
  }
  newWorld(style: WorldStyle) {
    this.pointers.cancelEdit();this.cancelStroke();
    this.cancelPendingEdit();
    this.history.clear();
    this.worldStyle = style;
    this.relief=[];this.reliefSampler=createReliefSampler([]);
    this.living=createLivingState({...this.living,elapsed:0,edits:0});
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
    this.relief=[];this.reliefSampler=createReliefSampler([]);
    this.frameWorld();
    this.render();
  }
  getSaveData() {
    return {
      version: WORLD_SAVE_VERSION,
      graph: this.getGraph(),
      paints: Object.fromEntries(this.paintByFace),
      style: this.worldStyle,
      relief: this.relief,
      living: this.living,
    };
  }
  loadSaveData(data: unknown) {
    this.pointers?.cancelEdit();if(this.renderer)this.cancelStroke();
    this.cancelPendingEdit();
    const saved = data as { version?: number; graph?: FreeGraph; paints?: Record<string, PaintKind>; biomes?: Record<string, Biome>; style?: WorldStyle; relief?:unknown; living?:unknown };
    if (!saved?.graph || !Array.isArray(saved.graph.verts) || !Array.isArray(saved.graph.edges)) return false;
    if(saved.style!==undefined && !["blank","doodle","jelly","tiny"].includes(saved.style))return false;
    this.history?.clear();
    // Upgrade an old empty Jelly/Tiny save into the new playable starter world.
    // A child can still replace it at any time with the Random button.
    if (shouldSeedLegacyWorld({...saved,graph:saved.graph})) {
      this.newWorld(saved.style === "jelly" ? "jelly" : "tiny");
      return true;
    }
    this.graph = JSON.parse(JSON.stringify(saved.graph));
    this.paintByFace = new Map(Object.entries(saved.paints ?? saved.biomes ?? {}));
    this.worldStyle = saved.style ?? "tiny";
    this.relief=sanitizeRelief(saved.relief);this.reliefSampler=createReliefSampler(this.relief);
    this.living=createLivingState(saved.living);
    // Unknown packs or old progression must never make a painted biome unusable.
    for(const paint of this.paintByFace.values())if(isTerrain(paint) && !this.living.unlocked.includes(paint))this.living.unlocked.push(paint);
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
    gradient.addColorStop(0, dark ? this.worldStyle === "jelly" ? "#443053" : "#353f38" : "#fffcf3");
    gradient.addColorStop(1, dark ? this.worldStyle === "tiny" ? "#151e21" : "#111b2b" : "#dedacb");
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
  private editState(): EditState { return {graph:this.graph,paints:Object.fromEntries(this.paintByFace),relief:this.relief}; }
  private restoreEdit(state: EditState) {
    this.graph=state.graph;
    this.paintByFace=new Map(Object.entries(state.paints));
    this.relief=state.relief??[];this.reliefSampler=createReliefSampler(this.relief);
    this.render();
  }

  setGraph(g: FreeGraph, pushHistory = true) {
    this.pointers?.cancelEdit();if(this.renderer)this.cancelStroke();
    this.cancelPendingEdit();
    if (pushHistory) this.history.push(this.editState());
    this.graph = JSON.parse(JSON.stringify(g));
    this.render();
  }

  clear() { this.setGraph({ verts: [], edges: [] }); }

  undo() {this.pointers?.cancelEdit();if(this.renderer)this.cancelStroke(); if(this.pendingWorker) {this.cancelPendingEdit();return;} const r = this.history.undo(this.editState()); if (r) this.restoreEdit(r); }
  redo() {this.pointers?.cancelEdit();if(this.renderer)this.cancelStroke(); this.cancelPendingEdit(); const r = this.history.redo(this.editState()); if (r) this.restoreEdit(r); }

  // Snapshot the current view as a PNG data URL (for saving to Photos).
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/png");
  }

  panelCount(): number { return extractSphereFaces(this.graph.verts, this.graph.edges).length; }

  // ---- rendering ------------------------------------------------------------
  private render(notify=true) {
    const previous = { group: this.group, panels: this.panelMeshes, details: this.animatedDetails, shaders: this.jellyShaders, exact: this.exactEdges,life:this.lifeGroup,lifeContext:this.lifeContext,weather:this.weatherDetails };
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
      this.lifeGroup=previous.life;this.lifeContext=previous.lifeContext;this.weatherDetails=previous.weather;
      caches.forEach(cache=>cache.rollback());
      if(this.renderedState) {
        this.graph=this.renderedState.graph;
        this.paintByFace=new Map(Object.entries(this.renderedState.paints));
        this.relief=this.renderedState.relief??[];this.reliefSampler=createReliefSampler(this.relief);
      }
      throw error;
    }
    caches.forEach(cache=>cache.commit());
    this.scene.add(this.group);
    this.scene.remove(previous.group);
    disposeExcept(previous.group, this.group);
    this.renderedState=this.editState();
    this.evolutionDirty=false;
    if(notify)this.onChange?.();
  }

  private buildWorld() {
    this.panelMeshes = [];
    this.animatedDetails = [];
    this.weatherDetails=[];
    this.reliefSampler=createReliefSampler(this.relief??[]);
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
      let reliefSignature="";
      if(this.worldStyle==="tiny" && this.reliefSampler.key) {
        const center=normalize(face.reduce<Vec3>((sum,i)=>[sum[0]+g.verts[i][0],sum[1]+g.verts[i][1],sum[2]+g.verts[i][2]],[0,0,0]));
        let radius=0;
        for(const i of face)radius=Math.max(radius,Math.acos(THREE.MathUtils.clamp(dot(center,vertsMm[i])/R,-1,1)));
        reliefSignature=this.reliefSampler.signature(center,radius>=Math.PI/2?Math.PI:radius+.03);
      }
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
      const signature = `${this.worldStyle}:${face.map((a,i)=>`${a}:${g.verts[a].join(",")}:${this.exactEdges.has(edgeId(a,face[(i+1)%face.length]))?1:0}`).join(";")}:${jellySignature}:${reliefSignature}`;
      const geom = this.faceGeometry.get(signature, ()=>{
        let positions = this.faceMesh(vertsMm, face);
        let normals:number[];
        if(shapeJelly) {
          const shaped=shapeJelly(positions);positions=shaped.positions;normals=shaped.normals;
        } else if(reliefSignature) {
          positions=refineReliefMesh(positions,this.relief,R);
          normals=[];
          for(let i=0;i<positions.length;i+=3) {
            const point=[positions[i],positions[i+1],positions[i+2]],length=Math.hypot(...point);
            const height=this.reliefSampler.height(point),normal=this.reliefSampler.normalAt(point,R);
            for(let j=0;j<3;j++){positions[i+j]=point[j]/length*(R+height);normals.push(normal[j]);}
          }
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
        const arc=this.surfaceArc(this.organicEdge(vertsMm[a],vertsMm[b],a,b));
        for(let i=1;i<arc.length;i++)ink.push(...this.onSurface(arc[i-1],.24),...this.onSurface(arc[i],.24));
      }
      const inkGeometry = new THREE.BufferGeometry();
      inkGeometry.setAttribute("position",new THREE.Float32BufferAttribute(ink,3));
      this.group.add(new THREE.LineSegments(inkGeometry,new THREE.LineBasicMaterial({color:0xfff6dc,transparent:true,opacity:.9})));
      const coast: number[] = [];
      for (const edge of edgeOwners.values()) {
        if (edge.faces.length !== 2) continue;
        const left = facePaints[edge.faces[0]];
        const right = facePaints[edge.faces[1]];
        if (left === right || (left !== "water" && right !== "water")) continue;
        const points = this.surfaceArc(this.organicEdge(vertsMm[edge.a],vertsMm[edge.b],edge.a,edge.b));
        for (let i=1;i<points.length;i++) coast.push(...this.onSurface(points[i-1],.3),...this.onSurface(points[i],.3));
      }
      const coastGeometry = new THREE.BufferGeometry();
      coastGeometry.setAttribute("position",new THREE.Float32BufferAttribute(coast,3));
      this.group.add(new THREE.LineSegments(coastGeometry,new THREE.LineBasicMaterial({color:0xdbf3d9,transparent:true,opacity:.75})));
      this.lifeContext={faces,edgeOwners,vertsMm};
      this.lifeGroup=new THREE.Group();this.group.add(this.lifeGroup);
      this.buildTinyLife(this.lifeContext);
    }
  }

  private onSurface(point:Vec3,lift=0):Vec3 {
    return onSphere(point,R+(this.worldStyle==="tiny"?this.reliefSampler.height(point):0)+lift);
  }
  private surfaceArc(points:Vec3[]):Vec3[] {
    if(!this.relief.length || points.length<2)return points;
    const result:Vec3[]=[points[0]];
    for(let i=1;i<points.length;i++) {
      const a=new THREE.Vector3(...points[i-1]).normalize(),b=new THREE.Vector3(...points[i]).normalize();
      const steps=Math.max(1,Math.ceil(a.angleTo(b)/.012));
      for(let step=1;step<=steps;step++)result.push(a.clone().lerp(b,step/steps).normalize().toArray() as Vec3);
    }
    return result;
  }
  private terrainAt(point:readonly number[]):Biome|undefined {
    const face=this.lifeContext?.faces.find(face=>regionContainsPoint(this.graph.verts,face,point));
    const terrain=face?this.paintByFace.get(faceKey(face)):undefined;
    return isTerrain(terrain)?terrain:undefined;
  }
  private habitatFits(point:number[],radius:number,terrain:Biome|undefined,maxHeightDifference=2.5) {
    const n=new THREE.Vector3(...point),u=new THREE.Vector3(Math.abs(n.x)<.9?1:0,Math.abs(n.x)<.9?0:1,0).cross(n).normalize(),v=n.clone().cross(u);
    const centerHeight=this.reliefSampler.height(point);
    let supported=0;
    for(let i=0;i<8;i++) {
      const sample=n.clone().multiplyScalar(Math.cos(radius*.7)).addScaledVector(u,Math.sin(radius*.7)*Math.cos(i*Math.PI/4)).addScaledVector(v,Math.sin(radius*.7)*Math.sin(i*Math.PI/4));
      if(terrain!=="water" && Math.abs(this.reliefSampler.height(sample.toArray())-centerHeight)>maxHeightDifference)return false;
      if(!terrain || this.terrainAt(sample.toArray())===terrain)supported++;
    }
    return supported>=6;
  }
  private buildTinyLife(context:LifeContext) {
    const state=this.living??createLivingState(),stage=livingStage(state);
    const population=planPopulation(context.faces,this.graph.verts,context.edgeOwners.values(),this.paintByFace,{density:state.density,stage,elapsed:state.elapsed});
    const space=new PopulationSpace(state.density==="sparse"?48:state.density==="rich"?96:72);
    for(const stamp of selectReliefFeatures(this.relief??[])) {
      if(this.terrainAt(stamp.center)!=="water")continue;
      if(!space.reserve(stamp.center,stamp.radius*1.1))continue;
      const feature=createReliefFeature(stamp);if(!feature)continue;
      feature.position.fromArray(stamp.center).multiplyScalar(R);
      feature.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(...stamp.center));
      this.lifeGroup.add(feature);this.weatherDetails.push(feature);
    }
    population.placements.forEach(({id,point,terrain,slot,kind})=>{
      const index=Number(id.slice(5));
      const normal=this.reliefSampler.normalAt(point);
      // Steep slopes are geology, not building plots. Water stays navigable.
      if(terrain!=="water" && normal.reduce((sum,v,i)=>sum+v*point[i],0)<.86)return;
      const detail=ecosystemForTerrain(terrain)[slot];
      if(!detail)return;
      const modelKey=kind==="resident"?`strategy:${terrain}:${detail.id}:${stage}:${index%4}`:`natural:${terrain}:${index%4}`;
      const source=this.toyModels.get(modelKey,()=>kind==="resident"?strategyModel(detail,stage,index%4):naturalSceneryModel(terrain,index%4));
      const scale=kind==="resident"?5.4:6.3;
      const radius=Math.max(kind==="resident"?.10:.11,(Number(source.userData.footprintRadius)||1.7)*scale/R+.025);
      const isStructure=["camp","village","farm","market","watchtower","windmill","watermill","quarry","forge","workshop","ruins"].includes(source.userData.family);
      if(!this.habitatFits(point,radius,terrain,isStructure?1.25:2.5))return;
      if(!space.reserve(point,radius))return;
      const anchor=new THREE.Group();
      anchor.userData.habitat={site:id,terrain,radius,kind,family:source.userData.family};
      anchor.position.fromArray(this.onSurface([point[0],point[1],point[2]],.15));
      anchor.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(...point));
      const model=source.clone(true);model.scale.setScalar(scale);model.rotation.y=index*2.399;
      anchor.add(model);this.lifeGroup.add(anchor);
      if(terrain!=="water")this.addContactShadow(anchor,scale*1.2);
      this.animatedDetails.push({object:model,base:model.position.clone(),baseScale:model.scale.clone(),baseRotation:model.rotation.clone(),phase:index*2.399,amount:kind==="resident"?.6:.15,motion:kind==="resident"?detail.motion:"sway"});
    });
    if(stage>0)for(const contact of findTerrainBorderContacts(context.faces,this.graph.verts,context.edgeOwners.values(),this.paintByFace)) {
      const left=this.paintByFace.get(faceKey(context.faces[contact.leftFace])),right=this.paintByFace.get(faceKey(context.faces[contact.rightFace]));
      if(!isTerrain(left)||!isTerrain(right)||left===right)continue;
      const story=borderStoryFor(left,right),point=new THREE.Vector3(...this.graph.verts[contact.a]).add(new THREE.Vector3(...this.graph.verts[contact.b])).normalize().toArray();
      if(story && this.habitatFits(point,.20,undefined,1.25) && space.reserve(point,.20))this.addBorderStory(story,context.vertsMm[contact.a],context.vertsMm[contact.b]);
    }
  }
  private refreshTinyLife() {
    if(!this.lifeContext||this.worldStyle!=="tiny")return;
    const old=this.lifeGroup,details=this.animatedDetails,weather=this.weatherDetails;
    this.toyModels.begin();this.lifeGroup=new THREE.Group();this.animatedDetails=[];this.weatherDetails=[];
    try {this.buildTinyLife(this.lifeContext);} catch {
      disposeExcept(this.lifeGroup,old);this.lifeGroup=old;this.animatedDetails=details;this.weatherDetails=weather;this.toyModels.rollback();this.evolutionDirty=false;return;
    }
    this.toyModels.commit();this.group.remove(old);this.group.add(this.lifeGroup);disposeExcept(old,this.group);this.evolutionDirty=false;
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
      } else {
        material.onBeforeCompile=shader=>{
          shader.vertexShader=shader.vertexShader.replace("#include <common>","#include <common>\nvarying float terrainElevation; varying float terrainSlope;").replace("#include <begin_vertex>","#include <begin_vertex>\nterrainElevation=length(position)-120.0;terrainSlope=1.0-dot(normalize(normal),normalize(position));");
          shader.fragmentShader=shader.fragmentShader.replace("#include <common>","#include <common>\nvarying float terrainElevation; varying float terrainSlope;").replace("#include <map_fragment>",`#include <map_fragment>
            float exposedRock=smoothstep(.10,.36,terrainSlope)*smoothstep(.5,3.5,terrainElevation);
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.19,.18,.15),exposedRock*.7);
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.68,.70,.65),smoothstep(9.0,14.0,terrainElevation)*.8);`);
        };
        material.customProgramCacheKey=()=>"pocket-land-elevation-v1";
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
      ctx.strokeStyle = highlight.getStyle(); ctx.globalAlpha = 0.18; ctx.lineWidth = 1;
      for (let y = 14; y < 160; y += 19) {
        ctx.beginPath();
        for (let x = -8; x <= 168; x += 8) {
          const wave = y + Math.sin((x + y) * 0.11) * 3;
          if (x === -8) ctx.moveTo(x, wave); else ctx.lineTo(x, wave);
        }
        ctx.stroke();
      }
    } else if (terrain === "meadow") {
      ctx.strokeStyle = accent.getStyle(); ctx.globalAlpha = 0.20; ctx.lineWidth = 1.25;
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
    } else if (terrain === "forest") {
      ctx.fillStyle=accent.getStyle();ctx.globalAlpha=.20;
      for(let i=0;i<200;i++) {
        const x=random()*160,y=random()*160;
        ctx.beginPath();ctx.ellipse(x,y,1+random()*2,.5+random(),random()*Math.PI,0,Math.PI*2);ctx.fill();
      }
      ctx.strokeStyle=highlight.getStyle();ctx.globalAlpha=.12;ctx.lineWidth=.8;
      for(let i=0;i<60;i++){const x=random()*160,y=random()*160;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+4,y+3);ctx.stroke();}
    } else if (terrain === "wetland") {
      ctx.strokeStyle=accent.getStyle();ctx.globalAlpha=.22;ctx.lineWidth=2;
      for(let y=9;y<160;y+=23) {
        ctx.beginPath();for(let x=-5;x<=165;x+=5){const py=y+Math.sin(x*.075+y)*4;if(x===-5)ctx.moveTo(x,py);else ctx.lineTo(x,py);}ctx.stroke();
      }
      ctx.strokeStyle=highlight.getStyle();ctx.lineWidth=.8;ctx.globalAlpha=.25;
      for(let i=0;i<70;i++){const x=random()*160,y=random()*160;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+1,y-4);ctx.stroke();}
    } else if (terrain === "snow") {
      ctx.strokeStyle=highlight.getStyle();ctx.globalAlpha=.22;ctx.lineWidth=1.2;
      for(let y=11;y<160;y+=28) {
        ctx.beginPath();for(let x=-5;x<=165;x+=5){const py=y+Math.sin(x*.045+y)*5;if(x===-5)ctx.moveTo(x,py);else ctx.lineTo(x,py);}ctx.stroke();
      }
      ctx.fillStyle=accent.getStyle();ctx.globalAlpha=.14;
      for(let i=0;i<160;i++)ctx.fillRect(random()*160,random()*160,.8,.8);
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

  private addBorderStory(story: BorderStory, a: Vec3, b: Vec3) {
    const point=new THREE.Vector3(...a).add(new THREE.Vector3(...b)).normalize();
    const modelKey=story.terrains.includes("water")&&story.terrains.includes("stone")?"watermill":story.terrains.includes("water")||story.terrains.includes("wetland")?"fishing":story.terrains.includes("lava")?"forge":story.terrains.includes("sand")?"caravan":"camp";
    const motion=modelKey==="caravan"?"walk":modelKey==="watermill"?"turn":"work";
    const detail:EcosystemDetail={id:story.id,label:story.label,motif:"people",motion,colors:[...story.colors],model:modelKey};
    const stage=livingStage(this.living),source=this.toyModels.get(`border:${story.id}:${stage}`,()=>strategyModel(detail,stage,0));
    const model=source.clone(true);model.scale.setScalar(4.6);
    const anchor=new THREE.Group();anchor.position.fromArray(this.onSurface([point.x,point.y,point.z],.2));
    anchor.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),point);anchor.add(model);
    this.addContactShadow(anchor,6);this.lifeGroup.add(anchor);
    this.animatedDetails.push({object:model,base:model.position.clone(),baseScale:model.scale.clone(),baseRotation:model.rotation.clone(),phase:a[0]*.41+b[1]*.67,amount:.35,motion});
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
    if(this.worldStyle==="tiny" && this.relief.length) {
      const hit=this.raycaster.intersectObjects(this.panelMeshes,false)[0];
      if(hit)return onSphere([hit.point.x,hit.point.y,hit.point.z],R);
    }
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
    if(this.tool==="relief" && this.worldStyle!=="tiny")return;
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
        this.render(this.worldStyle!=="tiny");
        if(this.worldStyle==="tiny")this.completeWorldEdit();
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
    this.brushRadius=THREE.MathUtils.clamp(this.strokeStep/1.5*(this.tool==="relief"?this.reliefSize:this.brushWidth)/2,this.tool==="relief"?RELIEF_LIMITS.minRadius:.003,this.tool==="relief"?RELIEF_LIMITS.maxRadius:.12);
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
    if (cancelled || pts.length < (this.tool==="brush"||this.tool==="relief"?1:2)) {this.removePreview();return;}
    if(this.tool==="relief") {this.commitRelief(pts);this.removePreview();return;}
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
        try {this.render(this.worldStyle!=="tiny");if(this.worldStyle==="tiny")this.completeWorldEdit();} catch {this.container.dispatchEvent(new CustomEvent("world-processing",{detail:"No se pudo dibujar el cambio. Tu mundo anterior se conservó."}));}
        if(this.worldStyle==="jelly")this.triggerJellyImpact(new THREE.Vector3().fromArray(pts[pts.length-1]),1.15);
      };
      worker.postMessage(request);
    } catch {this.cancelPendingEdit();this.container.dispatchEvent(new CustomEvent("world-processing",{detail:"No se pudo iniciar el trazo. Tu mundo sigue intacto."}));}
  }

  private cancelPendingEdit() {
    this.pendingWorker?.terminate();this.pendingWorker=undefined;this.removePreview();
    this.container.dispatchEvent(new CustomEvent("world-processing",{detail:""}));
  }

  private commitRelief(points:number[][]) {
    let next=this.relief,run:number[][]=[],terrain:Biome|undefined,last:number[]|undefined;
    const flush=()=>{if(terrain&&run.length)next=applyReliefStroke(next,run,this.reliefMode,terrain,this.brushRadius,this.reliefStrength);run=[];};
    for(const point of points) {
      if(last && Math.acos(THREE.MathUtils.clamp(point.reduce((sum,v,i)=>sum+v*last![i],0),-1,1))<this.brushRadius*.2)continue;
      last=point;const here=this.terrainAt(point);
      if(here!==terrain){flush();terrain=here;}
      if(here)run.push(point);
    }
    flush();
    if(JSON.stringify(next)===JSON.stringify(this.relief)) {
      this.container.dispatchEvent(new CustomEvent("world-processing",{detail:this.relief.length>=96?"Límite de relieve: usá Suavizar para liberar espacio.":"Primero pintá un ecosistema en esta superficie."}));
      return;
    }
    this.history.push(this.editState());this.relief=next;this.reliefSampler=createReliefSampler(next);
    try {this.render(false);this.completeWorldEdit();this.container.dispatchEvent(new CustomEvent("world-processing",{detail:""}));}
    catch {this.container.dispatchEvent(new CustomEvent("world-processing",{detail:"No se pudo aplicar el relieve. Se conservó el mundo anterior."}));}
  }

  private updatePreview() {
    if(this.tool==="relief") {
      const raw=this.strokePts.at(-1);if(!raw)return;
      const n=new THREE.Vector3(...raw).normalize(),u=new THREE.Vector3(Math.abs(n.x)<.9?1:0,Math.abs(n.x)<.9?0:1,0).cross(n).normalize(),v=n.clone().cross(u);
      const points=Array.from({length:49},(_,i)=>{const a=i*Math.PI/24,p=n.clone().multiplyScalar(Math.cos(this.brushRadius)).addScaledVector(u,Math.sin(this.brushRadius)*Math.cos(a)).addScaledVector(v,Math.sin(this.brushRadius)*Math.sin(a));return new THREE.Vector3(...this.onSurface([p.x,p.y,p.z],.5));});
      this.previewMaterial.color.setHex(this.reliefMode==="lower"?0x93d0d4:0xe5cf93);
      if(!this.preview){this.preview=new THREE.Line(new THREE.BufferGeometry(),this.previewMaterial);this.preview.renderOrder=999;this.scene.add(this.preview);}
      this.preview.geometry.dispose();this.preview.geometry=new THREE.BufferGeometry().setFromPoints(points);
      return;
    }
    if(this.tool==="brush") {
      const pos:number[]=[], radius=this.brushRadius;
      const rings=this.strokePts.map(raw=>{
        const n=new THREE.Vector3(...raw).normalize();
        const side=new THREE.Vector3(Math.abs(n.x)<.9?1:0,Math.abs(n.x)<.9?0:1,0).cross(n).normalize();
        const up=n.clone().cross(side);
        const ring=Array.from({length:16},(_,i)=>{const p=n.clone().multiplyScalar(Math.cos(radius)).addScaledVector(side,Math.sin(radius)*Math.cos(i*Math.PI/8)).addScaledVector(up,Math.sin(radius)*Math.sin(i*Math.PI/8));return this.onSurface(p.toArray(),.7);});
        for(let i=0;i<16;i++)pos.push(...this.onSurface(n.toArray(),.7),...ring[i],...ring[(i+1)%16]);
        return n;
      });
      for(let i=1;i<rings.length;i++) {
        const a=rings[i-1],b=rings[i],side=a.clone().cross(b).normalize();
        const corner=(p:THREE.Vector3,s:number)=>this.onSurface(p.clone().multiplyScalar(Math.cos(radius)).addScaledVector(side,s*Math.sin(radius)).toArray(),.7);
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
    this.previewMaterial.color.setHex(0x1c2430);
    for (const q of this.strokePts) { const p = this.onSurface(q,.24); pos.push(p[0], p[1], p[2]); }
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
    const world=new THREE.Vector3(...this.onSurface([point[0],point[1],point[2]]));
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
    const bridge=Array.from({length:13},(_,i)=>new THREE.Vector3(...this.onSurface(a.clone().lerp(b,i/12).normalize().toArray(),.5)));
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(bridge),new THREE.LineDashedMaterial({color:0xffdd65,dashSize:1,gapSize:.7,depthTest:false}));
    line.computeLineDistances();line.renderOrder=1000;group.add(line);
    const marker=new THREE.Mesh(new THREE.RingGeometry(1.2,1.8,24),new THREE.MeshBasicMaterial({color:0xffdd65,side:THREE.DoubleSide,depthTest:false}));
    marker.position.fromArray(this.onSurface(b.toArray(),.6));marker.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),b);marker.renderOrder=1001;group.add(marker);
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
    const dt = Math.min(0.05, Math.max(0.001, t - this.lastAnimationTime / 1000));
    this.lastAnimationTime = t * 1000;
    if(this.worldStyle==="tiny" && !document.hidden && this.graph.edges.length && !this.pendingWorker) {
      const change=advanceLivingWorld(this.living,dt);
      if(change.stageChanged||change.unlocked.length)this.evolutionDirty=true;
      this.progressTick+=dt;
      if(this.progressTick>=1){this.progressTick=0;this.notifyLiving();}
      if(this.evolutionDirty&&!this.drawing)this.refreshTinyLife();
    }
    this.waterTime.value = this.worldStyle==="tiny"?this.living.elapsed:t;
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
    const context={time:this.worldStyle==="tiny"?this.living.elapsed:t,stage:livingStage(this.living)};
    if(!this.reducedMotion)for (const detail of this.animatedDetails) this.behaviourEngine.update(detail,context);
    for(const weather of this.weatherDetails)animateReliefFeature(weather,this.living.elapsed,this.reducedMotion);
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
