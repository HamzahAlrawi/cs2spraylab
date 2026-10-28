// Offline source mappings: physics inheritance is independent of bullet material.
export function extractFootsteps(physics, mappings, sources) {
  const byName = new Map(physics.map(surface => [surface.surfacePropertyName.toLowerCase(), surface]));
  const byHash = new Map(physics.map(surface => [surface.m_nameHash, surface]));
  const overrides = new Map(mappings.ct_player.SurfacePropertiesList.map(surface => [surface.surfacePropertyName.toLowerCase(), surface]));
  function step(surface, seen = new Set()) {
    const name = surface.surfacePropertyName.toLowerCase();
    if (seen.has(name)) throw new Error(`Footstep surface cycle: ${name}`);
    seen.add(name);
    const override = overrides.get(name);
    if (override?.walkleft) return override.walkleft;
    const parent = surface.base ? byName.get(surface.base.toLowerCase()) : byHash.get(surface.m_baseNameHash);
    if ((surface.base || surface.m_baseNameHash) && !parent) throw new Error(`Missing footstep base: ${name}`);
    return parent ? step(parent, seen) : overrides.get('default').walkleft;
  }
  const surfaces = {}, events = {}, landingFallbacks = [];
  for (const surface of physics) {
    const source = step(surface);
    const stem = source === 'Player.Wade' ? 'wade' : source.replace(/^CT_/, '').replace(/\.StepLeft$/, '').toLowerCase();
    const bank = stem === 'solidmetal' ? 'metal' : stem;
    surfaces[surface.surfacePropertyName.toLowerCase()] = bank;
    events[`step-${bank}`] = source;
    const landing = source.replace(/^CT_/, 'Land_');
    // Water/wade and wet-sand have no corresponding Land_* event. Keep this
    // presentation fallback explicit; do not claim native landing selection.
    if (!sources[landing]) landingFallbacks.push(bank);
    events[`land-${bank}`] = sources[landing] ? landing : 'Land_Default.StepLeft';
  }
  const rightFootOverrides = Object.fromEntries([...overrides].filter(([, surface]) =>
    surface.walkright && surface.walkleft && surface.walkright !== surface.walkleft)
    .map(([name, surface]) => [name, surface.walkright]));
  return {surfaces, events, landingFallbacks: [...new Set(landingFallbacks)].sort(), rightFootOverrides};
}

export function footstepDefinition(sources, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`Sound event cycle: ${name}`);
  seen.add(name);
  const source = sources[name];
  if (!source) throw new Error(`Missing footstep event: ${name}`);
  const inherited = source.base ? footstepDefinition(sources, source.base, seen) : {};
  return {...inherited, ...source,
    // Silent events omit their track deliberately, despite Base.Footstep's track.
    vsnd_files_track_01: source.metadata === 'silentfs' ? [] : source.vsnd_files_track_01 ?? inherited.vsnd_files_track_01};
}

export function selectFootstepSamples(files, limit) {
  files = [...new Set((Array.isArray(files) ? files : [files]).filter(Boolean))];
  if (files.length <= limit) return files;
  return Array.from({length: limit}, (_, i) => files[Math.round(i * (files.length - 1) / Math.max(1, limit - 1))]);
}
