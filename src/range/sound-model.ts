import soundEvents from './sound-events-data.json';
import nativeFootsteps from './native-footsteps-data.json';
import type {Equipment} from './equipment';
import type {AcousticPath} from './spatial-audio';
import type {ActorKinematics} from './actor-physics';

// Installed CS2 convar snapshot: sv_min_jump_landing_sound 260. Merely
// reacquiring support on a ramp is not an audible jump landing.
export const MIN_AUDIBLE_LANDING_SPEED = 260 * .0254;
export function audibleLanding(before: Pick<ActorKinematics,'grounded'|'landedAt'>,
  after: Pick<ActorKinematics,'grounded'|'landedAt'|'landingVelocity'>) {
  return !before.grounded && !!after.grounded && after.landedAt !== undefined &&
    after.landedAt !== before.landedAt && (after.landingVelocity ?? 0) <= -MIN_AUDIBLE_LANDING_SPEED;
}

export function sampleIndex(count: number, previous: number | undefined, random: number) {
  random = Number.isFinite(random) ? Math.max(0, Math.min(1 - Number.EPSILON, random)) : 0;
  if (count <= 1) return 0;
  const index = Math.min(count - 2, Math.floor(random * (count - 1)));
  return previous === undefined ? Math.min(count - 1, Math.floor(random * count)) : index >= previous ? index + 1 : index;
}

// Linear interpolation of extracted knots, not Source 2's full Hermite mixer.
export function curveGain(units: number, points: number[][]) {
  if (!points.length) return 1;
  if (units <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) if (units <= points[i][0]) {
    const [x, y] = points[i], [px, py] = points[i - 1];
    return py + (y - py) * (units - px) / (x - px);
  }
  return points[points.length - 1][1];
}
export const footstepSurfaces: Readonly<Record<string, string>> = nativeFootsteps.surfaces;
const footstepEvents: Readonly<Record<string, {volume: number; distanceCurve: number[][]}>> = nativeFootsteps.events;
export function footstepEventKey(surface = 'concrete', landing = false) {
  const prefix = landing ? 'land-' : 'step-';
  const name = surface.toLowerCase();
  const bank = footstepEvents[prefix + name] ? name : footstepSurfaces[name] ?? name;
  return footstepEvents[prefix + bank] ? prefix + bank : prefix + 'concrete';
}
const stepCurve = nativeFootsteps.events['step-concrete'].distanceCurve;
export const FOOTSTEP_RANGE = stepCurve[stepCurve.length - 1][0] * .0254;
export function footstepGain(meters: number, surface = 'concrete', landing = false) {
  const key = footstepEventKey(surface, landing), event = footstepEvents[key];
  return key.endsWith('-silent') ? 0 : event.volume * curveGain(Math.max(0, meters) / .0254, event.distanceCurve);
}

export function gunshotRange(equipment: Equipment) {
  const points = soundEvents.weapons[equipment].distanceCurve;
  return points[points.length - 1][0] * .0254;
}
export function gunshotGain(equipment: Equipment, meters: number) {
  const event = soundEvents.weapons[equipment];
  return meters > gunshotRange(equipment) ? 0 : event.volume * curveGain(meters / .0254, event.distanceCurve);
}

/** Both AI hearing and Web Audio use the path length and cover transmission, once each. */
export function propagatedGunshotGain(equipment: Equipment, path: AcousticPath) {
  return gunshotGain(equipment, path.distance) * path.gain;
}
export function propagatedFootstepGain(path: AcousticPath, silent = false, surface = 'concrete', landing = false) {
  return silent ? 0 : footstepGain(path.distance, surface, landing) * path.gain;
}
export const inverseDistanceGain = (meters: number) => 1 / (1 + .7 * Math.max(0, meters / 3 - 1));
export function propagatedCueGain(key: string, path: AcousticPath, silent = false) {
  const cues = 'cues' in soundEvents ? soundEvents.cues as Record<string, {volume: number; distanceCurve: number[][]}> : {};
  const event = cues[key];
  if (silent || key.endsWith('-scope-out') || !event) return 0;
  const attenuation = event.distanceCurve.length ? curveGain(path.distance / .0254, event.distanceCurve)
    : inverseDistanceGain(path.distance);
  return event.volume * attenuation * path.gain;
}

export type SoundAction = 'reload' | 'reload-empty' | 'reload-start' | 'reload-loop' | 'reload-end' | 'draw' | 'inspect' | 'fire' | 'fire-alt' | 'charge';
export type SoundCue = {time: number; key: string; audience?: 'local' | 'all'};
export type SoundTimeline = {duration: number; cues: SoundCue[]; source?: string; sha256?: string};
export type SoundTimelines = Record<string, Partial<Record<SoundAction, SoundTimeline>>>;
export const nativeSoundTimelines: SoundTimelines = ('timelines' in soundEvents ? soundEvents.timelines : {}) as SoundTimelines;
export type ActorSoundState = {id: string | number; generation?: number; equipment: string; alive: boolean;
  local?: boolean; silent?: boolean; reloading: boolean; reloadEmpty?: boolean; reloadDuration?: number;
  reloadRemaining?: number; actionId?: string | number; reloadPhase?: 'idle' | 'magazine' | 'start' | 'shell' | 'finish'; reloadProgress?: number};
