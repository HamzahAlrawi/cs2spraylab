// PHYS surface IDs index a hash table. Resolve against vsurf's explicit hashes;
// neither render material names nor texture filenames enter this mapping.
export function extractNativeSurfaces(hashes, physics, game) {
  const byHash = new Map(physics.map(s => [s.m_nameHash,s]));
  const byName = new Map(physics.map(s => [s.surfacePropertyName.toLowerCase(),s]));
  const gameByName = new Map(game.map(s => [s.surfacePropertyName.toLowerCase(),s]));
  const families = {C:'concrete',M:'metal',W:'wood',L:'plastic',Y:'glass',G:'grate',S:'water',F:'flesh'};
  function resolve(surface, seen = new Set()) {
    const name = surface.surfacePropertyName.toLowerCase();
    if (seen.has(name)) throw new Error(`Surface inheritance cycle: ${name}`);
    seen.add(name);
    const parent = surface.base ? byName.get(surface.base.toLowerCase()) :
      surface.m_baseNameHash ? byHash.get(surface.m_baseNameHash) : name !== 'default' ? byName.get('default') : undefined;
    if ((surface.base || surface.m_baseNameHash) && !parent) throw new Error(`Missing source surface base: ${name}`);
    const inherited = parent ? resolve(parent,seen) : {game:{},sounds:{}};
    const properties = {...inherited.game,...gameByName.get(name)};
    return {game:properties,sounds:{...inherited.sounds,...surface.audiosounds},
      material:families[properties.gamematerial] ?? (parent?.surfacePropertyName.toLowerCase() !== 'default' ? inherited.material : undefined)};
  }
  return hashes.map((hash,id) => {
    const source = byHash.get(hash);
    if (!source) return {id,hash};
    const resolved = resolve(source);
    return {id,hash,name:source.surfacePropertyName,gameMaterial:resolved.game.gamematerial,
      material:resolved.material,penetrationModifier:resolved.game.bulletPenetrationDistanceModifier,
      damageModifier:resolved.game.bulletPenetrationDamageModifier,bulletImpact:resolved.sounds.bulletimpact};
  });
}
