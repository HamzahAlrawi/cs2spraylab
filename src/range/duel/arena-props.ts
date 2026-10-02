import * as THREE from 'three';
import type {Solid} from './geometry';

type CoverMaterials = Record<'concrete' | 'cargo' | 'crate' | 'barrier' | 'cap' | 'trim' | 'hazard' | 'crateEdge', THREE.Material>;

export function addArenaCover(solid: Solid, parent: THREE.Group, materials: CoverMaterials) {
  const {center, size, kind = 'concrete'} = solid;
  const add = (dimensions: [number, number, number], position: [number, number, number], material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), material);
    mesh.position.set(...position); parent.add(mesh);
  };
  add([size.x, size.y, size.z], [center.x, center.y, center.z], materials[kind]);
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
