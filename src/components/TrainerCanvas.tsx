import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import * as THREE from 'three';
import { getPatternForLength, getPatternForWeakSegment } from '../data/weapons';
import { createImportedConcreteMaterial, importedMapAssets, loadImportedWeaponGroup } from '../lib/importedAssets';
import { distanceTolerances, getBulletCursor, interpolatePatternAt } from '../lib/path';
import { REFERENCE_TARGET_DISTANCE, cameraForwardFromYaw, cameraRightFromYaw, distanceBasedPatternScale, scaleRecoilPattern, spawnZForDistance } from '../lib/fpsMovement';
import { scoreAttempt } from '../lib/scoring';
import { finiteNumber, isFinitePoint } from '../lib/numeric';
import { buildWeaponGroup, disposeThreeObject } from '../lib/threeWeaponFactory';
import { getWeaponModelUrl, parseWeaponModelAsset } from '../lib/modelAssets';
import { AttemptResult, PointerSample, RecoilPoint, SprayLength, TargetDistance, TrainingMode, UserSettings, WeaponPattern, WeakSegment } from '../types';

type Props = {
  weapon: WeaponPattern;
  mode: TrainingMode;
  sprayLength: SprayLength;
  distance: TargetDistance;
  settings: UserSettings;
  previousAttempts: AttemptResult[];
  weakSegment?: WeakSegment;
  onComplete: (attempt: AttemptResult) => void;
};

type ShotPulse = { bullet: number; t: number } | null;

type HitZone = 'head' | 'body' | 'miss';

type StoredBulletTrace = {
  startWorld: THREE.Vector3;
  endWorld: THREE.Vector3;
  t: number;
  zone: HitZone;
  good: boolean;
};

type StoredTargetImpact = {
  bullet: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  visualDistance: number;
  penalty: number;
  good: boolean;
  zone: HitZone;
};

type ThreeRefs = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  weaponMount: THREE.Group;
  weaponModel?: THREE.Group;
  headWorld: THREE.Vector3;
  transferHeadWorld: THREE.Vector3;
  muzzleFlash: THREE.PointLight;
};

type PlayerState = {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  height: number;
  vx: number;
  vz: number;
  speed: number;
  crouching: boolean;
  moving: boolean;
  counterStopUntil: number;
};

const canvasWidth = 1120;
const canvasHeight = 650;
const center = { x: canvasWidth / 2, y: canvasHeight / 2 };
const fallbackHead = { x: canvasWidth / 2, y: 214 };

// One trainer-pattern pixel is mapped to a fixed physical wall distance. This is
// the core coordinate-system fix: guide points, bullet impacts, and the blue user
// trail all use the same target-wall plane. Camera pitch/yaw no longer changes
// spray spacing; only the distance-based pattern scale in fpsMovement.ts does.
const WALL_UNITS_PER_PATTERN_PX = 0.006;
// Visual view recoil moves the camera about halfway toward the next raw impact.
// Scoring records the player's manual counter-movement separately.
const AUTO_RECOIL_VIEW_FACTOR = 0.5;
const RAW_REFERENCE_SIDE_OFFSET_UNITS = 2.35;
const RAW_REFERENCE_VERTICAL_OFFSET_UNITS = -0.12;
const HIT_DOT_WALL_UNITS_PER_NORMALIZED_PX = 0.00235;
const HIT_DOT_SOFT_LIMIT_PX = 90;

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function screenFromWorld(point: THREE.Vector3, camera: THREE.PerspectiveCamera) {
  const projected = point.clone().project(camera);
  return {
    x: (projected.x * 0.5 + 0.5) * canvasWidth,
    y: (-projected.y * 0.5 + 0.5) * canvasHeight,
    visible: projected.z > -1 && projected.z < 1
  };
}


function reticleScaleForDistance(distance: number) {
  return Math.max(0.62, Math.min(1.08, REFERENCE_TARGET_DISTANCE / Math.max(5.8, distance)));
}

function compressImpactOffset(value: number): number {
  const safe = finiteNumber(value);
  const sign = Math.sign(safe);
  const abs = Math.abs(safe);
  if (abs <= HIT_DOT_SOFT_LIMIT_PX) return safe;
  return sign * (HIT_DOT_SOFT_LIMIT_PX + (abs - HIT_DOT_SOFT_LIMIT_PX) * 0.72);
}


function classifyImpactZone(refs: ThreeRefs, worldX: number, worldY: number): HitZone {
  const localX = worldX - refs.headWorld.x;
  const localY = worldY - refs.headWorld.y;
  if (Math.hypot(localX, localY) <= 0.195) return 'head';

  const inShoulders = (localY <= -0.12 && localY >= -0.58 && Math.abs(localX) <= 0.34);
  const inChest = (localY <= -0.36 && localY >= -1.08 && Math.abs(localX) <= 0.29);
  const inStomach = (localY <= -1.0 && localY >= -1.38 && Math.abs(localX) <= 0.22);
  const inPelvis = (localY <= -1.32 && localY >= -1.58 && Math.abs(localX) <= 0.18);
  if (inShoulders || inChest || inStomach || inPelvis) return 'body';
  return 'miss';
}

function zoneColor(zone: HitZone, good: boolean) {
  if (zone === 'head') return good ? 'rgba(253,224,71,0.96)' : 'rgba(245,158,11,0.95)';
  if (zone === 'body') return good ? 'rgba(34,197,94,0.92)' : 'rgba(56,189,248,0.92)';
  return 'rgba(239,68,68,0.9)';
}

function zoneShadow(zone: HitZone, good: boolean) {
  if (zone === 'head') return good ? '#fde047' : '#f59e0b';
  if (zone === 'body') return good ? '#22c55e' : '#38bdf8';
  return '#ef4444';
}

function makeStoredImpactFromError(
  refs: ThreeRefs,
  bullet: number,
  dx: number,
  dy: number,
  distance: number,
  penalty: number,
  good: boolean
): StoredTargetImpact {
  // Paint the actual simulated bullet impact, not the visible crosshair location.
  // dx/dy already combine: starting aim offset + current correction - recoil pattern + spread.
  // This keeps green/correct hits visually near the target and keeps the first bullet
  // at the real starting crosshair position.
  const impactX = finiteNumber(dx);
  const impactY = finiteNumber(dy);
  const worldX = finiteNumber(refs.headWorld.x + impactX * WALL_UNITS_PER_PATTERN_PX, refs.headWorld.x);
  const worldY = finiteNumber(refs.headWorld.y - impactY * WALL_UNITS_PER_PATTERN_PX, refs.headWorld.y);
  return {
    bullet,
    worldX,
    worldY,
    worldZ: refs.headWorld.z + 0.012,
    visualDistance: finiteNumber(Math.hypot(impactX, impactY), distance),
    penalty: finiteNumber(penalty),
    good,
    zone: classifyImpactZone(refs, worldX, worldY)
  };
}


function drawProjectedScreenPath(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number; visible?: boolean }>,
  color: string,
  width: number,
  alpha = 1
) {
  const safePoints = points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.visible !== false);
  if (safePoints.length < 2) return;
  ctx.save();
  ctx.globalAlpha = finiteNumber(alpha, 1);
  ctx.strokeStyle = color;
  ctx.lineWidth = finiteNumber(width, 1);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  safePoints.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.stroke();
  ctx.restore();
}

function patternPointToWallWorld(refs: ThreeRefs, point: { x: number; y: number }) {
  return new THREE.Vector3(
    refs.headWorld.x + point.x * WALL_UNITS_PER_PATTERN_PX,
    refs.headWorld.y - point.y * WALL_UNITS_PER_PATTERN_PX,
    refs.headWorld.z
  );
}

function wallWorldToPatternOffset(refs: ThreeRefs, point: THREE.Vector3) {
  return {
    x: (point.x - refs.headWorld.x) / WALL_UNITS_PER_PATTERN_PX,
    y: (refs.headWorld.y - point.y) / WALL_UNITS_PER_PATTERN_PX
  };
}

function centerRayWallHit(refs: ThreeRefs) {
  const camera = refs.camera;
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
  const planeZ = refs.headWorld.z;
  const t = Math.abs(direction.z) > 0.0001 ? (planeZ - camera.position.z) / direction.z : Number.NaN;
  if (!Number.isFinite(t) || t <= 0) return null;
  return camera.position.clone().add(direction.multiplyScalar(t));
}

