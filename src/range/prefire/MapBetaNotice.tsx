import {nativeMaps} from './maps';
import './map-beta.css';
export function MapBetaNotice({mapId}:{mapId:string}){
  if(!nativeMaps.has(mapId))return null;
  const map=nativeMaps.get(mapId);
  if(map.onboarding?.state!=='beta')return null;
  return <details className="map-beta-notice"><summary>{map.name}: validation in progress</summary>
    <p>{map.onboarding.note}</p><ul>{map.onboarding.beta?.unresolved.map(gap=><li key={gap}>{gap}</li>)}</ul>
  </details>;
}
