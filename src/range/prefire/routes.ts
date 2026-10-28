import type {Vec} from '../actor-physics';
import dataset from './data/openprefire-dust2.json';
import retakes from './data/retakes-dust2.json';
import density from './data/dust2-hold-density.json';
import weightedPools from './data/dust2-weighted-pools.json';
import authored from './data/authored-dust2.json';
import combatLeads from './data/combat-dust2-leads.json';
import type {PrefireAngle, PrefireRoute, PrefireCatalog, SourcePoint} from './schema';
export type {PrefireAngle, PrefireRoute, SourcePoint} from './schema';

export const sourcePoint = ([x, y, z]: SourcePoint): Vec => ({x: x * .0254, y: z * .0254, z: -y * .0254});
export const prefireAngleSource = {repository: dataset.source, commit: dataset.commit, license: dataset.license, notice: dataset.licenseNotice};

// Indices are one-based bot lines in the pinned, MIT-licensed practice profiles.
// Keep the sampled position, facing and stance intact; never nudge bots into a
// different angle to hide a clearance problem in a newer map revision.
function angle(profile: keyof typeof dataset.profiles, index: number, name: string, moving = false): PrefireAngle {
  const sample = dataset.profiles[profile].angles[index - 1];
  if (!sample) throw new Error(`Missing sourced prefire angle: ${profile}/${index}`);
  return {name, position: sample.position as unknown as SourcePoint, rotation: sample.rotation as unknown as SourcePoint,
    crouched: sample.crouched, moving, id: `openprefire:${profile}/${index}`, source: {profile, index}};
}

function retake(index: number, name: string): PrefireAngle {
  const sample = retakes.angles[index - 1];
  if (!sample) throw new Error(`Missing retake position ${index}`);
  return {id: `retakes:dust2/${index}`, name, position: sample.position as unknown as SourcePoint,
    rotation: sample.rotation as unknown as SourcePoint, crouched: false, source: {dataset: 'retakes', profile: 'dust2', index}};
}

function nativeHold(id: string): PrefireAngle {
  const index = authored.angles.findIndex(angle => angle.id === id), sample = authored.angles[index];
  if (!sample) throw new Error(`Missing native-authored Dust 2 hold ${id}`);
  return {...sample, id: `spraylab:dust2/${id}`, position: sample.position as unknown as SourcePoint,
    rotation: sample.rotation as unknown as SourcePoint, source: {dataset: 'spraylab-authored', profile: 'dust2-native', index: index + 1}};
}
function combatHold(id:string):PrefireAngle {
  const index=combatLeads.angles.findIndex(angle=>angle.id===id),sample=combatLeads.angles[index];
  if(!sample)throw new Error(`Missing reviewed combat-position lead ${id}`);
  return {...sample,id:`duel-density:dust2/${id}`,position:sample.position as unknown as SourcePoint,
    rotation:sample.rotation as unknown as SourcePoint,source:{dataset:'duel-density',profile:'dust2-combat',index:index+1}};
}