function projectRecoilPointToWall(refs: ThreeRefs, point: { x: number; y: number }) {
  return screenFromWorld(patternPointToWallWorld(refs, point), refs.camera);
}

function drawProjectedRecoilPath(
  ctx: CanvasRenderingContext2D,
  refs: ThreeRefs,
  points: RecoilPoint[],
  color: string,
  width: number,
  alpha = 1
) {
  drawProjectedScreenPath(ctx, points.map((point) => projectRecoilPointToWall(refs, point)), color, width, alpha);
}

function drawProjectedGuideBullets(
  ctx: CanvasRenderingContext2D,
  refs: ThreeRefs,
  points: RecoilPoint[],
  showNumbers: boolean,
  alpha: number,
  currentIndex: number,
  nextIndex: number
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'left';
  points.forEach((point, index) => {
    const projected = projectRecoilPointToWall(refs, point);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !projected.visible) return;
    const isCurrent = index === currentIndex;
    const isNext = index === nextIndex;
    ctx.fillStyle = isCurrent ? '#22c55e' : isNext ? '#38bdf8' : '#f59e0b';
    ctx.strokeStyle = isCurrent ? '#bbf7d0' : isNext ? '#bae6fd' : 'rgba(253,230,138,0.65)';
    ctx.lineWidth = isCurrent || isNext ? 2.6 : 1.2;
    ctx.shadowColor = isCurrent ? '#22c55e' : isNext ? '#38bdf8' : 'transparent';
    ctx.shadowBlur = isCurrent || isNext ? 16 : 0;
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, isCurrent ? 8 : isNext ? 6.5 : 3.8, 0, Math.PI * 2);
    ctx.fill();
    if (isCurrent || isNext) ctx.stroke();

    const shouldLabel = isCurrent || isNext || (showNumbers && (point.bullet === 1 || point.bullet % 10 === 0 || index === points.length - 1));
    if (shouldLabel) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = isCurrent || isNext ? '#ffffff' : '#fde68a';
      ctx.font = `${isCurrent || isNext ? 'bold ' : ''}11px Inter, sans-serif`;
      ctx.fillText(String(point.bullet), projected.x + 9, projected.y - 8);
    }
  });
  ctx.restore();
}

function drawProjectedSamplePath(
  ctx: CanvasRenderingContext2D,
  refs: ThreeRefs,
  samples: PointerSample[],
  color: string,
  width: number,
  alpha = 1
) {
  const projected = samples
    .filter((sample) => Number.isFinite(sample.wallX) && Number.isFinite(sample.wallY))
    .map((sample) => screenFromWorld(new THREE.Vector3(sample.wallX!, sample.wallY!, refs.headWorld.z), refs.camera));
  drawProjectedScreenPath(ctx, projected, color, width, alpha);
}

