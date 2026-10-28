import {UNIT, type Vec} from '../actor-physics';
import type {Hitgroup} from './types';

export type ActorHitCapsule = {point0: Vec; point1: Vec; radius: number; group: Hitgroup; neck?: boolean};
export type ActorHitPose = {capsules: readonly ActorHitCapsule[]};

export type AnalyticBodyZone = {group: Hitgroup; centerX: number; low: number; high: number;
  halfWidth: number; halfDepth: number};

/** Body-local fallback dimensions shared by shot traces and sensor probes. */
export function analyticActorBodyZones(crouch: boolean | number): readonly AnalyticBodyZone[] {
  const fraction = typeof crouch === 'boolean' ? Number(crouch) : Math.max(0, Math.min(1, crouch));
  const lerp = (stand: number, duck: number) => stand + (duck - stand) * fraction;
  return [
    {group: 'chest', centerX: 0, low: lerp(1.08, .76), high: lerp(1.47, 1.07), halfWidth: lerp(.25, .24), halfDepth: .17},
    {group: 'stomach', centerX: 0, low: lerp(.76, .42), high: lerp(1.08, .76), halfWidth: .22, halfDepth: .17},
    {group: 'arm', centerX: -.31, low: lerp(.79, .55), high: lerp(1.4, 1.02), halfWidth: .09, halfDepth: .15},
    {group: 'arm', centerX: .31, low: lerp(.79, .55), high: lerp(1.4, 1.02), halfWidth: .09, halfDepth: .15},
    {group: 'leg', centerX: 0, low: .02, high: lerp(.76, .42), halfWidth: .22, halfDepth: .15},
  ];
}

type BoneMatrix = {matrixWorld: {elements: ArrayLike<number>}};
type BoneModel = {getObjectByName(name: string): BoneMatrix | undefined};
type NativeCapsule = {bone: string; point0: readonly number[]; point1: readonly number[]; radius: number; group: Hitgroup; neck?: boolean};

// Static cstrike HitboxSet from agents/models/ctm_sas/ctm_sas.vmdl_c,
// extracted with Source2Viewer into research/target-source.vmdl. Values are
// original bone-local Source units, not fitted mesh bounds or padded targets.
export const nativeActorCapsules: readonly NativeCapsule[] = [
  {bone: 'head_0', radius: 4.3, point0: [-1, 1.8, 0], point1: [3.5, .2, 0], group: 'head'},
  {bone: 'neck_0', radius: 3.5, point0: [0, -.4, 0], point1: [1.4, -.2, 0], group: 'chest', neck: true},
  {bone: 'pelvis', radius: 6, point0: [-2.7, 1.1, -3.2], point1: [-2.7, 1.1, 3.2], group: 'stomach'},
  {bone: 'spine_0', radius: 6, point0: [1.4, .8, 3.1], point1: [1.4, .8, -3.1], group: 'stomach'},
  {bone: 'spine_1', radius: 6.5, point0: [3.8, .8, -2.4], point1: [3.8, .4, 2.4], group: 'chest'},
  {bone: 'spine_2', radius: 6.2, point0: [4.8, .15, -4.1], point1: [4.8, .15, 4.1], group: 'chest'},
  {bone: 'spine_3', radius: 5, point0: [2.5, -.6, -6], point1: [2.5, -.6, 6], group: 'chest'},
  {bone: 'leg_upper_L', radius: 5, point0: [1.3, -.2, 0], point1: [16.5, -.7, 0], group: 'leg'},
  {bone: 'leg_upper_R', radius: 5, point0: [-1.3, 0, -.6], point1: [-16.5, 0, -.7], group: 'leg'},
  {bone: 'leg_lower_L', radius: 4, point0: [.1, -.4, .2], point1: [17, -.4, .7], group: 'leg'},
  {bone: 'leg_lower_R', radius: 4, point0: [-.1, 0, -.2], point1: [-17, .4, -.7], group: 'leg'},
  {bone: 'ankle_L', radius: 2.6, point0: [-0, -3.43, -.52], point1: [8, .74, .33], group: 'leg'},
  {bone: 'ankle_R', radius: 2.6, point0: [-7.98, -.75, -.27], point1: [-.02, 3.44, .58], group: 'leg'},
  {bone: 'hand_L', radius: 2.3, point0: [0, .3, 0], point1: [3.59, 1.15, .11], group: 'arm'},
  {bone: 'hand_R', radius: 2.3, point0: [0, -.3, .02], point1: [-3.44, -1.17, -.09], group: 'arm'},
  {bone: 'arm_upper_L', radius: 3.3, point0: [0, 0, 0], point1: [11.2, 0, 0], group: 'arm'},
  {bone: 'arm_lower_L', radius: 3, point0: [0, 0, 0], point1: [10, 0, 0], group: 'arm'},
  {bone: 'arm_upper_R', radius: 3.3, point0: [0, 0, 0], point1: [-11.2, 0, 0], group: 'arm'},
  {bone: 'arm_lower_R', radius: 3, point0: [0, 0, 0], point1: [-10, 0, -.5], group: 'arm'},
];

const point = (): Vec => ({x: 0, y: 0, z: 0});
function transform(out: Vec, values: readonly number[], m: ArrayLike<number>) {
  const x = values[0] * UNIT, y = values[1] * UNIT, z = values[2] * UNIT;
  out.x = m[0] * x + m[4] * y + m[8] * z + m[12];
  out.y = m[1] * x + m[5] * y + m[9] * z + m[13];
  out.z = m[2] * x + m[6] * y + m[10] * z + m[14];
}

/** Bind once per model. Capture only after its animation/world matrices update. */
export class NativeActorHitboxes {
  readonly pose: ActorHitPose;
  private readonly bindings: {bone: BoneMatrix; definition: NativeCapsule; capsule: ActorHitCapsule}[];

  constructor(model: BoneModel) {
    this.bindings = nativeActorCapsules.flatMap(definition => {
      const bone = model.getObjectByName(definition.bone);
      return bone ? [{bone, definition, capsule: {point0: point(), point1: point(), radius: definition.radius * UNIT, group: definition.group,
        ...(definition.neck ? {neck: true} : {})}}] : [];
    });
    this.pose = {capsules: this.bindings.map(binding => binding.capsule)};
    this.capture();
  }

  // Reuses all point/capsule objects; no meshes, rays, or skeleton traversal.
  capture(): ActorHitPose {
    for (const {bone, definition, capsule} of this.bindings) {
      const m = bone.matrixWorld.elements;
      transform(capsule.point0, definition.point0, m); transform(capsule.point1, definition.point1, m);
      capsule.radius = definition.radius * UNIT * Math.hypot(m[0], m[1], m[2]);
    }
    return this.pose;
  }

  headPoint(): Vec | undefined {
    const capsule = this.pose.capsules.find(capsule => capsule.group === 'head');
    return capsule ? {x: (capsule.point0.x + capsule.point1.x) / 2,
      y: (capsule.point0.y + capsule.point1.y) / 2, z: (capsule.point0.z + capsule.point1.z) / 2} : undefined;
  }
}