// Short native-hull-validated clearing segments keep the shared actor budget at
// five. Starts hide the full upper-body silhouettes behind native shot-blocking
// cover; look follows the exit, not an artificial turn away from visible bots.
// These walking paths are local adaptations, not upstream route samples.
const existingRoutes: readonly PrefireRoute[] = [
  {id: 'long-doors', name: 'Long doors', enemySide: 'ct', phase: 'preplant', spawn: [615, 188, 1], look: [660, 350, 1],
    path: [[660, 350, 1], [618, 550, 1], [618, 732, 1], [700, 800, 0], [700, 910, 0], [900, 910, 0], [1250, 1000, 0], [1400, 800, -13]], angles: [
      angle('a_long', 2, 'Long doors left', true), angle('a_long', 9, 'Blue corner'), angle('a_long', 11, 'Close doors crouched'),
      angle('a_long', 4, 'Long corner'), angle('a_long', 10, 'Wide long'),
    ]},
  {id: 'long-a', name: 'Long to A', enemySide: 'ct', phase: 'preplant', spawn: [1734, 902, -11], look: [1670, 870, -11],
    path: [[1670, 870, -11], [1430, 1190, -11], [1450, 1790, -8], [1475, 2320, 4], [1450, 2750, 105], [1190, 2780, 121]], angles: [
      angle('a_long', 19, 'Car', true), angle('a_long', 20, 'Car crouched'), angle('a_long', 23, 'A default'),
      angle('a_long', 34, 'Goose'), angle('a_long', 35, 'Short platform crouched'),
    ]},
  {id: 'short-a', name: 'Short to A', enemySide: 'ct', phase: 'preplant', spawn: [84, 1502, 0], look: [180, 1470, 0],
    path: [[180, 1470, 0], [380, 1390, 0], [405, 1740, 96], [405, 2120, 96], [740, 2640, 95]], angles: [
      angle('a_short', 9, 'Short stairs'), angle('a_short', 10, 'Short corner', true), angle('a_short', 11, 'A site box'),
      angle('a_short', 13, 'Short platform crouched'), angle('a_short', 18, 'Goose'),
    ]},
  {id: 'b-tunnels', name: 'Upper tunnels to B', enemySide: 'ct', phase: 'preplant', spawn: [-1764, 1186, 30], look: [-1880, 1186, 30],
    path: [[-1880, 1186, 30], [-1940, 1330, 30], [-1980, 1710, 32], [-1830, 1990, -2], [-1660, 2360, 2]], angles: [
      angle('b_tunnel', 11, 'Tunnel exit right', true), angle('b_tunnel', 9, 'B car'), angle('b_tunnel', 13, 'B site box crouched'),
      angle('b_tunnel', 10, 'Back platform'), angle('b_tunnel', 16, 'Window'),
    ]},
  {id: 'b-doors', name: 'B doors retake', enemySide: 't', phase: 'postplant', spawn: [-808, 2070, -102], look: [-840, 2070, -91],
    path: [[-840, 2070, -91], [-880, 2270, -80], [-1270, 2290, 7], [-1330, 2160, 3], [-1400, 2190, 1], [-1540, 2290, -2], [-1700, 2300, 2], [-1690, 2460, 11], [-1688, 2584, 7], [-1640, 2820, 16]], angles: [
      angle('mid_to_b', 30, 'B doors inside', true), angle('mid_to_b', 37, 'B doors outside crouched'),
      angle('mid_to_b', 46, 'B default'), angle('mid_to_b', 39, 'Back platform crouched'), angle('mid_to_b', 36, 'B car'),
    ]},
  {id: 'mid-doors', name: 'Mid doors to CT', enemySide: 'ct', phase: 'preplant', spawn: [-395, 1300, -126], look: [-395, 1460, -126],
    path: [[-395, 1460, -126], [-420, 1632, -126], [-400, 1770, -126], [-390, 2020, -128], [180, 2180, -125], [673, 2180, -82]], angles: [
      angle('mid_to_b', 27, 'Close CT', true), angle('a_long', 33, 'CT left'), angle('a_long', 31, 'CT back'),
      angle('a_long', 30, 'CT spawn'), angle('mid_to_b', 19, 'Mid-to-B corner'),
    ]},
  {id: 'lower-tunnels', name: 'Mid to lower tunnels', enemySide: 't', phase: 'preplant', spawn: [-395, 1612, -126], look: [-395, 1580, -126],
    path: [[-395, 1580, -126], [-395, 1460, -126], [-740, 1440, -112], [-1040, 1430, -113], [-1087, 1284, -112], [-1092, 1198, -70], [-1204, 1091, 10], [-1663, 1091, 31]], angles: [
      angle('ct_push_lower', 7, 'Lower tunnels right', true), angle('ct_push_lower', 8, 'Lower tunnels box'),
      angle('ct_push_lower', 14, 'Tunnel stairs'), angle('ct_push_lower', 16, 'Upper tunnels box'),
      angle('ct_push_lower', 17, 'Upper tunnels right'),
    ]},
  {id: 'a-retake', name: 'CT ramp retake', enemySide: 't', phase: 'postplant', spawn: [458, 2382, -120], look: [458, 2323, -119],
    path: [[458, 2323, -119], [537, 2264, -109], [1370, 2110, -6], [1480, 2400, 23], [1450, 2750, 105], [1190, 2780, 121]], angles: [
      angle('a_short', 19, 'A default'), angle('a_short', 18, 'Goose'), angle('a_short', 21, 'Long ramp'),
      angle('a_short', 23, 'Car crouched'), angle('a_short', 15, 'Short platform crouched'),
    ]},
];

const course = (base: string, id: string, name: string, region: string, angles: readonly PrefireAngle[]): PrefireRoute => {
  const route = existingRoutes.find(route => route.id === base)!;
  const revised = id === 'long-cross' || id === 'a-long-site' ? {spawn: [1766, 966, 1] as SourcePoint}
    : id === 'b-door-detail' ? {spawn: [-584, 1910, -118] as SourcePoint,
      path: [[-400,1870,-126], [-390,2020,-128], [-700,2215,-119], ...route.path] as readonly SourcePoint[]}
    : id === 'b-site-retake' ? {spawn: [-776,2070,-108] as SourcePoint}
    : id === 'lower-detail' ? {spawn: [-395,1804,-126] as SourcePoint,
      path: [[-459,1708,-125], ...route.path] as readonly SourcePoint[]}
    : id === 'mid-lower-check' ? {spawn: [-459,1140,-86] as SourcePoint,
      path: [[-395,1300,-126], ...route.path] as readonly SourcePoint[]} : {};
  const path = revised.path ?? route.path;
  return {...route, ...revised, id, name, region, look: path[0], angles};
};

