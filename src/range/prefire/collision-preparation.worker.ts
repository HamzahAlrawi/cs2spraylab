import {NativeMapCollision, type NativeCollisionManifest} from './native-collision';

const worker = self as unknown as {onmessage: ((event: MessageEvent) => void) | null;
  postMessage(value: unknown, transfer: Transferable[]): void};
worker.onmessage = async (event: MessageEvent<{manifest: NativeCollisionManifest; binary: ArrayBuffer}>) => {
  let world: NativeMapCollision | undefined;
  try {
    const {manifest, binary} = event.data;
    world = await NativeMapCollision.create(manifest, binary);
    const prepared = world.exportPrepared(), snapshot = prepared.snapshot.buffer as ArrayBuffer;
    // Columns/planes are already verified on the owning thread. Cloning the
    // multi-megabyte object graph back to it can stall an otherwise live round.
    const {ids,open}=prepared.metadata;
    worker.postMessage({ownership:{ids,open}, snapshot}, [snapshot]);
  } catch (error) {
    worker.postMessage({error: error instanceof Error ? error.message : 'Collision preparation failed'}, []);
  } finally {world?.dispose();}
};
