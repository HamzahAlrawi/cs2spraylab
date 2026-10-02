import type {Mode} from './config';
export const modeInfo: Record<Mode, {benefit: string; task: string; spread: boolean}> = {
  hearing: {benefit: 'Locate opponents before you see them', task: 'Listen to the hidden footsteps or gunfire, then mark their direction and distance. Compare your estimate with the revealed source.', spread: true},
  duel: {benefit: 'Turn practice into better duels', task: 'Read the opponent, isolate an angle, stop and shoot. Review your shot timing and aim after each fight.', spread: true},
  guided: {benefit: 'Learn the recoil correction', task: 'Move your crosshair to the green NOW ring. The pink NEXT ring previews the following correction. Start with a stationary target.', spread: false},
  spray: {benefit: 'Build a repeatable spray', task: 'Start at head height and keep your bullets on the target. Use the wall marks to judge your correction, not the crosshair alone.', spread: true},
  transfer: {benefit: 'Carry recoil control into a second kill', task: 'Spray A, then move to B without releasing the trigger. Continue correcting recoil; it does not restart when you switch targets.', spread: true},
  peek: {benefit: 'Prepare your aim before the duel', task: 'Follow the arrow out of cover, stop with the opposite movement key, then shoot the visible head. Small mouse corrections are normal.', spread: true},
  precision: {benefit: 'Stop accurately under pressure', task: 'Build sideways speed, release that key, tap the opposite direction, then fire one headshot. Standing still throughout does not train stopping.', spread: true},
  burst: {benefit: 'Stay mobile between accurate bursts', task: 'Stop and fire six rounds. Move at least 0.9 m sideways, stop again, then repeat.', spread: true},
};
