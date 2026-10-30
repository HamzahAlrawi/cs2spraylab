import type {PrefireMap} from '../src/range/prefire/map';

export type MountedIdentity = {mapId: string; configMapId: string; catalogRevision: string; gameBuild: string;
  geometrySha256: string; runtimeMapId: string; routeId: string; lineupId?: string};
export const fixture = {
  requests: [] as {mapId: string; signal?: AbortSignal; resolve: (map: PrefireMap) => void; reject: (reason: unknown) => void; settled: boolean}[],
  disposals: [] as string[], mounts: [] as MountedIdentity[],
};
