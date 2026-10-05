import {SkinnedMesh, type Object3D} from 'three';
import reloadPresentation from './native-reload-presentation.json';

export function nativeReloadWindow(id: string | undefined, phase: 'idle' | 'magazine' | 'start' | 'shell' | 'finish' | undefined) {
  if (!id || !phase || phase === 'idle' || phase === 'magazine') return undefined;
  const windows = (reloadPresentation.weapons as Record<string, Record<string, {start: number; duration: number}>>)[id];
  return windows?.[phase === 'start' ? 'intro' : phase === 'shell' ? 'loop' : 'outro'];
}

export type NativeViewAction = 'fire' | 'fire-last' | 'fire-alt' | 'fire-scoped' | 'fire-left' | 'fire-right' |
  'fire-left-last' | 'fire-right-last' | 'charge' | 'dryfire' | 'draw-alt' |
  'idle-empty' | 'idle-left-empty';

export interface NativeFireOptions {
  side?: 'left' | 'right'; lastShot?: boolean; alternate?: boolean; zoomed?: boolean;
}

const firearms = new Set([
  'ak47', 'm4a4', 'm4a1s', 'galil', 'famas', 'sg553', 'aug', 'mp9', 'mp7', 'mp5sd',
  'mac10', 'ump45', 'p90', 'bizon', 'm249', 'negev', 'cz75a', 'usp', 'glock', 'hkp2000',
  'p250', 'deagle', 'elite', 'fiveseven', 'tec9', 'revolver', 'awp', 'ssg08', 'g3sg1', 'scar20',
  'nova', 'xm1014', 'mag7', 'sawedoff', 'zeus',
]);
const lastShot = new Set(['cz75a', 'usp', 'glock', 'hkp2000', 'p250', 'deagle', 'fiveseven', 'tec9', 'negev', 'scar20']);

/** First-person skins have a tiny draw-start pose; cached bounds cannot cover later poses. */
export function prepareNativeViewAssembly(root: Object3D) {
  root.traverse(object => {
    if (object instanceof SkinnedMesh) object.frustumCulled = false;
  });
}

/** Presentation mapping only. The caller owns shot order, ammunition, cadence, and zoom. */
export function nativeFireAction(id: string, options: NativeFireOptions = {}): NativeViewAction | null {
  if (id === 'knife' || id.startsWith('knife-')) return options.alternate ? 'fire-alt' : 'fire';
  if (id === 'elite') {
    if (!options.side) return null;
    return `fire-${options.side}${options.lastShot ? '-last' : ''}`;
  }
  if (id === 'revolver') return options.alternate ? 'fire-alt' : 'fire';
  if (options.zoomed && (id === 'aug' || id === 'sg553')) return 'fire-scoped';
  if (options.lastShot && lastShot.has(id)) return 'fire-last';
  return firearms.has(id) ? 'fire' : null;
}

export function nativeActionMetadata(id: string) {
  return {
    charge: id === 'revolver' ? 'charge' as const : null,
    dryfire: id === 'revolver' ? 'dryfire' as const : null,
    boltIncludedInFire: id === 'awp' || id === 'ssg08',
    scopedFire: id === 'aug' || id === 'sg553' ? 'fire-scoped' as const : null,
    silencedFire: ['usp', 'm4a1s', 'mp5sd'].includes(id) ? 'fire' as const : null,
    bolt: null, pull: null, scope: null,
    chargePlayback: id === 'revolver' ? 'absolute-idle-composed; clamp at end until fire/cancel' : null,
  };
}
