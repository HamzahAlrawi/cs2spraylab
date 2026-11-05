import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect, it} from 'vitest';
import {canSkipReward, LevelUpReveal, REWARD_SKIP_DELAY_MS} from './LevelUpReveal';
import {RewardsOverview} from './RewardsOverview';
import {sanitizeProgression, type XpNotice} from './progression';
import {ACHIEVEMENTS, recordDuelAchievements, sanitizeAchievements} from './achievements';

const notice: XpNotice = {id:'test',source:'duel',levelBefore:1,levelAfter:2,xp:100,credits:60,
  unlockedIds:[],achievementIds:[],milestoneIds:[],milestoneCredits:0};
it('enforces the exact 500ms skip boundary with invalid times rejected',()=>{
  expect(REWARD_SKIP_DELAY_MS).toBe(500);
  expect(canSkipReward(1000,1499.999)).toBe(false);expect(canSkipReward(1000,1500)).toBe(true);
  expect(canSkipReward(NaN,1500)).toBe(false);expect(canSkipReward(1000,Infinity)).toBe(false);
});
it('renders the actual earned rank, deterministic rewards and an initially disabled skip without random prize claims',()=>{
  const html=renderToStaticMarkup(createElement(LevelUpReveal,{notice,catalog:[],onDismiss:()=>{}}));
  expect(html).toContain('Level up to 2');expect(html).toContain('+100');expect(html).toContain('+60');
  expect(html).toMatch(/aria-label="Skip level-up reveal"[^>]*disabled|disabled=""[^>]*aria-label="Skip level-up reveal"/);
  expect(html).not.toMatch(/jackpot|odds|case opening|spin again/i);
});
it('shows goals and a finish with explicit purchase eligibility, not automatic ownership',()=>{
  const profile=sanitizeProgression({version:2,balance:100});
  const catalog=[{id:'a',equipment:'ak47',label:'Test finish',unlockLevel:1,price:90}];
  const html=renderToStaticMarkup(createElement(RewardsOverview,{profile,catalog,onFinish:()=>{},onAchievements:()=>{},onMilestones:()=>{}}));
  expect(html).toContain('Rewards overview');expect(html).toContain('Affordable now');expect(html).toContain('eligible to purchase');
  expect(html).toContain('View unlock Test finish');expect(html).toContain('172');
});
it('records new skill goals only from known result metrics and keeps unknown legacy history empty',()=>{
  const setup={playerHealth:100,playerArmor:true,bots:[{id:'1',skill:5 as const,health:100,armor:true,accuracy:1,weapon:'ak47'}]};
  const result={completion:'completed' as const,outcome:'won' as const,activeSeconds:20,opponents:[],
    review:{score:90,shots:10,hits:8,heads:7,kills:1,damage:100,taken:60}};
  const state=recordDuelAchievements(sanitizeAchievements(undefined),setup,result);
  expect(state.stats.cleanHeadRounds).toBe(1);expect(state.stats.comebackWins).toBe(1);expect(state.stats.efficientWins).toBe(0);
  expect(sanitizeAchievements({stats:{duelWins:500}}).stats.comebackWins).toBe(0);
  const easier=recordDuelAchievements(sanitizeAchievements(undefined),{...setup,playerHealth:1000},result);
  expect(easier.stats.comebackWins).toBe(0);
  expect(ACHIEVEMENTS.filter(a=>a.metric==='cleanHeadRounds')).toHaveLength(4);
});
