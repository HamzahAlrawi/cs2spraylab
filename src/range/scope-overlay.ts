import type {WeaponActions} from './weapon-actions';
import {scopeVerticalFov} from './weapon-actions';
import type {PerspectiveCamera} from 'three';

export class ScopeOverlay {
  readonly element = document.createElement('div');
  constructor(host: HTMLElement) {
    this.element.className = 'weapon-scope'; this.element.hidden = true;
    this.element.setAttribute('aria-hidden', 'true');
    this.element.innerHTML = '<div class="scope-aperture"><i></i><b></b></div>';
    host.append(this.element);
  }
  update(actions: WeaponActions, camera: PerspectiveCamera, alive = true) {
    const fov = scopeVerticalFov(alive ? actions.horizontalFov : 90);
    if (camera.fov !== fov) {camera.fov = fov; camera.updateProjectionMatrix();}
    const scoped = alive && actions.hidesViewmodel;
    this.element.hidden = !scoped;
    return scoped;
  }
  dispose() {this.element.remove();}
}
