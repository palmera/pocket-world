import * as THREE from "three";

// This is the seam between Pocket World's scene renderer and its motion system.
// A richer simulation can replace this engine later without changing ecosystem
// catalogues, generated models, or the spherical editor.
export interface AnimatedDetail {
  object: THREE.Object3D;
  base: THREE.Vector3;
  baseScale?: THREE.Vector3;
  baseRotation?: THREE.Euler;
  phase: number;
  amount: number;
  motion: string;
  /** Optional rig captured once when a model is instantiated, never traversed per frame. */
  rig?: AnimationRig;
}

export interface BehaviourContext {
  time: number;
  stage?: number;
  /** Optional scene-specific activity multiplier; zero pauses local activity. */
  activity?: number;
}

interface Joint { object: THREE.Object3D; x: number; y: number; z: number; role: string; }
export interface AnimationRig { joints: Joint[]; legs: boolean; }
const JOINT_NAMES = new Set(["limb-left-arm", "limb-right-arm", "limb-left-leg", "limb-right-leg", "leg-front-left", "leg-front-right", "leg-rear-left", "leg-rear-right", "wing-left", "wing-right", "sail", "wheel", "wheel-left", "wheel-right", "rotor", "foliage", "head", "tail"]);
export function prepareAnimatedDetail(detail: AnimatedDetail): AnimatedDetail {
  const joints: Joint[] = [];
  let legs = false;
  detail.object.traverse(object => {
    if (!JOINT_NAMES.has(object.name)) return;
    const rest = object.userData.restRotation;
    joints.push({ object, role: object.name, x: Array.isArray(rest) ? rest[0] : object.rotation.x, y: Array.isArray(rest) ? rest[1] : object.rotation.y, z: Array.isArray(rest) ? rest[2] : object.rotation.z });
    if (object.name.includes("leg")) legs = true;
  });
  detail.rig = { joints, legs };
  return detail;
}

export interface Behaviour {
  id: string;
  update(detail: AnimatedDetail, context: BehaviourContext): void;
}

export interface BehaviourEngine {
  update(detail: AnimatedDetail, context: BehaviourContext): void;
  register(behaviour: Behaviour): void;
  has(id: string): boolean;
}

export class RegistryBehaviourEngine implements BehaviourEngine {
  private readonly behaviours = new Map<string, Behaviour>();

  constructor(behaviours: readonly Behaviour[] = []) { behaviours.forEach((behaviour) => this.register(behaviour)); }
  register(behaviour: Behaviour) { this.behaviours.set(behaviour.id, behaviour); }
  has(id: string) { return this.behaviours.has(id); }
  update(detail: AnimatedDetail, context: BehaviourContext) {
    if (!detail.rig) prepareAnimatedDetail(detail);
    detail.object.position.copy(detail.base);
    if (detail.baseScale) detail.object.scale.copy(detail.baseScale);
    else detail.object.scale.set(1, 1, 1);
    if (detail.baseRotation) detail.object.rotation.copy(detail.baseRotation);
    else detail.object.rotation.set(0, 0, 0);
    const joints = detail.rig!.joints;
    for (let i = 0; i < joints.length; i++) {
      const joint = joints[i]; joint.object.rotation.set(joint.x, joint.y, joint.z);
    }
    this.behaviours.get(detail.motion)?.update(detail, context);
  }
}

const wave = (detail: AnimatedDetail, time: number, rate = 2.2) => Math.sin(time * rate + detail.phase);
const activity = (d: AnimatedDetail, c: BehaviourContext): number => {
  // Residents alternate walking/working and observation. Different phases keep
  // neighbouring scenes from marching or harvesting in synchrony.
  const cycle = c.time * .085 + d.phase * .159 - Math.floor(c.time * .085 + d.phase * .159);
  return Math.max(0, Math.min(1, (cycle - .08) * 12, (.78 - cycle) * 12)) * (c.activity ?? 1);
};
function activeTravelTime(d: AnimatedDetail, c: BehaviourContext): number {
  // Integral of the activity envelope: feet and movement both stop during rest,
  // without keeping mutable per-frame path state or snapping back to an origin.
  const phase = c.time * .085 + d.phase * .159, period = Math.floor(phase), x = phase - period;
  const ramp = 1 / 12, full = .7 - ramp;
  const part = x <= .08 ? 0 : x < .08 + ramp ? (x - .08) ** 2 / (2 * ramp) : x <= .78 - ramp ? x - .08 - ramp / 2 : x < .78 ? full - (.78 - x) ** 2 / (2 * ramp) : full;
  return (period * full + part) / .085;
}
function articulate(d: AnimatedDetail, stride: number, wings = 0, work = 0, spin = 0, breeze = 0, graze = 0): void {
  const joints = d.rig!.joints;
  for (let i = 0; i < joints.length; i++) {
    const j = joints[i], r = j.object.rotation;
    switch (j.role) {
      case "limb-left-arm": r.x += -stride * .55 + work; break;
      case "limb-right-arm": r.x += stride * .55 + work * .75; break;
      case "limb-left-leg": case "leg-front-left": case "leg-rear-right": r.x += stride; break;
      case "limb-right-leg": case "leg-front-right": case "leg-rear-left": r.x -= stride; break;
      case "wing-left": r.z += wings; break;
      case "wing-right": r.z -= wings; break;
      case "wheel": case "wheel-left": case "wheel-right": r.x += spin; break;
      case "rotor": r.z += spin; break;
      case "sail": r.y += breeze; break;
      case "foliage": r.z += breeze; break;
      case "head": r.x += graze; break;
      case "tail": r.y += stride; break;
    }
  }
}
function walking(d: AnimatedDetail, c: BehaviourContext, grazing = false): void {
  const active = activity(d, c), travel = activeTravelTime(d, c), pace = travel * (grazing ? 1.8 : 2.8) + d.phase;
  // A smooth bounded local route is included in the planner's movement envelope.
  d.object.position.x += Math.sin(travel * .24 + d.phase) * d.amount * (grazing ? .75 : 1.35);
  d.object.position.z += Math.cos(travel * .19 + d.phase) * d.amount * .42;
  d.object.rotation.y += Math.cos(travel * .24 + d.phase) * .35;
  d.object.position.y += Math.abs(Math.sin(pace)) * d.amount * .035 * active;
  articulate(d, Math.sin(pace) * .5 * active, 0, 0, 0, 0, grazing ? (.2 + Math.sin(c.time * .8 + d.phase) * .1) * (1 - active) : 0);
}

