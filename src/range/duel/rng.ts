function hash(seed: number, label: string) {
  let value = seed >>> 0;
  for (let index = 0; index < label.length; index++) value = Math.imul(value ^ label.charCodeAt(index), 16777619) >>> 0;
  return value || 0x9e3779b9;
}

export class DuelRandom {
  private state: number;
  constructor(seed: number, label = 'duel') { this.state = hash(seed, label); }
  next() {
    let value = this.state;
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x100000000;
  }
}

export function randomStream(seed: number, label: string): () => number {
  const stream = new DuelRandom(seed, label);
  return () => stream.next();
}
