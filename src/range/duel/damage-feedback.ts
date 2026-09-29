import type {Vec} from '../actor-physics';
import {damageBearing} from './coaching';

export class DamageFeedback {
  private root = document.createElement('div');
  private marks: {element: HTMLElement; bearing: number; at: number; strength: number}[] = [];
  constructor(host: HTMLElement) {this.root.className = 'damage-feedback'; this.root.setAttribute('aria-hidden', 'true'); host.append(this.root);}
  hit(player: Vec, source: Vec, damage: number, time: number) {
    if (this.marks.length >= 4) this.marks.shift()!.element.remove();
    const element = document.createElement('i'); element.className = 'damage-arc'; this.root.append(element);
    this.marks.push({element, bearing: damageBearing(player, source), at: time, strength: Math.min(1, .5 + damage / 100)});
  }
  update(time: number, yaw: number) {
    this.marks = this.marks.filter(mark => {
      const age = time - mark.at;
      if (age > .85) {mark.element.remove(); return false;}
      mark.element.style.transform = `translate(-50%, -50%) rotate(${mark.bearing + yaw}rad)`;
      mark.element.style.opacity = String(mark.strength * Math.min(1, Math.max(0, (.85 - age) / .5)));
      return true;
    });
  }
  clear() {this.marks = []; this.root.replaceChildren();}
  dispose() {this.root.remove();}
}