export const BASIC_BEHAVIOURS: readonly Behaviour[] = [
  { id: "walk", update: (d, c) => walking(d, c) },
  { id: "graze", update: (d, c) => walking(d, c, true) },
  { id: "glide", update: (d, c) => { d.object.position.x += wave(d, c.time, .32) * d.amount * 1.6; d.object.position.z += Math.cos(c.time * .21 + d.phase) * d.amount * .55; d.object.rotation.y += wave(d, c.time, .32) * .2; articulate(d, wave(d, c.time, 2) * .12); } },
  { id: "orbit", update: (d, c) => { d.object.position.x += Math.cos(c.time * .35 + d.phase) * d.amount * 1.5; d.object.position.z += Math.sin(c.time * .35 + d.phase) * d.amount * 1.5; d.object.rotation.y += -c.time * .35 - d.phase; articulate(d, 0, wave(d, c.time, 3.5) * .35); } },
  { id: "roll", update: (d, c) => { d.object.position.x += wave(d, c.time, .28) * d.amount * 1.25; articulate(d, 0, 0, 0, c.time * 1.5 + d.phase); } },
  { id: "flutter", update: (d, c) => { d.object.position.y += wave(d, c.time, .8) * d.amount * .35; d.object.position.x += wave(d, c.time, .27) * d.amount * .9; d.object.rotation.z += wave(d, c.time, .6) * .06; articulate(d, 0, wave(d, c.time, 5) * .65); } },
  { id: "zoom", update: (d, c) => { d.object.position.x += wave(d, c.time, .45) * d.amount * 1.6; articulate(d, 0, wave(d, c.time, 4) * .5); } },
  { id: "drift", update: (d, c) => { d.object.position.y += wave(d, c.time, .35) * d.amount * .45; d.object.position.x += wave(d, c.time, .22) * d.amount * .65; } },
  { id: "hop", update: (d, c) => walking(d, c, true) },
  { id: "sway", update: (d, c) => { articulate(d, 0, 0, 0, 0, wave(d, c.time, 1.1) * .045); } },
  // Legacy "pulse" no longer scales an entire building like jelly.
  { id: "pulse", update: (d, c) => { articulate(d, 0, 0, wave(d, c.time, 1.5) * .28); } },
  { id: "bob", update: (d, c) => { d.object.position.y += wave(d, c.time, 1.1) * d.amount * .24; d.object.rotation.z += wave(d, c.time, .9) * .025; articulate(d, 0, 0, 0, 0, wave(d, c.time, 1.2) * .04); } },
  { id: "row", update: (d, c) => { d.object.position.x += wave(d, c.time, .2) * d.amount * .85; d.object.position.y += wave(d, c.time, 1.1) * d.amount * .12; articulate(d, 0, 0, -.45 + wave(d, c.time, 1.7) * .42, 0, wave(d, c.time, 1.2) * .025); } },
  { id: "work", update: (d, c) => { articulate(d, wave(d, c.time, 2.1) * activity(d, c) * .1, 0, -.3 + wave(d, c.time, 2.1) * .45 * activity(d, c), c.time * .45, wave(d, c.time, 1.1) * .03); } },
  { id: "gather", update: (d, c) => { walking(d, c, true); articulate(d, wave(d, c.time, 2.1) * activity(d, c) * .2, 0, -.3 + wave(d, c.time, 1.3) * .25); } },
  { id: "turn", update: (d, c) => { articulate(d, 0, 0, 0, c.time * .55 + d.phase, wave(d, c.time, 1.1) * .02); } },
  { id: "still", update: () => {} },
];

export type BasicBehaviourId = typeof BASIC_BEHAVIOURS[number]["id"];

export function createBasicBehaviourEngine(): BehaviourEngine {
  return new RegistryBehaviourEngine(BASIC_BEHAVIOURS);
}
