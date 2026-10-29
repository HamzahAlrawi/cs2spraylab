import type {RadarOverview} from './radar';

export type SourceRadarMetadata = {pos_x: number; pos_y: number; scale: number};

// Source overview coordinates use a 1024-unit reference canvas even when the
// delivered texture has a different resolution. z=-Source.y in trainer space.
// `rotate` in overview text is not the player's yaw and is not applied here.
export function sourceRadarOverview(image: CanvasImageSource, metadata: SourceRadarMetadata): RadarOverview {
  const {pos_x: x, pos_y: y, scale} = metadata;
  if (![x,y,scale].every(Number.isFinite) || scale <= 0) throw new Error('Invalid Source radar metadata');
  const unit = .0254, span = scale*1024*unit;
  return {image, bounds: {minX:x*unit, maxX:x*unit+span, minZ:-y*unit, maxZ:-y*unit+span}};
}
