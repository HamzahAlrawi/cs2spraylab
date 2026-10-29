import native from './utility-presentation-native.json';
import type {UtilityKind} from './utility-loadout';

export type UtilityViewAction = 'idle' | 'draw' | 'inspect' | 'pullpin' | 'hold-high' | 'hold-mid' | 'hold-low' | 'throw-high' | 'throw-low';
type NativeEvent = Readonly<{type: string; name?: string; at: number; authoredAt: number; duration: number; frame: number}>;
type NativeAction = Readonly<{seconds: number; frames: number; fps: number; pose: boolean; events: readonly NativeEvent[]}>;
type NativePresentation = Readonly<{actions: Readonly<Record<UtilityViewAction, NativeAction>>;
  deployDuration: number;
  completions: readonly Readonly<{state: string; remaining: number; event: string; type: string;
    comparison: string; actions: readonly Readonly<{action: UtilityViewAction; at: number}>[]}>[];
  transitions: readonly Readonly<{name: string; seconds: number}>[]}>;
export const nativeUtilityPresentation = native as unknown as Readonly<{build: string;
  utilities: Readonly<Record<UtilityKind, NativePresentation>>}>;

// Current viewmodel graph's Underhand condition (2000938), not a guessed midpoint.
export const utilityThrowAction = (strength: number): 'throw-low' | 'throw-high' =>
  Math.fround(strength) <= Math.fround(.33) ? 'throw-low' : 'throw-high';
/** Native graph state event, not a sound cue. Undefined means no verified completion rule. */
export function utilityActionCompleteAt(kind: UtilityKind, action: UtilityViewAction): number | undefined {
  for (const completion of nativeUtilityPresentation.utilities[kind].completions)
    for (const item of completion.actions) if (item.action === action) return item.at;
  return undefined;
}
export function utilityPinReadySeconds(kind: UtilityKind): number | undefined {return utilityActionCompleteAt(kind, 'pullpin');}
export function utilityNativeTiming(kind: UtilityKind, strength = 1) {
  const data = nativeUtilityPresentation.utilities[kind], action = utilityThrowAction(strength);
  return {draw: data.actions.draw.seconds, pullpin: data.actions.pullpin.seconds,
    deployDuration: data.deployDuration, drawCompleteAt: utilityActionCompleteAt(kind, 'draw'), pinReadyAt: utilityPinReadySeconds(kind),
    throwAction: action, throwDuration: data.actions[action].seconds,
    // A sound marker is useful for cosmetic alignment, NOT evidence of projectile release.
    throwSoundAt: data.actions[action].events.find(event => event.type.endsWith('_Sound') && event.name?.endsWith('.Throw'))?.at ?? 0,
    readyBlend: data.transitions.find(transition => transition.name === 'ReadyToThrow')?.seconds ?? 0};
}

/** Matches the parent's expanded utility audio importer; raw name remains available for auditing. */
export const utilityNativeCueKey = (name: string) => `utility-cue-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
export type UtilitySoundCue = Readonly<{name: string; key: string; at: number; endAt?: number; action: UtilityViewAction; index: number}>;
/** Authored seconds mapped to the SAME clock/rate as presentation; never a gameplay command. */
export function utilitySoundSchedule(kind: UtilityKind, action: UtilityViewAction, startedAt: number, rate = 1): readonly UtilitySoundCue[] {
  if (!Number.isFinite(startedAt) || !Number.isFinite(rate) || rate <= 0) return [];
  return nativeUtilityPresentation.utilities[kind].actions[action].events.flatMap((event, index) =>
    event.type.endsWith('_Sound') && event.name ? [{name: event.name, key: utilityNativeCueKey(event.name), at: startedAt + event.at / rate,
      ...(event.duration > 0 ? {endAt: startedAt + (event.at + event.duration) / rate} : {}), action, index}] : [])
    .sort((a, b) => a.at - b.at || a.index - b.index);
}

/** One action per actor. Replacing/cancelling the action invalidates its pending cues. */
export class UtilitySoundTimeline {
  private cues: readonly UtilitySoundCue[] = [];
  private next = 0;
  private previous = -Infinity;
  start(kind: UtilityKind, action: UtilityViewAction, startedAt: number, rate = 1) {
    this.cues = utilitySoundSchedule(kind, action, startedAt, rate); this.next = 0; this.previous = -Infinity;
  }
  advance(time: number): readonly UtilitySoundCue[] {
    if (!Number.isFinite(time) || time < this.previous) return [];
    this.previous = time;
    const start = this.next;
    while (this.next < this.cues.length && this.cues[this.next].at <= time) this.next++;
    return this.cues.slice(start, this.next);
  }
  cancel() {this.cues = []; this.next = 0; this.previous = -Infinity;}
}