// Distinct clearing sets share a validated approach where appropriate. Reusing
// an approach does not relocate source coordinates or increase the actor budget.
const extendedRoutes: readonly PrefireRoute[] = [
  course('long-doors', 'long-close', 'Long doors / close & blue', 'Long', [
    angle('a_long', 3, 'Outside doors left'), angle('a_long', 1, 'Long corner tight'), angle('a_long', 8, 'Blue deep'),
    angle('a_long', 5, 'Long ledge'), angle('a_long', 6, 'Long cross'),
  ]),
  course('long-doors', 'pit-clear', 'Long / pit clearing', 'Long', [
    angle('a_long', 7, 'Long wide corner'), angle('a_long', 13, 'Pit platform'), angle('a_long', 14, 'Pit upper edge'),
    angle('a_long', 16, 'Pit approach'), angle('a_long', 18, 'Deep pit'),
  ]),
  course('long-a', 'long-cross', 'Long / car & cross', 'Long', [
    angle('a_long', 22, 'Cross left'), angle('a_long', 27, 'Car tight'), angle('a_long', 25, 'A site front'),
    angle('a_long', 28, 'Short ledge'), angle('a_long', 36, 'Short platform standing'),
  ]),
  course('long-a', 'a-long-site', 'A site / long entry', 'A Site', [
    angle('a_long', 21, 'A back box crouched'), angle('a_long', 24, 'A default left'), angle('a_long', 29, 'Short ramp'),
    angle('a_long', 32, 'Short approach'), angle('a_long', 37, 'A front box'),
  ]),
  course('short-a', 'short-detail', 'Short / stairs & off-angles', 'Short', [
    angle('a_long', 38, 'Short close left'), angle('a_short', 8, 'Below short stairs'), angle('a_short', 14, 'Short back box'),
    angle('a_short', 15, 'A short edge crouched'), angle('a_short', 25, 'A default tight'),
  ]),
  course('short-a', 'short-cross', 'Short / ramp & car checks', 'Short', [
    angle('a_short', 16, 'Short ramp edge'), angle('a_short', 21, 'Long ramp elevated'), angle('a_short', 22, 'Long ramp low'),
    angle('a_short', 23, 'Car crouched'), angle('a_short', 24, 'Long cross'),
  ]),
  course('b-tunnels', 'b-backsite', 'B / back site clearing', 'B Site', [
    angle('b_tunnel', 25, 'B car deep'), angle('b_tunnel', 12, 'Back platform right crouched'), angle('b_tunnel', 14, 'B back box'),
    angle('b_tunnel', 15, 'B doors box'), angle('b_tunnel', 17, 'B doors inside'),
  ]),
  course('b-doors', 'b-door-detail', 'B doors / close corners', 'B Retake', [
    angle('mid_to_b', 31, 'B door right'), angle('mid_to_b', 34, 'B car deep'), angle('mid_to_b', 38, 'Tunnel exit left'),
    angle('mid_to_b', 40, 'Tunnel box'), angle('mid_to_b', 48, 'B doors close left'),
  ]),
  course('b-doors', 'b-site-retake', 'B / platform & default retake', 'B Retake', [
    angle('mid_to_b', 35, 'Window ledge'), angle('mid_to_b', 43, 'B back doors'), angle('mid_to_b', 44, 'B default left'),
    angle('mid_to_b', 45, 'B default box edge'), angle('mid_to_b', 49, 'Back platform deep crouched'),
  ]),
  course('mid-doors', 'mid-lower-check', 'Mid doors / CT cross', 'Mid', [
    angle('mid_to_b', 18, 'B slope'), angle('mid_to_b', 19, 'CT corner'), angle('mid_to_b', 22, 'CT doors left'),
    angle('mid_to_b', 27, 'Close CT right'), angle('a_long', 30, 'CT spawn back'),
  ]),
  course('lower-tunnels', 'lower-detail', 'Lower / stairs clearing', 'Tunnels', [
    angle('ct_push_lower', 5, 'Mid doors left'), angle('ct_push_lower', 9, 'Mid wall right'), angle('ct_push_lower', 10, 'Lower entrance'),
    angle('ct_push_lower', 11, 'Tunnel stairs upper'), angle('ct_push_lower', 12, 'Stairs box'),
  ]),
  course('lower-tunnels', 'upper-detail', 'Upper tunnels / pillar clearing', 'Tunnels', [
    angle('ct_push_lower', 19, 'Upper close left'), angle('ct_push_lower', 18, 'Upper deep corner'), angle('ct_push_lower', 20, 'Upper exit corner'),
    angle('ct_push_lower', 21, 'Pillar edge'), angle('ct_push_lower', 22, 'Upper entrance'),
  ]),
  course('a-retake', 'a-retake-boxes', 'A retake / site boxes', 'A Retake', [
    retake(16, 'A ramp box'), retake(18, 'A front box left'), retake(19, 'A default front'), retake(20, 'Goose'), retake(21, 'A back platform'),
  ]),
  course('b-doors', 'b-retake-boxes', 'B retake / post-plant holds', 'B Retake', [
    retake(9, 'Back platform deep'), retake(10, 'Back platform box'), retake(11, 'B doors post-plant'),
    retake(12, 'B default post-plant'), retake(14, 'B doors back box'),
  ]),
  {id: 'ct-mid-push', name: 'CT push / mid to top mid', region: 'Mid', enemySide: 't',
    spawn: [-580, 1883, -118], look: [-420, 1632, -126],
    path: [[-420,1632,-126], [-395,1460,-126], [-395,1300,-126], [-394,733,0], [-261,465,0], [20,350,0], [100,320,1], [150,240,8], [200,160,8]],
    angles: [angle('ct_push_mid', 3, 'Top mid left'), angle('ct_push_mid', 13, 'Xbox approach'), angle('ct_push_mid', 1, 'Top mid close'),
      angle('ct_push_mid', 11, 'Catwalk close'), angle('ct_push_mid', 12, 'Outside long')],
  },
  {id: 'upper-tunnels', name: 'Upper tunnels / B approach', region: 'Tunnels', enemySide: 'ct',
    spawn: [-1970, 351, 9], look: [-1650, 700, 32],
    path: [[-1650, 700, 32], [-1650, 950, 32], [-1700, 1180, 32], [-1850, 1186, 30]],
    angles: [angle('b_tunnel', 6, 'Upper pillar left'), angle('b_tunnel', 8, 'Upper deep right'), angle('b_tunnel', 3, 'Stairs upper corner'),
      angle('b_tunnel', 2, 'Upper pillar right'), angle('b_tunnel', 4, 'Tunnel exit corner')],
  },
];

