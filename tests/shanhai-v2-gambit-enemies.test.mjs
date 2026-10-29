import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent as loadYamlContent } from '../tools/content-kit/src/loader.mjs';
import { contentFromEntities } from '../build/shanhai/content.js';
import { calculateStats, simulateBattle } from '../build/shanhai/combat.js';

const START_METHODS = Object.freeze(['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05']);
const METHOD_BRANCHES = Object.freeze({
  RKF01: 'A', RKF02: 'B', RKF03: 'B', RKF04: 'C', RKF05: 'B',
});
const RR05_ENEMIES = Object.freeze([
  'EN-A1-L1', 'EN-A2-B2', 'EN-A2-L1', 'EN-A3-C2', 'EN-A3-L1', 'EN-A4-C4',
]);

async function loadGameContent() {
  // Read authored YAML directly so this test sees edits without rebuilding dist/content.
  const model = await loadYamlContent();
  assert.deepEqual(model.issues, []);
  return contentFromEntities(model.entities, model.manifest.content_version);
}

function referenceLoadouts(content, enemy, method) {
  const n = Math.min(4, Math.max(0, enemy.n));
  const player = {
    name: `第一幕参照-${method}`,
    method,
    n,
    talents: content.byId[method].talents
      .filter(talent => talent.tier <= n && talent.branch === METHOD_BRANCHES[method])
      .map(talent => talent.id),
    artifacts: [],
    baseStats: structuredClone(content.rules.cultivation.base_stats_by_tier[n]),
    preparation: 0,
    firstStrike: 0,
  };
  player.hp = calculateStats(content, player).max_hp;

  const target = {
    name: enemy.name,
    method: enemy.method,
    n: enemy.n,
    talents: structuredClone(enemy.talents ?? []),
    artifacts: structuredClone(enemy.artifacts ?? []),
    baseStats: structuredClone(enemy.stats),
    preparation: 0,
    firstStrike: 0,
  };
  target.hp = calculateStats(content, target).max_hp;
  return { player, target };
}

test('RR05 enemy previews expose its live gambit and each authored combat loop', async () => {
  const content = await loadGameContent();

  for (const id of RR05_ENEMIES) {
    const enemy = content.byId[id];
    assert.ok(enemy.counterplay.length >= 2, `${id} has two concrete counterplay choices`);
    assert.match(enemy.preview, /镇心玉先计入防御\+8再乘0\.5/, `${id} shows the defense penalty`);
    assert.match(enemy.preview, /自身直接与派生伤害×1\.6/, `${id} shows both damage kinds`);
    assert.match(enemy.preview, /每次自身普攻或怒技结束后攻击\+4，最多3层、从下次主动作起生效/, `${id} shows delayed attack stacks`);
  }

  assert.match(content.byId['EN-A1-L1'].preview, /J1-B.*每次普攻最多增加2层/);
  assert.match(content.byId['EN-A1-L1'].preview, /每柄现存飞剑各追加0\.18倍/);
  assert.match(content.byId['EN-A1-L1'].preview, /剑穗.*0\.45倍派生伤害/);

  assert.match(content.byId['EN-A2-B2'].preview, /最多消耗5层预存剑势/);
  assert.match(content.byId['EN-A2-B2'].preview, /每6次有效直接或派生命中释放4段/);
  assert.match(content.byId['EN-A2-B2'].preview, /每段0\.25倍/);

  assert.match(content.byId['EN-A2-L1'].preview, /J2-C.*实际回复气血的25%回怒/);
  assert.match(content.byId['EN-A2-L1'].preview, /行医囊.*完成行旅节点后.*不在战斗中治疗/);

  assert.match(content.byId['EN-A3-C2'].preview, /J1-B再回10/);
  assert.match(content.byId['EN-A3-C2'].preview, /J2-B每轮结束在公共回怒外再回10/);
  assert.match(content.byId['EN-A3-C2'].preview, /完成该普攻后额外回10怒/);

  assert.match(content.byId['EN-A3-L1'].preview, /J2-B至多消费5层已有剑势/);
  assert.match(content.byId['EN-A3-L1'].preview, /J3-C.*0\.45倍/);
  assert.match(content.byId['EN-A3-L1'].preview, /两层引气符每次普攻另回10怒/);

  assert.match(content.byId['EN-A4-C4'].preview, /J1-C提高22%，J4-B再提高30%/);
  assert.match(content.byId['EN-A4-C4'].preview, /J3-A.*每点怒气.*0\.012倍/);
  assert.match(content.byId['EN-A4-C4'].preview, /两层返气环.*合计返10怒/);
});

test('EN-F2 preview describes the capped RL04 opening and the 45-node ending', async () => {
  const content = await loadGameContent();
  const enemy = content.byId['EN-F2'];

  assert.ok(enemy.counterplay.length >= 2);
  assert.match(enemy.preview, /四幕各11个行旅节点.*第45个、也是唯一终战节点/);
  assert.match(enemy.preview, /开场追加50怒，但固定50点上限使入场仍为50怒，不会超过上限/);
  assert.match(enemy.preview, /首个怒技后尝试降低上限15，但启明玉的固定50上限优先、不再降低/);
  assert.doesNotMatch(enemy.preview, /开场额外回怒/);
  assert.match(enemy.preview, /J1-C只在长夜转白昼时回8怒/);
  assert.match(enemy.preview, /J2-B.*0\.26倍.*J3-B.*0\.12倍.*J4-B.*0\.38倍/);
});

test('EN-A1-L1 remains dangerous at realistic tier-one HP while the fixed samples stay viable', async () => {
  const content = await loadGameContent();
  const enemy = content.byId['EN-A1-L1'];
  assert.equal(enemy.stats.attack, 66);

  const results = new Map();
  for (const method of START_METHODS) {
    const { player, target } = referenceLoadouts(content, enemy, method);
    assert.equal(player.hp, 625, `${method} enters at the authored tier-one HP`);
    for (let seedIndex = 0; seedIndex < 5; seedIndex += 1) {
      const seed = `calibration-${enemy.id}-${method}-${seedIndex}`;
      const result = simulateBattle(content, player, target, seed, { roundLimit: 256 });
      assert.equal(result.outcome, 'player', `${enemy.id} / ${method} / ${seed}`);
      assert.ok(result.playerHp > 0, `${enemy.id} / ${method} / ${seed} survival`);
      results.set(`${method}-${seedIndex}`, result);
    }
  }

  // Before attack 82 -> 66, four of these 25 fixed samples died: RKF01 and RKF03
  // seeds 1 and 3. At attack 66 all 25 win; the hardest unchanged fixture starts
  // 625 vs 450 HP and ends round 5 at 28.6355 vs 0. This is fixture evidence only.
  const hardest = results.get('RKF01-1');
  const start = hardest.frames.find(frame => frame.kind === 'start');
  const end = hardest.frames.filter(frame => frame.kind === 'end').at(-1);
  assert.equal(start.player.hp, 625);
  assert.equal(start.enemy.hp, 450);
  assert.equal(hardest.rounds, 5);
  assert.equal(end.enemy.hp, 0);
  assert.ok(end.player.hp > 0 && end.player.hp < start.player.maxHp * 0.08,
    `low remaining HP ${end.player.hp} keeps this deterministic encounter threatening`);
  assert.ok(Math.abs(end.player.hp - 28.635555555555293) < 1e-8,
    'records the post-tune survivor HP for the fixed threatening seed');
});
