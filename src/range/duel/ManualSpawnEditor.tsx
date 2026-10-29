import {useState, type ChangeEvent} from 'react';
import {Camera, ChevronRight, Download, MapPin, Play, Plus, RotateCcw, Save, Trash2, Upload} from 'lucide-react';
import {exportManualLineups, importManualLineups, loadManualLineups, MANUAL_SPAWN_LIMITS,
  mergeManualLineups, parseManualLineup, parseSpawnPose, saveManualLineups,
  type LineupValidation, type ManualLineup, type ManualLineupDraft, type ManualSpawn, type SpawnContext, type SpawnPose} from './manual-spawns';
import './manual-spawns.css';

export type ManualSpawnEditorProps = {
  context?: SpawnContext;
  disabled?: boolean;
  canCapture: boolean;
  authoring: boolean;
  activeId?: string;
  onAuthoring: (enabled: boolean) => void;
  capture: () => SpawnPose | undefined;
  curated: (id: string) => ManualLineup | undefined;
  validate: (lineup: unknown) => LineupValidation;
  apply: (lineup: ManualLineup) => void;
  restore: () => void;
};
function newDraft(context?: SpawnContext): ManualLineupDraft {
  return {...context ?? {chunkId: '', collisionSha256: ''}, id: globalThis.crypto?.randomUUID?.() ?? `lineup-${Date.now()}`,
    name: 'My lineup', bots: [], allowImmediateSight: false};
}
function readLibrary() {
  try {return loadManualLineups(localStorage);}
  catch {return {lineups: [] as ManualLineup[], error: 'Browser storage is unavailable.'};}
}

