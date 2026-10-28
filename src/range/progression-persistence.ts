import type {ProgressionProfile, ProgressionStorage} from './progression';

export const MAX_PROFILE_BYTES = 1_000_000;
export type ProfileCopy = {format: 'spraylab-profile-copy'; version: 1; revision: number; checksum: string; profile: unknown};
export type ProfileMirror = {read(): Promise<unknown>; write(copy: ProfileCopy): Promise<boolean>};
export const progressionBackupKeys = (key: string) => [`${key}.backup.latest`, `${key}.backup.previous`] as const;
export function profileChecksum(value: unknown): string {
  const text = JSON.stringify(value); let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
export function profileCopy(profile: ProgressionProfile, revision: number): ProfileCopy {
  return {format: 'spraylab-profile-copy', version: 1, revision, checksum: profileChecksum(profile), profile};
}
export function decodeProfileCopy(raw: unknown): ProfileCopy | undefined {
  const value = raw as ProfileCopy;
  if (!value || value.format !== 'spraylab-profile-copy' || value.version !== 1 ||
    !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.profile ||
    typeof value.checksum !== 'string' || value.checksum !== profileChecksum(value.profile)) return;
  return value;
}
export function readProfileCopies(storage: ProgressionStorage, key: string) {
  const texts = [key, ...progressionBackupKeys(key)].map(name => ({key: name, text: storage.getItem(name)}));
  return texts.map(entry => {
    try {
      if (!entry.text || entry.text.length > MAX_PROFILE_BYTES) return {...entry, raw: undefined, revision: 0, unsupported: false};
      const parsed = JSON.parse(entry.text), copy = decodeProfileCopy(parsed);
      return {...entry, raw: entry.key === key ? parsed : copy?.profile,
        unsupported: entry.key !== key && parsed?.format === 'spraylab-profile-copy' && parsed.version !== 1,
        revision: entry.key === key ? Number.isSafeInteger(parsed?.saveRevision) && parsed.saveRevision >= 0 ? parsed.saveRevision : 0 : copy?.revision ?? 0};
    } catch {return {...entry, raw: undefined, revision: 0, unsupported: false};}
  });
}
export function writeProfileCopies(storage: ProgressionStorage, key: string, copy: ProfileCopy, previous?: ProfileCopy): boolean {
  const [latest, older] = progressionBackupKeys(key);
  const write = (name: string, text: string) => {try {storage.setItem(name, text); return true;} catch {return false;}};
  if (previous) write(older, JSON.stringify(previous));
  const backup = write(latest, JSON.stringify(copy));
  const primary = write(key, JSON.stringify({...copy.profile as object, saveRevision: copy.revision}));
  return backup || primary;
}

/** Independent, tiny profile database; never part of the disposable map caches. */
export function browserProfileMirror(key: string): ProfileMirror | null {
  if (typeof indexedDB === 'undefined') return null;
  const run = <T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, finish: (value: T) => void) => void, fallback: T): Promise<T> =>
    new Promise(resolve => {
      let db: IDBDatabase | undefined, done = false, result = fallback;
      const finish = (value: T) => {if (done) return; done = true; clearTimeout(timer); db?.close(); resolve(value);};
      const timer = setTimeout(() => finish(fallback), 1500);
      try {
        const request = indexedDB.open('spraylab-profile-backups-v1', 1);
        request.onupgradeneeded = () => {request.result.createObjectStore('profiles');};
        request.onerror = request.onblocked = () => finish(fallback);
        request.onsuccess = () => {
          db = request.result;
          if (done) {db.close(); return;}
          db.onversionchange = () => {db?.close(); finish(fallback);};
          try {
            const transaction = db.transaction('profiles', mode);
            transaction.oncomplete = () => finish(result);
            transaction.onerror = transaction.onabort = () => finish(fallback);
            operation(transaction.objectStore('profiles'), value => {result = value;});
          } catch {finish(fallback);}
        };
      } catch {finish(fallback);}
    });
  return {
    read: () => run<unknown>('readonly', (store, finish) => {const get = store.get(key); get.onsuccess = () => finish(get.result);}, undefined),
    write: copy => run<boolean>('readwrite', (store, finish) => {
      const get = store.get(key);
      get.onsuccess = () => {
        const current = get.result;
        if (current?.format === 'spraylab-profile-copy' && (current.version !== 1 ||
          ![1, 2].includes(current.profile?.version))) {finish(false); return;}
        const previous = decodeProfileCopy(get.result);
        if (previous && previous.revision > copy.revision) {finish(false); return;}
        const put = store.put(copy, key); put.onsuccess = () => finish(true);
      };
    }, false),
  };
}
