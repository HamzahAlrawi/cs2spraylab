import {useEffect, useId, useRef, useState, useSyncExternalStore, type ChangeEvent, type FormEvent} from 'react';
import {Download, Gift, RotateCcw, ShieldCheck, Upload, X} from 'lucide-react';
import type {ProgressionController} from './progression';
import './progression-account.css';

type GiftResult = Awaited<ReturnType<ProgressionController['redeemCode']>>;
type RestoreResult = Awaited<ReturnType<ProgressionController['restoreBackup']>>;
type Persistence = 'checking' | 'available' | 'requesting' | 'granted' | 'denied' | 'unsupported' | 'unavailable';
type Notice = {text: string; error?: boolean};
const MAX_BACKUP_BYTES = 1024 * 1024;
const number = (value: number) => value.toLocaleString('en-US');

export function giftCodeFeedback(result: GiftResult): string {
  if (result.success) return `Gift redeemed: +${number(result.xp)} XP, +${number(result.credits)} credits. Level ${result.level}.`;
  const messages: Record<GiftResult['reason'], string> = {
    redeemed: 'Gift redeemed.',
    'already-redeemed': 'This gift code has already been redeemed.',
    'invalid-code': 'This gift code is invalid. Check the code and try again.',
    expired: 'This gift code has expired.',
    'storage-unavailable': 'Gift not redeemed: browser storage is unavailable. Enable storage and try again.',
    'unsupported-version': 'This gift or save requires a newer version of SprayLab.',
    disposed: 'This account is no longer active. Reopen the armory and try again.',
    busy: 'Another account action is in progress. Try again shortly.',
  };
  return messages[result.reason] ?? 'Gift could not be redeemed. Try again.';
}

export function backupRestoreFeedback(result: RestoreResult): string {
  if (result.success) return `Progress restored. Level ${result.level}.`;
  const messages: Record<RestoreResult['reason'], string> = {
    restored: 'Progress restored.',
    'invalid-backup': 'This backup is invalid or damaged. Current progress was not replaced.',
    'unsupported-version': 'This backup requires a newer version of SprayLab. Current progress was not replaced.',
    'storage-unavailable': 'Backup not restored: browser storage is unavailable. Current progress was not replaced.',
    disposed: 'This account is no longer active. Reopen the armory and try again.',
  };
  return messages[result.reason] ?? 'Backup could not be restored.';
}

export async function readProgressionBackup(file: Pick<File, 'size' | 'text'>): Promise<string> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error('Backup must be 1 MB or smaller.');
  let text: string;
  try {text = await file.text();} catch {throw new Error('Could not read this backup. Choose the file again.');}
  try {JSON.parse(text);} catch {throw new Error('This file is not a valid JSON backup.');}
  return text;
}

