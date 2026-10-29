export type GrenadePointerCommand = Readonly<{
  fireHeld: boolean; secondaryHeld: boolean; firePressed?: true; secondaryPressed?: true;
}>;
type ButtonSample = Readonly<{buttons: number; pointerType?: string}>;

/** Browser mouse masks, not native attack masks. Pointer events alone omit chord edges. */
export class GrenadePointerInput {
  private buttons = 0;

  // Accept mousedown/up and pointermove samples; duplicate compatibility events
  // must not re-emit press edges. The owner gates input by focus/playability.
  update(event: ButtonSample): GrenadePointerCommand | undefined {
    if (event.pointerType !== undefined && event.pointerType !== 'mouse') return;
    const buttons = event.buttons & 3;
    if (buttons === this.buttons) return;
    const pressed = buttons & ~this.buttons;
    this.buttons = buttons;
    return {fireHeld: (buttons & 1) !== 0, secondaryHeld: (buttons & 2) !== 0,
      ...(pressed & 1 ? {firePressed: true as const} : {}),
      ...(pressed & 2 ? {secondaryPressed: true as const} : {})};
  }

  /** Call on pause/blur/cancel/equip reset; do not synthesize a throw command. */
  reset() {this.buttons = 0;}
}
