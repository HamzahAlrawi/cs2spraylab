import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';

const browser=await chromium.launch({channel:'chromium'});
try {
  const page=await browser.newPage({viewport:{width:1000,height:700}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:5176/tests/armory-host.html');
  await page.evaluate(async()=>{
    document.body.replaceChildren();document.body.style.margin='0';
    const root='/src/range/',{loadRealMapChunk,realMapChunks}=await import(root+'duel/real-map.ts'),
      {PrefireLighting}=await import(root+'prefire/lighting.ts'),
      {prefireRoutes,sourcePoint}=await import(root+'prefire/routes.ts'),THREE=await import('/node_modules/.vite/deps/three.js');
    const map=await loadRealMapChunk(realMapChunks.find(chunk=>chunk.id==='dust2-b-entry'),new AbortController().signal);
    const scene=new THREE.Scene();scene.background=new THREE.Color('#bbc9d1');scene.fog=new THREE.Fog('#bbc9d1',75,150);scene.add(map.scene);
    const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(innerWidth,innerHeight);
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;document.body.appendChild(renderer.domElement);
    const light=new PrefireLighting(scene,map.scene);light.configure(renderer,'auto');
    const camera=new THREE.PerspectiveCamera(2*Math.atan(.75)*180/Math.PI,innerWidth/innerHeight,.03,180);
    const route=prefireRoutes.find(route=>route.id==='b-tunnels');
    window.visualAudit={map,scene,renderer,light,camera,THREE,sourcePoint,points:[route.spawn,...route.path]};
  });
  const points=await page.evaluate(()=>window.visualAudit.points);
  const records=[];await fs.mkdir('research/b-tunnel-visuals',{recursive:true});
  for(let index=0;index<points.length-1;index++){
    const row=await page.evaluate(index=>{
      const a=window.visualAudit,p=a.map.settle(a.points[index]),next=a.sourcePoint(a.points[index+1]);
      a.camera.position.set(p.x,p.y+64*.0254,p.z);a.camera.lookAt(next.x,next.y+64*.0254,next.z);a.camera.updateMatrixWorld(true);
      a.map.updateVisibility(a.camera.position);a.light.beginFrame(a.renderer,a.camera.position);a.renderer.render(a.scene,a.camera);
      return {index,source:a.points[index],visible:a.map.scene.children.reduce((count,child)=>count+Number(child.visible),0),sun:a.light.sun.position.toArray()};
    },index);
    records.push(row);await page.screenshot({path:`research/b-tunnel-visuals/${index}.png`});
  }
  await fs.writeFile('research/b-tunnel-visuals/report.json',JSON.stringify({records,errors},null,2));
  console.log(JSON.stringify({points:records,errors}));
}finally{await browser.close();}