export const prefireClearingRoutes: readonly PrefireRoute[] = [...existingRoutes, ...extendedRoutes].map(route => ({...route,
  region: route.region ?? ({'long-doors': 'Long', 'long-a': 'Long', 'short-a': 'Short', 'b-tunnels': 'B Site',
    'b-doors': 'B Retake', 'mid-doors': 'Mid', 'lower-tunnels': 'Tunnels', 'a-retake': 'A Retake'}[route.id] ?? 'Other'),
  enemySide: route.enemySide ?? 'ct',
  phase: route.phase ?? 'preplant',
}));

const closet = (sample: PrefireAngle): PrefireAngle => ({...sample, exclusionGroup: 'b-closet-pocket'});
const bClose = [angle('b_tunnel', 21, 'B close-right deep crouched'),
  closet(angle('b_tunnel', 26, 'B closet-side crouched')), closet(angle('b_tunnel', 27, 'B closet-side standing')),
  angle('b_tunnel', 22, 'B tunnel-side box top'), angle('b_tunnel', 20, 'B exit high box')];
const lower = [angle('mid_to_b', 11, 'Lower back wall'), angle('mid_to_b', 15, 'Lower entrance wall')];
const cat = [angle('mid_to_b', 13, 'Catwalk edge'), angle('mid_to_b', 14, 'Catwalk second hold')];
const outsideLong = [angle('ct_push_mid', 15, 'Outside long rear wall crouched'),
  angle('ct_push_mid', 16, 'Outside long close wall crouched'), angle('ct_push_mid', 17, 'Outside long anti-push'),
  angle('ct_push_mid', 18, 'Outside long corner'), angle('ct_push_mid', 20, 'Top mid close crouched')];
const bRetake = [retake(13, 'B elevated site box'), closet(retake(15, 'B closet post-plant')),
  angle('b_tunnel', 24, 'B back-box floor')];
const longCar = [angle('a_short', 26, 'Car tight alternative'), angle('a_short', 28, 'Car approach off-angle'),
  angle('a_short', 30, 'Long car-side off-angle')];
const aSite = [angle('a_short', 19, 'A default'), angle('a_short', 25, 'A default tight'),
  angle('a_short', 29, 'Goose alternative'), angle('mid_to_b', 26, 'A ramp front')];
const aSiteBoxes = [angle('a_short', 11, 'A site elevated box'), angle('a_short', 14, 'A back-platform box'),
  retake(17, 'A front-site box'), retake(21, 'A back-platform hold')];
