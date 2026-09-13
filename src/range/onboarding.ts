const HINT_KEY = 'spraylab.setup-hint.v1';
export function needsSetupHint() {
  try {
    return !localStorage.getItem(HINT_KEY) && !localStorage.getItem('spraylab.range.v2') && !localStorage.getItem('spraylab.settings.v1');
  } catch { return true; }
}
export function markSetupHintSeen() {
  try { localStorage.setItem(HINT_KEY, 'seen'); } catch { /* The hint can still be dismissed for this visit. */ }
}
