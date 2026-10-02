// Names audited against pak01_dir.vpk's viewmodel namespace, never world animations.
const suffixes = {
  ak47: 'ak', m4a4: 'm4a4', m4a1s: 'rifle', galil: 'galilar', famas: 'famas', sg553: 'sg556',
  aug: 'aug', mp9: 'mp9', mp7: 'mp7', mp5sd: 'mp5sd', mac10: 'mac10', ump45: 'ump45',
  p90: 'p90', bizon: 'bizon', m249: 'm249', negev: 'negev', cz75a: 'cz75a', usp: 'pistol',
  glock: 'glock', hkp2000: 'hkp', p250: 'p250', deagle: 'deagle', elite: 'elite',
  fiveseven: 'fiveseven', tec9: 'tec9', revolver: 'revolver', awp: 'awp', ssg08: 'ssg08',
  g3sg1: 'g3sg1', scar20: 'scar20', knife: 'knife', 'knife-butterfly': 'butterfly',
};

export const supportedViewIds = Object.keys(suffixes);
export const expandedViewIds = ['deagle', 'elite', 'revolver', 'awp', 'ssg08', 'g3sg1', 'scar20'];
export const firearmViewIds = supportedViewIds.filter(id => !id.startsWith('knife'));
export const lastShotViewIds = ['cz75a', 'usp', 'glock', 'hkp2000', 'p250', 'deagle', 'fiveseven', 'tec9', 'negev', 'scar20'];
export const emptyIdleViewIds = lastShotViewIds.filter(id => !['negev', 'tec9'].includes(id));
export const scopedFireViewIds = ['aug', 'sg553'];
export const requiredViewActions = id => [
  'idle','draw','inspect',...(id.startsWith('knife')?[]:['reload']),
  ...(id.startsWith('knife') ? ['fire', 'fire-alt'] : []),
  ...(id==='elite'?['fire-left','fire-right','fire-left-last','fire-right-last','idle-left-empty','idle-empty']:
    firearmViewIds.includes(id)?['fire']:[]),
  ...(id==='revolver'?['charge','fire-alt','dryfire','draw-alt']:[]),
  ...(lastShotViewIds.includes(id)?['fire-last']:[]),
  ...(emptyIdleViewIds.includes(id)?['idle-empty']:[]),
  ...(scopedFireViewIds.includes(id)?['fire-scoped']:[]),
];

export function auditViewActions(id, files, clips) {
  const suffix = suffixes[id];
  const namespace = clips.idle.slice(0, clips.idle.lastIndexOf('/') + 1);
  const available = files.filter(file => file.startsWith(namespace) && !file.slice(namespace.length).includes('/'));
  return {
    available, unselected: available.filter(file => !Object.values(clips).includes(file)),
    absent: Object.fromEntries(['bolt', 'pull', 'charge', 'scope'].filter(action =>
      !available.some(file => new RegExp(`/(?:${action}|${action}[_0-9]|.*_${action})`).test(file)) &&
      !(action === 'charge' && clips.charge)).map(action => [action,
      action === 'bolt' && ['awp', 'ssg08'].includes(id) ? 'included-in-fire; no separate native clip' :
        `no separate ${action} clip in native ${suffix} viewmodel namespace`])),
  };
}

export function selectViewClips(id, files) {
  const suffix = suffixes[id];
  if (!suffix) throw new Error(`Unsupported viewmodel: ${id}`);
  const find = (name, required = true) => {
    const matches = files.filter(file => file.startsWith('animation/anims/viewmodel/') && file.endsWith(`/${name}.vnmclip_c`));
    if (matches.length > 1 || (required && matches.length !== 1)) throw new Error(`${id}: expected one native viewmodel ${name}, found ${matches.length}`);
    return matches[0] ?? null;
  };
  const knife = id.startsWith('knife');
  const result = {
    idle: find(`${['m249', 'g3sg1', 'knife-butterfly'].includes(id) ? 'idle1' : 'idle'}_${suffix}`),
    // The USP graph references draw_pistol with the usp_silencer secondary skeleton.
    // draw_silenced_pistol exists in the VPK but is not referenced by that graph.
    draw: find(`draw_${suffix}`),
    inspect: find(`lookat01_${suffix}`),
  };
  if (!knife) {
    result.reload = find(`reload_${suffix}`);
    const empty = find(`reload_empty_${suffix}`, false) ?? find(`empty_reload_${suffix}`, false);
    if (empty) result['reload-empty'] = empty;
  }
  const pickup = find(`pickup_${suffix}`, false);
  if (pickup) result.pickup = pickup;
  if (knife) {result.fire = find(`light_miss1_${suffix}`); result['fire-alt'] = find(`heavy_miss1_${suffix}`);}
  if (!knife) {
    if (id === 'elite') {
      for (const side of ['left', 'right']) {
        result[`fire-${side}`] = find(`shoot_${side}1_${suffix}`);
        result[`fire-${side}-last`] = find(`shoot_${side}last_${suffix}`);
      }
      result['idle-left-empty'] = find(`idle_leftempty_${suffix}`);
      result['idle-empty'] = find(`idle_leftrightempty_${suffix}`);
    } else {
      result.fire = find(`shoot1_${suffix}`);
      const emptyFire = find(`shoot_empty_${suffix}`, false);
      const emptyIdle = find(`idle_slide_back_${suffix}`, false);
      if (emptyFire) result['fire-last'] = emptyFire;
      if (emptyIdle) result['idle-empty'] = emptyIdle;
      const scopedFire = find(`ironsight_shoot_${suffix}`, false);
      if (scopedFire) result['fire-scoped'] = scopedFire;
    }
    if (id === 'revolver') {
      result.charge = find(`prepare_shoot_${suffix}`);
      result['fire-alt'] = find(`shoot_alt1_${suffix}`);
      result.dryfire = find(`dryfire_${suffix}`);
      result['draw-alt'] = find(`draw_2_${suffix}`);
    }
  }
  return result;
}
