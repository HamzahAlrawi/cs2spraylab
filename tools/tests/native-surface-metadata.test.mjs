import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {extractNativeSurfaces} from '../native-surface-metadata.mjs';
import {parseKv3} from '../kv3.mjs';

test('resolves explicit PHYS hashes and game/physics inheritance, never texture names',()=>{
  const physics=[
    {surfacePropertyName:'default',m_nameHash:10},
    {surfacePropertyName:'Wood',m_nameHash:20},
    {surfacePropertyName:'Wood_Panel',m_nameHash:30,base:'Wood',m_baseNameHash:20},
    {surfacePropertyName:'solidmetal',m_nameHash:40},
  ];
  const game=[{surfacePropertyName:'default',gamematerial:'C',bulletPenetrationDistanceModifier:.5},
    {surfacePropertyName:'Wood',gamematerial:'W',bulletPenetrationDistanceModifier:.9},
    {surfacePropertyName:'solidmetal',gamematerial:'M',bulletPenetrationDistanceModifier:.27}];
  const result=extractNativeSurfaces([30,40,999],physics,game);
  assert.equal(result[0].name,'Wood_Panel');assert.equal(result[0].material,'wood');assert.equal(result[0].penetrationModifier,.9);
  assert.equal(result[1].material,'metal');assert.equal(result[1].penetrationModifier,.27);
  assert.deepEqual(result[2],{id:2,hash:999});
});

test('rejects cyclic or incomplete inheritance instead of guessing a base',()=>{
  assert.throws(()=>extractNativeSurfaces([1],[{surfacePropertyName:'a',m_nameHash:1,base:'a'}],[]),/cycle/);
  assert.throws(()=>extractNativeSurfaces([1],[{surfacePropertyName:'a',m_nameHash:1,base:'missing'}],[]),/Missing/);
});

test('current on-disk PHYS resolves known concrete, wood and metal IDs',{
  skip:!fs.existsSync('research/dust2/physics.json') || !fs.existsSync('research/dust2/surfaces.vsurf'),
},()=>{
  const physics=JSON.parse(fs.readFileSync('research/dust2/physics.json','utf8'));
  const surfaces=extractNativeSurfaces(physics.m_surfacePropertyHashes,
    parseKv3(fs.readFileSync('research/dust2/surfaces.vsurf','utf8')).SurfacePropertiesList,
    parseKv3(fs.readFileSync('research/dust2/surfaceproperties_game.txt','utf8')).SurfacePropertiesList);
  assert.equal(surfaces.length,31);assert.equal(surfaces.filter(s=>s.name).length,31);
  assert.equal(surfaces[0].name,'concrete');assert.equal(surfaces[1].name,'Wood');assert.equal(surfaces[6].name,'metal');
  assert.equal(surfaces[11].penetrationModifier,.27);
  assert.equal(surfaces[14].gameMaterial,'13'); // Dense wood is not the W special branch.
});
