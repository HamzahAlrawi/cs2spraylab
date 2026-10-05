import * as THREE from 'three';
import type {Arena, Solid} from './geometry';
import {environmentPieceId, surfaceMaterial, type EnvironmentState, type TraversalVolume} from './environment';

export type CoverMaterials = Record<'concrete' | 'cargo' | 'crate' | 'barrier' | 'cap' | 'trim' | 'hazard' | 'crateEdge', THREE.Material> &
  Partial<Record<'glass' | 'metal' | 'grate' | 'water', THREE.Material>>;

function rampGeometry(solid: Solid) {
  const {size: s, shape} = solid, axis = shape!.axis, sign = shape!.highSide;
  const length = s[axis], width = axis === 'x' ? s.z : s.x;
  const points = [[-length / 2, -s.y / 2, -width / 2], [-length / 2, -s.y / 2, width / 2],
    [length / 2, -s.y / 2, -width / 2], [length / 2, -s.y / 2, width / 2],
    [length / 2, s.y / 2, -width / 2], [length / 2, s.y / 2, width / 2]];
  const vertices: number[] = [];
  const triangles = [[0, 2, 1], [1, 2, 3], [2, 4, 3], [3, 4, 5], [0, 4, 2], [1, 3, 5], [0, 1, 4], [1, 5, 4]];
  // Mirroring one horizontal axis changes winding; preserve outward normals.
  const mirrored = axis === 'z' ? sign > 0 : sign < 0;
  for (const triangle of triangles) for (const index of mirrored ? [...triangle].reverse() : triangle) {
    const [along, y, across] = points[index];
    vertices.push(axis === 'x' ? sign * along : across, y, axis === 'x' ? across : sign * along);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals();
  return geometry;
}

export function addArenaCover(solid: Solid, parent: THREE.Group, materials: CoverMaterials) {
  const {center, size, kind = 'concrete'} = solid;
  const add = (dimensions: [number, number, number], position: [number, number, number], material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), material);
    mesh.position.set(...position); parent.add(mesh);
  };
  const material = surfaceMaterial(solid), shellMaterial = material === 'glass' ? materials.glass ?? materials.cargo
    : material === 'grate' ? materials.grate ?? materials.cargo : material === 'metal' ? materials.metal ?? materials[kind]
      : material === 'wood' ? materials.crate : materials.concrete;
  if (solid.shape) {
    const mesh = new THREE.Mesh(rampGeometry(solid), shellMaterial);
    mesh.position.set(center.x, center.y, center.z); parent.add(mesh);
    return;
  }
  add([size.x, size.y, size.z], [center.x, center.y, center.z], shellMaterial);
  if (['stairs', 'glass', 'door', 'vent-panel'].includes(solid.style ?? '')) {
    if (solid.style === 'door') {
      for (const face of [-1, 1]) add([.045, .2, .025], [center.x + size.x * .3, center.y, center.z + face * (size.z / 2 + .016)], materials.trim);
    } else if (solid.style === 'vent-panel') {
      for (let row = 0; row < 5; row++) add([size.x * .9, .025, .02],
        [center.x, center.y + (row - 2) * size.y / 7, center.z + size.z / 2 + .014], materials.trim);
    }
    return;
  }
  const horizontal = size.x >= size.z;
  if (kind === 'crate') {
    add([size.x + .035, .07, size.z + .035], [center.x, center.y + size.y / 2, center.z], materials.crateEdge);
    add([size.x + .05, .07, size.z + .05], [center.x, center.y - size.y / 2 + .06, center.z], materials.crateEdge);
  } else if (!['bench', 'dock', 'planter', 'generator', 'vent'].includes(solid.style ?? '')) {
    // Props with authored lids must not also receive a coplanar generic cap.
    add([size.x + .04, .06, size.z + .04], [center.x, center.y + size.y / 2, center.z], materials.cap);
  }
  if (kind === 'cargo') {
    const length = horizontal ? size.x : size.z;
    for (let n = 1; n < Math.ceil(length / 1.3); n++) {
      const shift = -length / 2 + n * length / Math.ceil(length / 1.3);
      add(horizontal ? [.035, size.y * .9, size.z + .03] : [size.x + .03, size.y * .9, .035],
        [center.x + (horizontal ? shift : 0), center.y, center.z + (horizontal ? 0 : shift)], materials.trim);
    }
  } else if (kind === 'barrier') {
    add(horizontal ? [size.x + .035, .06, size.z + .04] : [size.x + .04, .06, size.z + .035],
      [center.x, center.y + size.y / 2 - .12, center.z], materials.hazard);
  } else if (kind === 'concrete') {
    for (const face of [-1, 1]) add(horizontal ? [size.x * .82, .04, .025] : [.025, .04, size.z * .82],
      [center.x + (horizontal ? 0 : face * (size.x / 2 + .014)), .48,
        center.z + (horizontal ? face * (size.z / 2 + .014) : 0)], materials.hazard);
  }
  propDetails(solid, parent, {metal: materials.cap, dark: materials.trim, label: materials.hazard, wood: materials.crateEdge});
}

