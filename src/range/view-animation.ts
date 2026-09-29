import * as THREE from 'three';

export class ViewAnimation {
  private mixer: THREE.AnimationMixer;
  private idle?: THREE.AnimationAction;
  private reload?: THREE.AnimationAction;
  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip); action.play(); action.paused = true;
      if (clip.name === 'idle') this.idle = action;
      else if (clip.name === 'reload') this.reload = action;
      else action.enabled = false;
    }
    this.update(0, 1);
  }
  update(remaining: number, duration: number) {
    const progress = remaining > 0 ? Math.max(0, Math.min(1, 1 - remaining / duration)) : 0;
    const weight = remaining > 0 ? Math.min(1, progress * duration / .06, remaining / .08) : 0;
    if (this.idle) {this.idle.enabled = true; this.idle.setEffectiveWeight(1 - weight); this.idle.time = 0;}
    if (this.reload) {this.reload.enabled = weight > 0; this.reload.setEffectiveWeight(weight); this.reload.time = progress * this.reload.getClip().duration;}
    this.mixer.update(0);
  }
  dispose() {this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.mixer.getRoot());}
}