function drawCrosshair(ctx: CanvasRenderingContext2D, x: number, y: number, mode: UserSettings['crosshair'], spreadPx = 0) {
  const drawSegment = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };

  ctx.save();
  const gap = mode === 'dot' ? 2.5 : mode === 'small' ? 3.5 : 4.5;
  const len = mode === 'dot' ? 4 : mode === 'small' ? 5 : 6;
  const innerDot = mode === 'dot' ? 1.2 : 0.9;

  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(34,197,94,0.22)';
  ctx.shadowBlur = 2;

  // black outline, like a typical CS crosshair outline
  ctx.strokeStyle = 'rgba(0,0,0,0.95)';
  ctx.lineWidth = 3.6;
  drawSegment(x - gap - len, y, x - gap, y);
  drawSegment(x + gap, y, x + gap + len, y);
  drawSegment(x, y - gap - len, x, y - gap);
  drawSegment(x, y + gap, x, y + gap + len);

  // inner green crosshair
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#39ff14';
  ctx.lineWidth = 1.8;
  drawSegment(x - gap - len, y, x - gap, y);
  drawSegment(x + gap, y, x + gap + len, y);
  drawSegment(x, y - gap - len, x, y - gap);
  drawSegment(x, y + gap, x, y + gap + len);

  ctx.fillStyle = '#39ff14';
  ctx.beginPath();
  ctx.arc(x, y, innerDot, 0, Math.PI * 2);
  ctx.fill();

  if (spreadPx > 20) {
    ctx.globalAlpha = 0.14;
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(7, Math.min(26, spreadPx * 0.32)), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawPath(ctx: CanvasRenderingContext2D, origin: { x: number; y: number }, points: Array<{ x: number; y: number }>, color: string, width: number, alpha = 1) {
  const safePoints = points.filter(isFinitePoint);
  if (safePoints.length === 0 || !isFinitePoint(origin)) return;
  ctx.save();
  ctx.globalAlpha = finiteNumber(alpha, 1);
  ctx.strokeStyle = color;
  ctx.lineWidth = finiteNumber(width, 1);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  safePoints.forEach((point, index) => {
    const x = origin.x + point.x;
    const y = origin.y + point.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawGuideBullets(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  points: RecoilPoint[],
  showNumbers: boolean,
  alpha: number,
  currentIndex: number,
  nextIndex: number
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'left';
  points.forEach((point, index) => {
    const x = origin.x + point.x;
    const y = origin.y + point.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const isCurrent = index === currentIndex;
    const isNext = index === nextIndex;
    ctx.fillStyle = isCurrent ? '#22c55e' : isNext ? '#38bdf8' : '#f59e0b';
    ctx.strokeStyle = isCurrent ? '#bbf7d0' : isNext ? '#bae6fd' : 'rgba(253,230,138,0.65)';
    ctx.lineWidth = isCurrent || isNext ? 2.6 : 1.2;
    ctx.shadowColor = isCurrent ? '#22c55e' : isNext ? '#38bdf8' : 'transparent';
    ctx.shadowBlur = isCurrent || isNext ? 16 : 0;
    ctx.beginPath();
    ctx.arc(x, y, isCurrent ? 8 : isNext ? 6.5 : 3.8, 0, Math.PI * 2);
    ctx.fill();
    if (isCurrent || isNext) ctx.stroke();

    const shouldLabel = isCurrent || isNext || (showNumbers && (point.bullet === 1 || point.bullet % 10 === 0 || index === points.length - 1));
    if (shouldLabel) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = isCurrent || isNext ? '#ffffff' : '#fde68a';
      ctx.font = `${isCurrent || isNext ? 'bold ' : ''}11px Inter, sans-serif`;
      ctx.fillText(String(point.bullet), x + 9, y - 8);
    }
  });
  ctx.restore();
}


function drawReferenceImpactPath(
  ctx: CanvasRenderingContext2D,
  origin: { x: number; y: number },
  points: RecoilPoint[],
  currentIndex: number,
  nextIndex: number
) {
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.strokeStyle = 'rgba(248,113,113,0.8)';
  ctx.lineWidth = 2.1;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = origin.x - point.x;
    const y = origin.y - point.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  points.forEach((point, index) => {
    const x = origin.x - point.x;
    const y = origin.y - point.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const isCurrent = index === currentIndex;
    const isNext = index === nextIndex;
    ctx.fillStyle = isCurrent ? '#22c55e' : isNext ? '#38bdf8' : '#ef4444';
    ctx.beginPath();
    ctx.arc(x, y, isCurrent ? 6 : isNext ? 5 : 3.1, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = 'rgba(254,226,226,0.82)';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('raw wall recoil reference', origin.x, origin.y + 28);
  ctx.restore();
}

function drawProjectedReferenceImpactPath(
  ctx: CanvasRenderingContext2D,
  refs: ThreeRefs,
  originWorld: THREE.Vector3,
  points: RecoilPoint[],
  currentIndex: number,
  nextIndex: number
) {
  const screenPoints = points.map((point) => screenFromWorld(new THREE.Vector3(
    originWorld.x - point.x * WALL_UNITS_PER_PATTERN_PX,
    originWorld.y + point.y * WALL_UNITS_PER_PATTERN_PX,
    originWorld.z
  ), refs.camera));

  drawProjectedScreenPath(ctx, screenPoints, 'rgba(248,113,113,0.88)', 2.2, 0.76);

  ctx.save();
  points.forEach((point, index) => {
    const projected = screenPoints[index];
    if (!projected || !Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !projected.visible) return;
    const isCurrent = index === currentIndex;
    const isNext = index === nextIndex;
    ctx.fillStyle = isCurrent ? '#22c55e' : isNext ? '#38bdf8' : '#ef4444';
    ctx.shadowColor = isCurrent ? '#22c55e' : isNext ? '#38bdf8' : '#ef4444';
    ctx.shadowBlur = isCurrent || isNext ? 14 : 7;
    ctx.beginPath();
    ctx.arc(projected.x, projected.y, isCurrent ? 6.5 : isNext ? 5.5 : 3.25, 0, Math.PI * 2);
    ctx.fill();
  });
  const labelPoint = screenFromWorld(new THREE.Vector3(originWorld.x, originWorld.y - 0.33, originWorld.z), refs.camera);
  if (labelPoint.visible) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(254,226,226,0.82)';
    ctx.font = '10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('raw wall recoil reference', labelPoint.x, labelPoint.y);
  }
  ctx.restore();
}

function nearestSample(samples: PointerSample[], timeMs: number): PointerSample {
  if (samples.length === 0) return { t: 0, x: 0, y: 0 };
  return samples.reduce((best, item) => Math.abs(item.t - timeMs) < Math.abs(best.t - timeMs) ? item : best, samples[0]);
}

function deterministicSpread(bullet: number, penaltyPx: number) {
  if (penaltyPx <= 0) return { x: 0, y: 0 };
  const seed = (bullet * 9301 + 49297) % 233280;
  const angle = (seed / 233280) * Math.PI * 2;
  const radius = penaltyPx * (0.28 + ((seed * 1103515245) % 10_000) / 10_000 * 0.22);
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function bulletImpacts(samples: PointerSample[], ideal: RecoilPoint[], elapsed: number, tolerance: number) {
  const startAimX = samples[0]?.startAimOffsetX ?? 0;
  const startAimY = samples[0]?.startAimOffsetY ?? 0;
  return ideal.filter((point) => point.timeMs <= elapsed + 8).map((point) => {
    const sample = nearestSample(samples, point.timeMs);
    const penalty = sample.inaccuracyPx ?? 0;
    const spread = deterministicSpread(point.bullet, penalty);
    const dx = finiteNumber(sample.x - point.x + startAimX + spread.x);
    const dy = finiteNumber(sample.y - point.y + startAimY + spread.y);
    const distance = finiteNumber(Math.hypot(dx, dy) + penalty * 0.12, 9999);
    return { bullet: point.bullet, dx, dy, distance, penalty: finiteNumber(penalty), good: distance <= tolerance };
  });
}

function drawBulletHole(ctx: CanvasRenderingContext2D, origin: { x: number; y: number }, impact: ReturnType<typeof bulletImpacts>[number]) {
  const x = origin.x + impact.dx;
  const y = origin.y + impact.dy;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(impact.distance)) return;
  ctx.save();
  ctx.fillStyle = impact.good ? 'rgba(34,197,94,0.86)' : 'rgba(239,68,68,0.88)';
  ctx.shadowColor = impact.good ? '#22c55e' : '#ef4444';
  ctx.shadowBlur = impact.good ? 7 : 10;
  ctx.beginPath();
  ctx.arc(x, y, 4.6 + Math.min(5, impact.distance / 35), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(2,6,23,0.92)';
  ctx.beginPath();
  ctx.arc(x, y, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(226,232,240,0.86)';
  ctx.font = '10px Inter, sans-serif';
  ctx.fillText(String(impact.bullet), x + 8, y - 6);
  if (impact.penalty > 18) {
    ctx.fillStyle = '#fecaca';
    ctx.fillText('move', x + 8, y + 8);
  }
  ctx.restore();
}


function drawStoredBulletTrace(
  ctx: CanvasRenderingContext2D,
  refs: ThreeRefs,
  trace: StoredBulletTrace,
  now: number
) {
  const age = now - trace.t;
  if (age < 0 || age > 240) return;
  const start = screenFromWorld(trace.startWorld, refs.camera);
  const end = screenFromWorld(trace.endWorld, refs.camera);
  if (!start.visible || !end.visible) return;
  const alpha = 1 - age / 240;
  ctx.save();
  ctx.globalAlpha = alpha * 0.92;
  ctx.strokeStyle = zoneColor(trace.zone, trace.good);
  ctx.shadowColor = zoneShadow(trace.zone, trace.good);
  ctx.shadowBlur = 10;
  ctx.lineWidth = trace.zone === 'head' ? 2.8 : 2.2;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.restore();
}

function drawStoredTargetImpact(
  ctx: CanvasRenderingContext2D,
  refs: ThreeRefs,
  impact: StoredTargetImpact
) {
  // Fired bullets are stored as physical wall/target points at shot time.
  // They are then projected from world space, exactly like paint on the target.
  // Changing player distance or camera position cannot recalculate their offset.
  const projected = screenFromWorld(new THREE.Vector3(impact.worldX, impact.worldY, impact.worldZ), refs.camera);
  if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !projected.visible || !Number.isFinite(impact.visualDistance)) return;

  ctx.save();
  ctx.fillStyle = zoneColor(impact.zone, impact.good);
  ctx.shadowColor = zoneShadow(impact.zone, impact.good);
  ctx.shadowBlur = impact.zone === 'head' ? 11 : impact.good ? 7 : 9;
  ctx.beginPath();
  ctx.arc(projected.x, projected.y, 3.6 + Math.min(2.6, impact.visualDistance / 80), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(2,6,23,0.92)';
  ctx.beginPath();
  ctx.arc(projected.x, projected.y, 1.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}


function drawTargetReticle(ctx: CanvasRenderingContext2D, origin: { x: number; y: number }, label = 'head', scale = 1) {
  ctx.save();
  ctx.strokeStyle = 'rgba(34,211,238,0.72)';
  ctx.lineWidth = Math.max(0.9, 1.2 * scale);
  for (const radius of [7, 18, 30].map((value) => value * scale)) {
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#f43f5e';
  ctx.shadowColor = '#f43f5e';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(origin.x, origin.y, Math.max(2.8, 3.8 * scale), 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(226,232,240,0.84)';
  ctx.font = `${Math.max(9, 10 * scale)}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(label, origin.x, origin.y - 28 * scale);
  ctx.restore();
}

function playLayeredShot(context: AudioContext, weapon: WeaponPattern) {
  const now = context.currentTime;
  const rifle = !['mp9', 'mac10', 'mp7', 'p90'].includes(weapon.id);
  const suppressed = weapon.id === 'm4a1s';
  const master = context.createGain();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 22;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.08;
  master.connect(compressor).connect(context.destination);

  const transientLength = Math.floor(context.sampleRate * (suppressed ? 0.055 : 0.085));
  const transientBuffer = context.createBuffer(1, transientLength, context.sampleRate);
  const transientData = transientBuffer.getChannelData(0);
  for (let i = 0; i < transientLength; i += 1) {
    const t = i / transientLength;
    const envelope = Math.exp(-t * (suppressed ? 10 : 8));
    transientData[i] = (Math.random() * 2 - 1) * envelope;
  }
  const transient = context.createBufferSource();
  transient.buffer = transientBuffer;
  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = suppressed ? 260 : 520;
  const lowpass = context.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = suppressed ? 2200 : rifle ? 3400 : 3900;
  const transientGain = context.createGain();
  transientGain.gain.setValueAtTime(suppressed ? 0.075 : rifle ? 0.115 : 0.095, now);
  transientGain.gain.exponentialRampToValueAtTime(0.0001, now + (suppressed ? 0.065 : 0.085));
  transient.connect(highpass).connect(lowpass).connect(transientGain).connect(master);
  transient.start(now);

  const thump = context.createOscillator();
  const thumpGain = context.createGain();
  thump.type = 'sine';
  thump.frequency.setValueAtTime(suppressed ? 112 : rifle ? 86 : 132, now);
  thump.frequency.exponentialRampToValueAtTime(suppressed ? 58 : 44, now + 0.09);
  thumpGain.gain.setValueAtTime(suppressed ? 0.035 : 0.052, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + (suppressed ? 0.09 : 0.12));
  thump.connect(thumpGain).connect(master);
  thump.start(now);
  thump.stop(now + 0.18);

  const mech = context.createOscillator();
  const mechGain = context.createGain();
  mech.type = 'triangle';
  mech.frequency.setValueAtTime(rifle ? 1550 : 2100, now + 0.006);
  mechGain.gain.setValueAtTime(0.014, now + 0.006);
  mechGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.026);
  mech.connect(mechGain).connect(master);
  mech.start(now + 0.006);
  mech.stop(now + 0.032);
}


function playHitConfirm(context: AudioContext, zone: HitZone) {
  const now = context.currentTime;
  const master = context.createGain();
  master.gain.value = zone === 'head' ? 0.16 : 0.12;
  master.connect(context.destination);

  if (zone === 'head') {
    const toneA = context.createOscillator();
    const gainA = context.createGain();
    toneA.type = 'triangle';
    toneA.frequency.setValueAtTime(1780, now);
    toneA.frequency.exponentialRampToValueAtTime(1320, now + 0.04);
    gainA.gain.setValueAtTime(0.0001, now);
    gainA.gain.exponentialRampToValueAtTime(0.036, now + 0.003);
    gainA.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
    toneA.connect(gainA).connect(master);
    toneA.start(now);
    toneA.stop(now + 0.06);

    const toneB = context.createOscillator();
    const gainB = context.createGain();
    toneB.type = 'sine';
    toneB.frequency.setValueAtTime(1120, now + 0.012);
    toneB.frequency.exponentialRampToValueAtTime(920, now + 0.07);
    gainB.gain.setValueAtTime(0.0001, now + 0.012);
    gainB.gain.exponentialRampToValueAtTime(0.018, now + 0.017);
    gainB.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    toneB.connect(gainB).connect(master);
    toneB.start(now + 0.012);
    toneB.stop(now + 0.085);
    return;
  }

  const toneA = context.createOscillator();
  const gainA = context.createGain();
  toneA.type = 'sine';
  toneA.frequency.setValueAtTime(1180, now);
  toneA.frequency.exponentialRampToValueAtTime(900, now + 0.045);
  gainA.gain.setValueAtTime(0.0001, now);
  gainA.gain.exponentialRampToValueAtTime(0.026, now + 0.004);
  gainA.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
  toneA.connect(gainA).connect(master);
  toneA.start(now);
  toneA.stop(now + 0.06);

  const thump = context.createOscillator();
  const thumpGain = context.createGain();
  thump.type = 'triangle';
  thump.frequency.setValueAtTime(240, now + 0.01);
  thump.frequency.exponentialRampToValueAtTime(180, now + 0.06);
  thumpGain.gain.setValueAtTime(0.0001, now + 0.01);
  thumpGain.gain.exponentialRampToValueAtTime(0.02, now + 0.016);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.075);
  thump.connect(thumpGain).connect(master);
  thump.start(now + 0.01);
  thump.stop(now + 0.08);
}

const REFERENCE_DISTANCE_BY_MODE: Record<TargetDistance, number> = {
  close: 7.6,
  mid: 10.25,
  long: 13.5
};

function createRangeScene(mount: HTMLDivElement): ThreeRefs {
  const scene = new THREE.Scene();
  const hdriPreview = new THREE.TextureLoader().load(importedMapAssets.indoorPreview);
  hdriPreview.colorSpace = THREE.SRGBColorSpace;
  scene.background = new THREE.Color('#0b1220');
  scene.environment = hdriPreview;
  scene.fog = new THREE.Fog('#0b1220', 10, 38);

  const camera = new THREE.PerspectiveCamera(74, mount.clientWidth / Math.max(1, mount.clientHeight), 0.05, 120);
  camera.position.set(0, 1.62, 0.4);
  camera.rotation.order = 'YXZ';

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(mount.clientWidth, mount.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight('#dbeafe', '#7c2d12', 1.25);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff7ed', 3.2);
  sun.position.set(-5, 8, 4);
  sun.castShadow = true;
  scene.add(sun);
  const warm = new THREE.PointLight('#f59e0b', 1.1, 22);
  warm.position.set(2.7, 2.6, -5.8);
  scene.add(warm);

  const floorMaterial = createImportedConcreteMaterial('floor');
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(42, 78), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -12.8;
  floor.receiveShadow = true;
  scene.add(floor);

  const wallMaterial = createImportedConcreteMaterial('wall');
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(26.5, 5.8, 0.34), wallMaterial);
  backWall.position.set(0, 2.45, -10.2);
  backWall.receiveShadow = true;
  scene.add(backWall);

  const sideMaterial = createImportedConcreteMaterial('wall');
  const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.1, 42), sideMaterial);
  leftWall.position.set(-13.35, 2.35, -12.2);
  const rightWall = leftWall.clone();
  rightWall.position.x = 13.35;
  scene.add(leftWall, rightWall);

  const ceiling = new THREE.Mesh(new THREE.BoxGeometry(26.5, 0.3, 40), createImportedConcreteMaterial('wall'));
  ceiling.position.set(0, 4.85, -12.0);
  scene.add(ceiling);

  const grooveMat = new THREE.MeshStandardMaterial({ color: '#3f3328', roughness: 0.9 });
  for (let x = -12; x <= 12; x += 1) {
    const groove = new THREE.Mesh(new THREE.BoxGeometry(0.025, 5.2, 0.035), grooveMat);
    groove.position.set(x, 2.45, -10.0);
    scene.add(groove);
  }
  for (let y = 0.4; y <= 5.2; y += 0.6) {
    const groove = new THREE.Mesh(new THREE.BoxGeometry(26.1, 0.025, 0.035), grooveMat);
    groove.position.set(0, y, -9.99);
    scene.add(groove);
  }

  const crateMat = new THREE.MeshStandardMaterial({ color: '#6f421e', roughness: 0.72, metalness: 0.03 });
  const cratePositions = [
    [-11.0, 0.45, -6.8], [10.9, 0.55, -7.2], [-9.2, 0.38, -18.6], [8.8, 0.38, -17.8],
    [-11.8, 0.46, 3.8], [11.8, 0.46, 3.8]
  ];
  for (const [x, y, z] of cratePositions) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 1.1), crateMat);
    crate.position.set(x, y, z);
    crate.castShadow = true;
    crate.receiveShadow = true;
    scene.add(crate);
  }

  const createRangeTarget = (x: number, z: number, accentHex = '#fbbf24') => {
    const stand = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({ color: '#4b5563', roughness: 0.8, metalness: 0.25 });
    const paperMat = new THREE.MeshStandardMaterial({ color: '#d6c3a1', roughness: 0.96, metalness: 0.02 });
    const silhouetteMat = new THREE.MeshStandardMaterial({ color: '#111827', roughness: 0.8, metalness: 0.04, transparent: true, opacity: 0.96 });
    const accentMat = new THREE.MeshStandardMaterial({ color: accentHex, emissive: accentHex, emissiveIntensity: 0.12, roughness: 0.45, metalness: 0.12 });

    const postLeft = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.2, 0.05), frameMat);
    postLeft.position.set(-0.22, 0.6, z + 0.03);
    const postRight = postLeft.clone();
    postRight.position.x = 0.22;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 0.28), frameMat);
    base.position.set(0, 0.03, z + 0.03);

    const board = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.76, 0.05), paperMat);
    board.position.set(0, 1.44, z);
    board.castShadow = true;
    board.receiveShadow = true;

    const shoulders = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.52, 8, 16), silhouetteMat);
    shoulders.rotation.z = Math.PI / 2;
    shoulders.position.set(0, 1.27, z + 0.03);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.68, 0.06), silhouetteMat);
    chest.position.set(0, 0.92, z + 0.035);
    const stomach = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.34, 0.06), silhouetteMat);
    stomach.position.set(0, 0.48, z + 0.035);
    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.06), silhouetteMat);
    pelvis.position.set(0, 0.2, z + 0.035);
    const legLeft = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.38, 0.05), silhouetteMat);
    legLeft.position.set(-0.08, -0.1, z + 0.035);
    const legRight = legLeft.clone();
    legRight.position.x = 0.08;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 28, 18), silhouetteMat);
    head.position.set(0, 1.63, z + 0.04);

    const headRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.008, 8, 36), accentMat);
    headRing.position.copy(head.position);
    const chestRing = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.008, 8, 42), accentMat);
    chestRing.scale.y = 1.24;
    chestRing.position.copy(chest.position);
    const stomachRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.008, 8, 36), accentMat);
    stomachRing.scale.y = 0.9;
    stomachRing.position.copy(stomach.position);

    stand.position.x = x;
    stand.add(postLeft, postRight, base, board, shoulders, chest, stomach, pelvis, legLeft, legRight, head, headRing, chestRing, stomachRing);
    scene.add(stand);
    return { group: stand, headWorld: new THREE.Vector3(x, 1.63, z + 0.04) };
  };

  const primaryTarget = createRangeTarget(0, -9.78, '#fbbf24');
  const transferTarget = createRangeTarget(3.3, -9.76, '#60a5fa');

  const weaponMount = new THREE.Group();
  camera.add(weaponMount);
  scene.add(camera);

  const muzzleFlash = new THREE.PointLight('#fbbf24', 0, 5.5);
  muzzleFlash.position.set(0.58, -0.34, -1.18);
  camera.add(muzzleFlash);

  return { scene, camera, renderer, weaponMount, headWorld: primaryTarget.headWorld.clone(), transferHeadWorld: transferTarget.headWorld.clone(), muzzleFlash };
}

export function TrainerCanvas(props: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const threeRef = useRef<ThreeRefs | null>(null);
  const [active, setActive] = useState(false);
  const [samples, setSamples] = useState<PointerSample[]>([]);
  const samplesRef = useRef<PointerSample[]>([]);
  const activeRef = useRef(false);
  const completedRef = useRef(false);
  const [lastPointer, setLastPointer] = useState({ x: 0, y: 0 });
  const [shotPulse, setShotPulse] = useState<ShotPulse>(null);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [movementHud, setMovementHud] = useState({ speed: 0, moving: false, crouching: false, inaccuracyPx: 0 });
  const [patternScale, setPatternScale] = useState(() => distanceBasedPatternScale(REFERENCE_DISTANCE_BY_MODE[props.distance]));
  const [hitConfirm, setHitConfirm] = useState<{ t: number; perfect: boolean; zone: HitZone } | null>(null);
  const hitConfirmRef = useRef<{ t: number; perfect: boolean; zone: HitZone } | null>(null);
  const shotPulseRef = useRef<ShotPulse>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const shotTimersRef = useRef<number[]>([]);
  const pressedKeysRef = useRef(new Set<string>());
  const playerRef = useRef<PlayerState>({ x: 0, z: 0.4, yaw: 0, pitch: 0, height: 1.62, vx: 0, vz: 0, speed: 0, crouching: false, moving: false, counterStopUntil: 0 });
  const mousePullRef = useRef({ x: 0, y: 0 });
  const autoRecoilOffsetRef = useRef({ x: 0, y: 0 });
  const sprayStartAimOffsetRef = useRef({ x: 0, y: 0 });
  const sprayStartWallOffsetRef = useRef({ x: 0, y: 0 });
  const sprayStartViewRef = useRef({ yaw: 0, pitch: 0 });
  const attemptStartTimeRef = useRef(0);
  const drawOverlayRef = useRef<() => void>(() => undefined);
  const targetImpactsRef = useRef<StoredTargetImpact[]>([]);
  const bulletTracesRef = useRef<StoredBulletTrace[]>([]);

  const basePattern = useMemo(() => (
    props.mode === 'weak-section'
      ? getPatternForWeakSegment(props.weapon, props.weakSegment)
      : getPatternForLength(props.weapon, props.sprayLength)
  ), [props.weapon, props.sprayLength, props.mode, props.weakSegment]);

  const idealPattern = useMemo(() => scaleRecoilPattern(basePattern, patternScale), [basePattern, patternScale]);

  const finalTime = idealPattern[idealPattern.length - 1]?.timeMs ?? 0;


  useEffect(() => {
    if (activeRef.current) return;
    const player = playerRef.current;
    player.z = spawnZForDistance(props.distance);
    setPatternScale(distanceBasedPatternScale(REFERENCE_DISTANCE_BY_MODE[props.distance]));
  }, [props.distance]);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    shotPulseRef.current = shotPulse;
  }, [shotPulse]);

  useEffect(() => {
    hitConfirmRef.current = hitConfirm;
  }, [hitConfirm]);

  const currentInaccuracy = useCallback(() => {
    const player = playerRef.current;
    const base = props.weapon.inaccuracy.standPx;
    if (player.crouching) {
      return player.speed > 0.05 ? base : base * props.weapon.inaccuracy.crouchMultiplier;
    }
    const speedRatio = Math.min(1, player.speed / 5.8);
    const accurateRatio = props.weapon.inaccuracy.accurateMoveSpeedRatio;
    const movementFactor = player.moving ? Math.max(0, (speedRatio - accurateRatio) / Math.max(0.01, 1 - accurateRatio)) : 0;
    return base + props.weapon.inaccuracy.movePx * movementFactor;
  }, [props.weapon.inaccuracy]);

  const getWallAimState = useCallback(() => {
    const refs = threeRef.current;
    if (!refs) {
      return {
        x: mousePullRef.current.x,
        y: mousePullRef.current.y,
        wallX: undefined,
        wallY: undefined
      };
    }

    // Raycast the fixed center crosshair into the same target-wall plane used by
    // the orange guide and bullet impact simulation. Convert that physical wall hit
    // to trainer pattern-pixels. This prevents vertical look angle from changing
    // the apparent spray spacing or desynchronizing the blue trail from bullets.
    const hit = centerRayWallHit(refs);
    if (!hit) {
      return {
        x: mousePullRef.current.x,
        y: mousePullRef.current.y,
        wallX: refs.headWorld.x,
        wallY: refs.headWorld.y
      };
    }

    const offset = wallWorldToPatternOffset(refs, hit);
    return {
      x: finiteNumber(offset.x, mousePullRef.current.x),
      y: finiteNumber(offset.y, mousePullRef.current.y),
      wallX: finiteNumber(hit.x, refs.headWorld.x),
      wallY: finiteNumber(hit.y, refs.headWorld.y)
    };
  }, []);

  const getWallAimOffset = useCallback(() => {
    const { x, y } = getWallAimState();
    return { x, y };
  }, [getWallAimState]);

  const getCurrentWallCompensation = useCallback(() => {
    const wallAim = getWallAimState();
    // Score and render the actual center-crosshair wall position. Automatic view
    // recoil is already baked into the camera aim, so subtracting it here would
    // make the blue trail diverge from the visible crosshair and from bullets.
    const aimX = finiteNumber(wallAim.x - sprayStartWallOffsetRef.current.x, mousePullRef.current.x);
    const aimY = finiteNumber(wallAim.y - sprayStartWallOffsetRef.current.y, mousePullRef.current.y);
    const refs = threeRef.current;
    if (!refs) {
      return { x: aimX, y: aimY, wallX: wallAim.wallX, wallY: wallAim.wallY, rawWallX: wallAim.wallX, rawWallY: wallAim.wallY };
    }
    const aimWall = patternPointToWallWorld(refs, { x: aimX, y: aimY });
    return {
      x: aimX,
      y: aimY,
      wallX: finiteNumber(aimWall.x, wallAim.wallX),
      wallY: finiteNumber(aimWall.y, wallAim.wallY),
      rawWallX: finiteNumber(wallAim.wallX, aimWall.x),
      rawWallY: finiteNumber(wallAim.wallY, aimWall.y)
    };
  }, [getWallAimState]);

  const makeSample = useCallback((timeMs: number): PointerSample => {
    const wallCompensation = getCurrentWallCompensation();
    mousePullRef.current = { x: wallCompensation.x, y: wallCompensation.y };
    return {
      t: timeMs,
      x: wallCompensation.x,
      y: wallCompensation.y,
      moving: playerRef.current.moving,
      crouching: playerRef.current.crouching,
      speed: playerRef.current.speed,
      inaccuracyPx: currentInaccuracy(),
      startAimOffsetX: sprayStartAimOffsetRef.current.x,
      startAimOffsetY: sprayStartAimOffsetRef.current.y,
      wallX: wallCompensation.wallX,
      wallY: wallCompensation.wallY,
      rawWallX: wallCompensation.rawWallX,
      rawWallY: wallCompensation.rawWallY
    };
  }, [currentInaccuracy, getCurrentWallCompensation]);

  const pushSample = useCallback((sample: PointerSample) => {
    const previous = samplesRef.current[samplesRef.current.length - 1];
    if (
      previous &&
      Math.abs(previous.x - sample.x) < 0.18 &&
      Math.abs(previous.y - sample.y) < 0.18 &&
      Math.abs((previous.inaccuracyPx ?? 0) - (sample.inaccuracyPx ?? 0)) < 0.5 &&
      sample.t - previous.t < 16
    ) {
      return;
    }
    samplesRef.current = [...samplesRef.current, sample].slice(-2200);
    setSamples(samplesRef.current);
  }, []);

  const clearShotTimers = useCallback(() => {
    for (const timer of shotTimersRef.current) window.clearTimeout(timer);
    shotTimersRef.current = [];
  }, []);

  const applyAutomaticViewRecoil = useCallback((targetRecoilOffset: { x: number; y: number }) => {
    const refs = threeRef.current;
    if (!refs) return;
    const previous = autoRecoilOffsetRef.current;
    const deltaX = targetRecoilOffset.x - previous.x;
    const deltaY = targetRecoilOffset.y - previous.y;
    autoRecoilOffsetRef.current = targetRecoilOffset;

    const player = playerRef.current;
    const distanceToWall = Math.max(1.2, Math.abs(refs.headWorld.z - refs.camera.position.z));
    const yawDelta = Math.atan((deltaX * WALL_UNITS_PER_PATTERN_PX) / distanceToWall);
    const pitchDelta = Math.atan((deltaY * WALL_UNITS_PER_PATTERN_PX) / distanceToWall);

    player.yaw -= yawDelta;
    player.pitch -= pitchDelta;
    player.pitch = Math.max(-1.25, Math.min(1.25, player.pitch));
    refs.camera.rotation.set(player.pitch, player.yaw, 0);
  }, []);

  const startShotAudio = useCallback((startTime: number) => {
    clearShotTimers();
    targetImpactsRef.current = [];
    const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const context = audioContextRef.current ?? new AudioCtor();
    audioContextRef.current = context;
    void context.resume?.();

    shotTimersRef.current = idealPattern.map((point) => window.setTimeout(() => {
      applyAutomaticViewRecoil({
        x: -point.x * AUTO_RECOIL_VIEW_FACTOR,
        y: -point.y * AUTO_RECOIL_VIEW_FACTOR
      });
      playLayeredShot(context, props.weapon);
      threeRef.current && (threeRef.current.muzzleFlash.intensity = props.weapon.id === 'm4a1s' ? 0.65 : 1.55);
      const pulse = { bullet: point.bullet, t: performance.now() };
      setShotPulse(pulse);
      shotPulseRef.current = pulse;
      const sample = makeSample(performance.now() - startTime);
      pushSample(sample);
      const tolerance = distanceTolerances[props.distance];
      const penalty = sample.inaccuracyPx ?? 0;
      const spread = deterministicSpread(point.bullet, penalty);
      const dx = finiteNumber(sample.x - point.x + (sample.startAimOffsetX ?? 0) + spread.x);
      const dy = finiteNumber(sample.y - point.y + (sample.startAimOffsetY ?? 0) + spread.y);
      const distance = Math.hypot(dx, dy) + penalty * 0.12;
      const refs = threeRef.current;
      if (refs) {
        const impact = makeStoredImpactFromError(refs, point.bullet, dx, dy, distance, penalty, distance <= tolerance);
        targetImpactsRef.current = [...targetImpactsRef.current, impact];
        const traceZone: HitZone = impact.zone === 'miss' ? (distance <= tolerance ? 'body' : 'miss') : impact.zone;
        bulletTracesRef.current = [
          ...bulletTracesRef.current.slice(-11),
          {
            startWorld: refs.camera.position.clone(),
            endWorld: new THREE.Vector3(impact.worldX, impact.worldY, impact.worldZ),
            t: performance.now(),
            zone: traceZone,
            good: impact.good
          }
        ];

        if (impact.zone !== 'miss') {
          const perfect = impact.zone === 'head' || distance <= Math.max(12, tolerance * 0.38);
          const hit = { t: performance.now(), perfect, zone: impact.zone };
          setHitConfirm(hit);
          hitConfirmRef.current = hit;
          playHitConfirm(context, impact.zone);
        }
      }
    }, point.timeMs));
  }, [applyAutomaticViewRecoil, clearShotTimers, idealPattern, makeSample, patternScale, props.distance, props.weapon, pushSample]);

  const completeAttempt = useCallback(() => {
    if (!activeRef.current || completedRef.current) return;
    completedRef.current = true;
    activeRef.current = false;
    setActive(false);
    clearShotTimers();
    const endSample = makeSample(finalTime);
    const rawFinalSamples = samplesRef.current.length > 2 ? [...samplesRef.current, endSample] : [makeSample(0), endSample];
    const finalSamples = rawFinalSamples.filter((sample) => Number.isFinite(sample.t) && Number.isFinite(sample.x) && Number.isFinite(sample.y));
    try {
      const attempt = scoreAttempt({
        weapon: props.weapon,
        mode: props.mode,
        sprayLength: props.sprayLength,
        distance: props.distance,
        samples: finalSamples,
        idealPattern,
        previousAttempts: props.previousAttempts
      });
      props.onComplete(attempt);
    } catch (error) {
      console.error('Attempt scoring failed; resetting trainer state instead of crashing.', error);
    }
  }, [clearShotTimers, idealPattern, makeSample, props]);

  const drawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const refs = threeRef.current;
    if (!overlay || !refs) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const head = screenFromWorld(refs.headWorld, refs.camera);
    const transferHead = screenFromWorld(refs.transferHeadWorld, refs.camera);
    const headOrigin = head.visible ? head : fallbackHead;
    const targetDistance = refs.camera.position.distanceTo(refs.headWorld);
    const targetReticleScale = reticleScaleForDistance(targetDistance);
    const elapsed = activeRef.current && samplesRef.current.length ? samplesRef.current[samplesRef.current.length - 1].t : 0;
    const cursor = getBulletCursor(idealPattern, activeRef.current ? elapsed : 0);
    const tolerance = distanceTolerances[props.distance];
    const assistAlpha = props.mode === 'fade-assist' ? Math.max(0.18, 1 - props.previousAttempts.length * 0.06) : 1;
    const showIdeal = ['learn', 'trace', 'ghosthair', 'weak-section', 'fade-assist'].includes(props.mode);
    const inaccuracyPx = currentInaccuracy();

    const referenceSide = headOrigin.x < canvasWidth * 0.58 ? 1 : -1;
    const referenceOriginWorld = new THREE.Vector3(
      refs.headWorld.x + referenceSide * RAW_REFERENCE_SIDE_OFFSET_UNITS,
      refs.headWorld.y + RAW_REFERENCE_VERTICAL_OFFSET_UNITS,
      refs.headWorld.z
    );

    drawTargetReticle(ctx, headOrigin, 'target head', targetReticleScale);
    if (transferHead.visible) drawTargetReticle(ctx, transferHead, 'transfer', targetReticleScale * 0.92);
    const nowMs = performance.now();
    bulletTracesRef.current = bulletTracesRef.current.filter((trace) => nowMs - trace.t < 240);
    bulletTracesRef.current.forEach((trace) => drawStoredBulletTrace(ctx, refs, trace, nowMs));
    targetImpactsRef.current.forEach((impact) => drawStoredTargetImpact(ctx, refs, impact));

    if (showIdeal) {
      // The orange compensation guide is now projected onto the actual target wall
      // instead of being painted as a 2D HUD offset. This keeps it aligned with
      // the FPS camera and with the blue wall-aim trail.
      drawProjectedRecoilPath(ctx, refs, idealPattern, '#f59e0b', 3.5, props.mode === 'ghosthair' ? 0.18 : assistAlpha * 0.78);
      drawProjectedGuideBullets(ctx, refs, idealPattern, props.mode === 'learn', props.mode === 'ghosthair' ? 0.32 : assistAlpha * 0.86, cursor.firedIndex, cursor.nextIndex);
      drawProjectedReferenceImpactPath(ctx, refs, referenceOriginWorld, idealPattern, cursor.firedIndex, cursor.nextIndex);
    } else {
      ctx.save();
      ctx.fillStyle = 'rgba(15,23,42,0.76)';
      roundedRect(ctx, 314, 24, 492, 42, 12);
      ctx.fill();
      ctx.fillStyle = 'rgba(248,250,252,0.84)';
      ctx.font = '15px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No-guide test: aim at the head, then control the timed burst from memory.', canvasWidth / 2, 50);
      ctx.restore();
    }

    if (props.mode === 'ghosthair' && activeRef.current) {
      const ghost = interpolatePatternAt(idealPattern, elapsed);
      if (ghost) {
        ctx.save();
        ctx.fillStyle = '#22d3ee';
        ctx.strokeStyle = '#ecfeff';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 18;
        ctx.beginPath();
        const ghostScreen = projectRecoilPointToWall(refs, ghost);
        ctx.arc(ghostScreen.x, ghostScreen.y, 8.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    if (samplesRef.current.length > 1 && props.mode !== 'no-guide') {
      // The user path is drawn from the recorded 3D wall ray hits, so the latest
      // blue segment lands directly under the center crosshair instead of drifting
      // below it due to 2D projection assumptions.
      drawProjectedSamplePath(ctx, refs, samplesRef.current, '#38bdf8', 2.4, 0.88);
    }

    drawCrosshair(ctx, center.x, center.y, props.settings.crosshair, inaccuracyPx);

    const hitPulse = hitConfirmRef.current;
    const hitAge = hitPulse ? performance.now() - hitPulse.t : 999;
    if (hitPulse && hitAge < 240) {
      const alpha = 1 - hitAge / 240;
      const headshot = hitPulse.zone === 'head';
      const bodyshot = hitPulse.zone === 'body';
      const color = headshot ? '#fde047' : bodyshot ? '#4ade80' : hitPulse.perfect ? '#fde68a' : '#ffffff';
      const size = headshot ? 15 : hitPulse.perfect ? 13 : 10;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = headshot ? 2.8 : hitPulse.perfect ? 2.6 : 2.1;
      ctx.shadowColor = color;
      ctx.shadowBlur = headshot ? 16 : 12;
      const gap = headshot ? 7 : 6;
      const seg = size;
      ctx.beginPath();
      ctx.moveTo(center.x - gap - seg, center.y - gap - seg);
      ctx.lineTo(center.x - gap, center.y - gap);
      ctx.moveTo(center.x + gap, center.y + gap);
      ctx.lineTo(center.x + gap + seg, center.y + gap + seg);
      ctx.moveTo(center.x + gap, center.y - gap);
      ctx.lineTo(center.x + gap + seg, center.y - gap - seg);
      ctx.moveTo(center.x - gap - seg, center.y + gap + seg);
      ctx.lineTo(center.x - gap, center.y + gap);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `bold ${headshot ? 18 : 14}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      if (headshot) ctx.fillText('HEADSHOT', center.x, center.y + 32);
      else if (bodyshot) ctx.fillText('BODYSHOT', center.x, center.y + 28);
      else if (hitPulse.perfect) ctx.fillText('HIT', center.x, center.y + 28);
      ctx.restore();
    }

    const progress = activeRef.current ? Math.min(1, elapsed / Math.max(1, finalTime)) : 0;
    const fired = activeRef.current ? Math.max(0, cursor.firedIndex + 1) : 0;
    const recentPulse = shotPulseRef.current && performance.now() - shotPulseRef.current.t < 130 ? shotPulseRef.current.bullet : null;
    ctx.save();
    ctx.fillStyle = 'rgba(2,6,23,0.66)';
    ctx.strokeStyle = 'rgba(248,250,252,0.1)';
    roundedRect(ctx, 18, 18, 270, 78, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px Inter, sans-serif';
    ctx.fillText(`${props.weapon.name} · ${fired}/${idealPattern.length}`, 32, 40);
    ctx.fillStyle = '#bbf7d0';
    ctx.fillText(`Now ${cursor.currentBullet?.bullet ?? '—'}`, 32, 59);
    ctx.fillStyle = '#bae6fd';
    ctx.fillText(`Next ${fired >= idealPattern.length ? 'done' : cursor.nextBullet?.bullet ?? 1}`, 92, 59);
    if (recentPulse) {
      ctx.fillStyle = '#fde68a';
      ctx.fillText(`Shot ${recentPulse}`, 164, 59);
    }
    ctx.fillStyle = movementHud.moving ? '#fecaca' : movementHud.crouching ? '#bbf7d0' : '#cbd5e1';
    ctx.fillText(`${movementHud.crouching ? 'crouched' : movementHud.moving ? 'moving' : 'steady'} · ${Math.round(inaccuracyPx)}px`, 32, 78);
    ctx.fillStyle = 'rgba(148,163,184,0.28)';
    roundedRect(ctx, 31, 84, 188, 5, 999);
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    roundedRect(ctx, 31, 84, 188 * progress, 5, 999);
    ctx.fill();
    ctx.restore();
  }, [
    currentInaccuracy,
    finalTime,
    idealPattern,
    movementHud,
    pointerLocked,
    props.distance,
    props.mode,
    props.previousAttempts.length,
    props.settings.crosshair,
    props.weapon.name,
    props.weapon.refireMs
  ]);

  useEffect(() => {
    drawOverlayRef.current = drawOverlay;
  }, [drawOverlay]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const refs = createRangeScene(mount);
    threeRef.current = refs;

    let frame = 0;
    let last = performance.now();
    let hudAccumulator = 0;
    const animate = () => {
      const now = performance.now();
      const delta = Math.min(0.04, (now - last) / 1000);
      last = now;

      const keys = pressedKeysRef.current;
      const player = playerRef.current;
      const crouching = keys.has('control') || keys.has('ctrl') || keys.has('c');
      const sprinting = keys.has('shift') && !crouching;
      const baseSpeed = crouching ? 2.25 : sprinting ? 6.6 : 5.35;
      const forwardKeyPair = keys.has('w') && keys.has('s');
      const strafeKeyPair = keys.has('a') && keys.has('d');
      const forwardAxis = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
      const strafeAxis = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
      const inputLength = Math.hypot(forwardAxis, strafeAxis);
      const f = cameraForwardFromYaw(player.yaw);
      const r = cameraRightFromYaw(player.yaw);
      const forward = new THREE.Vector3(f.x, 0, f.z);
      const right = new THREE.Vector3(r.x, 0, r.z);
      let desiredX = 0;
      let desiredZ = 0;
      if (inputLength > 0 && now >= player.counterStopUntil) {
        desiredX = (forward.x * forwardAxis + right.x * strafeAxis) / inputLength;
        desiredZ = (forward.z * forwardAxis + right.z * strafeAxis) / inputLength;
      }

      const currentSpeed = Math.hypot(player.vx, player.vz);
      const counterPairPressed = forwardKeyPair || strafeKeyPair;
      const inputOpposesVelocity = inputLength > 0 && currentSpeed > 0.08
        ? ((player.vx / currentSpeed) * desiredX + (player.vz / currentSpeed) * desiredZ) < -0.45
        : false;
      const lockedInput = inputLength > 0 && now < player.counterStopUntil;

      if ((inputOpposesVelocity || counterPairPressed) && currentSpeed > 0.02) {
        const nextSpeed = Math.max(0, currentSpeed - 90 * delta);
        if (nextSpeed <= 0.08) {
          player.vx = 0;
          player.vz = 0;
          player.counterStopUntil = now + 140;
        } else {
          player.vx = player.vx / currentSpeed * nextSpeed;
          player.vz = player.vz / currentSpeed * nextSpeed;
        }
      } else if (inputLength > 0 && !lockedInput) {
        const targetVx = desiredX * baseSpeed;
        const targetVz = desiredZ * baseSpeed;
        const maxChange = (crouching ? 16 : sprinting ? 28 : 24) * delta;
        const diffX = targetVx - player.vx;
        const diffZ = targetVz - player.vz;
        const diffLength = Math.hypot(diffX, diffZ);
        if (diffLength <= maxChange) {
          player.vx = targetVx;
          player.vz = targetVz;
        } else {
          player.vx += diffX / diffLength * maxChange;
          player.vz += diffZ / diffLength * maxChange;
        }
      } else {
        const decel = 18 * delta;
        if (currentSpeed <= decel) {
          player.vx = 0;
          player.vz = 0;
        } else {
          player.vx -= player.vx / currentSpeed * decel;
          player.vz -= player.vz / currentSpeed * decel;
        }
      }

      player.x += player.vx * delta;
      player.z += player.vz * delta;
      player.speed = Math.hypot(player.vx, player.vz);
      const accurateThreshold = (props.weapon.movementSpeed / 100) * props.weapon.inaccuracy.accurateMoveSpeedRatio;
      player.moving = !crouching && player.speed > accurateThreshold;
      player.crouching = crouching;
      player.height += ((crouching ? 1.16 : 1.62) - player.height) * Math.min(1, delta * 10);
      player.x = Math.max(-12.1, Math.min(12.1, player.x));
      player.z = Math.max(-7.5, Math.min(11.4, player.z));
      refs.camera.position.set(player.x, player.height, player.z);
      refs.camera.rotation.set(player.pitch, player.yaw, 0);

      if (activeRef.current) {
        pushSample(makeSample(now - attemptStartTimeRef.current));
      }

      const pulse = shotPulseRef.current;
      const pulseAge = pulse ? now - pulse.t : 999;
      const kick = pulseAge < 90 ? 1 - pulseAge / 90 : 0;
      const walkBob = player.moving ? Math.sin(now / 72) * 0.012 : 0;
      const crouchDrop = player.crouching ? -0.035 : 0;
      refs.weaponMount.position.set(kick * 0.025, -kick * 0.015 + walkBob + crouchDrop, kick * 0.055);
      refs.weaponMount.rotation.set(-kick * 0.055, kick * 0.035, -kick * 0.035 + walkBob * 1.2);
      refs.muzzleFlash.intensity *= 0.78;

      const targetDistance = refs.camera.position.distanceTo(refs.headWorld);
      const nextPatternScale = distanceBasedPatternScale(targetDistance);

      refs.renderer.render(refs.scene, refs.camera);
      hudAccumulator += delta;
      if (hudAccumulator > 0.08) {
        hudAccumulator = 0;
        setPatternScale((previous) => Math.abs(previous - nextPatternScale) > 0.012 ? nextPatternScale : previous);
        setMovementHud({
          speed: player.speed,
          moving: player.moving,
          crouching: player.crouching,
          inaccuracyPx: currentInaccuracy()
        });
      }
      try {
        drawOverlayRef.current();
      } catch (error) {
        console.error('Overlay render failed; continuing without crashing the app.', error);
      }
      frame = requestAnimationFrame(animate);
    };
    animate();

    const resize = () => {
      refs.camera.aspect = mount.clientWidth / Math.max(1, mount.clientHeight);
      refs.camera.updateProjectionMatrix();
      refs.renderer.setSize(mount.clientWidth, mount.clientHeight);
      drawOverlayRef.current();
    };
    window.addEventListener('resize', resize);

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'shift', 'control', 'ctrl', 'c'].includes(key)) event.preventDefault();
      pressedKeysRef.current.add(key);
    };
    const onKeyUp = (event: KeyboardEvent) => pressedKeysRef.current.delete(event.key.toLowerCase());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      clearShotTimers();
      if (refs.weaponModel) disposeThreeObject(refs.weaponModel);
      disposeThreeObject(refs.scene);
      refs.renderer.dispose();
      mount.removeChild(refs.renderer.domElement);
      threeRef.current = null;
    };
  }, [clearShotTimers, currentInaccuracy, makeSample, props.weapon.inaccuracy.accurateMoveSpeedRatio, props.weapon.movementSpeed, pushSample]);

  useEffect(() => {
    const onPointerLockChange = () => setPointerLocked(document.pointerLockElement === overlayRef.current);
    const onMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement !== overlayRef.current) return;
      const player = playerRef.current;
      const sensitivityScale = Math.max(0.2, props.settings.cs2Sensitivity) * 0.0019;
      player.yaw -= event.movementX * sensitivityScale;
      player.pitch -= event.movementY * sensitivityScale;
      player.pitch = Math.max(-1.25, Math.min(1.25, player.pitch));

      if (activeRef.current && threeRef.current) {
        threeRef.current.camera.rotation.set(player.pitch, player.yaw, 0);
        const sample = makeSample(performance.now() - attemptStartTimeRef.current);
        pushSample(sample);
        setLastPointer({ x: sample.x, y: sample.y });
      }
    };
    const onMouseUp = () => {
      if (activeRef.current) completeAttempt();
    };
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [completeAttempt, makeSample, props.settings.cs2Sensitivity, pushSample]);

  useEffect(() => {
    let cancelled = false;
    const refs = threeRef.current;
    if (!refs) return;
    if (refs.weaponModel) {
      refs.weaponMount.remove(refs.weaponModel);
      disposeThreeObject(refs.weaponModel);
      refs.weaponModel = undefined;
    }
    loadImportedWeaponGroup(props.weapon.id)
      .then((importedGroup) => {
        if (cancelled || !threeRef.current) return;
        if (importedGroup) {
          threeRef.current.weaponMount.add(importedGroup);
          threeRef.current.weaponModel = importedGroup;
          return;
        }

        return fetch(getWeaponModelUrl(props.weapon.id))
          .then((response) => response.json())
          .then((json) => parseWeaponModelAsset(json))
          .then((asset) => {
            if (cancelled || !threeRef.current) return;
            const group = buildWeaponGroup(asset);
            group.scale.setScalar(props.weapon.id === 'mp9' || props.weapon.id === 'mac10' ? 0.42 : 0.34);
            threeRef.current.weaponMount.add(group);
            threeRef.current.weaponModel = group;
          });
      })
      .catch(() => {
        // The overlay/scoring still works if an imported model asset is missing.
      });
    return () => { cancelled = true; };
  }, [props.weapon.id]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => completeAttempt(), finalTime + props.weapon.refireMs * 0.82);
    return () => window.clearTimeout(timer);
  }, [active, completeAttempt, finalTime, props.weapon.refireMs]);

  useEffect(() => () => clearShotTimers(), [clearShotTimers]);

  const begin = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const canvas = overlayRef.current;
    if (!canvas) return;
    if (document.pointerLockElement !== canvas) {
      void canvas.requestPointerLock?.();
    }

    const aimOffset = getWallAimOffset();
    const now = performance.now();
    completedRef.current = false;
    activeRef.current = true;
    setActive(true);
    mousePullRef.current = { x: 0, y: 0 };
    autoRecoilOffsetRef.current = { x: 0, y: 0 };
    attemptStartTimeRef.current = now;
    sprayStartViewRef.current = { yaw: playerRef.current.yaw, pitch: playerRef.current.pitch };
    sprayStartAimOffsetRef.current = aimOffset;
    sprayStartWallOffsetRef.current = aimOffset;
    samplesRef.current = [{ ...makeSample(0), x: 0, y: 0, startAimOffsetX: aimOffset.x, startAimOffsetY: aimOffset.y }];
    setSamples(samplesRef.current);
    setLastPointer({ x: 0, y: 0 });
    setShotPulse(null);
    shotPulseRef.current = null;
    targetImpactsRef.current = [];
    startShotAudio(now);
  };

  const releaseMouse = () => {
    if (document.pointerLockElement === overlayRef.current) document.exitPointerLock();
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-3 shadow-2xl shadow-black/30">
      <div className="relative mx-auto aspect-[1120/650] w-full max-w-[1760px] overflow-hidden rounded-2xl border border-white/10 bg-slate-950">
        <div ref={mountRef} className="absolute inset-0" />
        <canvas
          ref={overlayRef}
          width={canvasWidth}
          height={canvasHeight}
          className="absolute inset-0 h-full w-full touch-none cursor-crosshair"
          onPointerDown={begin}
          onContextMenu={(event) => event.preventDefault()}
        />
        {!pointerLocked && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-950/35">
            <div className="max-w-md rounded-2xl border border-cyan-400/30 bg-slate-950/90 p-5 text-center shadow-2xl shadow-cyan-950/30">
              <p className="text-lg font-semibold text-white">Click to enter the 3D range</p>
              <p className="mt-2 text-sm text-slate-300">Mouse controls the camera. ESC releases the mouse.</p>
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-400">
        <span>WASD move · Shift sprint · Ctrl/C crouch · ESC releases mouse · sensitivity/settings are at the bottom.</span>
        <span className="text-amber-300">{lastPointer.x || lastPointer.y ? `Mouse pull: ${Math.round(lastPointer.x)}, ${Math.round(lastPointer.y)}` : 'Aim at the head, then hold fire.'}</span>
        <button type="button" onClick={releaseMouse} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-200 transition hover:bg-white/10">
          Release mouse / exit 3D scene
        </button>
      </div>
    </div>
  );
}
