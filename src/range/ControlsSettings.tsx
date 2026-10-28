import {useCallback, useEffect, useState, useSyncExternalStore} from 'react';
import {Keyboard, Mouse, RotateCcw} from 'lucide-react';
import type {Settings} from './config';
import {captureControlKey, controlActions, controlConflict, controlKeyLabel, controlLabels, defaultControls, isWheelControlCode, type ControlAction, type Controls} from './controls';
import {cmPer360} from './input-sensitivity';
import {getMouseCaptureMode, listenForControlWheel, mouseCaptureFeedback, subscribeMouseCapture} from './input';
import './controls-settings.css';

export function ControlsSettings({value, onChange}: {value: Controls; onChange: (value: Controls) => void}) {
  const [binding, setBinding] = useState<ControlAction | null>(null);
  const [message, setMessage] = useState('');
  const commitBinding = useCallback((action: ControlAction, code: string) => {
    const error = controlConflict(value, action, code);
    if (error) {setMessage(error); return;}
    onChange({...value, [action]: code}); setBinding(null); setMessage(`${controlLabels[action]}: ${controlKeyLabel(code)}.`);
  }, [value, onChange]);
  useEffect(() => {
    if (!binding) return;
    const stop = listenForControlWheel(window, code => commitBinding(binding, code));
    const cancel = () => setBinding(null);
    window.addEventListener('blur', cancel);
    return () => {stop(); window.removeEventListener('blur', cancel);};
  }, [binding, commitBinding]);
  return <section className="controls-settings" aria-label="Controls settings">
    <header><h2>Controls</h2><button type="button" className="icon-button" title="Reset all controls" aria-label="Reset all controls"
      onClick={() => {onChange({...defaultControls}); setBinding(null); setMessage('Controls reset.');}}><RotateCcw size={16}/></button></header>
    <p className="controls-warning">Escape always pauses. C always crouches. Ctrl+W and other browser shortcuts cannot be reliably overridden, even with shortcut protection. Use C when moving forward.</p>
    <div role="status" aria-live="polite" className="controls-message">{message || (binding ? 'Press a key or scroll; Escape cancels.' : '')}</div>
    <div className="controls-list">{controlActions.map(action => <div className="control-row" key={action}>
      <span>{controlLabels[action]}{action === 'crouch' && <small>C safety alias</small>}</span>
      <button type="button" className="control-binding" data-controls-capture="true" aria-label={`Bind ${controlLabels[action].toLowerCase()}`}
        aria-pressed={binding === action} onClick={() => {setBinding(action); setMessage('');}} onBlur={() => setBinding(null)}
        onKeyDown={event => {
          if (binding !== action) return;
          if (event.code === 'Tab') {setBinding(null); return;}
          event.preventDefault(); event.stopPropagation();
          const captured = captureControlKey(event.nativeEvent);
          if (captured.cancel) {setBinding(null); setMessage('Binding cancelled.'); return;}
          if (captured.error) {setMessage(captured.error); return;}
          if (!captured.code) return;
          commitBinding(action, captured.code);
        }}>{isWheelControlCode(value[action]) ? <Mouse size={14}/> : <Keyboard size={14}/>}<span>{binding === action ? 'Key / wheel' : controlKeyLabel(value[action])}</span></button>
      <button type="button" className="icon-button" title={`${defaultControls[action] ? 'Reset' : 'Unbind'} ${controlLabels[action].toLowerCase()}`} aria-label={`Reset ${controlLabels[action].toLowerCase()}`}
        disabled={value[action] === defaultControls[action]} onClick={() => {
          const error = controlConflict(value, action, defaultControls[action]);
          if (error) {setMessage(error); return;}
          onChange({...value, [action]: defaultControls[action]}); setMessage(`${controlLabels[action]} reset.`);
        }}><RotateCcw size={14}/></button>
    </div>)}</div>
  </section>;
}

function MouseNumber({label, value, min, max, step, onCommit}: {label: string; value: number; min: number; max: number; step: number; onCommit: (value: number) => void}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return <label>{label}<input aria-label={label} type="number" value={draft} min={min} max={max} step={step}
    onChange={event => setDraft(event.target.value)} onKeyDown={event => {if (event.key === 'Enter') {event.stopPropagation(); event.currentTarget.blur();}}}
    onBlur={() => {
      const number = Number(draft), next = draft.trim() && Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : value;
      setDraft(String(next)); onCommit(next);
    }}/></label>;
}

export function MouseSettings({settings, onChange}: {settings: Settings; onChange: (value: Partial<Settings>) => void}) {
  const mode = useSyncExternalStore(subscribeMouseCapture, getMouseCaptureMode, () => 'idle' as const);
  const feedback = mouseCaptureFeedback(mode);
  return <section className="controls-settings mouse-settings" aria-label="Mouse settings">
    <h2>Mouse</h2><div className="two-fields">
      <MouseNumber label="Sensitivity" value={settings.sensitivity} min={.05} max={10} step={.01} onCommit={sensitivity => onChange({sensitivity})}/>
      <MouseNumber label="Mouse DPI" value={settings.dpi} min={100} max={32000} step={100} onCommit={dpi => onChange({dpi})}/>
    </div>
    <div className="readout"><span>CS2 hip-fire cm / 360</span><b>{cmPer360(settings.sensitivity, settings.dpi).toFixed(2)} cm</b></div>
    <div className="readout"><span>eDPI</span><b>{Math.round(settings.sensitivity * settings.dpi)}</b></div>
    <details className="settings-section"><summary>Scoped aim & calibration</summary><div><div className="two-fields">
      <MouseNumber label="Zoom sensitivity ratio" value={settings.zoomSensitivity} min={.01} max={3} step={.01} onCommit={zoomSensitivity => onChange({zoomSensitivity})}/>
      <MouseNumber label="Browser count calibration" value={settings.mouseCalibration} min={.1} max={10} step={.01} onCommit={mouseCalibration => onChange({mouseCalibration})}/>
    </div>
    <p className="controls-warning">DPI must match your mouse hardware setting; it only calculates cm/360. Zoom ratio matches zoom_sensitivity_ratio and applies only while scoped. Calibration defaults to 1, with no automatic devicePixelRatio or display-scale multiplier.</p>
    <div role="status" className="mouse-capture-status"><b>{feedback.label}</b><p>{feedback.warning}</p></div>
    <details><summary>Physical sensitivity calibration</summary><p className="controls-warning">Unscoped, move the mouse by the displayed CS2 cm/360 and measure the actual turn. New calibration = current calibration x 360 / observed degrees. For a 180-degree check, use half that distance and 180 / observed degrees. Repeat at slow and fast speeds; different results indicate acceleration that a constant cannot fix. Recheck after browser zoom, display scale, browser or mouse changes. Touch is separate and not CS2-calibrated.</p></details>
    {settings.mouseCalibration !== 1 && <div className="readout"><span>At 1 browser unit per hardware count</span><b>{(cmPer360(settings.sensitivity, settings.dpi) / settings.mouseCalibration).toFixed(2)} cm / 360</b></div>}
    <button type="button" className="secondary" disabled={settings.mouseCalibration === 1} onClick={() => onChange({mouseCalibration: 1})}><RotateCcw size={14}/>Reset count calibration</button>
    </div></details>
  </section>;
}
