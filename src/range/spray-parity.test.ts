import {describe,it,expect,vi} from 'vitest';
import {defaults,gameData,weaponIds,type Weapon} from './config';
import {Simulation,STEP,type Shot} from './simulation';

function capture(weapon:Weapon,mode:'guided'|'peek',distance:number,spread=false){
  const sim=new Simulation({...defaults,weapon,mode,spread,peekDuration:10});
  sim.position={x:0,y:1.6256,z:-100+distance};sim.yaw=.12;sim.pitch=.015;
  const shots:Shot[]=[];sim.onShot=shot=>shots.push(shot);
  const count=Math.min(8,gameData.weapons[weapon].magazine);
  sim.start(true);
  for(let tick=0;tick<Math.ceil(20/STEP)&&shots.length<count;tick++){
    sim.step(STEP);
    if(!sim.firing && sim.time>=sim.lastShotAt+sim.stats.cycle)sim.start();
  }
  expect(shots).toHaveLength(count);
  return shots;
}
describe('Peeking spray parity',()=>{
  it.each(weaponIds)('%s uses the same recoil and physical shot rays as guided spray at all distances',weapon=>{
    let reference:number[][]|undefined;
    for(const distance of [8,30,80]){
      const regular=capture(weapon,'guided',distance),peek=capture(weapon,'peek',distance);
      expect(peek.map(s=>[s.recoil,s.direction])).toEqual(regular.map(s=>[s.recoil,s.direction]));
      const projected=peek.map(s=>{
        const t=(-100-s.origin.z)/s.direction.z;
        return [(s.origin.x+s.direction.x*t)/distance,(s.origin.y+s.direction.y*t-1.6256)/distance];
      });
      if(reference)for(let i=0;i<peek.length;i++)for(let axis=0;axis<2;axis++)expect(projected[i][axis]).toBeCloseTo(reference[i][axis],12);
      reference=projected;
    }
  });
  it('uses the same optional spread when enabled, without a mode-specific multiplier',()=>{
    const random=vi.spyOn(Math,'random').mockReturnValue(.35);
    try{expect(capture('ak47','peek',20,true).map(s=>s.direction)).toEqual(capture('ak47','guided',20,true).map(s=>s.direction));}
    finally{random.mockRestore();}
  });
});
