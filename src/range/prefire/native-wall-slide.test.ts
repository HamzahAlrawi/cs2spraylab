import {describe,expect,it} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {NativeMapCollision} from './native-collision';
import {advanceActor,idleInput,STEP,UNIT,type ActorKinematics} from '../actor-physics';

// Native collision witnesses, not matched CS2 trajectory captures; keep each export's build.
const witnesses=[
  {map:'mirage',crouched:false,build:'2000942',hash:'6253487f363acf4b1b5bd2e8af0468a8fc29814ec36e564a8643f4645da88352',
    start:{x:-15.053732872009277,y:3.251199960708618,z:7.821199645996094},normal:{x:0,z:1},sign:-1},
  {map:'dust2',crouched:false,build:'2000932',hash:'395a10802ed5a26dce1c48b754adc7c2f1418755edc4f62c401597d19f7e6396',
    start:{x:-82.80261700003248,y:1.561332558192132,z:-55.98081589764848},normal:{x:.999999968660781,z:-.0000050065270906237475},sign:1},
  {map:'mirage',crouched:true,build:'2000942',hash:'6253487f363acf4b1b5bd2e8af0468a8fc29814ec36e564a8643f4645da88352',
    start:{x:-23.77338150848198,y:-2.0738122837310797,z:-14.22400229668802},normal:{x:0,z:1},sign:0},
] as const;
for(const witness of witnesses)describe.skipIf(!existsSync(`public/revamp/maps/${witness.map}/collision.bin`))(`${witness.map} native wall contact (${witness.crouched?'crouched':'standing'})`,()=>{
  it('continues past the sampled wall/floor seam without entering solids',async()=>{
    const base=`public/revamp/maps/${witness.map}/`,manifest=JSON.parse(readFileSync(base+'collision.json','utf8'));
    const bytes=readFileSync(base+'collision.bin');
    expect(manifest.build).toBe(witness.build);expect(manifest.collisionSha256).toBe(witness.hash);
    const collision=await NativeMapCollision.create(manifest,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer);
    try {
      let p={...witness.start} as {x:number;y:number;z:number};
      const n=witness.normal,t={x:-n.z,z:n.x},world={solids:[],floor:null,native:collision};
      const height=(witness.crouched?54:72)*UNIT,eye=(witness.crouched?46:64)*UNIT;
      expect(collision.fits(p,p.y,height)).toBe(true);
      let actor:ActorKinematics={position:{...p,y:p.y+eye},feet:p.y,eyeHeight:eye,verticalVelocity:0,
        duckAmount:Number(witness.crouched),crouchHeld:witness.crouched,
        velocity:{x:0,z:0},grounded:true,jumpHeld:false,yaw:Math.atan2(witness.sign*n.x-t.x,witness.sign*n.z-t.z)+Math.PI/4};
      let reference=actor;
      for(let tick=0;tick<96;tick++){
        const input={...idleInput(),forward:1,side:1,crouch:witness.crouched};
        actor=advanceActor(actor,input,215*UNIT,STEP,undefined,undefined,undefined,world);
        reference=advanceActor(reference,input,215*UNIT,STEP,undefined,undefined,undefined,{solids:[],floor:witness.start.y});
        p={...actor.position,y:actor.feet};
        expect(collision.fits(p,p.y,height),`tick ${tick}`).toBe(true);
      }
      const clearDistance=Math.hypot(reference.position.x-witness.start.x,reference.position.z-witness.start.z);
      expect(Math.hypot(p.x-witness.start.x,p.z-witness.start.z)).toBeGreaterThan(witness.crouched?clearDistance*.95:.5);
    }finally{collision.dispose();}
  });
});
