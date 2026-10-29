/** Native names are case-insensitive; IDs such as WPN_ACTION_COMPLETE are not sounds. */
export function utilityAudioKey(name: string): string {
  const trimmed = name.trim().toLowerCase();
  return trimmed.startsWith('utility-') ? trimmed : `utility-cue-${trimmed.replace(/[^a-z0-9]+/g, '-')}`;
}

export type UtilityAudioOwner = string | number;
export type UtilitySamplePlayback = {loop?: {start: number; end: number}};

export function utilitySampleLoop(playback: UtilitySamplePlayback | undefined, duration: number) {
  const loop = playback?.loop;
  return loop && Number.isFinite(loop.start) && Number.isFinite(loop.end) &&
    loop.start >= 0 && loop.end > loop.start && loop.end <= duration + .001
    ? {start: loop.start, end: Math.min(duration, loop.end)} : undefined;
}
