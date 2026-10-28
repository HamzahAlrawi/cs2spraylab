import {afterEach, describe, expect, it, vi} from 'vitest';
import {defaults, loadSettings, saveSettings} from './config';
import {actionsForCode, captureControlKey, controlConflict, controlKeyLabel, controlWheelCode, defaultControls, equipmentKeyLabel, grenadeForControl, ignoreGameplayKey, isEditingTarget, isInputTarget, isWheelControlCode, movementControls, sanitizeControls, validControlCode} from './controls';

afterEach(() => vi.unstubAllGlobals());

describe('configurable physical-key controls', () => {
  it('maps every required action and preserves shared use/pickup by default', () => {
    expect(Object.keys(defaultControls)).toHaveLength(24);
    expect(actionsForCode({...defaultControls}, 'KeyE')).toEqual(['use', 'pickup']);
    expect(actionsForCode({...defaultControls}, 'Escape')).toEqual([]);
  });
  it('maps custom movement, opposing inputs, jump, and both modifier sides', () => {
    const controls = {...defaultControls, forward: 'ArrowUp', left: 'ArrowLeft', right: 'ArrowRight', crouch: 'KeyV', jump: 'KeyJ'};
    expect(movementControls(controls, new Set(['KeyW', 'KeyA']))).toEqual({forward: 0, side: 0, jump: false, walk: false, crouch: false});
    expect(movementControls(controls, new Set(['ArrowUp', 'ArrowLeft', 'ArrowRight', 'ShiftRight', 'KeyC', 'KeyJ'])))
      .toEqual({forward: 1, side: 0, jump: true, walk: true, crouch: true});
    expect(actionsForCode({...defaultControls}, 'ControlRight')).toEqual(['crouch']);
  });
  it('cycles grenades on 4 and preserves older custom bindings', () => {
    expect(actionsForCode({...defaultControls}, 'Digit4')).toEqual(['utility']);
    expect(actionsForCode({...defaultControls}, 'Digit5')).toEqual([]);
    expect(actionsForCode({...defaultControls, utility: 'KeyZ'}, 'KeyZ')).toEqual(['utility']);
    expect(controlConflict({...defaultControls}, 'utility', 'KeyR')).toContain('reload');
    const migrated = sanitizeControls({reload: 'Digit4'});
    expect(migrated.reload).toBe('Digit4');
    expect(migrated.utility).toBe('Digit5');
    expect(actionsForCode(migrated, 'Digit4')).toEqual(['reload']);
    expect(sanitizeControls({...defaultControls, utility: 'WheelDown'}).utility).toBe('WheelDown');
  });
  it('migrates the old stock equipment pair without resetting other custom controls', () => {
    const controls = sanitizeControls({...defaultControls, slot4: 'Digit4', utility: 'Digit5', jump: 'WheelUp'});
    expect(controls).toEqual({...defaultControls, jump: 'WheelUp'});
    const custom = {...defaultControls, slot4: 'KeyZ', utility: 'KeyX'};
    expect(sanitizeControls(custom)).toEqual(custom);
    expect(equipmentKeyLabel(controls, 4)).toBe('3 x2');
    expect(equipmentKeyLabel(custom, 4)).toBe('Z');
  });
  it('keeps direct grenade binds optional, independent, conflict-checked and persistent', () => {
    expect(actionsForCode({...defaultControls}, '')).toEqual([]);
    expect(controlKeyLabel('')).toBe('Unbound');
    const controls = sanitizeControls({...defaultControls, grenadeSmoke: 'KeyZ', grenadeFlash: 'WheelDown'});
    expect(actionsForCode(controls, 'KeyZ')).toEqual(['grenadeSmoke']);
    expect(actionsForCode(controls, 'WheelDown')).toEqual(['grenadeFlash']);
    expect(grenadeForControl('grenadeSmoke')).toBe('smoke');
    expect(grenadeForControl('slot3')).toBeUndefined();
    expect(controlConflict(controls, 'grenadeHE', 'KeyZ')).toContain('smoke');
    expect(controlConflict(controls, 'grenadeSmoke', '')).toBeNull();
    expect(controlConflict(controls, 'forward', '')).not.toBeNull();
    expect(sanitizeControls(JSON.parse(JSON.stringify(controls)))).toEqual(controls);
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', {getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value)});
    saveSettings({...defaults, controls});
    expect(loadSettings().controls).toEqual(controls);
  });
  it('rejects conflicting keys, modifier aliases, reserved keys and C reassignment', () => {
    expect(controlConflict({...defaultControls}, 'reload', 'KeyW')).toContain('forward');
    expect(controlConflict({...defaultControls}, 'reload', 'ShiftRight')).toContain('walk');
    expect(controlConflict({...defaultControls}, 'reload', 'Escape')).toContain('reserved');
    expect(controlConflict({...defaultControls}, 'reload', 'KeyC')).toContain('browser-safe');
    expect(controlConflict({...defaultControls}, 'use', 'KeyE')).toBeNull();
    expect(controlConflict({...defaultControls}, 'pickup', 'KeyE')).toBeNull();
    expect(controlConflict({...defaultControls}, 'reload', 'KeyT')).toBeNull();
  });
  it('sanitizes malformed saves and never mutates shared defaults', () => {
    expect(sanitizeControls({reload: 'KeyT', forward: '<script>', bogus: 'KeyZ'})).toEqual({...defaultControls, reload: 'KeyT'});
    expect(sanitizeControls({reload: 'KeyW'})).toEqual(defaultControls);
    const controls = sanitizeControls(null); controls.forward = 'KeyZ';
    expect(defaultControls.forward).toBe('KeyW');
  });
  it('captures single physical keys and keeps escape/tab/OS combinations out', () => {
    const event = {code: 'KeyZ', repeat: false, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, isComposing: false};
    expect(captureControlKey(event)).toEqual({code: 'KeyZ'});
    expect(captureControlKey({...event, ctrlKey: true}).error).toContain('Browser shortcut');
    expect(captureControlKey({...event, code: 'ControlRight', ctrlKey: true})).toEqual({code: 'ControlRight'});
    expect(captureControlKey({...event, code: 'Escape'})).toEqual({cancel: true});
    expect(captureControlKey({...event, code: 'Tab'})).toEqual({cancel: true});
    expect(captureControlKey({...event, repeat: true})).toEqual({});
    expect(captureControlKey({...event, isComposing: true})).toEqual({});
  });
  it('ignores consumed events, editable descendants, buttons, dialogs and composition', () => {
    const event = {defaultPrevented: false, isComposing: false, altKey: false, metaKey: false, target: null, composedPath: () => []} as unknown as KeyboardEvent;
    expect(ignoreGameplayKey(event)).toBe(false);
    expect(ignoreGameplayKey({...event, defaultPrevented: true})).toBe(true);
    expect(ignoreGameplayKey({...event, isComposing: true})).toBe(true);
    const target = {closest: (selector: string) => selector.includes('[contenteditable]') ? {} : null} as unknown as EventTarget;
    expect(ignoreGameplayKey({...event, target})).toBe(true);
    expect(ignoreGameplayKey({...event, composedPath: () => [target]})).toBe(true);
  });
  it('labels keys without depending on a keyboard layout or locale', () => {
    expect(controlKeyLabel('KeyZ')).toBe('Z'); expect(controlKeyLabel('ControlRight')).toBe('Ctrl');
    expect(controlKeyLabel('Digit2')).toBe('2'); expect(controlKeyLabel('ArrowLeft')).toBe('Arrow Left');
  });
  it('pauses for editors/dialogs but not a focused HUD reload/inspect button', () => {
    const element = (match: string) => ({closest: (selector: string) => selector.split(',').includes(match) ? {} : null}) as unknown as EventTarget;
    expect(isInputTarget(element('button'))).toBe(true);
    expect(isEditingTarget(element('button'))).toBe(false);
    expect(isEditingTarget(element('input'))).toBe(true);
    expect(isEditingTarget(element('[role="dialog"]'))).toBe(true);
    expect(isEditingTarget(null)).toBe(false);
  });
});

