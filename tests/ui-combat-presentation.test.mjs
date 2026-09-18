import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.HTMLElement ??= class {};
globalThis.customElements ??= { define() {} };

const { FengshenGame, compactBattleFrame } = await import('../build/app.js');

const context = {
  playerName: '我方修士',
  enemyName: '山魈',
  statusLabels: { burn: '燃烧', shield: '护盾', weak: '虚弱' },
};

const fighter = (name, patch = {}) => ({
  name,
  stats: { hp: 100, attack: 10, defense: 5, speed: 5, hit: 0, dodge: 0, luck: 0 },
  hp: 100,
  rage: 0,
  shield: 0,
  status: {},
  abilities: [],
  used: [],
  tags: [],
  cooldown: {},
  phase: 0,
  ...patch,
});

const frame = (kind, patch = {}) => ({
  round: 1,
  actor: 'system',
  kind,
  label: kind,
  amount: 0,
  p: fighter('我方修士'),
  e: fighter('山魈'),
  ...patch,
});

test('compact formatter keeps major combat events and drops low-value system frames', () => {
  const kinds = ['heal', 'convert', 'rage', 'miss', 'strategy', 'phase', 'timeout', 'win', 'loss'];
  for (const kind of kinds) {
    const current = frame(kind, {
      actor: kind === 'rage' || kind === 'miss' ? 'p' : 'system',
      amount: kind === 'heal' ? 8 : 0,
      detail: kind === 'strategy' ? '条件尚未成熟，保留一轮满怒继续铺垫' : undefined,
    });
    const view = compactBattleFrame(current, undefined, context);
    assert.equal(view.visible, true, kind);
    assert.equal(view.kind, kind, kind);
  }

  for (const kind of ['start', 'build', 'ready', 'wait']) {
    const view = compactBattleFrame(frame(kind), undefined, context);
    assert.equal(view.visible, false, kind);
  }
});

test('compact formatter reports shield absorption, healing, and status changes from frame snapshots', () => {
  const before = frame('ready', {
    p: fighter('我方修士', { hp: 60, shield: 7, status: { burn: 2 } }),
    e: fighter('山魈', { status: { weak: 1 } }),
  });
  const damage = frame('damage', {
    actor: 'e',
    label: '爪击',
    amount: 0,
    breakdown: {
      base: 10,
      scaled: 10,
      afterDefense: 10,
      afterVulnerable: 10,
      afterBuild: 10,
      afterCrit: 10,
      absorbed: 10,
      hpLoss: 0,
    },
    p: fighter('我方修士', { hp: 60, shield: 0, status: { burn: 1 } }),
    e: fighter('山魈', { status: { weak: 2 } }),
  });
  const damageView = compactBattleFrame(damage, before, context);
  assert.equal(damageView.visible, true);
  assert.match(damageView.outcome, /护盾吸收 10/);
  assert.deepEqual(damageView.changes.find((change) => change.label === '护盾'), {
    side: 'p',
    label: '护盾',
    before: 7,
    after: 0,
    delta: -7,
  });
  assert.deepEqual(
    damageView.statuses.map(({ side, status, before: oldValue, after }) => ({ side, status, before: oldValue, after })),
    [
      { side: 'p', status: '燃烧', before: 2, after: 1 },
      { side: 'e', status: '虚弱', before: 1, after: 2 },
    ],
  );

  const heal = frame('heal', {
    actor: 'p',
    label: '回春',
    amount: 12,
    p: fighter('我方修士', { hp: 72 }),
  });
  const healView = compactBattleFrame(heal, before, context);
  assert.equal(healView.visible, true);
  assert.match(healView.outcome, /回复 12 生命/);
});

test('compact formatter gives side badges to player-owned system events', () => {
  const strategy = compactBattleFrame(frame('strategy', {
    sourceId: 'strategy.rage',
    label: '战策 · 怒海',
  }), undefined, context);
  assert.equal(strategy.actor, 'p');
  assert.equal(strategy.actorBadge, '我方');

  const phase = compactBattleFrame(frame('phase', {
    label: '第二阶段',
    detail: '生命降至 50% 阈值',
  }), undefined, context);
  assert.equal(phase.actor, 'system');
  assert.equal(phase.actorBadge, '天道');
});

test('battle contribution summary keeps non-attack output and labels zero-output sources', () => {
  const app = Object.create(FengshenGame.prototype);
  app.content = {
    abilities: [],
    talents: [],
    races: [],
    fates: [],
    labels: { facts: {} },
  };
  app.game = { s: { fate: 'fate.test' } };
  const html = app.battleContributions({
    contributions: {
      'aux.recovery': { damage: 0, heal: 12, shield: 8, rage: 3, conversions: 2, triggers: 1 },
      'aux.idle': { damage: 0, heal: 0, shield: 0, rage: 0, conversions: 0, triggers: 0 },
    },
  }, {
    sources: [
      { actor: 'p', id: 'aux.recovery', kind: 'ability', name: '回元法' },
      { actor: 'p', id: 'aux.idle', kind: 'ability', name: '静默法' },
    ],
  });
  assert.match(html, /全部来源/);
  assert.match(html, /回元法/);
  assert.match(html, /实际回复 12/);
  assert.match(html, /提供护盾 8/);
  assert.match(html, /获得怒气 3/);
  assert.match(html, /转化 2 次/);
  assert.match(html, /静默法/);
  assert.match(html, /本场无直接产出/);
});
