import {describe,expect,it} from 'vitest';
import {audibleLanding,MIN_AUDIBLE_LANDING_SPEED} from './sound-model';
import {advanceActor,idleInput,STEP,UNIT} from './actor-physics';
import {existsSync,readFileSync} from 'node:fs';

describe('native minimum audible jump landing speed',()=>{
  it.skipIf(!existsSync('research/convars.txt'))('matches the locally captured game convar rather than a guessed debounce',()=>{
    const captured=readFileSync('research/convars.txt','utf8').match(/^sv_min_jump_landing_sound\s+([\d.]+)/m);
    expect(captured).not.toBeNull();expect(MIN_AUDIBLE_LANDING_SPEED/UNIT).toBe(Number(captured![1]));
  });
  it('does not play a heavy landing when support is regained at a ramp seam',()=>{
    for(const velocity of [0,-6.25,-100,-259.99])expect(audibleLanding({grounded:false},
      {grounded:true,landedAt:1,landingVelocity:velocity*UNIT})).toBe(false);
    expect(MIN_AUDIBLE_LANDING_SPEED/UNIT).toBe(260);
  });
  it('plays one landing for a real jump, not every grounded physics tick',()=>{
    let actor=advanceActor({position:{x:0,y:64*UNIT,z:0},velocity:{x:0,z:0},yaw:0,feet:0,
      verticalVelocity:0,eyeHeight:64*UNIT,jumpHeld:false,grounded:true},{...idleInput(),jump:true},215*UNIT,STEP);
    let count=0;
    for(let i=0;i<200;i++){
      const next=advanceActor(actor,idleInput(),215*UNIT,STEP);
      count+=Number(audibleLanding(actor,next));actor=next;
    }
    expect(count).toBe(1);
  });
  it('does not reuse a stale impact after a shallow contact interruption',()=>{
    const before={grounded:false,landedAt:2};
    expect(audibleLanding(before,{grounded:true,landedAt:2,landingVelocity:-300*UNIT})).toBe(false);
    expect(audibleLanding(before,{grounded:true,landedAt:3,landingVelocity:-300*UNIT})).toBe(true);
  });
});
