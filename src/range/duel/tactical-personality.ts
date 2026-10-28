import type {BotBehavior} from './config';
import type {BotTraits} from './skill';
import {randomStream} from './rng';

// A separate identity stream keeps personality stable without consuming the
// existing reaction/peek/crouch rolls. These are policy preferences, not skill.
export function tacticalPersonality(traits: BotTraits, behavior: BotBehavior, actorId: number) {
  const seed = Math.round(traits.recognitionMedianMs * 1000 + traits.motorSettlingMs * 100);
  const random = randomStream(seed, `tactical-personality:${actorId}`);
  // Related preferences share latent traits; changing an archetype does not
  // reroll the identity. These are authored policies, not FACEIT statistics.
  const deliberation = random(), teamwork = random(), flexibility = random();
  return Object.freeze({
    patience: (behavior === 'holder' ? 1.12 : behavior === 'aggressive' ? .88 : 1) * (.9 + deliberation * .2),
    riskTolerance: (behavior === 'aggressive' ? 1.12 : behavior === 'holder' ? .88 : 1) * (1.1 - deliberation * .2),
    tradeWillingness: .8 + teamwork * .4,
    adaptation: .8 + flexibility * .4,
    flankCommitment: .85 + deliberation * .25 + (1 - flexibility) * .15,
  });
}

export type TacticalPersonality = ReturnType<typeof tacticalPersonality>;
