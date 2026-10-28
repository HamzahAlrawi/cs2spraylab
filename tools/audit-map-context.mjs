import fs from 'node:fs/promises';
import {chromium} from '@playwright/test';
import sharp from 'sharp';
import assert from 'node:assert/strict';

const browser=await chromium.launch({channel:'chromium'}),errors=[],rows=[],images=[];
const directory='research/context-atlas-audit';await fs.mkdir(directory,{recursive:true});
try {
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  await page.route('**/favicon.ico',route=>route.fulfill({status:204,body:''}));
  page.on('response',response=>{if(response.status()>=400)errors.push(`${response.status()} ${response.url()}`);});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto('http://127.0.0.1:5176/tests/armory-host.html');
  await page.evaluate(async()=>{
    document.body.replaceChildren();document.body.style.margin='0';
    const {loadRealMapChunk,realMapChunks,chunkRenderBounds}=await import('/src/range/duel/real-map.ts');
    const threeUrl=performance.getEntriesByType('resource').find(entry=>/\/three\.js\?/.test(entry.name)).name;
    const THREE=await import(threeUrl);
    const {MapContextCache}=await import('/src/range/duel/map-context.ts');
    const {GLTFLoader}=await import('/node_modules/three/examples/jsm/loaders/GLTFLoader.js');
    const {MeshoptDecoder}=await import('/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js');
    const {PrefireLighting}=await import('/src/range/prefire/lighting.ts');
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(innerWidth,innerHeight);
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;document.body.appendChild(renderer.domElement);
    const camera=new THREE.PerspectiveCamera(2*Math.atan(.75)*180/Math.PI,innerWidth/innerHeight,.03,200);
    const cache=new MapContextCache(async()=>{
      const response=await fetch('/maps/dust2/duel/objects/a1ab5104848e7d12e078c5e5621201cfdc32c478ea14beecb42d217552ef67f9.bin');
      const bytes=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes,'')).scene;
    });
    window.contextAudit={THREE,loadRealMapChunk,realMapChunks,chunkRenderBounds,PrefireLighting,renderer,camera,cache};
  });
  const cases=[
    {id:'dust2-mid-ct',position:[180,2180,-125],target:[1300,2600,50]},
    {id:'dust2-a-short',position:[530,1900,100],target:[-200,-350,0]},
    {id:'dust2-b-entry',position:[-1400,2190,1],target:[400,2000,-125]},
  ];
  for(const [index,entry] of cases.entries()) {
    await page.evaluate(async entry=>{
      const a=window.contextAudit;
      a.light?.dispose();a.map?.dispose();a.old?.dispose();
      a.chunk=a.realMapChunks.find(chunk=>chunk.id===entry.id);
      a.map=await a.loadRealMapChunk(a.chunk,new AbortController().signal);
      a.scene=new a.THREE.Scene();a.scene.background=new a.THREE.Color('#bbc9d1');a.scene.fog=new a.THREE.Fog('#bbc9d1',75,150);a.scene.add(a.map.scene);
      a.light=new a.PrefireLighting(a.scene,a.map.scene);a.light.configure(a.renderer,'auto');
      a.newRoot=a.map.scene.getObjectByName('duel-distant-native-context');
      a.old=await a.cache.load();a.old.attach(a.map.scene,a.chunkRenderBounds(a.chunk));
      const p=entry.position;a.camera.position.set(p[0]*.0254,(p[2]+64)*.0254,-p[1]*.0254);
      const t=entry.target;a.camera.lookAt(t[0]*.0254,(t[2]+64)*.0254,-t[1]*.0254);a.camera.updateMatrixWorld(true);
      a.map.updateVisibility(a.camera.position);a.light.beginFrame(a.renderer,a.camera.position);
    },entry);
    for(const [column,variant] of ['old','atlas'].entries()) {
      const state=await page.evaluate(async variant=>{
        const a=window.contextAudit;a.old.root.visible=variant==='old';a.newRoot.visible=variant==='atlas';
        await a.renderer.compileAsync(a.scene,a.camera);for(let i=0;i<3;i++)a.renderer.render(a.scene,a.camera);
        const timings=[];for(let i=0;i<12;i++){const start=performance.now();a.renderer.render(a.scene,a.camera);timings.push(performance.now()-start);}
        const mesh=a.newRoot.children.find(node=>node.isMesh);
        return {variant,draws:a.renderer.info.render.calls,triangles:a.renderer.info.render.triangles,
          atlas:!!mesh.material.map,tileAttribute:!!mesh.geometry.getAttribute('_context_tile'),
          medianCpuRenderMs:timings.sort((a,b)=>a-b)[6]};
      },variant);
      rows.push({chunk:entry.id,...state});
      const path=`${directory}/${entry.id}-${variant}.png`;await page.screenshot({path});
      images.push({input:await sharp(path).resize(640,360).png().toBuffer(),left:column*640,top:index*360});
    }
  }
  await sharp({create:{width:1280,height:cases.length*360,channels:3,background:'#202020'}}).composite(images).png().toFile(`${directory}/comparison.png`);
  await fs.writeFile(`${directory}/report.json`,JSON.stringify({rows,errors},null,2));
  console.log(JSON.stringify({rows,errors}));assert.deepEqual(errors,[]);
} finally {await browser.close();}
