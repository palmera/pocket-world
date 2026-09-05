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
}

export interface BehaviourContext {
  time: number;
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
    detail.object.position.copy(detail.base);
    if (detail.baseScale) detail.object.scale.copy(detail.baseScale);
    else detail.object.scale.set(1, 1, 1);
    if (detail.baseRotation) detail.object.rotation.copy(detail.baseRotation);
    else detail.object.rotation.set(0, 0, 0);
    this.behaviours.get(detail.motion)?.update(detail, context);
  }
}

const wave = (detail: AnimatedDetail, time: number, rate = 2.2) => Math.sin(time * rate + detail.phase);

export const BASIC_BEHAVIOURS: readonly Behaviour[] = [
  { id: "walk", update: (d, c) => { const w = wave(d, c.time, 2.9); d.object.position.x += w * d.amount * 2.8; d.object.position.y += Math.abs(w) * d.amount * .28; d.object.rotation.z += w * .2; } },
  { id: "glide", update: (d, c) => { const w = wave(d, c.time, 1.45); d.object.position.x += w * d.amount * 3.45; d.object.position.z += Math.cos(c.time * 1.1 + d.phase) * d.amount * .85; d.object.rotation.z += w * .08; } },
  { id: "orbit", update: (d, c) => { d.object.position.x += Math.cos(c.time * 1.85 + d.phase) * d.amount * 1.9; d.object.position.z += Math.sin(c.time * 1.85 + d.phase) * d.amount * 1.9; d.object.rotation.y += c.time * .95; } },
  { id: "roll", update: (d, c) => { const w = wave(d, c.time, 2.45); d.object.position.x += w * d.amount * 3; d.object.rotation.z += c.time * 3.4 + d.phase; } },
  { id: "flutter", update: (d, c) => { const w = wave(d, c.time, 4.1); d.object.position.y += w * d.amount * 2.35; d.object.rotation.z += w * .48; } },
  { id: "zoom", update: (d, c) => { const w = wave(d, c.time, 2.1); d.object.position.x += w * d.amount * 4.35; d.object.position.y += Math.cos(c.time * 3 + d.phase) * d.amount * .8; d.object.rotation.z += w * .14; } },
  { id: "drift", update: (d, c) => { const w = wave(d, c.time, 1.1); d.object.position.y += w * d.amount * 1.9; d.object.position.x += Math.cos(c.time * .7 + d.phase) * d.amount * 1.55; } },
  { id: "hop", update: (d, c) => { const w = Math.abs(wave(d, c.time, 2.3)); d.object.position.y += w * d.amount * 2.45; d.object.scale.y *= 1 - w * .08; d.object.scale.x *= 1 + w * .05; d.object.scale.z *= 1 + w * .05; } },
  { id: "sway", update: (d, c) => { d.object.rotation.z += wave(d, c.time, 1.65) * .32; } },
  { id: "pulse", update: (d, c) => { d.object.scale.multiplyScalar(1 + wave(d, c.time, 2.4) * .22); } },
  { id: "bob", update: (d, c) => { d.object.position.y += wave(d, c.time, 1.8) * d.amount * 1.45; d.object.rotation.z += wave(d, c.time, 1.8) * .06; } },
];

export type BasicBehaviourId = typeof BASIC_BEHAVIOURS[number]["id"];

export function createBasicBehaviourEngine(): BehaviourEngine {
  return new RegistryBehaviourEngine(BASIC_BEHAVIOURS);
}
