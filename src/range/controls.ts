export const controlLabels = {
  forward: 'Move forward', backward: 'Move backward', left: 'Strafe left', right: 'Strafe right',
  crouch: 'Crouch', walk: 'Walk', jump: 'Jump', reload: 'Reload', use: 'Use', pickup: 'Pick up weapon',
  inspect: 'Inspect', drop: 'Drop weapon', slot1: 'Primary weapon', slot2: 'Sidearm', slot3: 'Knife / Zeus',
  slot4: 'Zeus (direct)', lastWeapon: 'Last weapon', utility: 'Cycle grenades',
  grenadeHE: 'Equip HE grenade', grenadeFlash: 'Equip flashbang', grenadeSmoke: 'Equip smoke grenade',
  grenadeMolotov: 'Equip Molotov', grenadeIncendiary: 'Equip incendiary grenade', grenadeDecoy: 'Equip decoy grenade',
} as const;
export type ControlAction = keyof typeof controlLabels;
export type Controls = Record<ControlAction, string>;
export const controlActions = Object.keys(controlLabels) as ControlAction[];
export const defaultControls: Readonly<Controls> = Object.freeze({
  forward: 'KeyW', backward: 'KeyS', left: 'KeyA', right: 'KeyD', crouch: 'ControlLeft', walk: 'ShiftLeft',
  jump: 'Space', reload: 'KeyR', use: 'KeyE', pickup: 'KeyE', inspect: 'KeyF', drop: 'KeyG',
  slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: '', lastWeapon: 'KeyQ', utility: 'Digit4',
  grenadeHE: '', grenadeFlash: '', grenadeSmoke: '', grenadeMolotov: '', grenadeIncendiary: '', grenadeDecoy: '',
});
export const grenadeControlKinds = {
  grenadeHE: 'he', grenadeFlash: 'flash', grenadeSmoke: 'smoke',
  grenadeMolotov: 'molotov', grenadeIncendiary: 'incendiary', grenadeDecoy: 'decoy',
} as const;
export function grenadeForControl(action: ControlAction) {
  return grenadeControlKinds[action as keyof typeof grenadeControlKinds];
}
const modifiers: Record<string, string> = {ControlLeft: 'Control', ControlRight: 'Control', ShiftLeft: 'Shift', ShiftRight: 'Shift'};
const normalizedCode = (code: string) => modifiers[code] ?? code;
export type WheelControlCode = 'WheelUp' | 'WheelDown';
export function isWheelControlCode(code: unknown): code is WheelControlCode {
  return code === 'WheelUp' || code === 'WheelDown';
}
export function controlWheelCode(event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>): WheelControlCode | null {
  if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || !Number.isFinite(event.deltaX) ||
    !Number.isFinite(event.deltaY) || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return null;
  return event.deltaY < 0 ? 'WheelUp' : 'WheelDown';
}
export function validControlCode(code: unknown): code is string {
  return isWheelControlCode(code) || typeof code === 'string' && /^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Shift(Left|Right)|Control(Left|Right)|Numpad[0-9]|Numpad(Add|Subtract|Multiply|Divide|Decimal|Enter)|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Enter|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock)$/.test(code);
}
export function controlCodes(controls: Controls, action: ControlAction): string[] {
  const code = controls[action], group = modifiers[code];
  if (!code) return [];
  const codes = group ? [`${group}Left`, `${group}Right`] : [code];
  return action === 'crouch' ? [...new Set([...codes, 'KeyC'])] : codes;
}
export function actionsForCode(controls: Controls, code: string): ControlAction[] {
  return controlActions.filter(action => controlCodes(controls, action).includes(code));
}
export function controlConflict(controls: Controls, action: ControlAction, code: string): string | null {
  if (code === '' && defaultControls[action] === '') return null;
  if (!validControlCode(code)) return 'Escape, Tab, function keys and system keys are reserved.';
  if (isWheelControlCode(code) && ['forward', 'backward', 'left', 'right', 'crouch', 'walk'].includes(action))
    return 'Choose a key for held movement controls.';
  if (code === 'KeyC' && action !== 'crouch') return 'C is reserved as the browser-safe crouch alias.';
  const conflict = controlActions.find(other => other !== action &&
    !(other === 'use' && action === 'pickup' || other === 'pickup' && action === 'use') &&
    controlCodes(controls, other).some(bound => normalizedCode(bound) === normalizedCode(code)));
  return conflict ? `Already assigned to ${controlLabels[conflict].toLowerCase()}.` : null;
}
export function sanitizeControls(raw: unknown): Controls {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const controls = {...defaultControls};
  for (const action of controlActions) {
    const code = value[action];
    if (validControlCode(code) || code === '' && defaultControls[action] === '') controls[action] = code;
  }
  // Move the old stock layout together, without overwriting custom equipment binds.
  if (value.slot4 === 'Digit4' && (value.utility === 'Digit5' || value.utility === undefined)) {
    controls.slot4 = ''; controls.utility = 'Digit4';
  }
  // Preserve older custom bindings that already occupy the new grenade key.
  if (!validControlCode(value.utility) && controlConflict(controls, 'utility', controls.utility)) {
    controls.utility = ['Digit5', 'Digit0', 'KeyU', 'KeyJ', 'KeyK', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(key => `Key${key}`)]
      .find(code => !controlConflict(controls, 'utility', code)) ?? defaultControls.utility;
  }
  // Reject an ambiguous imported map as a unit; never silently activate two actions.
  return controlActions.some(action => controlConflict(controls, action, controls[action])) ? {...defaultControls} : controls;
}
export function movementControls(controls: Controls, keys: ReadonlySet<string>) {
  const held = (action: ControlAction) => controlCodes(controls, action).some(code => keys.has(code));
  return {forward: +held('forward') - +held('backward'), side: +held('right') - +held('left'),
    crouch: held('crouch'), walk: held('walk'), jump: held('jump')};
}
export function controlKeyLabel(code: string): string {
  if (!code) return 'Unbound';
  if (isWheelControlCode(code)) return code === 'WheelUp' ? 'Wheel Up' : 'Wheel Down';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return modifiers[code] === 'Control' ? 'Ctrl' : modifiers[code] ?? code.replace(/([a-z])([A-Z])/g, '$1 $2');
}
export function equipmentKeyLabel(controls: Controls, slot: 1 | 2 | 3 | 4): string {
  if (slot === 4 && !controls.slot4) return `${controlKeyLabel(controls.slot3)} x2`;
  return controlKeyLabel(controls[`slot${slot}`]);
}
type CaptureKey = Pick<KeyboardEvent, 'code' | 'repeat' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey' | 'isComposing'>;
export function captureControlKey(event: CaptureKey): {code?: string; error?: string; cancel?: boolean} {
  if (event.code === 'Escape' || event.code === 'Tab') return {cancel: true};
  if (event.repeat || event.isComposing) return {};
  if (event.metaKey || event.altKey || event.ctrlKey && !event.code.startsWith('Control') || event.shiftKey && !event.code.startsWith('Shift'))
    return {error: 'Choose a single key. Browser shortcut combinations cannot be rebound reliably.'};
  return validControlCode(event.code) ? {code: event.code} : {error: 'This key is reserved by the browser or system.'};
}
export function isInputTarget(target: EventTarget | null): boolean {
  return !!target && typeof (target as Element).closest === 'function' && !!(target as Element).closest(
    'input,select,textarea,button,a[href],[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="dialog"],[data-controls-capture]');
}
export function isEditingTarget(target: EventTarget | null): boolean {
  return !!target && typeof (target as Element).closest === 'function' && !!(target as Element).closest(
    'input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="dialog"],[data-controls-capture]');
}
export function ignoreGameplayKey(event: KeyboardEvent): boolean {
  return event.defaultPrevented || event.isComposing || event.altKey || event.metaKey ||
    isInputTarget(event.target) || event.composedPath().some(isInputTarget);
}
