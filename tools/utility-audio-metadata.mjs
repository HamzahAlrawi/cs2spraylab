import {wavInfo} from './import-combat-feedback.mjs';

/** Source2Viewer's DATA summary exposes sample-space loops even for old v4 VSNDs. */
export function nativeSoundPlayback(summary) {
  const field = name => Number(summary.match(new RegExp(`^${name}: (-?\\d+)`, 'm'))?.[1] ?? NaN);
  const sampleRate = field('Sample Rate'), sampleCount = field('SampleCount');
  const loopStart = field('LoopStart'), loopEnd = field('LoopEnd');
  if (![sampleRate, sampleCount, loopStart, loopEnd].every(Number.isFinite) || sampleRate <= 0 || sampleCount <= 0)
    throw new Error('Missing native VSND sample/loop metadata');
  const end = loopEnd === 0 ? sampleCount : loopEnd;
  if (loopStart < -1 || loopStart >= sampleCount || end > sampleCount || end <= loopStart)
    throw new Error('Invalid native VSND loop bounds');
  return {nativeSound: {sampleRate, sampleCount, loopStart, loopEnd},
    ...(loopStart >= 0 ? {loop: {start: loopStart / sampleRate, end: end / sampleRate}} : {})};
}

/** Measurement only: do not normalize quiet authored foley into loud effects. */
export function wavSignal(bytes) {
  const info = wavInfo(bytes);
  if (info.format !== 1 || info.bitsPerSample !== 16) return {measurement: 'unsupported PCM format'};
  let squares = 0, peak = 0, count = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = bytes.readUInt32LE(offset + 4), start = offset + 8;
    if (bytes.toString('ascii', offset, offset + 4) === 'data') for (let i = start; i < start + length; i += 2) {
      const value = bytes.readInt16LE(i) / 32768;
      peak = Math.max(peak, Math.abs(value)); squares += value * value; count++;
    }
    offset = start + length + length % 2;
  }
  return {peak, rms: Math.sqrt(squares / count), silent: peak === 0};
}
