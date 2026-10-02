import * as THREE from 'three';

/** Points remain in their parent's space; changing visual size never moves a hit. */
export class ImpactCloud {
  readonly mesh: THREE.InstancedMesh;
  private points: THREE.Vector3[] = [];
  private scales: number[] = [];
  private next = 0;
  private transform = new THREE.Matrix4();
  private rotation = new THREE.Quaternion();
  private scale = new THREE.Vector3();
  constructor(geometry: THREE.BufferGeometry, private readonly capacity: number, parent: THREE.Object3D) {
    this.mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({color: '#ffffff'}), capacity);
    this.mesh.name = 'batched-bullet-impacts'; this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parent.add(this.mesh);
  }
  add(point: THREE.Vector3, baseScale: number, size: number, color: THREE.Color) {
    const index = this.next;
    this.points[index] = point.clone(); this.scales[index] = baseScale;
    this.writeMatrix(index, size); this.mesh.setColorAt(index, color);
    this.mesh.instanceColor!.needsUpdate = true;
    this.mesh.count = Math.min(this.capacity, this.mesh.count + 1);
    this.next = (index + 1) % this.capacity;
  }
  private writeMatrix(index: number, size: number) {
    this.transform.compose(this.points[index], this.rotation, this.scale.setScalar(this.scales[index] * size));
    this.mesh.setMatrixAt(index, this.transform); this.mesh.instanceMatrix.needsUpdate = true;
  }
  resize(size: number) {for (let i = 0; i < this.mesh.count; i++) this.writeMatrix(i, size);}
  clear() {this.mesh.count = this.next = 0; this.points.length = this.scales.length = 0;}
  dispose() {this.mesh.removeFromParent(); this.mesh.dispose(); (this.mesh.material as THREE.Material).dispose();}
}
