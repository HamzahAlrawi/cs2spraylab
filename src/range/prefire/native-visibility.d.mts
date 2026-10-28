export class NativeVisibility {
  constructor(metadata: Record<string, any>, bytes: Uint8Array);
  readonly metadata: Record<string, any>;
  readonly row: Uint8Array;
  readonly key: string;
  pointRow(point: readonly number[]): Uint8Array;
  allVisible(): Uint8Array;
  boxClusters(min: readonly number[], max: readonly number[]): number[];
  static visible(clusters: readonly number[], row: Uint8Array): boolean;
}
