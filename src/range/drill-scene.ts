import * as THREE from 'three';
import {PEEK_WALLS, type Scenario} from './drills';

export class DrillScenery {
  group = new THREE.Group();
  solids: THREE.Mesh[] = [];
  coverGroups = new Map<string,THREE.Group>();
  texture = new THREE.TextureLoader().load('/textures/wall.webp');
  normal = new THREE.TextureLoader().load('/textures/wall-normal.webp');
  constructor() {
    this.texture.colorSpace = THREE.SRGBColorSpace;
    for (const t of [this.texture,this.normal]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2,2); }
    const material = new THREE.MeshStandardMaterial({color:'#75817c',roughness:.94,map:this.texture,normalMap:this.normal,normalScale:new THREE.Vector2(.3,.3)});
    const metal = new THREE.MeshStandardMaterial({color:'#334744',roughness:.55,metalness:.25});
    const paint = new THREE.MeshStandardMaterial({color:'#c7a65d',roughness:.7});
    for (const id of [...PEEK_WALLS.map(c=>c.id),'target-cover','platform']) {
      const group = new THREE.Group(); this.group.add(group); this.coverGroups.set(id,group);
      const body = new THREE.Mesh(new THREE.BoxGeometry(1,1,1),material);
      body.castShadow = body.receiveShadow = true; group.add(body); this.solids.push(body);
      for (const x of [-.48,.48]) {
        const trim = new THREE.Mesh(new THREE.BoxGeometry(.035,1.01,1.02),metal); trim.position.x=x; group.add(trim);
      }
      const band = new THREE.Mesh(new THREE.BoxGeometry(.96,.035,1.015),paint); band.position.y=.3; group.add(band);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(1.02,.045,1.04),metal); cap.position.y=.485; group.add(cap);
    }
    for (const [i,c] of PEEK_WALLS.entries()) {
      const canvas = document.createElement('canvas'); canvas.width=256;canvas.height=128;
      const ctx=canvas.getContext('2d')!;ctx.fillStyle='#e3ddca';ctx.font='bold 58px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(`0${i+1}`,128,64);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
      const number=new THREE.Mesh(new THREE.PlaneGeometry(.38,.21),new THREE.MeshBasicMaterial({map:texture,transparent:true}));
      number.position.set(0,.12,.507);this.coverGroups.get(c.id)!.add(number);
    }
    this.group.visible=false;
  }
  setScenario(scenario?: Scenario) {
    this.group.visible=!!scenario;
    for (const [id,group] of this.coverGroups) {
      const c=scenario?.covers.find(c=>c.id===id);group.visible=!!c;
      if (c) { group.position.set(c.center.x,c.center.y,c.center.z);group.scale.set(c.size.x,c.size.y,c.size.z); }
    }
    this.group.updateMatrixWorld(true);
  }
  dispose() { this.texture.dispose();this.normal.dispose(); }
}
