import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { simulateBattle } from '../build/shanhai/combat.js';
import {
  localizeBattleText,
  localizeBranch,
  localizeError,
  localizeReason,
  localizeSourceId,
  localizeStatus,
  localizeTier,
  localizeVisibleText,
} from '../build/shanhai/localization.js';

const loaded = await loadContent();
assert.deepEqual(loaded.issues, []);
const content = contentFromEntities(loaded.entities, loaded.manifest.content_version);

test('localizes known combat vocabulary, branches, tiers, statuses, and source IDs', () => {
  assert.equal(
    localizeVisibleText('player damage, critical armor_break, rage, and shield'),
    '我方 伤害, 暴击 破甲, 怒气, and 护盾',
  );
  assert.equal(localizeBattleText('玩家获得护盾；敌人受到damage'), '我方获得护盾；敌方受到伤害');
  assert.equal(localizeStatus('armor_break'), '破甲');
  assert.equal(localizeTier('elite'), '精英');
  assert.equal(localizeBranch('B'), '乙');
  assert.equal(localizeSourceId('RKF01-BASIC-DAMAGE'), '功法招式');
  assert.equal(localizeSourceId('RULES-RAGE-SETTLE'), '轮尾回怒');
});

test('replaces unknown English errors and contribution reasons with safe Chinese fallbacks', () => {
  assert.equal(localizeError('Unknown method: RKF99'), '此处暂时无法展开，请重试。');
  assert.equal(localizeError('存档无效'), '存档无效');
  assert.equal(localizeReason('conditional trigger absent'), '本局未满足触发条件');
  assert.equal(localizeReason('target_design_before_runtime_fixture'), '本局未满足触发条件');
});

test('localizes status stacks next to digits and resolves IDs before their vocabulary', () => {
  for (const status of ['burn', 'poison', 'armor_break', 'weakness', 'charge_luck', 'sword_intent']) {
    assert.equal(localizeBattleText(`敌人获得${status}12层`), `敌方获得${localizeStatus(status)}12层`);
  }
  assert.equal(localizeVisibleText('RKF04-J1-A-BURN', source =>
    source === 'RKF04-J1-A-BURN' ? '火势连绵' : undefined), '火势连绵');
  assert.equal(localizeVisibleText('RULES-RAGE-SETTLE'), '斗法规则');
  assert.equal(localizeVisibleText('healingBonus'), 'healingBonus');
  assert.equal(localizeVisibleText('SHOP-A1-a1-d5-l0'), '云游坊市');
  assert.equal(localizeVisibleText('R-A2-03'), '山中一息');
});

test('all authored player-facing method, artifact, event and enemy descriptions localize', () => {
  const visibleKeys = new Set([
    'name', 'summary', 'description', 'quick', 'text', 'scene', 'label',
    'outcome', 'failure_outcome', 'role', 'counterplay', 'pressure',
  ]);
  function check(value, path, visible = false) {
    if (typeof value === 'string') {
      if (visible) assert.doesNotMatch(localizeVisibleText(value), /[A-Za-z]/, path);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => check(item, `${path}.${index}`, visible));
    } else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) check(item, `${path}.${key}`, visibleKeys.has(key));
    }
  }
  for (const entity of content.entities.filter(entity =>
    ['method', 'artifact', 'event', 'enemy'].includes(entity.kind))) check(entity, entity.id);
});

test('localizes generated battle text without mutating real combat frames', () => {
  const player = {
    name: '行者',
    method: 'RKF01',
    n: 0,
    talents: [],
    artifacts: [],
    baseStats: { attack: 100, defense: 30, max_hp: 2_000, crit_rate: 0, speed: 12 },
  };
  const enemy = {
    name: '试炼者',
    method: 'RKF02',
    n: 0,
    talents: [],
    artifacts: [],
    baseStats: { attack: 80, defense: 30, max_hp: 2_000, crit_rate: 0, speed: 10 },
  };
  const result = simulateBattle(content, player, enemy, 'localization-frame-check', { roundLimit: 3 });
  const originalFrames = structuredClone(result.frames);

  assert.ok(result.frames.length > 0);
  for (const frame of result.frames) {
    const visible = localizeBattleText(frame.text);
    assert.doesNotMatch(visible, /玩家|敌人/);
    assert.doesNotMatch(visible, /\b(?:player|enemy|damage|critical|shield|rage)\b/i);
  }
  assert.deepEqual(result.frames, originalFrames);
});
