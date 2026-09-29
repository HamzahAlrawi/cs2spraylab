import {clamp, DEG, STEP} from '../actor-physics';

export type AimMotor = {yawRate: number; pitchRate: number};

export function aimStep(state: AimMotor, yawError: number, pitchError: number, settlingMs: number) {
  const response = clamp(4 / (settlingMs / 1000), 12, 28);
  const maxRate = (settlingMs > 250 ? 175 : 350) * DEG;
  const maxAcceleration = maxRate / Math.max(.06, settlingMs / 1000 * .4);
  const axis = (error: number, rate: number) => {
    const acceleration = clamp(response * response * error - 2 * response * rate, -maxAcceleration, maxAcceleration);
    const nextRate = clamp(rate + acceleration * STEP, -maxRate, maxRate);
    const delta = nextRate * STEP;
    if (Math.sign(delta) === Math.sign(error) && Math.abs(delta) > Math.abs(error)) return {delta: error, rate: 0};
    return {delta, rate: nextRate};
  };
  const yaw = axis(yawError, state.yawRate), pitch = axis(pitchError, state.pitchRate);
  state.yawRate = yaw.rate; state.pitchRate = pitch.rate;
  return {yawDelta: yaw.delta, pitchDelta: pitch.delta};
}
