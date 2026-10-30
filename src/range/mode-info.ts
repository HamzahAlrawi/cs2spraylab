import type {Mode} from './config';
export const modeInfo: Record<Mode, {benefit: string; task: string; spread: boolean}> = {
  hearing: {benefit: 'Locate opponents before you see them', task: 'Listen to the hidden footsteps or gunfire, then mark their direction and distance. Compare your estimate with the revealed source.', spread: true},
  duel: {benefit: 'Win cleaner duels', task: 'Pre-aim, use cover to isolate a fight and counter-strafe for the opening shot. Review first-bullet placement, shot timing and spray control after the fight.', spread: true},
  prefire: {benefit: 'Clear common angles with better crosshair placement', task: 'Pre-aim the next common angle, slice the pie and stop before firing. Use the angle review to repeat a weak entry, not just race the route timer.', spread: true},
  guided: {benefit: 'Learn the recoil correction', task: 'Move your crosshair to the green NOW ring. The pink NEXT ring previews the following correction. Start with a stationary target.', spread: false},
  spray: {benefit: 'Build a repeatable spray', task: 'Start at head height and keep your bullets on the target. Use the wall marks to judge your correction, not the crosshair alone.', spread: true},
  transfer: {benefit: 'Carry recoil control into a second kill', task: 'Spray A, then move to B without releasing the trigger. Continue correcting recoil; it does not restart when you switch targets.', spread: true},
  peek: {benefit: 'Pre-aim before taking the fight', task: 'Follow the arrow out of cover, counter-strafe and fire at the exposed target. Use the mouse to correct an off-angle; movement-only aiming is not a rule.', spread: true},
  precision: {benefit: 'Make the first bullet accurate', task: 'Build sideways speed, release that key, tap the opposite direction to counter-strafe, then fire. Standing still throughout skips the stop-shoot practice.', spread: true},
  burst: {benefit: 'Burst, reposition, repeat', task: 'Counter-strafe and fire six rounds. Release the trigger, strafe at least 0.9 m, then stop for the next burst.', spread: true},
};
