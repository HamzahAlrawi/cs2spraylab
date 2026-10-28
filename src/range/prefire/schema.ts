export type SourcePoint = readonly [number, number, number];
export type HoldingSide = 'ct' | 't';
export type PrefireAngle = {
  id?: string;
  name: string;
  position: SourcePoint;
  rotation?: SourcePoint;
  crouched?: boolean;
  moving?: boolean;
  peek?: SourcePoint;
  source?: {dataset?: string; profile: string; index: number;
    // Explicit, native-validated training adaptation; source coordinates remain exact.
    stanceOverride?: 'standing' | 'crouched'};
  // Alternative holds in the same corner must not spawn as overlapping enemies.
  exclusionGroup?: string;
};
export type PrefireRoute = {
  id: string; name: string; region?: string; enemySide?: HoldingSide;
  phase?: 'preplant' | 'postplant';
  spawn: SourcePoint; look: SourcePoint;
  path: readonly SourcePoint[]; angles: readonly PrefireAngle[];
  // Weighted practice can vary the holds without changing the learn-mode lineup.
  alternatives?: readonly PrefireAngle[];
  startLabel?: string;
  lineups?: readonly {id: string; name: string; angles: readonly PrefireAngle[]}[];
};
export type PrefireSource = {id: string; repository: string; commit: string; license: string; notice: string; context: string};
export type PrefireCatalog = {
  id: string; name: string; revision: string;
  routes: readonly PrefireRoute[];
  sources: readonly PrefireSource[];
  density?: HoldingDensity;
  // Regional density above remains coverage evidence, never joint setup data.
  encounters?: EncounterEvidence;
};

export type EncounterContext = {
  side?: HoldingSide;
  phase?: 'preplant' | 'postplant';
  // Source-defined team equipment class / approach-arrival window, not inferred from route names.
  equipment?: string;
  arrival?: string;
};
export type EncounterContextField = keyof EncounterContext;
export type PrefireBuildIdentity = {
  mapId: string; gameBuild: string; geometrySha256: string; catalogRevision: string;
};
export type EncounterProvenance = {
  id: string; url: string; revision: string; sha256: string; license: string;
  kind: 'demo' | 'tick-data';
  rights: {status: 'approved' | 'restricted' | 'unknown'; reference: string};
  extractor: {revision: string; sha256: string};
  // Only fields recovered from source data may be declared. Definitions include units/bins.
  fields: Partial<Record<EncounterContextField, string>>;
  positionKind: 'raw-feet';
};
export type PrefireCoverPocket = {
  id: string; angleIds: readonly string[];
  geometrySha256: string; reportSha256: string;
};
export type EncounterMember = {
  actorId: string; angleId: string; pocketId: string;
  observedFeet: SourcePoint; crouched: boolean;
  // Per-observation raw-foot -> authored-hold proof, not a nearby centroid assignment.
  pocketProof: {method: 'raw-feet-local-pocket-v1'; geometrySha256: string; reportSha256: string};
};
export type EncounterObservation = {
  id: string; sourceId: string; matchId: string; roundId: string; routeId: string;
  tick: number; context: EncounterContext;
  // Empty complete rosters are valid evidence. Partial/unmapped teams are not.
  complete: true;
  // Completeness and arrival need a source-backed proof even when members is empty.
  snapshotProof: {method: 'complete-defender-snapshot-v1'; reportSha256: string};
  members: readonly EncounterMember[];
};
export type EncounterEvidence = {
  schemaVersion: 1; revision: string; build: PrefireBuildIdentity;
  sources: readonly EncounterProvenance[]; pockets: readonly PrefireCoverPocket[];
  split: {method: 'match-disjoint-v1'; trainMatches: readonly string[]; heldoutMatches: readonly string[]};
  observations: readonly EncounterObservation[];
};

export type HoldingDensity = {
  schemaVersion: number; mapId: string;
  source: {url: string; revision: string; license: string; author: string};
  sample: {matches: number; rounds: number; povs: number};
  layers?: readonly {side: string; context: string; roundKeys?: readonly string[]; rounds: number; matches?: number}[];
  cells: readonly {position: readonly number[]; side: string; context: string;
    episodeAnchors: number; seconds: number; rounds: number; matches: number; roundKeys?: readonly string[]}[];
};
