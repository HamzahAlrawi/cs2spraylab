import type {AnimationAction} from 'three';

// Disabling an action alone leaves it and its bindings in Three's active mixer.
// Start replacements first so shared channels never restore an intermediate pose.
export function syncAnimationActions(actions: Iterable<AnimationAction>, active: Set<AnimationAction>, extra?: AnimationAction) {
  for (const action of actions) if (action.enabled && action.getEffectiveWeight() > 0 && !active.has(action)) {
    action.play(); action.paused = true; active.add(action);
  }
  if (extra?.enabled && extra.getEffectiveWeight() > 0 && !active.has(extra)) {
    extra.play(); extra.paused = true; active.add(extra);
  }
  for (const action of active) if (!action.enabled || action.getEffectiveWeight() <= 0) {
    action.stop(); action.enabled = false; active.delete(action);
  }
}
