// Metric labels are persisted practice keys. Translate presentation, not saved data.
const skillNames: Readonly<Record<string, string>> = {
  'Opening brake': 'First-bullet timing',
  'Opposite-key brake': 'Counter-strafe',
  'Aim at the stop': 'Pre-aim at the stop',
  'Aim at the opening shot': 'First-bullet placement',
  'Settled shots': 'Stop-shoot timing',
  'Settled openings': 'First-bullet timing',
  'Prepared aim': 'Crosshair placement',
  'Prepared openings': 'Crosshair placement',
  'Opening preparation': 'First-bullet placement',
  'Shot discipline': 'Stop-shoot timing',
  'Single-angle openings': 'Angle isolation',
  'Recoil containment': 'Spray control',
  'B acquisition': 'First hit on B',
  'Tap shot discipline': 'Tap timing',
  'Tap preparation': 'Tap placement',
  'Tap physical hits': 'Tap hit rate',
};
export const skillName = (label: string) => skillNames[label] ?? label;

const terms = {
  counter: {name: 'Counter-strafe', meaning: 'Release your strafe key and briefly tap the opposite direction to brake. Fire once your speed is low enough; holding both keys or crouching is not an instant stop.'},
  placement: {name: 'Crosshair placement / pre-aim', meaning: 'Prepare your crosshair for the next likely enemy before exposing yourself. Strafe into the angle; use the mouse for height changes, off-angles and the final correction. Do not force movement-only aim.'},
  isolation: {name: 'Slice the pie', meaning: 'Clear possible enemy positions one at a time, using cover to limit simultaneous fights. A wide swing can still be useful when committing to a known single opponent.'},
  recoil: {name: 'Spray control / reset', meaning: 'Compensate the recoil while firing. At range, compare short bursts with a recovery pause. Releasing the trigger or changing targets does not instantly reset recoil; random spread cannot be pulled back onto target.'},
} as const;
export function coachingTerms(labels: readonly string[]) {
  const selected = new Set<keyof typeof terms>();
  for (const label of labels) {
    if (/brake|settled|discipline|shot timing|movement sequence/i.test(label)) selected.add('counter');
    if (/prepared|preparation|aim at|tap preparation/i.test(label)) selected.add('placement');
    if (/isolat|single-angle/i.test(label)) selected.add('isolation');
    if (/recoil|spray|transfer/i.test(label)) selected.add('recoil');
  }
  return [...selected].slice(0, 3).map(key => terms[key]);
}
