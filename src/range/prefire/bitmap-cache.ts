type Bitmap = {width: number; height: number; close(): void};
/** Owns idle decoded images only. Taking an image transfers ownership to the map. */
export class WarmBitmapCache<T extends Bitmap> {
  private readonly idle = new Map<string, {image: T; bytes: number; expires: number}>();
  private bytes = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly budget = 32 * 1024 * 1024, private readonly lifetime = 20000, private readonly maxEntries = 64) {}
  take(key: string): T | undefined {
    this.expire(); const entry = this.idle.get(key);
    if (!entry) return;
    this.idle.delete(key); this.bytes -= entry.bytes; return entry.image;
  }
  retire(key: string, image: T) {
    this.expire();
    const bytes = image.width * image.height * 4;
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > this.budget) {image.close(); return;}
    const previous = this.idle.get(key);
    if (previous) {this.bytes -= previous.bytes; this.idle.delete(key); if (previous.image !== image) previous.image.close();}
    this.idle.set(key, {image, bytes, expires: Date.now() + this.lifetime}); this.bytes += bytes;
    while (this.bytes > this.budget || this.idle.size > this.maxEntries) {
      const oldest = this.idle.entries().next().value!;
      this.idle.delete(oldest[0]); this.bytes -= oldest[1].bytes; oldest[1].image.close();
    }
    this.schedule();
  }
  private expire() {
    for (const [key, entry] of this.idle) if (entry.expires <= Date.now()) {
      this.idle.delete(key); this.bytes -= entry.bytes; entry.image.close();
    }
  }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    const first = this.idle.values().next().value;
    this.timer = first ? setTimeout(() => {this.timer = undefined; this.expire(); this.schedule();}, Math.max(1,first.expires - Date.now() + 1)) : undefined;
  }
  clear() {
    if (this.timer) clearTimeout(this.timer); this.timer = undefined;
    for (const entry of this.idle.values()) entry.image.close(); this.idle.clear(); this.bytes = 0;
  }
  get retainedBytes() {this.expire(); return this.bytes;}
}

/** Shares live decoded sources; the existing bounded cache owns idle sources. */
export class SharedBitmapCache<T extends Bitmap> {
  private readonly active=new Map<string,{value:Promise<T>;refs:number;settled:boolean;controller:AbortController}>();
  private readonly idle:WarmBitmapCache<T>;
  constructor(budget=32*1024*1024,lifetime=20000){this.idle=new WarmBitmapCache<T>(budget,lifetime);}
  acquire(key:string,decode:(signal:AbortSignal)=>Promise<T>) {
    let entry=this.active.get(key);const reused=!!entry;
    const warm=entry?undefined:this.idle.take(key);
    if(!entry) {
      const controller=new AbortController();
      entry={value:undefined as unknown as Promise<T>,refs:0,settled:!!warm,controller};
      const created=entry;
      entry.value=(warm?Promise.resolve(warm):Promise.resolve().then(()=>{
        controller.signal.throwIfAborted();return decode(controller.signal);
      })).then(value=>{
        created.settled=true;
        if(controller.signal.aborted){value.close();throw controller.signal.reason;}
        return value;
      });
      this.active.set(key,entry);
      const owned=entry;
      void entry.value.catch(()=>{if(this.active.get(key)===owned)this.active.delete(key);});
    }
    entry.refs++;const owned=entry;let released=false;
    return {value:entry.value,reused:reused||!!warm,release:()=>{
      if(released)return;released=true;owned.refs--;
      if(owned.refs===0 && !owned.settled) {
        if(this.active.get(key)===owned)this.active.delete(key);
        owned.controller.abort(new DOMException('Unused texture decode','AbortError'));
      }
      void owned.value.then(value=>{
        if(owned.refs===0 && this.active.get(key)===owned) {
          this.active.delete(key);this.idle.retire(key,value);
        }
      },()=>{});
    }};
  }
  clear(){this.idle.clear();}
  get retainedBytes(){return this.idle.retainedBytes;}
}
