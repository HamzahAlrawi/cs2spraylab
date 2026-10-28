import {clamp, DEG, STEP} from '../actor-physics';

export type AimMotor = {yawRate: number; pitchRate: number};
export type AimMotorMode = 'travel' | 'clearing' | 'holding' | 'acquiring' | 'tracking';
const tuning: Record<AimMotorMode, {response: number; rate: number; acceleration: number}> = {
  travel: {response: .8, rate: .8, acceleration: .7},
  clearing: {response: .72, rate: .65, acceleration: .6},
  holding: {response: .65, rate: .55, acceleration: .55},
  acquiring: {response: .85, rate: .85, acceleration: .8},
  tracking: {response: 1, rate: 1, acceleration: 1},
};

export function aimStep(state: AimMotor, yawError: number, pitchError: number, settlingMs: number,
  mode: AimMotorMode = 'tracking') {
  const context = tuning[mode];
  const response = clamp(4 / (settlingMs / 1000), 12, 28) * context.response;
  const baseRate = (settlingMs > 250 ? 175 : 350) * DEG;
  const maxRate = baseRate * context.rate;
  const maxAcceleration = baseRate / Math.max(.06, settlingMs / 1000 * .4) * context.acceleration;
  const axis = (error: number, rate: number) => {
    const acceleration = clamp(response * response * error - 2 * response * rate, -maxAcceleration, maxAcceleration);
    const desiredRate = clamp(rate + acceleration * STEP, -maxRate, maxRate);
    // A mode/target change must decelerate the existing hand motion, never
    // reset it or snap to an endpoint (including tiny target reversals).
    const nextRate = rate + clamp(desiredRate - rate, -maxAcceleration * STEP, maxAcceleration * STEP);
    const delta = nextRate * STEP;
    return {delta, rate: nextRate};
  };
  const yaw = axis(yawError, state.yawRate), pitch = axis(pitchError, state.pitchRate);
  state.yawRate = yaw.rate; state.pitchRate = pitch.rate;
  return {yawDelta: yaw.delta, pitchDelta: pitch.delta};
}
