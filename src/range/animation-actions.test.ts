import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {syncAnimationActions} from './animation-actions';
import {ViewAnimation} from './view-animation';

// Three exposes these diagnostics at runtime, but not in its public typings.
const stats = (mixer: THREE.AnimationMixer) => (mixer as THREE.AnimationMixer & {
  stats: {actions: {inUse: number}; bindings: {inUse: number}};
}).stats;

describe('only contributing animation actions are scheduled', () => {
  it('keeps a large native library out of the active mixer and preserves shared-channel transitions', () => {
    const root = new THREE.Object3D(), mixer = new THREE.AnimationMixer(root), active = new Set<THREE.AnimationAction>();
    const actions = Array.from({length: 100}, (_, index) => {
      const action = mixer.clipAction(new THREE.AnimationClip(`clip-${index}`, 0, [
        new THREE.NumberKeyframeTrack('.position[x]', [0], [index]),
      ]));
      action.enabled = false; return action;
    });
    for (let index = 0; index < 100; index++) {
      const next = actions[index];
      for (const action of actions) action.enabled = action === next;
      next.setEffectiveWeight(1);
      syncAnimationActions(actions, active); mixer.update(0);
      expect(root.position.x).toBe(index);
      expect(stats(mixer).actions.inUse).toBe(1);
      expect(stats(mixer).bindings.inUse).toBe(1);
    }
    actions[99].enabled = false; syncAnimationActions(actions, active); mixer.update(0);
    expect(root.position.x).toBe(0); expect(stats(mixer).actions.inUse).toBe(0);
    mixer.uncacheRoot(root);
  });

  it('samples first-person fire/inspect/reload while scheduling at most two actions', () => {
    const root = new THREE.Object3D();
    const clips = ['idle', 'inspect', 'reload', 'draw', 'fire', 'fire-alt', 'dryfire'].map((name, index) =>
      new THREE.AnimationClip(name, 1, [new THREE.NumberKeyframeTrack('.position[x]', [0, 1], [index, index + 1])]));
    const animation = new ViewAnimation(root, clips), mixer = (animation as unknown as {mixer: THREE.AnimationMixer}).mixer;
    expect(stats(mixer).actions.inUse).toBe(1);
    animation.playInspect(); animation.update(0, 1, .2); expect(stats(mixer).actions.inUse).toBeLessThanOrEqual(2);
    animation.playFire('ak47'); animation.update(0, 1, .2); expect(stats(mixer).actions.inUse).toBeLessThanOrEqual(2);
    animation.update(.5, 1); expect(stats(mixer).actions.inUse).toBeLessThanOrEqual(2);
    animation.cancel(); expect(stats(mixer).actions.inUse).toBe(1);
    animation.dispose(); expect(stats(mixer).actions.inUse).toBe(0);
  });
});
