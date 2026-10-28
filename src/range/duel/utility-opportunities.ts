import data from './utility-opportunities.json';
import type {Arena} from './geometry';
import type {DuelActorSnapshot} from './types';
import type {ThreatReport} from './trading';
import type {UtilityInventory, UtilityKind} from './utility-loadout';
import {UTILITY_KERNEL_VERSION} from './utilities';
export type UtilityOpportunity = typeof data.entries[number];
const byGeometry = new Map<string, UtilityOpportunity[]>();
for (const entry of data.entries) {const list=byGeometry.get(entry.collisionSha256)??[];list.push(entry);byGeometry.set(entry.collisionSha256,list);}
export function authoredUtilityOpportunity(self: DuelActorSnapshot, arena: Arena, stock: UtilityInventory, report: ThreatReport, time: number) {
  if(data.kernelVersion!==UTILITY_KERNEL_VERSION)return;
  if (report.readyAt>time||time-report.observedAt>2.2||Math.hypot(self.velocity.x,self.velocity.z)>.3||self.duckAmount>.15) return;
  return byGeometry.get(arena.native?.collisionSha256??'')?.filter(entry=>stock[entry.kind as UtilityKind]>0&&
    Math.abs(self.feet-entry.feet.y)<.15&&Math.hypot(self.position.x-entry.feet.x,self.position.z-entry.feet.z)<=entry.tolerance&&
    Math.hypot(report.point.x-entry.target.x,report.point.z-entry.target.z)<7)
    .sort((a,b)=>Math.hypot(report.point.x-a.target.x,report.point.z-a.target.z)-Math.hypot(report.point.x-b.target.x,report.point.z-b.target.z))[0];
}