const ctBoxCrouched = angle('mid_to_b', 24, 'CT spawn box / crouched headglitch');
const ctBoxStanding: PrefireAngle = {...ctBoxCrouched, id: `${ctBoxCrouched.id}:standing`, name: 'CT spawn box / standing headglitch',
  crouched: false, source: {...ctBoxCrouched.source!, stanceOverride: 'standing'}};
const ctSpawn = [ctBoxCrouched, angle('mid_to_b', 25, 'CT spawn under-A hold'),
  angle('a_long', 31, 'CT cross headshot angle')];
const bSiteBoxes = [...bRetake, angle('b_tunnel', 18, 'B car-side hold'), angle('b_tunnel', 28, 'B window raised hold')];
const shortEntry = [angle('a_short', 3, 'Catwalk close alternative'), angle('a_short', 5, 'Short entry left'),
  angle('a_short', 6, 'Short entry right')];
const topMid = [angle('mid_to_b', 16, 'Top mid close alternative'), angle('ct_push_mid', 21, 'Outside long doorway'),
  angle('ct_push_mid', 22, 'Top mid rear crouched'), angle('ct_push_mid', 23, 'T ramp crouched')];
const families = [
  ['long-doors', 'long-close', 'pit-clear'], ['long-a', 'long-cross', 'a-long-site'],
  ['short-a', 'short-detail', 'short-cross'], ['b-tunnels', 'b-backsite'],
  ['b-doors', 'b-door-detail', 'b-site-retake', 'b-retake-boxes'], ['mid-doors', 'mid-lower-check'],
  ['lower-tunnels', 'lower-detail', 'upper-detail'], ['a-retake', 'a-retake-boxes'],
  ['ct-mid-push'], ['upper-tunnels'],
];
const extraCandidates: Record<string, readonly PrefireAngle[]> = {
  'long-doors': [angle('a_long', 15, 'Pit ledge alternative'), angle('a_short', 31, 'Pit platform alternative'), nativeHold('pit-slope'), nativeHold('pit-floor')],
  'long-a': [...longCar, ...aSite, ...aSiteBoxes, ...ctSpawn, angle('mid_to_b', 32, 'Long ramp corner'), angle('a_short', 23, 'Long car / crouched rear'),
    ...['car-front-edge', 'car-back-edge', 'a-ninja', 'a-default-box-top', 'a-short-box-edge', 'a-ramp-short-low', 'a-ramp-short-high'].map(nativeHold)],
  'short-a': [...longCar, ...aSite, ...aSiteBoxes, ...shortEntry, ...cat, angle('a_long', 37, 'A front box'),
    ...['car-front-edge', 'car-back-edge', 'a-ninja', 'a-default-box-top', 'a-short-box-edge', 'a-ramp-short-low', 'a-ramp-short-high'].map(nativeHold)],
  'a-retake': [...longCar, ...aSite, ...aSiteBoxes, retake(17, 'A front-site post-plant'),
    ...['car-front-edge', 'car-back-edge', 'a-ninja', 'a-default-box-top', 'a-short-box-edge', 'a-ramp-short-low', 'a-ramp-short-high'].map(nativeHold)],
  'b-tunnels': [...bClose, ...bSiteBoxes], 'b-backsite': bClose,
  'b-doors': [...bClose, ...bRetake], 'b-door-detail': [...bClose, ...bRetake],
  'b-site-retake': [...bClose, ...bRetake], 'b-retake-boxes': [...bClose, ...bRetake],
  'mid-doors': [...lower, ...ctSpawn, ctBoxStanding, angle('mid_to_b', 20, 'CT mid close wall'), angle('mid_to_b', 21, 'CT mid doors recess')],
  'mid-lower-check': lower,
  'lower-tunnels': [...lower, ...cat], 'lower-detail': [...lower, ...cat], 'upper-detail': [...lower, ...cat],
  'ct-mid-push': [...lower, cat[0], ...outsideLong, ...topMid, shortEntry[0]],
  'upper-tunnels': [angle('b_tunnel', 1, 'Upper exit right corner'), angle('b_tunnel', 5, 'Upper exit deep left')],
};
for(const [route,ids] of Object.entries({
  'long-doors':['long-blue-exit'],
  'long-a':['a-ramp-cross-low','short-platform-front','a-short-ramp-edge','a-back-default'],
  'short-a':['a-ramp-cross-low','short-platform-front','a-short-ramp-edge','a-back-default'],
  'a-retake':['a-ramp-cross-low','short-platform-front','a-short-ramp-edge','a-back-default'],
  'b-tunnels':['b-default-back'], 'b-doors':['b-default-back','ct-spawn-b-slope'],
  'mid-doors':['ct-spawn-b-slope'], 'ct-mid-push':['ct-spawn-b-slope'],
}))extraCandidates[route]=[...extraCandidates[route]??[],...ids.map(combatHold)];

