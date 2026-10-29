import type {WebGLRenderer} from 'three';
import {backgroundFrame} from '../prefire/background-work';

/** Submitted uploads/draws are not completed uploads/draws. Poll a fence without
 * blocking the combat thread with finish(), readPixels() or a synchronous wait. */
export async function waitForGpu(renderer:Pick<WebGLRenderer,'getContext'>,signal:AbortSignal) {
  signal.throwIfAborted();
  const gl=renderer.getContext();
  if(gl.isContextLost())throw new Error('Graphics context lost during map preparation');
  if(!('fenceSync' in gl)){await backgroundFrame(signal);return;}
  const fence=gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
  if(!fence){await backgroundFrame(signal);return;}
  try {
    gl.flush();
    while(true){
      signal.throwIfAborted();
      const status=gl.clientWaitSync(fence,0,0);
      if(status===gl.ALREADY_SIGNALED||status===gl.CONDITION_SATISFIED)return;
      if(status===gl.WAIT_FAILED||gl.isContextLost())throw new Error('Graphics preparation did not complete');
      await backgroundFrame(signal);
    }
  }finally{gl.deleteSync(fence);}
}

export function textureUploadBytes(texture:{image?:{width?:number;height?:number}}) {
  const {width=1,height=1}=texture.image??{};
  return Math.max(1,width)*Math.max(1,height)*4*4/3;
}