export function ManualSpawnEditor(props: ManualSpawnEditorProps) {
  const [loaded] = useState(readLibrary);
  const [library, setLibrary] = useState(loaded.lineups);
  const [draft, setDraft] = useState(() => newDraft(props.context));
  const [message, setMessage] = useState(loaded.error ?? '');
  const [validation, setValidation] = useState<LineupValidation>({errors: [], warnings: []});
  const [selected, setSelected] = useState('');
  const unavailable = props.disabled || !props.context;
  const local = library.filter(lineup => lineup.chunkId === props.context?.chunkId);
  const change = (next: ManualLineupDraft) => {setDraft(next); setValidation({errors: [], warnings: []}); setMessage('Unsaved changes');};
  const persist = (next: ManualLineup[], success: string) => {
    try {saveManualLineups(localStorage, next); setLibrary(next); setMessage(success); return true;}
    catch (error) {setMessage(error instanceof Error ? error.message : 'Could not save lineups.'); return false;}
  };
  const checked = (): ManualLineup | undefined => {
    const result = props.validate(draft); setValidation(result);
    if (result.errors.length) return;
    return parseManualLineup(draft);
  };
  const capturePoint = (target: 'entry' | number) => {
    const pose = parseSpawnPose(props.capture());
    if (!pose) {setMessage('No supported standing pose is available.'); return;}
    if (target === 'entry') change({...draft, entry: {...pose, id: 'entry', name: draft.entry?.name ?? 'Player entry'}});
    else {
      const bots = [...draft.bots], previous = bots[target];
      bots[target] = {...pose, id: previous?.id ?? globalThis.crypto.randomUUID(), name: previous?.name ?? `Hold ${target + 1}`};
      change({...draft, bots});
    }
  };
  const save = () => {
    const lineup = checked(); if (!lineup) return;
    try {if (persist(mergeManualLineups(library, [lineup]), 'Lineup saved on this device.')) setSelected(lineup.id);}
    catch (error) {setMessage(error instanceof Error ? error.message : 'Lineup limit reached.');}
  };
  const play = () => {const lineup = checked(); if (lineup) props.apply(lineup);};
  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try {
      if (file.size > MANUAL_SPAWN_LIMITS.bytes) throw new Error('Lineup file exceeds 192 KiB.');
      const imported = importManualLineups(await file.text());
      persist(mergeManualLineups(library, imported), 'Lineups imported. Geometry is checked before use.');
    } catch (error) {setMessage(error instanceof Error ? error.message : 'Could not import lineups.');}
  };
  const exportFile = () => {
    try {
      const url = URL.createObjectURL(new Blob([exportManualLineups(local)], {type: 'application/json'}));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${props.context?.chunkId}-lineups.json`;
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {setMessage(error instanceof Error ? error.message : 'Could not export lineups.');}
  };
  const pointRow = (point: ManualSpawn, target: 'entry' | number) => <li key={point.id}>
    <MapPin size={15} aria-hidden="true"/>
    <label><span className="manual-spawn-label">{target === 'entry' ? 'Player entry' : `Hold ${target + 1}`}</span>
      <input aria-label={target === 'entry' ? 'Player entry name' : `Hold ${target + 1} name`} maxLength={64} value={point.name}
        onChange={event => change(target === 'entry' ? {...draft, entry: {...point, name: event.target.value}} :
          {...draft, bots: draft.bots.map((bot, index) => index === target ? {...bot, name: event.target.value} : bot)})}/>
      <small title={`Feet metres: ${point.feet.x}, ${point.feet.y}, ${point.feet.z}; yaw/pitch radians: ${point.yaw}, ${point.pitch}`}>
        {point.feet.x.toFixed(2)}, {point.feet.y.toFixed(2)}, {point.feet.z.toFixed(2)}
      </small></label>
    <button type="button" title="Recapture at current standing position and view" aria-label={`Recapture ${target === 'entry' ? 'player entry' : `hold ${target + 1}`}`}
      disabled={!props.canCapture || !props.authoring || unavailable} onClick={() => capturePoint(target)}><Camera size={16}/></button>
    <button type="button" title="Remove point" aria-label={`Remove ${target === 'entry' ? 'player entry' : `hold ${target + 1}`}`} disabled={unavailable}
      onClick={() => change(target === 'entry' ? {...draft, entry: undefined} : {...draft, bots: draft.bots.filter((_, index) => index !== target)})}><Trash2 size={16}/></button>
  </li>;

  return <details className="duel-setup-section manual-spawn-editor">
    <summary><ChevronRight size={16} aria-hidden="true"/><span>Manual lineups</span><output>{local.length}/{MANUAL_SPAWN_LIMITS.perChunk}</output></summary>
    <div className="manual-spawn-content">
      <label className="duel-field"><span>Saved lineup</span><select aria-label="Saved manual lineup" value={selected} disabled={unavailable}
        onChange={event => {const lineup = local.find(lineup => lineup.id === event.target.value); setSelected(event.target.value);
          if (lineup) {setDraft(structuredClone(lineup)); setValidation({errors: [], warnings: []}); setMessage('');}
          else change(newDraft(props.context));}}>
        <option value="">New lineup</option>{local.map(lineup => <option key={lineup.id} value={lineup.id}>{lineup.name}{lineup.id === props.activeId ? ' (active)' : ''}</option>)}
      </select></label>
      <div className="manual-spawn-actions">
        <button type="button" title="New empty lineup" aria-label="New manual lineup" disabled={unavailable} onClick={() => {setSelected(''); change(newDraft(props.context));}}><Plus size={16}/></button>
        <button type="button" title="Restore a curated entry and holds into this draft" aria-label="Restore curated points" disabled={unavailable} onClick={() => {
          const lineup = props.curated(draft.id); if (lineup) change({...lineup, name: draft.name});
        }}><RotateCcw size={16}/></button>
        <button type="button" title="Delete saved lineup" aria-label="Delete saved lineup" disabled={!selected || unavailable} onClick={() => {
          if (persist(library.filter(lineup => lineup.chunkId !== props.context?.chunkId || lineup.id !== selected), 'Saved lineup deleted.')) {
            if (selected === props.activeId) props.restore(); setSelected(''); change(newDraft(props.context));
          }
        }}><Trash2 size={16}/></button>
        <button type="button" title="Export this chunk's saved lineups" aria-label="Export manual lineups" disabled={!local.length} onClick={exportFile}><Download size={16}/></button>
        <label className="manual-spawn-import" title="Import lineup JSON"><Upload size={16}/><input aria-label="Import manual lineups" type="file" accept=".json,application/json" onChange={event => void importFile(event)}/></label>
      </div>
      <label className="duel-field"><span>Lineup name</span><input aria-label="Manual lineup name" value={draft.name} maxLength={64} disabled={unavailable} onChange={event => change({...draft, name: event.target.value})}/></label>
      <label className="duel-check"><span>Walk mode</span><input aria-label="Manual spawn walk mode" type="checkbox" checked={props.authoring}
        disabled={unavailable || !props.canCapture} onChange={event => props.onAuthoring(event.target.checked)}/></label>
      <ul className="manual-spawn-points">{draft.entry && pointRow(draft.entry, 'entry')}{draft.bots.map((bot, index) => pointRow(bot, index))}</ul>
      <div className="manual-spawn-commands">
        <button type="button" title="Capture feet and view where you are standing" disabled={unavailable || !props.canCapture || !props.authoring} onClick={() => capturePoint('entry')}><Camera size={15}/>Capture entry</button>
        <button type="button" title="Capture a bot hold where you are standing" disabled={unavailable || !props.canCapture || !props.authoring || draft.bots.length >= 5} onClick={() => capturePoint(draft.bots.length)}><MapPin size={15}/>Add hold</button>
      </div>
      <label className="duel-check"><span>Allow immediate sightlines</span><input aria-label="Allow immediate spawn sightlines" type="checkbox" checked={draft.allowImmediateSight}
        disabled={unavailable} onChange={event => change({...draft, allowImmediateSight: event.target.checked})}/></label>
      <div className="manual-spawn-commands">
        <button type="button" disabled={unavailable} onClick={save}><Save size={15}/>Save</button>
        <button type="button" disabled={unavailable} onClick={play}><Play size={15}/>Use lineup</button>
        <button type="button" title="Use standard authored course without deleting saved lineups" disabled={unavailable} onClick={props.restore}><RotateCcw size={15}/>Curated</button>
      </div>
      {props.authoring && <p role="status">Walk mode active</p>}
      {message && <p role="status">{message}</p>}
      {!!validation.errors.length && <ul className="manual-spawn-errors" role="alert">{validation.errors.map(error => <li key={error}>{error}</li>)}</ul>}
      {!!validation.warnings.length && <ul className="manual-spawn-warnings" role="status">{validation.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
    </div>
  </details>;
}
