import {describe, expect, it} from 'vitest';
import {DuelEngine} from './DuelEngine';

describe('route requests during GPU preparation', () => {
  const subject = () => ({loadingMap: true, pendingMapSelection: false, pendingSetupRestart: false});
  const restart = (state: ReturnType<typeof subject>, continuous = false, changeMap = true) =>
    DuelEngine.prototype.restart.call(state as unknown as DuelEngine, continuous, changeMap);
  it('queues manual route changes instead of dropping them while an earlier route is preparing', () => {
    const state = subject(); restart(state); restart(state);
    expect(state.pendingMapSelection).toBe(true);
  });
  it('retains a queued map/route selection when later changes need only a same-map restart', () => {
    const state = subject(); restart(state, false, true); restart(state, false, false);
    expect(state).toMatchObject({pendingMapSelection: true, pendingSetupRestart: true});
  });
  it('does not queue repeated automatic round transitions while loading', () => {
    const state = subject(); restart(state, true);
    expect(state).toMatchObject({pendingMapSelection: false, pendingSetupRestart: false});
  });
});
