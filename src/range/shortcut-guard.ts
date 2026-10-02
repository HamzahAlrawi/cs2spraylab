type KeyboardLock = {lock(keys: string[]): Promise<void>; unlock(): void};
const keyboard = () => (navigator as Navigator & {keyboard?: KeyboardLock}).keyboard;

export class ShortcutGuard {
  protected = false;
  private generation = 0;
  private enabled = false;
  private ownsFullscreen = false;
  constructor(private readonly stage: HTMLElement | null) {}
  async enter(enabled: boolean) {
    if (!enabled) {this.release(); return;}
    this.enabled = enabled;
    const generation = ++this.generation;
    if (!this.stage || !keyboard()?.lock) return;
    try {
      if (!document.fullscreenElement) {
        await this.stage.requestFullscreen(); this.ownsFullscreen = true;
      }
      if (generation !== this.generation) {if (!this.enabled) this.exitFullscreen(); return;}
      await keyboard()!.lock(['KeyW']);
      if (generation !== this.generation) {if (!this.enabled) keyboard()?.unlock(); return;}
      this.protected = true;
    } catch {if (generation === this.generation) this.protected = false;}
  }
  release() {
    this.enabled = false; this.generation++;
    if (this.protected) keyboard()?.unlock();
    this.protected = false; this.exitFullscreen();
  }
  private exitFullscreen() {
    if (!this.ownsFullscreen) return;
    this.ownsFullscreen = false;
    if (document.fullscreenElement === this.stage) void document.exitFullscreen().catch(() => {});
  }
}
