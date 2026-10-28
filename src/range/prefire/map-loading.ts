export function abortError() {return new DOMException('Map loading aborted', 'AbortError');}

export function createLoadScope(parent?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason ?? abortError());
  if (parent?.aborted) abort(); else parent?.addEventListener('abort',abort,{once:true});
  return {signal:controller.signal,abort:(reason?: unknown) => controller.abort(reason ?? abortError()),
    dispose:() => parent?.removeEventListener('abort',abort)};
}

// A single shared limiter also bounds external glTF buffers/images, not just
// top-level sector requests. Queued work never starts after cancellation.
export function createTaskLimiter(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 16) throw new RangeError('Invalid map loading concurrency');
  let active = 0;
  const pending: (() => void)[] = [];
  const pump = () => {while (active < limit && pending.length) pending.shift()!();};
  return <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> => new Promise((resolve,reject) => {
    pending.push(() => {
      if (signal?.aborted) {reject(signal.reason ?? abortError()); return;}
      active++;
      Promise.resolve().then(task).then(resolve,reject).finally(() => {active--; pump();});
    });
    pump();
  });
}

export async function loadBounded<T,R>(items: readonly T[], limit: number,
  task: (item: T, index: number, signal: AbortSignal) => Promise<R>, parent?: AbortSignal): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 16) throw new RangeError('Invalid map loading concurrency');
  const scope = createLoadScope(parent), result: R[] = new Array(items.length);
  let next = 0, failed = false, failure: unknown;
  const worker = async () => {
    try {
      while (next < items.length) {
        scope.signal.throwIfAborted();
        const index = next++;
        result[index] = await task(items[index],index,scope.signal);
      }
    } catch (error) {if (!failed) {failed = true; failure = error; scope.abort(error);}}
  };
  try {
    // Drain in-flight decodes before the caller disposes any shared resources.
    await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
    if (failed) throw failure;
    scope.signal.throwIfAborted();
    return result;
  } finally {scope.dispose();}
}

export async function verifyMapDigest(bytes: ArrayBuffer, expected: string) {
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('Missing map resource checksum');
  if (!globalThis.crypto?.subtle) throw new Error('Map checksum verification requires a secure browser context');
  const actual = [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if (actual !== expected) throw new Error('Map resource checksum mismatch. Rebuild map assets.');
}

export type MapResource = {name: string; bytes: number; sha256: string};
export type TexturePack={name:'textures.bin';bytes:number;sha256:string;images:{name:string;offset:number;length:number}[]};
export function validateTexturePack(raw:unknown,resources:ReadonlyMap<string,MapResource>):TexturePack|undefined {
  if(raw===undefined)return;
  const pack=raw as TexturePack;
  if(!pack || pack.name!=='textures.bin' || !Number.isSafeInteger(pack.bytes) || pack.bytes<=0 || pack.bytes>25*1024*1024 ||
    !/^[a-f0-9]{64}$/.test(pack.sha256) || !Array.isArray(pack.images) || pack.images.length>8192)throw new Error('Invalid texture pack');
  const names=new Set<string>(),ranges:{start:number;end:number}[]=[];
  for(const image of pack.images) {
    const resource=image && resources.get(image.name);
    if(!resource || !image.name.endsWith('.webp') || names.has(image.name) || !Number.isSafeInteger(image.offset) || image.offset<0 ||
      !Number.isSafeInteger(image.length) || image.length!==resource.bytes || image.offset+image.length>pack.bytes)throw new Error('Invalid packed texture');
    names.add(image.name);ranges.push({start:image.offset,end:image.offset+image.length});
  }
  ranges.sort((a,b)=>a.start-b.start);
  if(ranges.some((range,i)=>i>0 && ranges[i-1].end>range.start) ||
    [...resources.keys()].some(name=>name.endsWith('.webp') && !names.has(name)))throw new Error('Incomplete or overlapping texture pack');
  return pack;
}
export function validateMapResources(resources: readonly MapResource[], budget = 128 * 1024 * 1024) {
  if (!Array.isArray(resources) || resources.length > 8192) throw new Error('Invalid map resource inventory');
  const names = new Set<string>(); let total = 0;
  for (const resource of resources) {
    if (!/^(texture-[a-f0-9]{24}\.webp|visual-\d+(?:_\d+)?\.bin)$/.test(resource.name) || names.has(resource.name) ||
      !Number.isSafeInteger(resource.bytes) || resource.bytes < 0 || !/^[a-f0-9]{64}$/.test(resource.sha256)) throw new Error('Invalid map resource');
    names.add(resource.name); total += resource.bytes;
  }
  if (total > budget) throw new Error('Map resources exceed the loading memory budget');
  return new Map(resources.map(resource=>[resource.name,resource]));
}
