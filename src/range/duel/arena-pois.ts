import type {Solid, PropStyle} from './geometry';
import type {Vec} from '../actor-physics';

export const poiThemes = ['freight', 'service', 'courtyard', 'switchback', 'loading', 'workshop'] as const;
export type POITheme = typeof poiThemes[number];
export type Footprint = {minX: number; maxX: number; minZ: number; maxZ: number};
export type POIPart = Solid & {label: string};
export type POITemplate = {id: string; theme: POITheme; use: string; spawnCover: boolean; parts: POIPart[]; footprint: Footprint};
export type PlacedPOI = {id: string; templateId: string; theme: POITheme; center: Vec;
  mirrorX: -1 | 1; mirrorZ: -1 | 1; footprint: Footprint; reservation: Footprint; solidIndices: number[]};

const part = (label: string, x: number, z: number, width: number, height: number, depth: number, style: PropStyle): POIPart => ({
  label, center: {x, y: height / 2, z}, size: {x: width, y: height, z: depth}, style,
  kind: style === 'pallets' || style === 'rack' ? 'crate' : style === 'roadblock' || style === 'bench' ? 'barrier'
    : style === 'concrete-stack' || style === 'planter' || style === 'dock' ? 'concrete' : 'cargo',
});
export function footprintOf(parts: Solid[]): Footprint {
  return {minX: Math.min(...parts.map(p => p.center.x - p.size.x / 2)), maxX: Math.max(...parts.map(p => p.center.x + p.size.x / 2)),
    minZ: Math.min(...parts.map(p => p.center.z - p.size.z / 2)), maxZ: Math.max(...parts.map(p => p.center.z + p.size.z / 2))};
}
export const reserveFootprint = (f: Footprint, margin: number): Footprint => ({
  minX: f.minX - margin, maxX: f.maxX + margin, minZ: f.minZ - margin, maxZ: f.maxZ + margin,
});
export const footprintsOverlap = (a: Footprint, b: Footprint) =>
  a.minX < b.maxX - 1e-8 && a.maxX > b.minX + 1e-8 && a.minZ < b.maxZ - 1e-8 && a.maxZ > b.minZ + 1e-8;
const poi = (id: string, theme: POITheme, use: string, parts: POIPart[], spawnCover = false): POITemplate =>
  ({id, theme, use, parts, spawnCover, footprint: footprintOf(parts)});

