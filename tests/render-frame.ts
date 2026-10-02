import type {Page} from '@playwright/test';

export async function canvasColors(page: Page, selector: string) {
  return page.locator(selector).evaluate(node => new Promise<number>(resolve => {
    const canvas = node as HTMLCanvasElement, gl = canvas.getContext('webgl2');
    if (!gl || gl.isContextLost()) {resolve(0); return;}
    const context = gl as any;
    const names = ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced'];
    const originals = names.map(name => context[name]);
    let pending = false;
    const restore = () => names.forEach((name,i) => {context[name] = originals[i];});
    const timeout = setTimeout(() => {restore(); resolve(0);},5000);
    // A requestAnimationFrame need not draw at a capped FPS. Sample after the
    // next real draw callback finishes, before the browser discards its buffer.
    names.forEach((name,i) => {context[name] = function(...args: unknown[]) {
      const result = originals[i].apply(gl,args);
      if (!pending) {
        pending = true;
        queueMicrotask(() => {
          restore(); clearTimeout(timeout);
          const pixel = new Uint8Array(4), colors = new Set<string>();
          for (let y=1;y<8;y++) for (let x=1;x<8;x++) {
            gl.readPixels(Math.floor(canvas.width*x/8),Math.floor(canvas.height*y/8),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
            colors.add(pixel.slice(0,3).join(','));
          }
          resolve(colors.size);
        });
      }
      return result;
    };});
  }));
}
