import { Weapon } from './config';

export class RangeAudio {
  context?: AudioContext;
  buffers = new Map<Weapon, AudioBuffer>();
  pending = new Map<Weapon, Promise<void>>();
  voices = new Set<AudioBufferSourceNode>();
  disposed = false;
  status: 'locked' | 'ready' | 'unavailable' = 'locked';
  async unlock(weapon: Weapon) {
    try {
      const Constructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Constructor) throw new Error('Web Audio unavailable');
      this.context ??= new Constructor({ latencyHint: 'interactive' });
      // Resume happens in the gesture, before network/decode awaits.
      await this.context.resume();
      if (!this.pending.has(weapon)) this.pending.set(weapon, this.load(weapon));
      await this.pending.get(weapon);
      this.status = 'ready';
    } catch { this.status = 'unavailable'; this.pending.delete(weapon); }
  }
  private async load(weapon: Weapon) {
    const response = await fetch(`/audio/${weapon}.wav`);
    if (!response.ok) throw new Error('Missing audio');
    const buffer = await this.context!.decodeAudioData(await response.arrayBuffer());
    if (!this.disposed) this.buffers.set(weapon, buffer);
  }
  play(weapon: Weapon, volume: number) {
    if (!this.context || this.context.state !== 'running' || !volume || this.disposed) return;
    const buffer = this.buffers.get(weapon);
    if (!buffer) return;
    try {
      if (this.voices.size >= 16) this.voices.values().next().value?.stop();
      const voice = this.context.createBufferSource();
      const gain = this.context.createGain();
      gain.gain.value = volume * .65;
      voice.buffer = buffer; voice.connect(gain); gain.connect(this.context.destination);
      this.voices.add(voice);
      voice.onended = () => { voice.disconnect(); gain.disconnect(); this.voices.delete(voice); };
      voice.start();
    } catch { this.status = 'unavailable'; }
  }
  dispose() { this.disposed = true; for (const v of this.voices) v.stop(); void this.context?.close().catch(() => {}); }
}