// Every entry is an authored object bundle, not a randomized box-count variant.
// Touching pieces form closed structures; separate pieces leave real walkways.
export const arenaPOIs: readonly POITemplate[] = [
  poi('customs-gatehouse', 'freight', 'Guard office with inspection counter and parcel cage', [
    part('office back', 0, 0, 4, 2.6, .6, 'kiosk'), part('office return', -1.6, -1.1, .8, 2.6, 1.6, 'cabinet'), part('parcel cage', 1.2, -2.1, 1.2, 1.4, .8, 'rack')], true),
  poi('weighbridge-control', 'freight', 'Scale controls beside a protected operator recess', [
    part('control wall', 0, 0, 3.6, 2.4, .6, 'cabinet'), part('scale console', -1.5, -1, .6, 1.2, 1.4, 'generator'), part('wheel stop', .9, -2, 1.2, 1, .6, 'roadblock')], true),
  poi('bonded-freight', 'freight', 'Sealed freight bay with a customs sorting shelf', [
    part('sealed bay', 0, 0, 3.8, 2.8, .6, 'plain'), part('bay return', 1.4, -1.2, 1, 2.8, 1.8, 'plain'), part('sorting shelf', -1.2, -2, 1.2, 1.5, .8, 'rack')], true),
  poi('forklift-pallet-aisle', 'freight', 'Paired pallet rows with a capped pickup end', [
    part('left row', -1.35, -.3, 1.2, 1.6, 2, 'pallets'), part('right row', 1.35, -.3, 1.2, 2.2, 2, 'pallets'), part('pickup stack', -1.35, 1.2, 1.2, .9, 1, 'pallets')]),
  poi('railhead-transfer', 'freight', 'Trackside wall, end stop, and transshipment rack', [
    part('rail wall', 0, 1, 4.4, 2.1, .6, 'concrete-stack'), part('end stop', -1.9, -.3, .6, 1.2, 2, 'roadblock'), part('transfer rack', 1.1, -.9, 1.4, 1.8, .8, 'rack')]),
  poi('strapping-station', 'freight', 'Packing bench attached to a bale stack, with tool locker', [
    part('bales', -1.3, 0, 1.4, 2.2, 1.8, 'pallets'), part('packing bench', -1.3, 1.2, 1.4, 1, .6, 'bench'), part('strap locker', 1.3, -.4, 1.2, 1.9, 1, 'cabinet')]),
  poi('reefer-service', 'freight', 'Cold-store machinery and a detached spare-parts bay', [
    part('cold store', -.9, .5, 2.4, 2.7, 1, 'plain'), part('compressor', -1.5, -.6, 1.2, 1.4, 1.2, 'generator'), part('spares', 1.9, -.4, .8, 1.6, 1.6, 'rack')]),
  poi('freight-checkpoint', 'freight', 'Split vehicle chicane and attendant terminal', [
    part('west stop', -1.3, -.6, 1.4, 1.2, .6, 'roadblock'), part('east stop', 1.3, .6, 1.4, 1.2, .6, 'roadblock'), part('terminal', -1.3, .2, 1.4, 2, 1, 'kiosk')]),
  poi('cargo-manifest', 'freight', 'Manifest booth attached to a tall parcel bank', [
    part('parcel bank', .4, .8, 3.2, 2.3, .8, 'pallets'), part('manifest booth', -1.8, .8, 1.2, 2.5, .8, 'kiosk'), part('dispatch bench', 1, -1.2, 2, 1, .8, 'bench')]),

  poi('power-substation', 'service', 'Switchgear wall with transformer and lockout cabinet', [
    part('switchgear', 0, 0, 3.4, 2.5, .6, 'cabinet'), part('transformer', -1.1, -1.1, 1.2, 1.8, 1.6, 'generator'), part('lockout box', 1.3, -2, .8, 1.3, .8, 'cabinet')], true),
  poi('pump-control', 'service', 'Pump-house wall, impeller housing, and valve cabinet', [
    part('pump wall', 0, 0, 4.2, 2.3, .6, 'concrete-stack'), part('impeller', 1.5, -1, 1.2, 1.5, 1.4, 'pump'), part('valves', -1.3, -2.1, 1, 1.5, .8, 'cabinet')], true),
  poi('maintenance-kiosk', 'service', 'Service counter with attached locker and workbench', [
    part('counter back', 0, 0, 3.8, 2.4, .6, 'kiosk'), part('locker return', -1.4, -1.2, 1, 2.4, 1.8, 'cabinet'), part('workbench', 1.1, -2.2, 1.4, 1, .8, 'bench')], true),
  poi('vent-corner', 'service', 'L-shaped duct bank beside an access-control pedestal', [
    part('main duct', 0, .9, 3.8, 2.3, .8, 'vent'), part('duct return', -1.5, -.4, .8, 1.7, 1.8, 'vent'), part('access pedestal', 1.1, -1.1, 1.2, 1.4, .8, 'kiosk')]),
  poi('generator-yard', 'service', 'Twin generators sharing an attached distribution box', [
    part('large generator', -1.4, 0, 1.4, 1.8, 2.2, 'generator'), part('small generator', 1.4, -.4, 1.4, 1.3, 1.4, 'generator'), part('distribution box', -1.4, 1.4, 1.4, 2.2, .6, 'cabinet')]),
  poi('water-treatment', 'service', 'Filter bank with a connected pump and sample desk', [
    part('filters', -.5, .9, 3, 2.6, .8, 'vent'), part('feed pump', -1.5, -.3, 1, 1.6, 1.6, 'pump'), part('sample desk', 1.4, -1.1, 1.2, 1, .8, 'bench')]),
  poi('meter-alley', 'service', 'Opposed meter cabinets around a maintenance aisle', [
    part('meter bank', -1.3, 0, 1, 2.2, 2.4, 'cabinet'), part('utility bank', 1.3, .2, 1, 1.8, 2, 'cabinet'), part('spare meter', -1.3, 1.5, 1, 1.2, .6, 'generator')]),
  poi('cooling-exchange', 'service', 'Heat exchanger with an attached fan and detached controls', [
    part('exchanger', -.6, .6, 2.8, 2.4, 1.2, 'vent'), part('fan housing', -1.4, -.6, 1.2, 1.4, 1.2, 'vent'), part('control box', 2.4, -.3, .8, 1.8, 1, 'cabinet')]),
  poi('emergency-service', 'service', 'Emergency cabinet and impact barriers framing a clear approach', [
    part('emergency cabinet', 0, 1, 1.2, 2.1, .8, 'cabinet'), part('west guard', -2.1, -.1, .6, 1.2, 2, 'roadblock'), part('east guard', 2.1, .5, .6, 1.2, .8, 'roadblock')]),

  poi('courtyard-porter', 'courtyard', 'Porter lodge with a planted return and parcel bench', [
    part('lodge wall', 0, 0, 3.6, 2.6, .6, 'kiosk'), part('planted return', -1.4, -1.2, .8, 1.2, 1.8, 'planter'), part('parcel bench', 1.1, -2.2, 1.4, 1, .8, 'bench')], true),
  poi('garden-shed', 'courtyard', 'Garden storage back with potting table and seed cabinet', [
    part('shed back', 0, 0, 4, 2.3, .6, 'rack'), part('potting table', 1.4, -1, 1.2, 1, 1.4, 'bench'), part('seed cabinet', -1.3, -2, 1, 1.7, .8, 'cabinet')], true),
  poi('arcade-recess', 'courtyard', 'Arcade screen and stone return sheltering a sitting area', [
    part('arcade screen', 0, 0, 4.4, 2.8, .6, 'concrete-stack'), part('stone return', -1.9, -1.3, .6, 2.2, 2, 'concrete-stack'), part('seat', 1, -2.2, 1.8, .9, .8, 'bench')], true),
  poi('fountain-court', 'courtyard', 'Closed fountain plinth between two detached planted borders', [
    part('fountain plinth', 0, 0, 1.2, 1.4, 1.2, 'pump'), part('west border', -2.1, .4, .6, 1.1, 2, 'planter'), part('east border', 2.1, -.4, .6, 1.1, 2, 'planter')]),
  poi('reading-garden', 'courtyard', 'L-shaped planter with a detached reading bench', [
    part('rear planter', 0, 1, 4, 1.2, .6, 'planter'), part('planter return', -1.7, -.3, .6, 1.2, 2, 'planter'), part('reading bench', 1.1, -1, 1.6, .9, .8, 'bench')]),
  poi('memorial-niche', 'courtyard', 'Memorial wall, connected plinth, and separate flower box', [
    part('memorial wall', -.3, .8, 3.4, 2.3, .6, 'concrete-stack'), part('stone plinth', -1.4, -.4, 1.2, 1.1, 1.8, 'dock'), part('flowers', 1.3, -1.1, 1.2, 1, .8, 'planter')]),
  poi('market-stall', 'courtyard', 'Market counter with joined stock chest and a separate locker', [
    part('market counter', -1.1, .6, 1.4, 1.4, 1.2, 'kiosk'), part('stock chest', -1.1, -.6, 1.4, 1, 1.2, 'pallets'), part('stall locker', 1.3, 0, 1, 2.2, 1.8, 'cabinet')]),
  poi('bicycle-court', 'courtyard', 'Solid cycle-storage bank and offset planted resting point', [
    part('cycle bank', -1.3, 0, 1.2, 1.7, 2.6, 'rack'), part('planted seat back', 1.3, .8, 1.2, 1.2, 1, 'planter'), part('resting seat', 1.3, -.1, 1.2, .9, .8, 'bench')]),
  poi('delivery-court', 'courtyard', 'Parcel hatch, adjoining cabinet, and visitor planter', [
    part('parcel hatch', 0, .9, 2.8, 2.2, .8, 'kiosk'), part('hatch cabinet', -1.8, .9, .8, 2, .8, 'cabinet'), part('visitor planter', .6, -1.1, 2, 1, .8, 'planter')]),

  poi('checkpoint-office', 'switchback', 'Security back wall, inspection return, and stop block', [
    part('security back', 0, 0, 3.8, 2.5, .6, 'kiosk'), part('inspection return', 1.6, -1.1, .6, 1.4, 1.6, 'roadblock'), part('stop block', -1.1, -2.1, 1.4, 1.2, .8, 'roadblock')], true),
  poi('traffic-control', 'switchback', 'Signal cabinet wall with blast return and backup power', [
    part('signal wall', 0, 0, 4.2, 2.2, .6, 'cabinet'), part('blast return', -1.8, -1.2, .6, 1.7, 1.8, 'concrete-stack'), part('backup power', 1.2, -2, 1.2, 1.4, .8, 'generator')], true),
  poi('barricade-store', 'switchback', 'Barrier depot with joined repair desk and spare block', [
    part('depot wall', 0, 0, 3.4, 2.4, .6, 'rack'), part('repair desk', -1.2, -1, 1, 1, 1.4, 'bench'), part('spare block', 1.2, -2.1, 1, 1.3, .8, 'concrete-stack')], true),
  poi('dogleg-guard', 'switchback', 'Two opposing L-shaped barriers forming an open dogleg', [
    part('west spine', -1.4, 0, .6, 1.5, 2.4, 'roadblock'), part('west return', -1.9, 1.5, 1.6, 1.5, .6, 'roadblock'), part('east spine', 1.1, -.5, .8, 2, 1.4, 'concrete-stack'), part('east return', 1.8, .5, 2.2, 1.2, .6, 'roadblock')]),
  poi('serpentine-check', 'switchback', 'Offset stop islands and a connected scanner', [
    part('first stop', -1.3, -.9, 1.4, 1.3, .6, 'roadblock'), part('second stop', 1.3, .9, 1.4, 1.3, .6, 'roadblock'), part('scanner', -1.3, -.1, 1.4, 2.2, 1, 'kiosk')]),
  poi('blast-pocket', 'switchback', 'Stone blast screen with one return and offset supply chest', [
    part('blast screen', .2, 1, 4, 2.4, .6, 'concrete-stack'), part('screen return', 1.9, -.2, .6, 1.8, 1.8, 'concrete-stack'), part('supply chest', -1.1, -1, 1.4, 1.2, .8, 'pallets')]),
  poi('median-crossover', 'switchback', 'Split median gate with one tall signal housing', [
    part('west median', -1.5, 0, 1.2, 1.1, 2.6, 'roadblock'), part('east median', 1.5, .4, 1.2, 1.1, 1.8, 'roadblock'), part('signal housing', -1.5, 1.6, 1.2, 2.4, .6, 'cabinet')]),
  poi('inspection-turn', 'switchback', 'Inspection desk flanked by separated crash walls', [
    part('inspection desk', 0, .9, 1.2, 1.4, 1, 'kiosk'), part('west crash wall', -2.1, -.1, .6, 1.8, 2.2, 'concrete-stack'), part('east crash wall', 2.1, .4, .6, 1.4, 1.2, 'roadblock')]),
  poi('detour-storage', 'switchback', 'Detour barrier with connected sign cabinet and spare rails', [
    part('detour barrier', -.7, .9, 2.6, 1.3, .8, 'roadblock'), part('sign cabinet', -1.5, -.2, 1, 2.2, 1.4, 'cabinet'), part('spare rails', 1.6, -1.2, 1.2, 1.2, 1, 'rack')]),

  poi('dispatch-window', 'loading', 'Dispatch wall, receiving counter, and outgoing pallet', [
    part('dispatch back', 0, 0, 4, 2.4, .6, 'kiosk'), part('receiving counter', -1.5, -1.2, 1, 1.3, 1.8, 'dock'), part('outgoing pallet', 1.3, -2.2, 1.2, 1.5, .8, 'pallets')], true),
  poi('dock-control', 'loading', 'Loading-bay control wall and attached dock end', [
    part('bay control', 0, 0, 3.6, 2.5, .6, 'cabinet'), part('dock end', 1.2, -1.1, 1.2, 1.1, 1.6, 'dock'), part('check-in box', -1.3, -2.1, 1, 1.8, .8, 'kiosk')], true),
  poi('returns-depot', 'loading', 'Returns bank with attached sorting desk and rejected stock', [
    part('returns bank', 0, 0, 4.2, 2.3, .6, 'rack'), part('sorting desk', -1.5, -1, 1.2, 1, 1.4, 'bench'), part('rejected stock', 1.4, -2, 1.2, 1.2, .8, 'pallets')], true),
  poi('split-loading-dock', 'loading', 'Two loading fingers separated by a forklift approach', [
    part('west dock', -1.4, -.2, 1.4, 1, 2.2, 'dock'), part('east dock', 1.4, .2, 1.4, 1, 1.8, 'dock'), part('staged goods', -1.4, 1.3, 1.4, 2.3, .8, 'pallets')]),
  poi('pallet-marshalling', 'loading', 'Crosswise pallet queue, joined tall stack, and separate cage', [
    part('queue', -.6, .8, 2.8, 1.3, 1, 'pallets'), part('tall stack', -1.5, -.3, 1, 2.3, 1.2, 'pallets'), part('goods cage', 2.6, -.6, 1.2, 2, 1.2, 'rack')]),
  poi('parcel-sorter', 'loading', 'Sorting counter and joined locker opposite a parcel rack', [
    part('sort counter', -1.3, -.4, 1.2, 1.2, 1.6, 'bench'), part('sort locker', -1.3, .9, 1.2, 2.4, 1, 'cabinet'), part('parcel rack', 1.3, .3, 1.2, 1.8, 2, 'rack')]),
  poi('tail-lift-bay', 'loading', 'Solid lift platform, sealed cargo head, and loading controls', [
    part('lift platform', -.6, -.6, 2.8, .9, 1.4, 'dock'), part('cargo head', -.6, .7, 2.8, 2.5, 1.2, 'plain'), part('lift controls', 2.4, -.3, .8, 1.6, .8, 'cabinet')]),
  poi('delivery-lockers', 'loading', 'L-shaped locker bank around a detached packing table', [
    part('locker bank', 0, .9, 4, 2.2, .8, 'cabinet'), part('locker return', -1.6, -.4, .8, 2.2, 1.8, 'cabinet'), part('packing table', 1, -1.1, 1.6, 1, .8, 'bench')]),
  poi('drum-receiving', 'loading', 'Pump-fed receiving station and segregated supply pallet', [
    part('receiving tank', -1.3, .3, 1.4, 2.3, 1.6, 'pump'), part('feed controls', -1.3, -.9, 1.4, 1.2, .8, 'cabinet'), part('supply pallet', 1.3, .4, 1.2, 1.7, 1.8, 'pallets')]),

  poi('tool-crib', 'workshop', 'Tool wall with attached issue desk and repair cabinet', [
    part('tool wall', 0, 0, 3.8, 2.4, .6, 'rack'), part('issue desk', 1.3, -1.1, 1.2, 1.2, 1.6, 'bench'), part('repair cabinet', -1.2, -2.1, 1.2, 1.9, .8, 'cabinet')], true),
  poi('machine-control', 'workshop', 'Machine guard wall, drive housing, and calibration desk', [
    part('guard wall', 0, 0, 4.4, 2.6, .6, 'vent'), part('drive housing', -1.5, -1.2, 1.4, 1.6, 1.8, 'generator'), part('calibration desk', 1.3, -2.2, 1.4, 1, .8, 'bench')], true),
  poi('parts-issue', 'workshop', 'Parts counter backed by lockers with a returns shelf', [
    part('locker back', 0, 0, 3.4, 2.2, .6, 'cabinet'), part('issue counter', -1.1, -1, 1.2, 1.3, 1.4, 'kiosk'), part('returns shelf', 1.3, -2, .8, 1.4, .8, 'rack')], true),
  poi('welding-cell', 'workshop', 'Solid welding screen and joined bench with separate power pack', [
    part('welding screen', -.4, .9, 3.2, 2.4, .6, 'concrete-stack'), part('welding bench', -1.4, -.4, 1.2, 1.1, 2, 'bench'), part('power pack', 1.3, -1, 1.2, 1.5, .8, 'generator')]),
  poi('lathe-service', 'workshop', 'Machine bed, attached drive, and detached tool cabinet', [
    part('machine bed', -.6, .6, 2.8, 1.5, 1.2, 'generator'), part('drive', -1.4, -.6, 1.2, 2.2, 1.2, 'vent'), part('tool cabinet', 2.5, .1, 1, 1.9, 1.6, 'cabinet')]),
  poi('joinery-bench', 'workshop', 'Timber rack connected to a saw bench beside spare boards', [
    part('timber rack', -1.3, .9, 1.4, 2.4, .8, 'rack'), part('saw bench', -1.3, -.4, 1.4, 1.1, 1.8, 'bench'), part('spare boards', 1.4, .1, 1.4, 1.5, 2.2, 'pallets')]),
  poi('compressor-recess', 'workshop', 'Ventilated compressor corner with remote electrical cabinet', [
    part('rear ventilation', 0, .9, 3.8, 2.2, .8, 'vent'), part('compressor', 1.3, -.4, 1.2, 1.5, 1.8, 'pump'), part('electrical cabinet', -1.2, -1.1, 1.2, 1.8, .8, 'cabinet')]),
  poi('paint-mixing', 'workshop', 'Mixing counter with attached extraction and segregated stock', [
    part('mixing counter', -1.4, -.3, 1.2, 1.3, 1.8, 'kiosk'), part('extraction', -1.4, 1, 1.2, 2.6, .8, 'vent'), part('paint stock', 1.3, .3, 1.4, 1.9, 1.8, 'rack')]),
  poi('repair-islands', 'workshop', 'Two repair benches with unequal attached tool towers', [
    part('west bench', -1.4, -.4, 1.4, 1, 1.8, 'bench'), part('west tower', -1.4, .9, 1.4, 2.3, .8, 'cabinet'), part('east bench', 1.4, .3, 1.4, 1, 1.6, 'bench'), part('east tower', 1.4, -1, 1.4, 1.7, 1, 'rack')]),
];

export function placePOI(template: POITemplate, center: Vec, mirrorX: -1 | 1, mirrorZ: -1 | 1, id: string, firstIndex: number, gap = 1.2) {
  const solids = template.parts.map(p => ({...p, center: {x: center.x + mirrorX * p.center.x, y: p.center.y, z: center.z + mirrorZ * p.center.z}, poiId: id}));
  const footprint = footprintOf(solids);
  const instance: PlacedPOI = {id, templateId: template.id, theme: template.theme, center, mirrorX, mirrorZ,
    footprint, reservation: reserveFootprint(footprint, gap / 2), solidIndices: solids.map((_, i) => firstIndex + i)};
  return {solids, instance};
}
