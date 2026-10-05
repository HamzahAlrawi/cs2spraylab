import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {parseKv3} from './kv3.mjs';

// Independent, read-only comparison against a fresh export of the installed archive.
const game = process.env.CS2_PATH || 'C:/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive';
const cli = path.resolve('.local-tools/vrf/Source2Viewer-CLI.exe');
const file = path.resolve('research/weapon-stats-audit.vdata');
fs.mkdirSync(path.dirname(file), {recursive:true});
execFileSync(cli,['-i',`${game}/game/csgo/pak01_dir.vpk`,'-f','scripts/weapons.vdata_c','-d','-o',file],{stdio:'pipe'});
const raw = fs.readFileSync(file,'utf8'), native = parseKv3(raw);
const runtime = JSON.parse(fs.readFileSync('src/range/game-data.json','utf8'));
const build = fs.readFileSync(`${game}/game/csgo/steam.inf`,'utf8').match(/ClientVersion=(\d+)/)[1];
assert.equal(runtime.build,build,'Runtime weapon data was exported from a different game build');
const aliases={m4a4:'m4a1',m4a1s:'m4a1_silencer',galil:'galilar',sg553:'sg556',usp:'usp_silencer',zeus:'taser'};
const fields={damage:'m_nDamage',penetration:'m_flPenetration',armorRatio:'m_flArmorRatio',headshotMultiplier:'m_flHeadshotMultiplier',
  range:'m_flRange',rangeModifier:'m_flRangeModifier',magazine:'m_iMaxClip1',cycle:'m_flCycleTime',speed:'m_flMaxSpeed',
  deploy:'m_flDeployDuration',reload:'m_flDisallowAttackAfterReloadStartDuration',spread:'m_flSpread',
  stand:'m_flInaccuracyStand',crouch:'m_flInaccuracyCrouch',move:'m_flInaccuracyMove',fire:'m_flInaccuracyFire',
  jump:'m_flInaccuracyJump',jumpInitial:'m_flInaccuracyJumpInitial',jumpApex:'m_flInaccuracyJumpApex',land:'m_flInaccuracyLand',
  recovery:'m_flRecoveryTimeStand',recoveryFinal:'m_flRecoveryTimeStandFinal',recoveryCrouch:'m_flRecoveryTimeCrouch',
  recoveryCrouchFinal:'m_flRecoveryTimeCrouchFinal',recoveryStart:'m_nRecoveryTransitionStartBullet',recoveryEnd:'m_nRecoveryTransitionEndBullet',
  recoilSeed:'m_nRecoilSeed',recoilAngle:'m_flRecoilAngle',recoilVariance:'m_flRecoilAngleVariance',
  recoilMagnitude:'m_flRecoilMagnitude',recoilMagnitudeVariance:'m_flRecoilMagnitudeVariance'};
const flags={fullAuto:'m_bIsFullAuto',zoomLevels:'m_nZoomLevels',hideWhenZoomed:'m_bHideViewModelWhenZoomed',
  hasBurst:'m_bHasBurstMode',burstCycle:'m_flCycleTimeWhenInBurstMode',burstInterval:'m_flTimeBetweenBurstShots',
  unzoomsAfterShot:'m_bUnzoomsAfterShot',isRevolver:'m_bIsRevolver',showCrosshair:'m_bShowCrosshair'};
const fixture={build,source:'scripts/weapons.vdata_c',sha256:crypto.createHash('sha256').update(raw).digest('hex'),
  limitations:['Exported stats verified; damage hitgroup/armor arithmetic is separately tested, not native-engine emulated.','R8 windup is not present in weapons.vdata and remains an explicit trainer estimate.'],weapons:{}};
for(const [id,weapon] of Object.entries(runtime.weapons)) {
  const source=native[`weapon_${aliases[id]||id}`]; assert(source,`Missing native ${id}`);
  const mode=index=>Object.fromEntries(Object.entries(fields).map(([key,field])=>{
    const value=Array.isArray(source[field])?source[field][index]:source[field];
    assert(Number.isFinite(value),`Invalid ${id}.${field}`);return [key,value];
  }));
  const primary=mode(['usp','m4a1s'].includes(id)?1:0),alternate=mode(1);
  for(const [name,stats] of [['primary',primary],['alternate',alternate]]) for(const [key,value] of Object.entries(stats))
    assert.equal((name==='primary'?weapon:weapon.alternate)[key],value,`${id}.${name}.${key}`);
  // Non-snipers omit this override; retain the ordinary crosshair by default.
  const controls=Object.fromEntries(Object.entries(flags).map(([key,field])=>[key,key==='showCrosshair'?source[field]??true:source[field]]));
  controls.zoomFov=[source.m_nZoomFOV1,source.m_nZoomFOV2];controls.zoomTime=[source.m_flZoomTime0,source.m_flZoomTime1,source.m_flZoomTime2];
  for(const [key,value] of Object.entries(controls)) assert.deepEqual(weapon[key],value,`${id}.${key}`);
  const ammo = {pellets:source.m_nNumBullets, reserveAsClips:source.m_bReserveAmmoAsClips ?? false,
    reserve:source.m_nPrimaryReserveAmmoMax*(source.m_bReserveAmmoAsClips?source.m_iMaxClip1:1),
    reloadsSingleShells:source.m_bReloadsSingleShells ?? false, spreadSeed:source.m_nSpreadSeed};
  for(const [key,value] of Object.entries(ammo)) assert.deepEqual(weapon[key],value,`${id}.${key}`);
  fixture.weapons[id]={primary,alternate,...controls,...ammo};
  console.log(`${id}: ${primary.damage} damage; ${primary.armorRatio/2*100}% armor penetration; ${primary.magazine} rounds; ${primary.cycle}s cycle. Both modes verified.`);
}
if(process.argv.includes('--write-fixture')) fs.writeFileSync('src/range/native-weapon-stats-fixture.json',JSON.stringify(fixture,null,2)+'\n');
console.log(`Verified ${Object.keys(fixture.weapons).length} weapons against installed build ${build}; export SHA256 ${fixture.sha256}`);
