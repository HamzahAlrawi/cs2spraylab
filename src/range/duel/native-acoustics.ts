import type {AcousticScene} from '../spatial-audio';
import {AcousticNavigation} from '../acoustic-navigation';
import type {Arena} from './geometry';
import {exportNativeNavigation} from './native-navigation';

const graphs=new WeakMap<object,AcousticNavigation>();
export function configureArenaAcoustics(scene:AcousticScene,arena:Arena) {
  scene.setBoxes(arena.solids);
  const native=arena.native;
  if(!native){scene.setNavigation();return;}
  let graph=graphs.get(native);
  if(!graph) {
    const nodes=exportNativeNavigation(arena).nodes.map(node=>({point:{...node.point,y:node.point.y+1.2},links:node.links}));
    graph=new AcousticNavigation(nodes,(a,b)=>{
      const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,length=Math.hypot(dx,dy,dz);
      return length<.04||!native.ray(a,{x:dx/length,y:dy/length,z:dz/length},length-.02);
    });
    graphs.set(native,graph);
  }
  scene.setNavigation(graph);
}