export type DueSoundCue = SoundCue & {actorId: string | number};

/** Simulation-clock driven, one bounded timeline per actor. No asynchronous late sounds. */
export class ActionSoundTimeline {
  private active = new Map<string | number, {timeline: SoundTimeline; start: number; duration: number;
    cursor: number; local: boolean}>();
  private actors = new Map<string | number, ActorSoundState>();
  constructor(private timelines: SoundTimelines = nativeSoundTimelines, readonly capacity = 32) {}
  setTimelines(timelines: SoundTimelines) {this.clear(); this.timelines = timelines;}
  start(id: string | number, equipment: string, action: SoundAction, now: number,
    options: {duration?: number; local?: boolean; silent?: boolean; elapsed?: number} = {}) {
    this.cancel(id);
    const actions = this.timelines[equipment];
    const timeline = actions?.[action] ?? (action === 'reload-empty' ? actions?.reload : undefined);
    const duration = options.duration ?? timeline?.duration ?? 0;
    if (options.silent || !timeline || !Number.isFinite(now) || !Number.isFinite(duration) || duration <= 0 ||
      !Number.isFinite(timeline.duration) || timeline.duration <= 0 || this.capacity <= 0) return false;
    if (this.active.size >= this.capacity) this.cancel(this.active.keys().next().value!);
    const elapsed = Number.isFinite(options.elapsed) ? Math.max(0, options.elapsed!) : 0;
    const cursor = elapsed > 0 ? timeline.cues.findIndex(cue => cue.time / timeline.duration * duration >= elapsed) : 0;
    this.active.set(id, {timeline, start: now - elapsed, duration, cursor: cursor < 0 ? timeline.cues.length : cursor,
      local: options.local ?? false});
    return true;
  }
  sync(actor: ActorSoundState, now: number) {
    const old = this.actors.get(actor.id);
    const changed = old && (old.equipment !== actor.equipment || old.generation !== actor.generation);
    if (!actor.alive || actor.silent || changed || old?.reloading && !actor.reloading) this.cancel(actor.id);
    if (actor.alive && !actor.silent && actor.reloading &&
      (!old?.reloading || changed || old.silent || old.actionId !== actor.actionId || old.reloadPhase !== actor.reloadPhase ||
        (actor.reloadProgress ?? 1) < (old.reloadProgress ?? 0))) {
      const elapsed = actor.reloadProgress !== undefined ? Math.max(0, actor.reloadProgress * (actor.reloadDuration ?? 0))
        : actor.reloadRemaining === undefined ? 0 : Math.max(0, (actor.reloadDuration ?? 0) - actor.reloadRemaining);
      const action = actor.reloadPhase === 'start' ? 'reload-start' : actor.reloadPhase === 'shell' ? 'reload-loop'
        : actor.reloadPhase === 'finish' ? 'reload-end' : actor.reloadEmpty ? 'reload-empty' : 'reload';
      this.start(actor.id, actor.equipment, action, now,
        {duration: actor.reloadDuration, local: actor.local, elapsed});
    }
    if (!this.actors.has(actor.id) && this.actors.size >= this.capacity) {
      const first = this.actors.keys().next().value!; this.actors.delete(first); this.cancel(first);
    }
    this.actors.set(actor.id, {...actor});
  }
  update(now: number): DueSoundCue[] {
    if (!Number.isFinite(now)) return [];
    const due: DueSoundCue[] = [];
    for (const [id, state] of this.active) {
      if (now < state.start) {this.cancel(id); continue;}
      while (state.cursor < state.timeline.cues.length) {
        const cue = state.timeline.cues[state.cursor];
        const at = state.start + cue.time / state.timeline.duration * state.duration;
        if (at > now + 1e-8) break;
        state.cursor++;
        // Do not dump a reload's entire foley after a paused/background frame.
        if (now - at <= .2 && (state.local || cue.audience !== 'local')) due.push({...cue, actorId: id});
      }
      if (state.cursor >= state.timeline.cues.length || now > state.start + state.duration) this.cancel(id);
    }
    return due;
  }
  cancel(id: string | number) {this.active.delete(id);}
  remove(id: string | number) {this.cancel(id); this.actors.delete(id);}
  clear() {this.active.clear(); this.actors.clear();}
  get size() {return this.active.size;}
}