export function environmentRenderMetadata(arena: Arena) {
  return arena.solids.map((solid, surfaceIndex) => ({id: environmentPieceId(solid, surfaceIndex), surfaceIndex,
    dynamic: !!solid.interaction, material: surfaceMaterial(solid), shape: solid.shape, interaction: solid.interaction}));
}

// Main batches only static solids. Dynamic groups retain stable IDs for revision sync.
export function createEnvironmentRenderMap(arena: Arena, parent: THREE.Group, materials: CoverMaterials): Map<string, THREE.Group> {
  const groups = new Map<string, THREE.Group>();
  arena.solids.forEach((solid, index) => {
    if (!solid.interaction) return;
    const id = environmentPieceId(solid, index), group = new THREE.Group();
    group.name = id; group.userData.environmentId = id;
    addArenaCover(solid, group, materials); parent.add(group); groups.set(id, group);
  });
  return groups;
}

export function syncEnvironmentRenderMap(groups: ReadonlyMap<string, THREE.Group>, state: EnvironmentState) {
  for (const [id, group] of groups) {
    const piece = state.pieces[id];
    if (!piece) continue;
    group.visible = piece.active;
    group.position.set(piece.offset.x, piece.offset.y, piece.offset.z);
  }
}

export function addArenaTraversal(volume: TraversalVolume, parent: THREE.Group, materials: CoverMaterials) {
  const group = new THREE.Group(); group.name = volume.id; group.userData.traversalId = volume.id;
  if (volume.kind === 'water' && volume.water) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(volume.size.x, volume.size.z), materials.water ?? materials.cargo);
    mesh.rotation.x = -Math.PI / 2; mesh.position.set(volume.center.x, volume.water.surfaceY, volume.center.z); group.add(mesh);
  } else if (volume.kind === 'ladder' && volume.ladder) {
    const ladder = volume.ladder, height = ladder.top - ladder.bottom, alongX = ladder.axis === 'z';
    const width = alongX ? volume.size.x : volume.size.z;
    const add = (w: number, h: number, d: number, across: number, y: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(alongX ? w : d, h, alongX ? d : w), materials.metal ?? materials.cap);
      mesh.position.set(volume.center.x + (alongX ? across : 0), y, volume.center.z + (alongX ? 0 : across)); group.add(mesh);
    };
    for (const side of [-1, 1]) add(.055, height, .06, side * (width / 2 - .0275), (ladder.top + ladder.bottom) / 2);
    const count = Math.ceil(height / .24);
    for (let n = 0; n < count; n++) add(width - .055, .035, .05, 0, ladder.bottom + (n + .5) * height / count);
  }
  parent.add(group);
  return group;
}

