/** Disk caching survives sessions; this small LRU avoids rebuilding recent scenes.
 * Active, replay and in-flight next maps are owned separately and never evicted. */
export class ResidentChunks<T extends {dispose():void}> {
  private readonly entries=new Map<string,{value:T;bytes:number}>();
  private bytes=0;
  constructor(private readonly maxEntries:number,private readonly budget:number){}
  has(key:string){return this.entries.has(key);}
  take(key:string){
    const entry=this.entries.get(key);if(!entry)return;
    this.entries.delete(key);this.bytes-=entry.bytes;return entry.value;
  }
  retire(key:string,value:T,bytes:number){
    const old=this.take(key);if(old&&old!==value)old.dispose();
    if(!Number.isFinite(bytes)||bytes<0||bytes>this.budget||this.maxEntries<1){value.dispose();return;}
    this.entries.set(key,{value,bytes});this.bytes+=bytes;
    while(this.entries.size>this.maxEntries||this.bytes>this.budget){
      const key=this.entries.keys().next().value!;this.take(key)!.dispose();
    }
  }
  clear(){for(const {value} of this.entries.values())value.dispose();this.entries.clear();this.bytes=0;}
}
