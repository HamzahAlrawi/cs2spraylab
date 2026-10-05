import {describe, expect, it} from 'vitest';
import {Group, Mesh, SkinnedMesh} from 'three';
import {nativeActionMetadata, nativeFireAction, prepareNativeViewAssembly} from './native-view-actions';
import {gameData} from './config';

describe('native view assembly contract', () => {
  it('keeps animated skins visible after a draw-start bounds calculation', () => {
    const root = new Group(), hand = new SkinnedMesh(), gun = new SkinnedMesh(), staticMesh = new Mesh();
    root.add(hand, gun, staticMesh); prepareNativeViewAssembly(root);
    expect(hand.frustumCulled).toBe(false); expect(gun.frustumCulled).toBe(false);
    expect(staticMesh.frustumCulled).toBe(true);
  });
  it('requires authoritative Dualies side and preserves last-shot variants', () => {
    expect(nativeFireAction('elite')).toBe(null);
    expect(nativeFireAction('elite', {side:'left',lastShot:true})).toBe('fire-left-last');
    expect(nativeFireAction('elite', {side:'right'})).toBe('fire-right');
    expect(nativeFireAction('deagle', {lastShot:true})).toBe('fire-last');
    expect(nativeFireAction('scar20', {lastShot:true})).toBe('fire-last');
    expect(nativeFireAction('revolver', {alternate:true})).toBe('fire-alt');
    expect(nativeFireAction('ak47')).toBe('fire');
  });
  it('maps every current firearm and knife attack without accepting unknown guns', () => {
    for (const id of Object.keys(gameData.weapons)) {
      expect(nativeFireAction(id, id === 'elite' ? {side:'left'} : {})).not.toBe(null);
    }
    for (const id of ['knife', 'knife-butterfly']) {
      expect(nativeFireAction(id)).toBe('fire'); expect(nativeFireAction(id, {alternate:true})).toBe('fire-alt');
    }
    for (const id of ['nova', 'xm1014', 'mag7', 'sawedoff', 'zeus']) expect(nativeFireAction(id)).toBe('fire');
    for (const id of ['unknown', '']) expect(nativeFireAction(id)).toBe(null);
  });
  it('uses only authored last-shot variants', () => {
    for (const id of ['cz75a','usp','glock','hkp2000','p250','deagle','fiveseven','tec9','negev','scar20']) {
      expect(nativeFireAction(id)).toBe('fire');
      expect(nativeFireAction(id, {lastShot:true})).toBe('fire-last');
    }
    for (const id of ['ak47','m4a1s','mp9','awp','m249']) expect(nativeFireAction(id, {lastShot:true})).toBe('fire');
  });
  it('distinguishes authored scoped fire from alternate-fire gameplay', () => {
    for (const id of ['aug','sg553']) {
      expect(nativeFireAction(id, {zoomed:true})).toBe('fire-scoped');
      expect(nativeFireAction(id, {alternate:true})).toBe('fire');
      expect(nativeActionMetadata(id).scopedFire).toBe('fire-scoped');
    }
    for (const id of ['usp','m4a1s','mp5sd']) {
      expect(nativeFireAction(id)).toBe('fire');
      expect(nativeActionMetadata(id).silencedFire).toBe('fire');
    }
    expect(nativeFireAction('awp', {zoomed:true})).toBe('fire');
  });
  it('does not fabricate sniper scope or bolt clips', () => {
    for (const id of ['awp','ssg08','g3sg1','scar20']) {
      expect(nativeFireAction(id)).toBe('fire');
      expect(nativeActionMetadata(id).scope).toBe(null);
      expect(nativeActionMetadata(id).bolt).toBe(null);
    }
    expect(nativeActionMetadata('awp').boltIncludedInFire).toBe(true);
    expect(nativeActionMetadata('ssg08').boltIncludedInFire).toBe(true);
    expect(nativeActionMetadata('scar20').boltIncludedInFire).toBe(false);
    expect(nativeActionMetadata('revolver').charge).toBe('charge');
  });
});
