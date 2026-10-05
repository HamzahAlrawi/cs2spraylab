import {expect, test} from '@playwright/test';

for (const frameLimit of [30, 240]) for (const shooter of [0, 1]) {
  test(`${frameLimit} FPS: ${shooter ? 'player' : 'bot'} damage and lethal feedback publish on the hit frame`, async ({page}, info) => {
    test.skip(info.project.name !== 'chromium', 'Deterministic renderer timing regression');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(frameLimit => {
      localStorage.setItem('spraylab.range.v2', JSON.stringify({mode: 'duel', volume: 0, quality: 'performance', frameLimit}));
      localStorage.setItem('spraylab.duel.v1', JSON.stringify({botCount: 2, skill: 1, behavior: 'patient'}));
    }, frameLimit);
    await page.goto('/');
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').find(entry => entry.name.includes('/duel/DuelEngine.ts'))!.name;
      const {DuelEngine} = await import(/* @vite-ignore */ url), tick = DuelEngine.prototype.tick;
      DuelEngine.prototype.tick = function(time: number) {(window as any).latencyEngine = this; return tick.call(this, time);};
    });
    await page.waitForFunction(() => {
      const e = (window as any).latencyEngine;
      return e?.motionReady && e.worldLoading.size === 0;
    });
    const timing = await page.evaluate(shooter => new Promise<{
      hitFrame: number; reportFrame: number; deadPoseOnHitFrame: boolean; health: number; damage: number; caption: string;
    }>((resolve, reject) => {
      const e = (window as any).latencyEngine;
      e.sim.arena.solids = []; e.covers.visible = false;
      e.sim.actors[0].position = {x: 0, y: 1.6256, z: 4}; e.sim.actors[0].yaw = 0;
      e.sim.actors[1].position = {x: 0, y: 1.6256, z: -4}; e.sim.actors[1].yaw = Math.PI;
      e.sim.actors[2].position = {x: 10, y: 1.6256, z: -4};
      e.sim.actors[1 - shooter].health = 1;
      e.sim.actors[shooter].weapon.random = () => 0;
      e.sim.command(1, {}); e.sim.command(2, {});
      const onStatus = e.onStatus, processEvents = e.processEvents;
      let hitFrame = -1, deadPoseOnHitFrame = false;
      const timeout = setTimeout(() => reject(new Error('No hit feedback published')), 2000);
      e.processEvents = function(events: any[]) {
        if (events.some(event => event.kind === 'hit' && event.shooter === shooter)) {
          hitFrame = this.last;
          const animator = this.animators.get(1);
          deadPoseOnHitFrame = shooter === 1 || animator.dying;
        }
        return processEvents.call(this, events);
      };
      e.onStatus = function(status: any) {
        onStatus(status);
        if (hitFrame < 0) return;
        clearTimeout(timeout);
        resolve({hitFrame, reportFrame: e.last, deadPoseOnHitFrame, health: status.health, damage: status.damage, caption: status.caption});
      };
      e.statusAt = performance.now();
      e.animationTimes.set(1, e.animationClock);
      e.sim.start(); e.paused = false; e.sim.command(shooter, {firePressed: true});
    }), shooter);
    expect(timing.reportFrame).toBe(timing.hitFrame);
    expect(timing.deadPoseOnHitFrame).toBe(true);
    if (shooter) {
      expect(timing.health).toBe(0);
      await expect(page.locator('.duel-health strong')).toHaveText('0');
    } else {
      expect(timing.damage).toBe(1);
      expect(timing.caption).toBe('HEADSHOT');
      await expect(page.locator('.duel-caption')).toHaveText('HEADSHOT');
      await page.waitForTimeout(1500);
      const settled = await page.evaluate(() => {
        const e = (window as any).latencyEngine, model = e.models.get(1), animator = e.animators.get(1); model.updateMatrixWorld(true);
        return {head: model.getObjectByName('head_0').matrixWorld.elements[13], pelvis: model.getObjectByName('pelvis').matrixWorld.elements[13],
          age: e.animationClock - e.deaths.get(1), poseAge: animator.deathTime, visible: model.visible};
      });
      expect(settled.head, JSON.stringify(settled)).toBeLessThan(.55); expect(settled.pelvis, JSON.stringify(settled)).toBeLessThan(.5);
      await page.locator('canvas[data-duel]').screenshot({path: info.outputPath('grounded-collapse.png')});
    }
    expect(errors).toEqual([]);
  });
}
