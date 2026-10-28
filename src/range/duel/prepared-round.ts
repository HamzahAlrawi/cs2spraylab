/** One owned preparation. Superseded or cancelled scenes are always released. */
export class PreparedRound<T extends {dispose(): void}> {
  private slot?: {key: string; controller: AbortController; promise: Promise<T>; value?: T};
  get key() {return this.slot?.key;}
  get ready() {return !!this.slot?.value;}
  start(key: string, load: (signal: AbortSignal) => Promise<T>) {
    if (this.slot?.key === key) return;
    this.cancel();
    const controller = new AbortController();
    const slot = {key, controller, promise: undefined as unknown as Promise<T>, value: undefined as T | undefined};
    this.slot = slot;
    slot.promise = Promise.resolve().then(() => {controller.signal.throwIfAborted(); return load(controller.signal);}).then(value => {
      if (controller.signal.aborted || this.slot !== slot) {
        value.dispose(); throw controller.signal.reason ?? new DOMException('Superseded', 'AbortError');
      }
      slot.value = value; return value;
    }).catch(error => {if (this.slot === slot) this.slot = undefined; throw error;});
    void slot.promise.catch(() => {});return slot.promise;
  }
  async take(key: string, signal: AbortSignal): Promise<T | undefined> {
    const slot = this.slot;
    if (!slot || slot.key !== key) return;
    signal.throwIfAborted();
    const abort = () => {if (this.slot === slot) this.cancel();};
    signal.addEventListener('abort', abort, {once: true});
    try {
      const value = await slot.promise; signal.throwIfAborted();
      if (this.slot !== slot) throw new DOMException('Superseded', 'AbortError');
      this.slot = undefined; slot.value = undefined; return value;
    } finally {signal.removeEventListener('abort', abort);}
  }
  /** Wait without transferring ownership or attaching the next scene. */
  async wait(key:string,signal:AbortSignal):Promise<void> {
    signal.throwIfAborted();
    const slot=this.slot;if(!slot||slot.key!==key)throw new Error('Next round is not prepared');
    let abort:()=>void=()=>{};
    const cancelled=new Promise<never>((_resolve,reject)=>{
      abort=()=>{if(this.slot===slot)this.cancel();reject(signal.reason);};
      signal.addEventListener('abort',abort,{once:true});
    });
    try {
      await Promise.race([slot.promise,cancelled]);signal.throwIfAborted();
      if(this.slot!==slot)throw new DOMException('Superseded','AbortError');
    }finally{signal.removeEventListener('abort',abort);}
  }
  cancel() {
    const slot = this.slot; this.slot = undefined;
    if (!slot) return;
    slot.controller.abort(); slot.value?.dispose(); slot.value = undefined;
  }
}

export function decodedPreloadAllowed(device: {deviceMemory?: number; hardwareConcurrency?:number; connection?: {saveData?: boolean; effectiveType?: string}}) {
  return !device.connection?.saveData && !['slow-2g', '2g'].includes(device.connection?.effectiveType ?? '') &&
    (device.deviceMemory === undefined ? (device.hardwareConcurrency??0)>=8 : device.deviceMemory >= 8);
}
