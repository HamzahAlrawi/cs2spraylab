import fs from 'node:fs';
import {createHash} from 'node:crypto';
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const collision=JSON.parse(fs.readFileSync('public/revamp/maps/mirage/collision.json')),
  routes=JSON.parse(fs.readFileSync('src/range/prefire/data/mirage-authored-routes.json')),
  dataset=JSON.parse(fs.readFileSync('src/range/prefire/data/openprefire-mirage.json'));
const areas=[
  {id:'a-site',name:'A site, Ramp and Palace',routeIds:['a-ramp','a-palace'],pockets:['Ramp close','Tetris','Under balcony / Shadows','Sandwich','Default','Triple','Firebox','Ninja','Stairs','Jungle','Ticket','Palace balcony']},
  {id:'mid',name:'Top mid, Short and Underpass',routeIds:['mid-short','underpass-connector'],pockets:['Top-mid boxes','Chair','Window','Window close','Connector close','Connector stairs','Underpass mouth','Short corner','Ladder room','Short arches','Short boost']},
  {id:'b-site',name:'B site, Apartments and Market',routeIds:['b-apartments','market-b'],pockets:['Apartments close','Balcony','Van','Bench','Default','Back site','Get Right','Short corner','Market window','Market door','Market shelves']},
];
const plan={schemaVersion:1,mapId:'de_mirage',revision:routes.revision,weighting:'authored-coverage',
  native:{gameBuild:collision.build,resourceSha256:{'maps/de_mirage.vpk':collision.mapSha256,'maps/de_mirage/world_physics.vmdl_c':collision.sourceSha256,
    'Source2Viewer-CLI.exe':hash('.local-tools/vrf-dev/Source2Viewer-CLI.exe')},extractorRevision:'Source 2 Viewer (installed CLI; executable SHA pinned)',
    extractionMethod:'Static VPK -> PHYS KV3; hull faces and mesh triangles converted without recentering. Native vmap GLB and visibility exported separately.',
    coordinateTransform:'[Source.x, Source.z, -Source.y] * 0.0254 metres',collisionMasks:'Separate movement, shot and csgo_grenadeclip attributes from PHYS; grenade-only groups retained.',
    referenceCapture:'Pending matched-build in-game trajectory and image captures; beta is not native parity certification.'},
  scopeReview:{reviewer:'',reference:'docs/mirage.md',approved:false},
  references:[{id:'native',kind:'native',independentGroup:'Valve',reference:'Installed de_mirage.vpk, native radar and PHYS',revision:collision.build,license:'Local CS2 installation; media excluded from Git'},
    {id:'coordinates',kind:'coordinates',independentGroup:'lengran',reference:dataset.source,revision:dataset.commit,license:dataset.license},
    {id:'expert',kind:'expert',independentGroup:'EliGE',reference:'https://www.youtube.com/watch?v=S9fe6AgxVHs',revision:'2024-01-14',license:'Reference only; no video assets copied'}],
  areas:areas.map(a=>({...a,pockets:a.pockets.map((name,i)=>({id:`pocket-${i+1}`,name,angleIds:[],referenceIds:['native','coordinates','expert'],
    status:'pending',reviewer:'',note:'Independent required-angle review remains pending; do not infer completion from the coordinate pool.'}))}))};
fs.mkdirSync('docs/mirage',{recursive:true});fs.writeFileSync('docs/mirage/coverage-plan.json',JSON.stringify(plan,null,2)+'\n');
console.log('Saved explicit pending whole-map coverage brief and native resource provenance. No human review marked passed.');
