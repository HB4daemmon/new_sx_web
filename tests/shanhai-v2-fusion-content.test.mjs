import assert from 'node:assert/strict';
import test from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';
import { renderDocuments } from '../tools/content-kit/src/renderer.mjs';
import { ARTIFACT_FUSION_RECIPES, ARTIFACT_FUSION_RULES } from '../tools/content-kit/src/constants.mjs';

const content = await loadContent();
assert.deepEqual(content.issues, []);
const byId = new Map(content.entities.map(entity => [entity.id, entity]));
const legendaryPage = renderDocuments(content).get('artifacts/LEGENDARY.md');

test('the four new recipes use distinct input layers and stay out of random acquisition', () => {
  const expected = {
    RL10: ['RC03', 'RC11'],
    RL11: ['RC05', 'RC12'],
    RL12: ['RC07', 'RC10'],
    RL13: ['RC18', 'RC19'],
  };
  const allInputs = [];

  for (const [id, inputs] of Object.entries(expected)) {
    const artifact = byId.get(id);
    assert.ok(artifact, `${id} exists in the explicit manifest`);
    assert.deepEqual(ARTIFACT_FUSION_RECIPES[id].inputs, inputs);
    assert.deepEqual(artifact.fusion_recipe, { inputs, fights: 2 });
    assert.deepEqual(artifact.fusion_rule, ARTIFACT_FUSION_RULES[id]);
    assert.deepEqual(artifact.acquisition.pools, []);
    assert.equal(artifact.max_stacks, 1);
    assert.equal(artifact.status, 'design_target');
    assert.equal(artifact.balance.measured, null);
    assert.deepEqual(artifact.attributes, { flat: {}, percent: {} });
    assert.deepEqual(artifact.effects, []);
    assert.equal(artifact.equipment_role, id === 'RL13' ? 'support' : 'core');
    allInputs.push(...inputs);
  }

  const priorInputs = [
    ...ARTIFACT_FUSION_RECIPES.RL06.inputs,
    ...ARTIFACT_FUSION_RECIPES.RL07.inputs,
  ];
  assert.equal(new Set(allInputs).size, allInputs.length, 'new and old recipes do not reuse ingredients');
  assert.equal(allInputs.some(id => priorInputs.includes(id)), false,
    'the four new material pairs do not reuse RL06 or RL07 ingredients');
  assert.deepEqual(new Set(allInputs), new Set(['RC03', 'RC11', 'RC05', 'RC12', 'RC07', 'RC10', 'RC18', 'RC19']));
});

test('rendered legendary rules state the combat caps, trigger limits, victory coins and mirror behavior', () => {
  assert.match(legendaryPage, /### 铁壁神铳[\s\S]*炮势最多储存自身最大气血的30%[\s\S]*每个主动作至多轰击一次[\s\S]*伤害不再生成炮势/);
  assert.match(legendaryPage, /### 玉液回天壶[\s\S]*有效治疗与溢疗分别按实际数值1:1[\s\S]*最多储存自身最大气血的50%[\s\S]*达到最大气血20%/);
  assert.match(legendaryPage, /### 天机落雷箓[\s\S]*直接暴击[\s\S]*攻击0\.65倍[\s\S]*返还10点怒气[\s\S]*至多触发一次/);
  assert.match(legendaryPage, /### 万金聚灵炉[\s\S]*最多按1000枚计[\s\S]*灵石×0\.0005[\s\S]*最高1\.5倍[\s\S]*额外获得12枚灵石[\s\S]*不会被昆仑镜镜映或铭刻复制/);
  assert.match(byId.get('RL13').description, /事件战斗/);
  assert.match(byId.get('RL13').description, /同一场只结算一次/);
});