describe('configurable wheel controls', () => {
  const wheel = {deltaX: 0, deltaY: -100, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false};
  it.each(['WheelUp', 'WheelDown'])('validates, labels and resolves %s without a held jump', code => {
    expect(validControlCode(code)).toBe(true); expect(isWheelControlCode(code)).toBe(true);
    expect(controlKeyLabel(code)).toBe(code === 'WheelUp' ? 'Wheel Up' : 'Wheel Down');
    const controls = {...defaultControls, jump: code};
    expect(actionsForCode(controls, code)).toEqual(['jump']);
    expect(actionsForCode(controls, 'Space')).toEqual([]);
    expect(movementControls(controls, new Set()).jump).toBe(false);
    expect(controlConflict(controls, 'jump', code)).toBeNull();
    expect(controlConflict(controls, 'reload', code)).toBe('Already assigned to jump.');
    expect(controlConflict(controls, 'reload', code === 'WheelUp' ? 'WheelDown' : 'WheelUp')).toBeNull();
    expect(validControlCode('WheelLeft')).toBe(false);
  });
  it('maps vertical sign independently of wheel delta units and ignores browser gestures', () => {
    for (const deltaY of [-.1, -3, -120, -5000]) expect(controlWheelCode({...wheel, deltaY})).toBe('WheelUp');
    for (const deltaY of [.1, 3, 120, 5000]) expect(controlWheelCode({...wheel, deltaY})).toBe('WheelDown');
    for (const deltaY of [0, NaN, Infinity, -Infinity]) expect(controlWheelCode({...wheel, deltaY})).toBeNull();
    expect(controlWheelCode({...wheel, deltaX: 200})).toBeNull();
    expect(controlWheelCode({...wheel, deltaX: NaN})).toBeNull();
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey'])
      expect(controlWheelCode({...wheel, [modifier]: true})).toBeNull();
  });
  it.each(['WheelUp', 'WheelDown'])('round-trips %s through settings storage and sanitization', code => {
    const saved = new Map<string, string>();
    vi.stubGlobal('localStorage', {getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value)});
    const controls = {...defaultControls, jump: code, reload: code === 'WheelUp' ? 'WheelDown' : 'WheelUp'};
    expect(saveSettings({...defaults, controls})).toBe(true);
    expect(loadSettings().controls).toEqual(controls);
    expect(sanitizeControls(JSON.parse(JSON.stringify(controls)))).toEqual(controls);
    expect(sanitizeControls({...controls, reload: code})).toEqual(defaultControls);
    expect(sanitizeControls({jump: 'WheelLeft'})).toEqual(defaultControls);
    expect(defaultControls.jump).toBe('Space');
  });
  it('allows shared use/pickup pulses but rejects wheel bindings for held movement', () => {
    const controls = {...defaultControls, use: 'WheelUp', pickup: 'WheelUp'};
    expect(sanitizeControls(controls)).toEqual(controls);
    expect(actionsForCode(controls, 'WheelUp')).toEqual(['use', 'pickup']);
    for (const action of ['forward', 'backward', 'left', 'right', 'crouch', 'walk'] as const) {
      expect(controlConflict({...defaultControls}, action, 'WheelDown')).toContain('held movement');
      expect(sanitizeControls({[action]: 'WheelDown'})).toEqual(defaultControls);
    }
  });
});
