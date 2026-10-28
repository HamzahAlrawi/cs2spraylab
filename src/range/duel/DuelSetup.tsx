import {memo} from 'react';
import {ChevronRight, Plus, X} from 'lucide-react';
import {weaponIds} from '../config';
import {equipmentNames, type Equipment} from '../equipment';
import {arenaDesigns} from './arena-layout';
import {botConfig, type BotOverride, type DuelConfig, type SkillLevel} from './config';
import './duel-setup.css';
import realMaps from './real-map-catalog.json';
import {UtilityLoadout} from './utility-ui';

type DuelSetupProps = {
  config: DuelConfig;
  arenaDesign?: string;
  weaponToAdd: Equipment;
  setWeaponToAdd: (weapon: Equipment) => void;
  update: (patch: Partial<DuelConfig>) => void;
  updateBot: (index: number, patch: BotOverride) => void;
  customizeBot: (index: number, enabled: boolean) => void;
};

// Combat reports change at 10 Hz; setup only changes with configuration or a new map.
export const DuelSetup = memo(function DuelSetup({config, arenaDesign, weaponToAdd, setWeaponToAdd, update, updateBot, customizeBot}: DuelSetupProps) {
  return <div className="duel-controls-body duel-setup">
      <section className="duel-setup-basics" aria-label="Opponent basics">
        <h3>Opponent basics</h3>
        <div className="duel-setup-basics-grid">
        <label className="duel-field"><span>Bots <output>{config.botCount}</output></span><input aria-label="Number of bots" type="range" min="1" max="5" step="1" value={config.botCount} onChange={event => update({botCount: +event.target.value})}/></label>
        <label className="duel-field"><span>FACEIT level <output>{config.skill}</output></span><select aria-label="Bot skill level" value={config.skill} onChange={event => update({skill: event.target.value === '10+' ? '10+' : +event.target.value as SkillLevel})}>
          {[1,2,3,4,5,6,7,8,9,10,'10+'].map(level => <option key={level} value={level}>{level}</option>)}
        </select></label>
        <label className="duel-field duel-setup-wide"><span>Behavior</span><select aria-label="Bot behavior" value={config.behavior} onChange={event => update({behavior: event.target.value as DuelConfig['behavior']})}>
          <option value="mixed">Defensive mix</option><option value="holder">Cover peeker</option><option value="patient">Patient</option><option value="aggressive">Aggressive</option>
        </select></label>
        <div className="duel-field duel-setup-wide"><span>Bot weapons</span><div className="duel-weapon-add"><select aria-label="Add bot weapon" value={weaponToAdd} onChange={event => setWeaponToAdd(event.target.value as Equipment)}>
          {[...weaponIds,'knife' as const].map(id => <option value={id} key={id}>{equipmentNames[id]}</option>)}
        </select><button type="button" aria-label="Add weapon to bot pool" title="Add weapon" onClick={() => update({weapons: [...config.weapons, weaponToAdd]})}><Plus size={18} aria-hidden="true"/></button></div>
          <div className="duel-weapon-pool">{config.weapons.map(weapon => <span key={weapon}>{equipmentNames[weapon]}<button type="button" aria-label={`Remove ${equipmentNames[weapon]}`} title={`Remove ${equipmentNames[weapon]}`} disabled={config.weapons.length === 1}
            onClick={() => update({weapons: config.weapons.filter(id => id !== weapon)})}><X size={14} aria-hidden="true"/></button></span>)}</div>
        </div>
        </div>
      </section>

      <UtilityLoadout config={config} update={update}/>
      <details className="duel-setup-section">
        <summary><ChevronRight size={16} aria-hidden="true"/><span>Arena</span></summary>
        <div className="duel-setup-fields">
          <label className="duel-check"><span>Generated arenas</span><input aria-label="Use generated arenas" type="checkbox" checked={config.generatedMaps} onChange={event=>update({generatedMaps:event.target.checked})}/></label>
          {!config.generatedMaps && <><label className="duel-field"><span>Map chunk <output>{arenaDesign}</output></span><select aria-label="Real map chunk" value={config.realMapChunk} onChange={event=>update({realMapChunk:event.target.value})}>
            <option value="random">Random Dust 2 chunk each round</option>{realMaps.chunks.map(chunk=><option key={chunk.id} value={chunk.id}>{chunk.name}</option>)}</select></label>
            <label className="duel-check"><span>Route arrows</span><input aria-label="Duel route arrows" type="checkbox" checked={config.routeGuide} onChange={event=>update({routeGuide:event.target.checked})}/></label></>}
          {config.generatedMaps && <><label className="duel-field"><span>Map layout <output>{arenaDesign}</output></span><select aria-label="Map layout" value={config.mapDesign} onChange={event=>update({mapDesign:event.target.value as DuelConfig['mapDesign']})}>
            <option value="random">Varied each round</option>{arenaDesigns.map(design=><option key={design} value={design}>{design}</option>)}</select></label>
          <label className="duel-field"><span>Arena size <output>{(24 * config.arenaScale).toFixed(0)} x {(32 * config.arenaScale).toFixed(0)} m</output></span><input type="range" aria-label="Arena size" min={config.botCount <= 2 ? '.65' : '1'} max="1.5" step=".05" value={config.arenaScale} onChange={event => update({arenaScale: +event.target.value})}/></label></>}
        </div>
      </details>

      <details className="duel-setup-section">
        <summary><ChevronRight size={16} aria-hidden="true"/><span>Health &amp; armor</span></summary>
        <div className="duel-setup-fields">
        <fieldset className="duel-setup-fieldset"><legend>Bots</legend><div className="duel-setup-fields">
        <label className="duel-field"><span>Health <output>{config.health}</output></span><input aria-label="Bot health" type="number" min="1" max="500" value={config.health} onChange={event => update({health: +event.target.value})}/></label>
        <label className="duel-check"><span>Bot Kevlar</span><input aria-label="Bot armor" type="checkbox" checked={config.armor} onChange={event => update({armor: event.target.checked})}/></label>
        <label className="duel-check"><span>Bot helmet</span><input aria-label="Bot helmet" type="checkbox" checked={config.helmet} disabled={!config.armor} onChange={event => update({helmet: event.target.checked})}/></label>
        <label className="duel-field"><span>Bot armor condition</span><input aria-label="Bot armor points" type="number" min="0" max="100" value={config.armorPoints} disabled={!config.armor} onChange={event => update({armorPoints: +event.target.value})}/></label>
        </div></fieldset>
        <fieldset className="duel-setup-fieldset"><legend>Player</legend><div className="duel-setup-fields">
        <label className="duel-field"><span>Player health <output>{config.playerHealth}</output></span><input aria-label="Player health" type="number" min="1" max="500" value={config.playerHealth} onChange={event => update({playerHealth: +event.target.value})}/></label>
        <label className="duel-check"><span>Player Kevlar</span><input aria-label="Player armor" type="checkbox" checked={config.playerArmor} onChange={event => update({playerArmor: event.target.checked})}/></label>
        <label className="duel-check"><span>Player helmet</span><input aria-label="Player helmet" type="checkbox" checked={config.playerHelmet} disabled={!config.playerArmor} onChange={event => update({playerHelmet: event.target.checked})}/></label>
        <label className="duel-field"><span>Player armor condition</span><input aria-label="Player armor points" type="number" min="0" max="100" value={config.playerArmorPoints} disabled={!config.playerArmor} onChange={event => update({playerArmorPoints: +event.target.value})}/></label>
        </div></fieldset>
        </div>
      </details>

      <details className="duel-setup-section">
        <summary><ChevronRight size={16} aria-hidden="true"/><span>Advanced combat &amp; radar</span></summary>
        <div className="duel-setup-fields">
        <label className="duel-field"><span>Aim accuracy <output>{Math.round(config.accuracy * 100)}%</output></span><input aria-label="Bot aim accuracy" type="range" min=".5" max="1.5" step=".05" value={config.accuracy} onChange={event => update({accuracy: +event.target.value})}/></label>
        <label className="duel-check"><span>Bots trade teammates</span><input aria-label="Bot trading" type="checkbox" checked={config.tradeEnabled}
          onChange={event => update({tradeEnabled: event.target.checked})}/></label>
        <label className="duel-field"><span>Between rounds <output>{config.feedbackSeconds.toFixed(1)}s</output></span><input aria-label="Round restart delay" type="range" min="1" max="3" step=".1" value={config.feedbackSeconds} onChange={event => update({feedbackSeconds: +event.target.value})}/></label>
        <label className="duel-check"><span>Protect Ctrl+W in fullscreen</span><input aria-label="Protect Ctrl+W" type="checkbox" checked={config.shortcutProtection}
          onChange={event => update({shortcutProtection: event.target.checked})}/></label>
        <fieldset className="duel-setup-fieldset duel-setup-wide"><legend>Radar</legend><div className="duel-setup-fields">
          <label className="duel-check"><span>Radar</span><input aria-label="Show radar" type="checkbox" checked={config.radarEnabled} onChange={event=>update({radarEnabled:event.target.checked})}/></label>
          <label className="duel-check"><span>Rotate radar</span><input aria-label="Rotate radar" type="checkbox" checked={config.radarRotate} onChange={event=>update({radarRotate:event.target.checked})}/></label>
          <label className="duel-field"><span>Radar zoom</span><input aria-label="Radar zoom" type="range" min=".25" max="1" step=".05" value={config.radarScale} onChange={event=>update({radarScale:+event.target.value})}/></label>
        </div></fieldset>
        </div>
      </details>

      <details className="duel-setup-section">
        <summary><ChevronRight size={16} aria-hidden="true"/><span>Opponents</span><output>{config.botCount}</output></summary>
        <div className="duel-setup-roster">{Array.from({length: config.botCount}, (_, index) => {
          const custom = !!Object.keys(config.overrides[index] ?? {}).length;
          const bot = botConfig(config, index);
          return <details className="duel-bot-details duel-setup-bot" key={index}>
            <summary><ChevronRight size={16} aria-hidden="true"/>Bot {index + 1}<span>{equipmentNames[bot.weapon]} / Lv {bot.skill}</span></summary>
            <div className="duel-setup-bot-content">
            <label className="duel-check"><span>Custom loadout & skill</span><input aria-label={`Customize bot ${index + 1}`} type="checkbox" checked={custom}
              onChange={event => customizeBot(index, event.target.checked)}/></label>
            {custom && <div className="duel-setup-fields">
              <label className="duel-field"><span>Weapon</span><select aria-label={`Bot ${index + 1} weapon`} value={bot.weapon}
                onChange={event => updateBot(index, {weapon: event.target.value as Equipment})}>
                {[...weaponIds,'knife' as const].map(id => <option key={id} value={id}>{equipmentNames[id]}</option>)}</select></label>
              <label className="duel-field"><span>Level</span><select aria-label={`Bot ${index + 1} skill`} value={bot.skill}
                onChange={event => updateBot(index, {skill: event.target.value === '10+' ? '10+' : +event.target.value as SkillLevel})}>
                {[1,2,3,4,5,6,7,8,9,10,'10+'].map(level => <option key={level} value={level}>{level}</option>)}</select></label>
              <label className="duel-field"><span>Behavior</span><select aria-label={`Bot ${index + 1} behavior`} value={bot.behavior}
                onChange={event => updateBot(index, {behavior: event.target.value as DuelConfig['behavior']})}>
                <option value="mixed">Defensive mix</option><option value="holder">Cover peeker</option><option value="patient">Patient</option><option value="aggressive">Aggressive</option></select></label>
              <label className="duel-field"><span>Health</span><input aria-label={`Bot ${index + 1} health`} type="number" min="1" max="500" value={bot.health}
                onChange={event => updateBot(index, {health: +event.target.value})}/></label>
              <label className="duel-check"><span>Kevlar</span><input aria-label={`Bot ${index + 1} armor`} type="checkbox" checked={bot.armor}
                onChange={event => updateBot(index, {armor: event.target.checked})}/></label>
              <label className="duel-check"><span>Helmet</span><input aria-label={`Bot ${index + 1} helmet`} type="checkbox" checked={bot.helmet} disabled={!bot.armor} onChange={event=>updateBot(index,{helmet:event.target.checked})}/></label>
              <label className="duel-field"><span>Armor condition</span><input aria-label={`Bot ${index + 1} armor points`} type="number" min="0" max="100" value={bot.armorPoints} disabled={!bot.armor} onChange={event=>updateBot(index,{armorPoints:+event.target.value})}/></label>
              <label className="duel-field"><span>Aim accuracy <output>{Math.round(bot.accuracy * 100)}%</output></span>
                <input aria-label={`Bot ${index + 1} accuracy`} type="range" min=".5" max="1.5" step=".05" value={bot.accuracy}
                  onChange={event => updateBot(index, {accuracy: +event.target.value})}/></label>
            </div>}
            </div>
          </details>;
        })}</div>
      </details>
      </div>;
});
