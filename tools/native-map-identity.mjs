export function nativeMapIdentity(mapId){
  if(typeof mapId!=='string'||!/^de_[a-z0-9_]+$/.test(mapId))throw Error('Use a native de_<map> identifier, without paths.');
  const assetId=mapId.slice(3);
  return {mapId,assetId,name:assetId.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase()),
    work:`research/${assetId}`,out:`public/revamp/maps/${assetId}`};
}
export function nativeMapFiles(assetId='dust2'){
  const map=nativeMapIdentity(`de_${assetId}`),prefix='src/range/prefire/maps/';
  return {...map,catalog:assetId==='dust2'?'src/range/duel/real-map-catalog.json':`${prefix}${assetId}-chunks.json`,
    rounds:assetId==='dust2'?'src/range/duel/real-map-round-data.json':`${map.work}/round-data.json`,
    manifests:assetId==='dust2'?'src/range/duel/map-manifests.json':`${prefix}${assetId}-release.json`,
    radar:assetId==='dust2'?'src/range/duel/native-radar.json':`${prefix}${assetId}-radar.json`};
}