const coverageProfiles: Record<string, readonly (keyof typeof dataset.profiles)[]> = {
  'long-doors':['a_long','a_short'], 'long-a':['a_long','a_short'], 'short-a':['a_short','a_long'],
  'a-retake':['a_short','a_long'], 'b-tunnels':['b_tunnel','mid_to_b'], 'b-backsite':['b_tunnel','mid_to_b'],
  'b-doors':['b_tunnel','mid_to_b'], 'b-door-detail':['b_tunnel','mid_to_b'],
  'b-site-retake':['b_tunnel','mid_to_b'], 'b-retake-boxes':['b_tunnel','mid_to_b'],
  'mid-doors':['mid_to_b','ct_push_mid','a_long'], 'mid-lower-check':['mid_to_b','ct_push_lower'],
  'lower-tunnels':['ct_push_lower','mid_to_b'], 'lower-detail':['ct_push_lower','mid_to_b'],
  'upper-detail':['ct_push_lower','mid_to_b'], 'ct-mid-push':['ct_push_mid','mid_to_b'],
  'upper-tunnels':['ct_push_lower','b_tunnel'],
};
function coverageName(profile:keyof typeof dataset.profiles,index:number):string {
  const [x,y,z]=dataset.profiles[profile].angles[index-1].position;
  if(x < -1200 && y > 1550) return x < -1950 ? 'B car / back-site cover' : y > 2600 ? 'B back platform / window cover'
    : y < 1900 ? 'B tunnel exit / close cover' : 'B site / box cover';
  if(x < -800) return y > 1950 ? 'B doors / window approach' : y > 1000 ? 'Lower / upper tunnel cover' : 'T tunnels / entrance cover';
  if(x > 1200 && y < 900)return z < -80 ? 'Long pit / low hold' : 'Long pit / platform hold';
  if(x > 1550 && y < 2300)return 'Long car / off-angle';
  if(y > 2350 && x > 200)return x < 600 ? 'A Ninja / back-platform cover' : y > 2850 ? 'A Goose / back-site cover'
    : x > 1300 ? 'A ramp / site edge' : 'A site / box cover';
  if(x > 200 && y > 1750)return z > 60 ? 'Short platform / ramp edge' : 'A ramp / CT cross';
  if(y > 1750)return 'CT spawn / mid cover';
  if(y > 1300 && z > -30)return 'Catwalk / short cover';
  if(y > 1100)return 'Mid doors / Xbox cover';
  return x > 300 ? 'Outside Long / top-mid cover' : 'Top mid / T ramp cover';
}
function expandedCoverage(route:PrefireRoute,existing:readonly PrefireAngle[]):PrefireAngle[] {
  const extra:PrefireAngle[]=[];
  for(const profile of coverageProfiles[route.id]??[])for(let index=1;index<=dataset.profiles[profile].angles.length;index++) {
    const candidate=angle(profile,index,coverageName(profile,index));
    if([...existing,...extra].some(other=>other.id===candidate.id ||
      Math.hypot(other.position[0]-candidate.position[0],other.position[1]-candidate.position[1])<48 &&
      Math.abs(other.position[2]-candidate.position[2])<24))continue;
    extra.push(candidate);
  }
  return extra;
}

// Complete pinned practice profiles are proposals only: geometry, covered-entry,
// reachability and head visibility must pass before any new position can spawn.
export const proposedPrefirePools = Object.fromEntries(prefireClearingRoutes.map(route => [route.id,
  (()=>{
    const existing=[...new Map([...prefireClearingRoutes.filter(other => families.find(ids => ids.includes(route.id))!.includes(other.id))
      .flatMap(other => other.angles), ...extraCandidates[route.id] ?? []].map(angle => [angle.id!, angle])).values()];
    return [...existing,...expandedCoverage(route,existing)];
  })(),
]));
const sharedFamilies: Readonly<Record<string, string>> = {
  'openprefire:a_long/27': 'long-tight-car', 'openprefire:a_short/26': 'long-tight-car',
  'openprefire:a_long/29': 'short-ramp-edge', 'openprefire:a_short/16': 'short-ramp-edge',
  'openprefire:a_long/34': 'goose-back-wall', 'openprefire:a_short/29': 'goose-back-wall',
  'openprefire:ct_push_mid/1': 'top-mid-close', 'openprefire:mid_to_b/16': 'top-mid-close',
  'openprefire:ct_push_mid/11': 'catwalk-close', 'openprefire:mid_to_b/13': 'catwalk-close',
  'openprefire:a_short/3': 'catwalk-close',
  'openprefire:mid_to_b/46': 'b-default-overlap', 'retakes:dust2/12': 'b-default-overlap',
  'openprefire:mid_to_b/49': 'b-platform-overlap', 'retakes:dust2/9': 'b-platform-overlap',
  'openprefire:mid_to_b/24': 'ct-spawn-box', 'openprefire:mid_to_b/24:standing': 'ct-spawn-box',
  'openprefire:a_long/19': 'long-car-front',
  'openprefire:a_long/20': 'long-car-rear', 'openprefire:a_short/23': 'long-car-rear',
};
const withFamily = (angle: PrefireAngle): PrefireAngle => sharedFamilies[angle.id ?? '']
  ? {...angle, exclusionGroup: sharedFamilies[angle.id!]} : angle;
