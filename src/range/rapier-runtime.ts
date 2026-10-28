import RAPIER from '@dimforge/rapier3d-compat';

let initialization: Promise<void> | undefined;
let ready = false;
export function prepareRapier() {
  return initialization ??= RAPIER.init().then(() => {ready = true;});
}
export const rapierReady = () => ready;
