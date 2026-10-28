import defaults from './native-utility-defaults.json';

export const nativeUtilityDefaults=defaults;
/** Compiled registration default only; not an arbitrary live server override. */
export function nativeUtilityDefault(name:string):number {
  const value=defaults.convars.find(item=>item.name===name)?.engineDefault;
  if(typeof value!=='number'||!Number.isFinite(value))throw new Error(`No verified native utility default: ${name}`);
  return value;
}