const sourceAngles = new Map(Object.values(proposedPrefirePools).flat().map(angle => [angle.id!, withFamily(angle)]));
// A route is a distinct approach, not a five-bot roster. Keep old clearing sets
// as provenance and selectable lineups, not duplicate entries in the route menu.
export const prefireRouteAliases = Object.fromEntries(families.flatMap(ids => ids.map(id => [id, ids[0]])));
const approaches: Record<string, Partial<PrefireRoute>> = {
  'long-doors': {name: 'Outside Long to pit', startLabel: 'Outside Long / T approach', spawn: [210, -297, 2]},
  'long-a': {name: 'Long corner to A', startLabel: 'Long corner', spawn: [700, 910, 0],
    path: [[900,910,0], [1250,1000,0], [1430,1190,-11], [1450,1790,-8], [1475,2320,4], [1450,2750,105], [1190,2780,121]]},
  'short-a': {name: 'Catwalk to A', startLabel: 'Top Mid / Catwalk approach', spawn: [200,160,8],
    path: [[-26,420,-1], [-156,526,0], [-180,1400,0], ...existingRoutes[2].path],
    angles: [cat[1], shortEntry[1], angle('a_short', 9, 'Short stairs'), angle('a_short', 11, 'A site box'), angle('a_short', 18, 'Goose')]},
  'b-tunnels': {name: 'Upper tunnels to B', startLabel: 'Upper tunnels / pillar approach', spawn: [-1650,950,32],
    path: [[-1700,1180,32], [-1764,1186,30], ...existingRoutes[3].path,
      [-1690,2460,11], [-1688,2584,7], [-1640,2820,16]]},
  'b-doors': {name: 'CT mid to B retake', startLabel: 'CT mid cover', spawn: [-584,1910,-118],
    path: [[-400,1870,-126], [-390,2020,-128], [-700,2215,-119], ...existingRoutes[4].path]},
  'mid-doors': {name: 'Mid slope to CT', startLabel: 'Mid slope / Xbox approach', spawn: [-395,1004,-55],
    path: [[-395,1300,-126], ...existingRoutes[5].path]},
  'lower-tunnels': {name: 'Mid doors through lower tunnels', startLabel: 'CT side of Mid doors', spawn: [-395,1804,-126],
    path: [[-459,1708,-125], [-395,1612,-126], ...existingRoutes[6].path]},
  'a-retake': {name: 'CT ramp to A retake', startLabel: 'CT spawn / under A cover', spawn: [360,2430,-125],
    path: [[458,2323,-119], ...existingRoutes[7].path.slice(1)]},
  'ct-mid-push': {startLabel: 'CT mid cover'},
  'upper-tunnels': {startLabel: 'T tunnels entrance'},
};
export const prefireApproachRoutes: readonly PrefireRoute[] = families.map(ids => {
  const original = prefireClearingRoutes.find(route => route.id === ids[0])!;
  const route = {...original, ...approaches[original.id]};
  return {...route, look: route.path[0]};
});
const focusLineups: Readonly<Record<string, readonly {id: string; name: string; angles: readonly string[]}[]>> = {
  'long-doors': [{id: 'long-pit-floor', name: 'Long / pit floor & platform', angles: [
    'openprefire:a_long/1', 'openprefire:a_long/8', 'openprefire:a_long/13', 'openprefire:a_long/16', 'spraylab:dust2/pit-slope',
  ]}],
  'mid-doors': [{id: 'ct-spawn-boxes', name: 'CT spawn / headglitch & under A', angles: [
    'openprefire:mid_to_b/27', 'openprefire:a_long/31', 'openprefire:mid_to_b/24:standing',
    'openprefire:mid_to_b/25', 'openprefire:mid_to_b/19',
  ]}],
  'long-a': [{id: 'long-car-variations', name: 'Long / car, ramp & site', angles: [
    'spraylab:dust2/car-front-edge', 'spraylab:dust2/car-back-edge', 'spraylab:dust2/a-ramp-short-low', 'spraylab:dust2/a-default-box-top', 'openprefire:a_long/34',
  ]}, {id: 'long-a-boxes', name: 'A site / boxes from Long', angles: [
    'openprefire:a_short/11', 'openprefire:a_short/14', 'openprefire:a_short/19', 'openprefire:a_long/34', 'retakes:dust2/17',
  ]}],
  'short-a': [{id: 'short-site-entry', name: 'A Short / stairs to site', angles: [
    'openprefire:a_short/9', 'openprefire:a_short/10', 'openprefire:a_short/11', 'openprefire:a_short/13', 'openprefire:a_short/18',
  ]}, {id: 'catwalk-close', name: 'Catwalk / close & stairs', angles: [
    'openprefire:mid_to_b/14', 'openprefire:a_short/3', 'openprefire:a_short/5', 'openprefire:a_short/8', 'openprefire:a_short/9',
  ]}, {id: 'short-a-ninja-ramp', name: 'A Short / Ninja, boxes & ramp', angles: [
    'spraylab:dust2/a-ninja', 'spraylab:dust2/a-short-box-edge', 'spraylab:dust2/a-default-box-top', 'spraylab:dust2/a-ramp-short-high', 'openprefire:a_short/18',
  ]}, {id: 'short-a-boxes', name: 'A site / boxes from Short', angles: [
    'openprefire:a_short/11', 'openprefire:a_short/14', 'openprefire:a_short/19', 'openprefire:a_short/18', 'retakes:dust2/17',
  ]}],
  'b-tunnels': [{id: 'b-tunnel-boxes', name: 'B site / elevated & back-site boxes', angles: [
    'openprefire:b_tunnel/11', 'retakes:dust2/13', 'openprefire:b_tunnel/24', 'openprefire:b_tunnel/26', 'openprefire:b_tunnel/9',
  ]}],
};
export const prefireRoutes: readonly PrefireRoute[] = prefireApproachRoutes.map(route => {
  const pool = ((weightedPools.routes as Record<string, readonly string[]>)[route.id] ?? []).map(id => {
    const angle = sourceAngles.get(id);
    if (!angle) throw new Error(`Missing validated weighted hold ${id}`);
    return angle;
  });
  const admitted = new Set(pool.map(angle => angle.id));
  const siblings = families.find(ids => ids[0] === route.id)!;
  const lineups = [...siblings.map(id => prefireClearingRoutes.find(other => other.id === id)!)
    .map(other => ({id: other.id, name: other.id === route.id ? route.name : other.name,
      angles: (other.id === route.id ? route.angles : other.angles).map(withFamily)})),
    ...(focusLineups[route.id] ?? []).map(lineup => ({...lineup, angles: lineup.angles.map(id => {
      const angle = sourceAngles.get(id);
      if (!angle) throw new Error(`Missing focused lineup hold ${id}`);
      return angle;
    })}))]
    .filter(lineup => lineup.angles.every(angle => admitted.has(angle.id)));
  return {...route, angles: route.angles.map(withFamily), lineups,
    alternatives: pool.filter(angle => !route.angles.some(original => original.id === angle.id))};
});