// Decorations sit on closed collision-box shells. No walkable-looking holes
// hide solid collision, and every shared material is batched by the caller.
export function propDetails(solid: Solid, parent: THREE.Group, materials: {metal: THREE.Material; dark: THREE.Material; label: THREE.Material; wood: THREE.Material}) {
  const {center: c, size: s, style} = solid;
  if (!style || style === 'plain') return;
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.position.set(c.x + x, c.y + y, c.z + z); mesh.updateMatrix(); mesh.matrixAutoUpdate = false; parent.add(mesh);
  };
  if (style === 'kiosk') {
    for (const side of [-1, 1]) {
      box(0, s.y * .18, side * (s.z / 2 + .015), s.x * .65, s.y * .32, .025, materials.dark);
      box(0, s.y * .02, side * (s.z / 2 + .025), s.x * .7, .05, .04, materials.metal);
      box(0, s.y * .39, side * (s.z / 2 + .015), s.x * .46, .1, .025, materials.label);
    }
  } else if (style === 'rack') {
    // Closed storage backing remains visible behind the shelves.
    for (const side of [-1, 1]) {
      for (const height of [-.3, 0, .3]) box(0, s.y * height, side * (s.z / 2 + .015), s.x * .9, .055, .03, materials.wood);
      for (const x of [-s.x * .44, s.x * .44]) box(x, 0, side * (s.z / 2 + .015), .06, s.y * .94, .03, materials.metal);
    }
  } else if (style === 'planter') {
    box(0, s.y / 2 + .015, 0, s.x * .8, .03, s.z * .8, materials.dark);
    for (const side of [-1, 1]) box(0, s.y * .25, side * (s.z / 2 + .012), s.x * .95, .04, .025, materials.metal);
  } else if (style === 'dock' || style === 'bench') {
    box(0, s.y / 2 + .015, 0, s.x, .03, s.z, style === 'bench' ? materials.wood : materials.metal);
    for (const side of [-1, 1]) {
      box(0, s.y * .3, side * (s.z / 2 + .015), s.x * .8, .08, .03, materials.label);
      for (const x of [-s.x * .38, s.x * .38]) box(x, -s.y * .12, side * (s.z / 2 + .012), .08, s.y * .62, .025, materials.dark);
    }
  } else if (style === 'pump') {
    for (const side of [-1, 1]) {
      box(0, 0, side * (s.z / 2 + .02), s.x * .4, s.y * .4, .04, materials.metal);
      box(0, 0, side * (s.z / 2 + .03), s.x * .15, s.y * .15, .02, materials.dark);
      box(s.x * .3, s.y * .3, side * (s.z / 2 + .015), s.x * .15, .1, .025, materials.label);
    }
  } else if (style === 'generator' || style === 'vent') {
    for (const side of [-1, 1]) {
      for (let row = 0; row < 5; row++) box(0, (row - 2) * s.y / 8, side * (s.z / 2 + .012), s.x * .72, .04, .025, materials.dark);
      box(s.x * .34, s.y * .3, side * (s.z / 2 + .03), s.x * .16, s.y * .13, .04, materials.label);
    }
    box(0, s.y / 2 + .008, 0, s.x * .75, .025, s.z * .75, materials.metal);
  } else if (style === 'cabinet') {
    for (const side of [-1, 1]) {
      box(0, 0, side * (s.z / 2 + .012), .025, s.y * .92, .025, materials.dark);
      box(s.x * .12, 0, side * (s.z / 2 + .03), .045, .23, .045, materials.metal);
      box(-s.x * .2, s.y * .3, side * (s.z / 2 + .025), s.x * .25, .16, .03, materials.label);
    }
  } else if (style === 'pallets') {
    for (let row = 0; row < Math.min(12, Math.ceil(s.y / .26)); row++) {
      const y = -s.y / 2 + .08 + row * .26;
      for (const side of [-1, 1]) box(0, y, side * (s.z / 2 + .006), s.x, .04, .018, materials.wood);
    }
    for (const x of [-s.x * .25, s.x * .25]) box(x, 0, s.z / 2 + .015, .07, s.y, .025, materials.dark);
  } else if (style === 'concrete-stack') {
    for (let y = -s.y / 2 + .45; y < s.y / 2; y += .5) {
      for (const side of [-1, 1]) box(0, y, side * (s.z / 2 + .003), s.x, .018, .01, materials.dark);
    }
  } else if (style === 'roadblock') {
    for (const side of [-1, 1]) {
      box(0, s.y * .18, side * (s.z / 2 + .01), s.x * .9, .13, .025, materials.label);
      for (const x of [-s.x * .33, s.x * .33]) box(x, s.y * .18, side * (s.z / 2 + .025), .12, .14, .025, materials.dark);
    }
  }
}
