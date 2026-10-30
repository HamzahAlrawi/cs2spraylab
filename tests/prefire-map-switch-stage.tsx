import React, {useEffect} from 'react';
import {nativeMaps} from '../src/range/prefire/maps';
import type {PrefireSession} from '../src/range/prefire/session';
import type {PrefireConfig} from '../src/range/prefire/config';
import {fixture} from './prefire-map-switch-state';

export function DuelStage({prefire: {session, config, update}}: {prefire: {session: PrefireSession; config: PrefireConfig;
  update: (patch: Partial<PrefireConfig>) => void}}) {
  const identity = {...session.identity, configMapId: config.mapId, runtimeMapId: session.map.scene.userData.mapId as string,
    routeId: config.routeId, lineupId: config.lineupId};
  useEffect(() => {fixture.mounts.push(identity);}, [session]);
  return <main data-testid="mock-stage">
    <h1>{session.name}</h1>
    <label>Map <select aria-label="Prefire map" value={config.mapId} onChange={event => update({
      mapId: event.target.value, routeId: config.routeId, lineupId: config.lineupId,
    })}>{nativeMaps.list().filter(map => map.id.startsWith('fixture_')).map(map => <option key={map.id} value={map.id}>{map.name}</option>)}</select></label>
    <output data-testid="identity">{JSON.stringify(identity)}</output>
  </main>;
}
