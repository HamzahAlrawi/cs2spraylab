import {NativeMapCollision, type NativeCollisionManifest, type PreparedNativeQueries} from './native-collision';
import {readCachedQueries,saveCachedQueries} from './query-cache';

type Prepared = {metadata: PreparedNativeQueries; snapshot: ArrayBuffer};
type WorkerReply = {ownership?: Pick<PreparedNativeQueries,'ids'|'open'>; snapshot: ArrayBuffer; error?:string};
type PreparationReport={sha256:string;source:'worker'|'disk'|'main';workerMilliseconds:number;restoreMilliseconds:number};
const reports:PreparationReport[]=[];
export const collisionPreparationReport=()=>reports.map(report=>({...report}));
/** A worker builds the expensive BVHs; only snapshot restoration owns main-thread queries. */
export async function prepareCollision(manifest: NativeCollisionManifest, binary: ArrayBuffer,
  metadata?: PreparedNativeQueries, signal?: AbortSignal): Promise<NativeMapCollision> {
  signal?.throwIfAborted();
  let worker: Worker | undefined;
  let prepared: Prepared | undefined=metadata&&globalThis.caches?await readCachedQueries(metadata,signal??new AbortController().signal):undefined;
  const cached=!!prepared;
  const started=performance.now();let source:PreparationReport['source']=cached?'disk':'main',workerMilliseconds=0;
  signal?.throwIfAborted();
  // Full-map legacy imports have no prepared metadata and may exceed snapshot
  // budgets. Keep their existing path rather than constructing the world twice.
  if (!prepared && metadata && typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./collision-preparation.worker.ts', import.meta.url), {type: 'module'});
      const active = worker;
      prepared = await new Promise<Prepared>((resolve, reject) => {
        const abort = () => {cleanup();reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));};
        const cleanup = () => signal?.removeEventListener('abort', abort);
        active.onmessage = (event: MessageEvent<WorkerReply>) => {
          cleanup();
          const {error,ownership,snapshot}=event.data;
          if(error)reject(new Error(error));
          else if(!ownership||!Array.isArray(ownership.ids)||!Array.isArray(ownership.open)||!(snapshot instanceof ArrayBuffer))
            reject(new Error('Invalid prepared collision reply'));
          else resolve({metadata:{...metadata,ids:ownership.ids,open:ownership.open},snapshot});
        };
        active.onerror = event => {event.preventDefault?.(); cleanup(); reject(new Error(event.message || 'Collision worker unavailable'));};
        signal?.addEventListener('abort', abort, {once: true});
        // Retain the checked source for browsers that prohibit workers or reject a snapshot.
        try {const copy = binary.slice(0); active.postMessage({manifest, binary: copy}, [copy]);}
        catch(error){cleanup();reject(error);}
      });
      source='worker';workerMilliseconds=performance.now()-started;
    } catch {signal?.throwIfAborted();}
    finally {worker?.terminate();}
  }
  signal?.throwIfAborted();
  const restoreAt=performance.now();
  let result: NativeMapCollision;
  try {result = await NativeMapCollision.create(manifest, binary, prepared ?? (metadata ? {metadata} : undefined));}
  catch (error) {
    if (!prepared) throw error;
    prepared=undefined;
    source='main';
    signal?.throwIfAborted();
    result = await NativeMapCollision.create(manifest, binary, metadata ? {metadata} : undefined);
  }
  if (signal?.aborted) {result.dispose(); signal.throwIfAborted();}
  if(prepared&&!cached)saveCachedQueries(prepared);
  reports.push({sha256:manifest.collisionSha256,source,workerMilliseconds,restoreMilliseconds:performance.now()-restoreAt});
  if(reports.length>8)reports.shift();
  return result;
}