export function downloadProgressionBackup(text: string, date = new Date()): void {
  const url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = `spraylab-progress-${date.toISOString().replace(/[:.]/g, '-')}.json`;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Allow the browser to start the download before releasing its backing URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const persistenceText: Record<Persistence, string> = {
  checking: 'Checking persistent storage...',
  available: 'Eviction protection is optional. Saving progress does not require this permission.',
  requesting: 'Requesting persistent storage...',
  granted: 'Persistent storage granted. Clearing site data can still remove progress.',
  denied: 'Eviction protection was not granted. This does not prevent normal saves. Keep an exported backup.',
  unsupported: 'Persistent storage requests are not supported in this browser.',
  unavailable: 'Persistent storage status is unavailable. Keep an exported backup.',
};

export function ProgressionAccount({controller}: {controller: ProgressionController}) {
  const {storageStatus} = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const id = useId();
  const [ready, setReady] = useState(false), [code, setCode] = useState('');
  const [busy, setBusy] = useState<'redeeming' | 'reading' | 'restoring' | null>(null);
  const [notice, setNotice] = useState<Notice>({text: ''});
  const [pendingBackup, setPendingBackup] = useState<string | null>(null);
  const [persistence, setPersistence] = useState<Persistence>('checking');
  const [retrying, setRetrying] = useState(false), [saveNotice, setSaveNotice] = useState('');
  const [saveOpen, setSaveOpen] = useState(storageStatus !== 'saved' && storageStatus !== 'saving');
  const mounted = useRef(false), locked = useRef(false), persistenceRevision = useRef(0);
  const giftInput = useRef<HTMLTextAreaElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const confirmation = useRef<HTMLDivElement>(null), importButton = useRef<HTMLButtonElement>(null);
  const noticeNode = useRef<HTMLParagraphElement>(null), nextFocus = useRef<'gift' | 'import' | 'notice' | null>(null);

  useEffect(() => {
    if (storageStatus !== 'saved' && storageStatus !== 'saving') setSaveOpen(true);
  }, [storageStatus]);

  useEffect(() => {
    mounted.current = true;
    setReady(false);
    let current = true;
    void controller.ready.then(() => {if (current) setReady(true);}, () => {
      if (current) setNotice({text: 'Progress could not be loaded. Reopen the armory and try again.', error: true});
    });
    return () => {current = false; mounted.current = false;};
  }, [controller]);

  useEffect(() => {
    let current = true;
    const revision = persistenceRevision.current;
    void (async () => {
      try {
        const storage = navigator.storage;
        const granted = typeof storage?.persisted === 'function' ? await storage.persisted() : false;
        if (current && revision === persistenceRevision.current) setPersistence(granted ? 'granted' : typeof storage?.persist === 'function' ? 'available' : 'unsupported');
      } catch {if (current && revision === persistenceRevision.current) setPersistence('unavailable');}
    })();
    return () => {current = false;};
  }, []);

  useEffect(() => {if (pendingBackup !== null) confirmation.current?.focus();}, [pendingBackup]);
  useEffect(() => {
    if (busy !== null || pendingBackup !== null) return;
    const target = nextFocus.current;
    nextFocus.current = null;
    if (target === 'gift') giftInput.current?.focus();
    else if (target === 'import') importButton.current?.focus();
    else if (target === 'notice') noticeNode.current?.focus();
  }, [notice, busy, pendingBackup]);

  async function redeem(event: FormEvent) {
    event.preventDefault();
    if (!ready || locked.current || pendingBackup !== null || !code.trim()) return;
    locked.current = true; setBusy('redeeming'); setNotice({text: 'Redeeming gift...'});
    try {
      const result = await controller.redeemCode(code.trim());
      if (!mounted.current) return;
      setNotice({text: giftCodeFeedback(result), error: !result.success});
      if (result.success) setCode('');
    } catch {
      if (mounted.current) setNotice({text: 'Gift could not be redeemed. Try again.', error: true});
    } finally {
      locked.current = false;
      if (mounted.current) {nextFocus.current = 'gift'; setBusy(null);}
    }
  }

  function exportBackup() {
    if (!ready || locked.current || pendingBackup !== null) return;
    try {
      downloadProgressionBackup(controller.exportBackup());
      setNotice({text: 'Backup download started.'});
    } catch {setNotice({text: 'Could not export a backup. Try again.', error: true});}
  }

  async function selectBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file || !ready || locked.current || pendingBackup !== null) return;
    locked.current = true; setBusy('reading'); setNotice({text: 'Reading backup...'});
    try {
      const text = await readProgressionBackup(file);
      if (mounted.current) {setPendingBackup(text); setNotice({text: ''});}
    } catch (error) {
      if (mounted.current) {
        nextFocus.current = 'notice';
        setNotice({text: error instanceof Error ? error.message : 'Could not read this backup.', error: true});
      }
    } finally {locked.current = false; if (mounted.current) setBusy(null);}
  }

  async function restoreBackup() {
    if (!ready || locked.current || pendingBackup === null) return;
    locked.current = true; setBusy('restoring');
    try {
      const result = await controller.restoreBackup(pendingBackup);
      if (!mounted.current) return;
      setNotice({text: backupRestoreFeedback(result), error: !result.success});
    } catch {setNotice({text: 'Backup could not be restored. Try again.', error: true});}
    finally {
      locked.current = false; setBusy(null); setPendingBackup(null);
      nextFocus.current = 'notice';
    }
  }

  async function retrySave() {
    if (retrying) return;
    setRetrying(true); setSaveNotice('Checking and saving progress...');
    try {
      const saved = await controller.retryStorage();
      if (mounted.current) setSaveNotice(saved ? 'Progress saved on this browser.' :
        'Saving is still blocked. Export a backup now. Allow site data for spraylab.pages.dev in Chrome settings, then retry. Do not clear site data.');
    } catch {if (mounted.current) setSaveNotice('Could not save progress. Export a backup before leaving, then retry.');}
    finally {if (mounted.current) setRetrying(false);}
  }

  async function requestPersistence() {
    if (persistence === 'requesting' || persistence === 'granted') return;
    ++persistenceRevision.current;
    setPersistence('requesting');
    const saving = retrySave();
    try {
      const storage = navigator.storage;
      if (typeof storage?.persist !== 'function') setPersistence('unsupported');
      else {
        const granted = await storage.persist();
        if (mounted.current) setPersistence(granted ? 'granted' : 'denied');
      }
    } catch {if (mounted.current) setPersistence('unavailable');}
    await saving;
  }

  const disabled = !ready || busy !== null || pendingBackup !== null;
  return <details className="progression-save-gifts" open={saveOpen} onToggle={event => setSaveOpen(event.currentTarget.open)}>
    <summary>Save &amp; gifts</summary>
    <div className="progression-save-content">
      <p className="progression-save-note">Progress is local to this browser. Clearing site data removes local copies. Export a backup to keep them.</p>
      <div className="progression-save-health">
        <p role="status" aria-live="polite">{storageStatus === 'saved' ? 'Progress saved on this browser.' : storageStatus === 'saving' ? 'Saving progress...' :
          storageStatus === 'unsupported-version' ? 'A newer save is protected. Update SprayLab before saving.' : storageStatus === 'corrupt-save' ?
            'A damaged save is protected. Export this session or import a valid backup.' : 'Progress is not saved yet. Retry saving or export a backup before leaving.'}</p>
        <button type="button" onClick={retrySave} disabled={!ready || retrying || busy !== null || storageStatus === 'unsupported-version'}><RotateCcw size={16} aria-hidden="true"/>{retrying ? 'Retrying...' : 'Retry saving progress'}</button>
        <p role="status" aria-live="polite" aria-atomic="true">{saveNotice}</p>
      </div>
      <form className="progression-gift-form" onSubmit={redeem} aria-busy={busy === 'redeeming'}>
        <label htmlFor={`${id}-gift`}>Gift code</label>
        <div className="progression-gift-entry"><textarea ref={giftInput} id={`${id}-gift`} rows={2} value={code} autoComplete="off" spellCheck={false} autoCapitalize="none"
          disabled={disabled} maxLength={4096} onChange={event => setCode(event.target.value)} aria-describedby={`${id}-notice`}/>
          <button type="submit" disabled={disabled || !code.trim()}><Gift size={16} aria-hidden="true"/>{busy === 'redeeming' ? 'Redeeming...' : 'Redeem'}</button></div>
      </form>
      <div className="progression-save-actions">
        <button type="button" disabled={disabled} onClick={exportBackup}><Download size={16} aria-hidden="true"/>Export backup</button>
        <button type="button" ref={importButton} disabled={disabled} onClick={() => fileInput.current?.click()}><Upload size={16} aria-hidden="true"/>{busy === 'reading' ? 'Reading...' : 'Import backup'}</button>
        <label className="progression-save-file-label" htmlFor={`${id}-file`}>Backup JSON file</label>
        <input ref={fileInput} id={`${id}-file`} type="file" accept="application/json,.json" hidden disabled={disabled} onChange={selectBackup}/>
      </div>
      {pendingBackup !== null && <div className="progression-restore-confirmation" ref={confirmation} tabIndex={-1} role="group" aria-labelledby={`${id}-confirm`}>
        <p id={`${id}-confirm`}>Replace current XP, credits and collection with this backup? Already-claimed gifts stay claimed. Cancel and export first to keep your current progress.</p>
        <div className="progression-save-actions"><button type="button" onClick={restoreBackup} disabled={busy !== null}><RotateCcw size={16} aria-hidden="true"/>Replace progress</button>
          <button type="button" onClick={() => {nextFocus.current = 'import'; setPendingBackup(null);}} disabled={busy !== null}><X size={16} aria-hidden="true"/>Cancel</button></div>
      </div>}
      <p ref={noticeNode} tabIndex={-1} id={`${id}-notice`} className={`progression-save-status${notice.error ? ' is-error' : ''}`} role="status" aria-live="polite" aria-atomic="true">{notice.text || (!ready ? 'Loading progress...' : '')}</p>
      <div className="progression-save-persistence"><button type="button" onClick={requestPersistence} disabled={persistence === 'checking' || persistence === 'requesting' || persistence === 'granted' || persistence === 'unsupported'} aria-describedby={`${id}-persistence`}>
        <ShieldCheck size={16} aria-hidden="true"/>{persistence === 'requesting' ? 'Requesting...' : 'Request persistent storage'}</button>
        <p id={`${id}-persistence`} role="status" aria-live="polite" aria-atomic="true">{persistenceText[persistence]}</p></div>
    </div>
  </details>;
}