const lineupRoutes = new WeakMap<PrefireRoute, Map<string, PrefireRoute>>();
export function prefireLineup(route: PrefireRoute, id?: string): PrefireRoute {
  const lineup = route.lineups?.find(lineup => lineup.id === id);
  if (!lineup || lineup.id === route.id) return route;
  let variants = lineupRoutes.get(route);
  if (!variants) {variants = new Map(); lineupRoutes.set(route, variants);}
  let variant = variants.get(lineup.id);
  if (!variant) {
    const angles = new Set(lineup.angles.map(angle => angle.id));
    variant = {...route, angles: lineup.angles,
      alternatives: [...route.angles, ...route.alternatives ?? []].filter(angle => !angles.has(angle.id))};
    variants.set(lineup.id, variant);
  }
  return variant;
}

export const dust2Catalog: PrefireCatalog = {id: 'de_dust2', name: 'Dust 2', revision: authored.revision, routes: prefireRoutes, density,
  sources: [
    {id: 'openprefire', ...prefireAngleSource, context: 'Authored common-angle practice coordinates, not match statistics.'},
    {id: 'retakes', repository: retakes.source, commit: retakes.commit, license: retakes.license, notice: retakes.licenseNotice, context: retakes.context},
    {id:'duel-density',repository:combatLeads.source,commit:combatLeads.commit,license:combatLeads.license,notice:combatLeads.licenseNotice,context:combatLeads.context},
  ]};
