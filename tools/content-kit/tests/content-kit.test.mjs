import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { stringify } from 'yaml'

import {
  ARTIFACT_BASELINE,
  ARTIFACT_BUDGET,
  ARTIFACT_EQUIPMENT_ROLES,
  ARTIFACT_RARITIES,
  ARTIFACT_RESONANCE_RULES,
  CORE_ARTIFACT_RULES,
  CONTENT_VERSION,
  EXPECTED_MANIFEST_ENTRIES,
  METHOD_RARITIES,
  METHOD_P_BY_TIER,
  METHOD_RESONANCE_RULES,
  SCHEMA_VERSION,
  SHARED_INSIGHT_BUILD_RULES,
  SHARED_INSIGHT_IDS,
} from '../src/constants.mjs'
import { loadContent } from '../src/loader.mjs'
import {
  renderDocuments,
  writeDocuments,
  checkDocuments,
  GENERATED_HEADER,
  DOCUMENT_PATHS,
} from '../src/renderer.mjs'
import { validateContent, validateLoadedContent } from '../src/validator.mjs'
import { parseYaml } from '../src/yaml.mjs'

function common(id, kind, name = id) {
  return {
    schema_version: SCHEMA_VERSION,
    content_version: CONTENT_VERSION,
    kind,
    id,
    name,
    status: 'design_target',
    summary: `${name} 摘要`,
    description: `${name} 说明`,
    tags: ['fixture'],
    source: { basis: 'original', reference: null, note: 'fixture' },
    balance: { target: { B: 1 }, measured: null },
  }
}

function effect(id) {
  return {
    id,
    trigger: 'always',
    operation: 'modify_stat',
    target: 'self',
    params: { amount: 1 },
    requires: [],
    consumes: [],
    replaces: [],
    limit: { scope: 'action', count: 1 },
    text: 'fixture effect',
  }
}

function resonanceEffect(owner, rule) {
  const params = Object.fromEntries(Object.entries(rule.params).map(([key, range]) => [
    key,
    range.integer ? Math.max(1, range.min) : range.max === 1 ? 0.5 : range.min,
  ]))
  return {
    id: `${owner}-V2-RESONANCE`,
    trigger: 'always',
    operation: 'modify_effect',
    target: 'self',
    params: { resonance: rule.kind, ...params },
    requires: [],
    consumes: [],
    replaces: [],
    limit: { scope: 'permanent', count: 1 },
    text: 'fixture resonance',
  }
}

function sharedInsightEffect(id) {
  const rule = SHARED_INSIGHT_BUILD_RULES[id]
  if (!rule) {
    return {
      ...effect(`${id}-ATTACK`),
      params: { stat: 'attack', mode: 'percent_add', amount: 0.35 },
      limit: { scope: 'permanent', count: 1 },
    }
  }
  const params = Object.fromEntries(Object.entries(rule.params).map(([key, range]) => [
    key,
    range.integer ? range.min : range.min + (range.max - range.min) / 2,
  ]))
  return {
    ...effect(`${id}-BUILD`),
    operation: 'modify_effect',
    params: { build: rule.kind, ...params },
    limit: { scope: 'permanent', count: 1 },
  }
}

function makeEntities() {
  const entities = new Map()
  const rules = common('RULES', 'rules', '规则')
  Object.assign(rules, {
    attributes: ['attack', 'defense', 'max_hp', 'crit_rate', 'speed'],
    rarities: {
      common: { method_multiplier: 1, artifact_B: 1 },
      rare: { method_multiplier: 1.1, artifact_B: 2.4 },
      legendary: { method_multiplier: 1.25, artifact_B: 4 },
    },
    cultivation: { requirements: [120, 480, 600, 840] },
    combat: { observation_rounds: 15, direct_defense_constant: 100 },
    rage: { base_cap: 100, opening: 50 },
    statuses: { poison: { max_stacks: 10, duration_rounds: 3 } },
    adventure: { acts: 4, nodes_per_act: 11, terminal_nodes: 1, baseline: { C: 4, E: 3, L: 1, S: 1, R: 1, B: 1 } },
    economy: { initial_coins: 20 },
    pools: { common_artifact: { kind: 'artifact', rarity: 'common' } },
    calibration: { damage_and_status_values: 'fixture' },
      insights: SHARED_INSIGHT_IDS.map((id) => {
        const [, tier, branch] = id.match(/^V2-J([1-4])-([A-F])$/)
        return {
          id,
          tier: Number(tier),
          branch,
          name: '共享天赋',
          quick: '测试共享效果',
          category: 'enhance',
          effects: [sharedInsightEffect(id)],
        }
      }),
  })
  entities.set('RULES', rules)

  for (const entry of EXPECTED_MANIFEST_ENTRIES.filter((item) => item.kind === 'method')) {
    const entity = common(entry.id, 'method', entry.id)
    const rarity = METHOD_RARITIES[entry.id]
    Object.assign(entity, {
      rarity,
      role: 'fixture',
      stat_focus: 'attack',
      mechanic: null,
      acquisition: { start: rarity === 'common', pools: [rarity === 'common' ? 'method_common' : `method_${rarity}`] },
      actions: {
        basic: { name: '普攻', quick: '基础攻击', effects: [effect(`${entry.id}-BASIC`)] },
        rage: { name: '怒技', quick: '基础怒技', effects: [effect(`${entry.id}-RAGE`)] },
      },
      passives: [],
      travel: [],
      talents: Array.from({ length: 4 }, (_, tier) => ['A', 'B', 'C'].map((branch) => ({
        id: `${entry.id}-J${tier + 1}-${branch}`,
        tier: tier + 1,
        branch,
        name: '四字天赋',
        quick: '玩家摘要',
        category: 'enhance',
        effects: [],
      }))).flat(),
      routes: [
        { name: '路线一', summary: '路线', talents: [`${entry.id}-J1-A`, `${entry.id}-J2-A`, `${entry.id}-J3-A`, `${entry.id}-J4-A`] },
        { name: '路线二', summary: '路线', talents: [`${entry.id}-J1-B`, `${entry.id}-J2-B`, `${entry.id}-J3-B`, `${entry.id}-J4-B`] },
        { name: '路线三', summary: '路线', talents: [`${entry.id}-J1-C`, `${entry.id}-J2-C`, `${entry.id}-J3-C`, `${entry.id}-J4-C`] },
      ],
    })
    if (METHOD_RESONANCE_RULES[entry.id]) {
      entity.passives.push(resonanceEffect(entry.id, METHOD_RESONANCE_RULES[entry.id]))
    }
    entity.balance.target.P_by_tier = METHOD_P_BY_TIER.map((value) => value * ({ common: 1, rare: 1.1, legendary: 1.25 }[rarity]))
    entities.set(entry.id, entity)
  }

  for (const entry of EXPECTED_MANIFEST_ENTRIES.filter((item) => item.kind === 'artifact')) {
    const baseline = structuredClone(ARTIFACT_BASELINE[entry.id])
    const entity = common(entry.id, 'artifact', baseline.name)
    const rarity = ARTIFACT_RARITIES[entry.id]
    Object.assign(entity, {
      rarity,
      max_stacks: baseline.max_stacks,
      unique_group: entry.id === 'RL01' ? 'overflow_outlet' : null,
      equipment_role: ARTIFACT_EQUIPMENT_ROLES[entry.id],
      ...(CORE_ARTIFACT_RULES[entry.id] ? { core_rule: structuredClone(CORE_ARTIFACT_RULES[entry.id]) } : {}),
      attributes: { flat: baseline.flat, percent: baseline.percent },
      effects: ARTIFACT_RESONANCE_RULES[entry.id]
        ? [resonanceEffect(entry.id, ARTIFACT_RESONANCE_RULES[entry.id])]
        : [effect(`${entry.id}-EFFECT`)],
      acquisition: { pools: [`${rarity}_artifact`] },
    })
    entity.balance.target = { B: ARTIFACT_BUDGET[rarity], A: ARTIFACT_BUDGET[rarity] * 5, J: 0 }
    entities.set(entry.id, entity)
  }

  for (const entry of EXPECTED_MANIFEST_ENTRIES.filter((item) => item.kind === 'event')) {
    const core = entry.path.includes('/core/')
    const act = core && Number(entry.id.slice(2)) % 2 === 0 ? 2 : 1
    const entity = common(entry.id, 'event', entry.id)
    Object.assign(entity, {
      event_type: core ? 'core' : 'ordinary',
      acts: [act],
      scene: '场景',
      options: [
        { id: `${entry.id}-A`, label: '选择甲', quick: '安全选择', requirements: [], costs: [], rewards: [], outcome: '结果甲' },
        { id: `${entry.id}-B`, label: '选择乙', quick: '风险选择', requirements: [], costs: [], rewards: [], outcome: '结果乙' },
      ],
      settlement: { once: true, internal_battle_package: false, travel_triggers: 1, fallback: 'coins' },
    })
    entity.balance.target.gross_U = 0
    entities.set(entry.id, entity)
  }

  const coreIds = EXPECTED_MANIFEST_ENTRIES.filter((item) => item.kind === 'event' && item.path.includes('/core/')).map((item) => item.id)
  for (const [index, entry] of EXPECTED_MANIFEST_ENTRIES.filter((item) => item.kind === 'storyline').entries()) {
    const entity = common(entry.id, 'storyline', entry.id)
    Object.assign(entity, {
      character: '人物',
      premise: '前提',
      encounters: [coreIds[index * 2], coreIds[index * 2 + 1]],
      commitment: '承诺',
      resolution: '兑现',
      selection: { planned_per_run: 1, optional: true, fallback: 'ordinary_event' },
    })
    entities.set(entry.id, entity)
  }

  for (const entry of EXPECTED_MANIFEST_ENTRIES.filter((item) => item.kind === 'enemy')) {
    const final = entry.id.startsWith('EN-F')
    const entity = common(entry.id, 'enemy', entry.id)
    const tier = final ? 'final' : entry.id.includes('-C') ? 'normal' : entry.id.includes('-L') ? 'elite' : 'boss'
    Object.assign(entity, {
      acts: [final ? 5 : Number(entry.id.match(/A(\d)/)?.[1])],
      tier,
      identity: '敌人身份',
      method: 'RKF01',
      n: 0,
      talents: [],
      artifacts: [],
      stats: { attack: 100, defense: 100, max_hp: 500, crit_rate: 0.05, speed: 10 },
      pressure: ['直接攻击'],
      counterplay: ['保留护盾', '优先处理怒技'],
      preview: '战前公开预览',
      phases: [],
      reward_profile: final ? 'F' : tier === 'normal' ? 'C' : tier === 'elite' ? 'L' : 'B',
    })
    entities.set(entry.id, entity)
  }

  const route = {
    name: '稳健',
    nodes: ['C', 'E', 'C', 'R', 'E', 'S', 'C', 'E', 'C', 'L', 'B'],
  }
  for (const entry of EXPECTED_MANIFEST_ENTRIES.filter((item) => item.kind === 'act')) {
    const final = entry.id === 'RF01'
    const entity = common(entry.id, 'act', entry.id)
    Object.assign(entity, {
      index: final ? 5 : Number(entry.id.slice(2)),
      story: { goal: '推进主线' },
      node_budget: final ? { F: 1 } : { C: 4, E: 3, L: 1, S: 1, R: 1, B: 1 },
      routes: final ? [{ name: '终局', nodes: ['F'] }] : Array.from({ length: 6 }, (_, index) => ({ name: `路线${index + 1}`, nodes: [...route.nodes] })),
      pools: {},
      rewards: [],
      economy: {},
      cultivation: {},
      transition: {},
    })
    entities.set(entry.id, entity)
  }
  return entities
}

async function writeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'shanhai-content-kit-'))
  const entities = makeEntities()
  const manifest = {
    schema_version: SCHEMA_VERSION,
    content_version: CONTENT_VERSION,
    status: 'design_target',
    files: EXPECTED_MANIFEST_ENTRIES,
    counts: {
      methods: 10,
      artifacts: 44,
      ordinary_events: 36,
      core_events: 16,
      storylines: 6,
      act_enemies: 32,
      final_enemies: 2,
      acts: 5,
    },
  }
  await writeFile(path.join(root, 'manifest.yaml'), stringify(manifest), 'utf8')
  for (const entry of EXPECTED_MANIFEST_ENTRIES) {
    const entity = entities.get(entry.id)
    const filePath = path.join(root, ...entry.path.split('/'))
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, stringify(entity), 'utf8')
  }
  return { root, entities }
}

async function rewriteEntity(fixture, id, value) {
  const entry = EXPECTED_MANIFEST_ENTRIES.find((item) => item.id === id)
  const filePath = path.join(fixture.root, ...entry.path.split('/'))
  await writeFile(filePath, stringify(value), 'utf8')
}

async function reportFor(fixture) {
  return validateContent({ contentRoot: fixture.root, manifestPath: path.join(fixture.root, 'manifest.yaml') })
}

test('complete temporary fixture validates and renders the fixed 32 pages', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const report = await reportFor(fixture)
  assert.equal(report.ok, true, report.errors.map((error) => `${error.code}:${error.path}:${error.message}`).join('\n'))
  assert.equal(report.warnings.length, 1)
  const pages = renderDocuments(report)
  assert.deepEqual([...pages.keys()], DOCUMENT_PATHS)
  assert.equal(pages.size, 32)
  assert.ok(pages.get('INDEX.md').startsWith(GENERATED_HEADER))
  assert.match(pages.get('methods/RKF01.md'), /四字天赋/)
  assert.match(pages.get('enemies/FINAL.md'), /EN-F1/)
  assert.doesNotMatch(pages.get('methods/RKF01.md'), /schema_version:/)
})

test('event commitment schema is bounded and cannot be combined with an encounter', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const event = fixture.entities.get('RE001')
  const option = event.options[0]
  const commitment = {
    name: '护送药箱',
    after_nodes: 2,
    avoid_node_types: ['R'],
    rewards: [{ type: 'artifact', id: 'RC17', count: 2 }],
    success_outcome: '药箱送达，取得两层行医囊。',
    failure_outcome: '失约不退款，也没有行医囊。',
  }
  option.commitment = commitment
  option.requirements = [{ type: 'capacity', id: 'RC17', count: 2 }]
  await rewriteEntity(fixture, 'RE001', event)
  let report = await reportFor(fixture)
  assert.equal(report.ok, true, report.errors.map((error) => `${error.code}:${error.message}`).join('\n'))

  option.requirements = []
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'commitment-capacity'))

  option.requirements = [{ type: 'capacity', id: 'RC17', count: 2 }]
  option.commitment = { ...commitment, retry_reward: true }
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'commitment-fields'))

  option.commitment = commitment
  option.encounter = {
    enemy_id: 'EN-A1-C1',
    mode: 'nonlethal',
    failure_hp_floor: 1,
    failure_rewards: [],
    failure_outcome: '落败。',
  }
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'encounter-commitment'))

  delete option.encounter
  option.commitment = {
    ...commitment,
    after_nodes: 4,
    avoid_node_types: ['F'],
    rewards: [{ type: 'resource', resource: 'coins', amount: 4, basis: 'common_price' }],
  }
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'commitment-count'))
  assert.ok(report.errors.some((error) => error.code === 'commitment-nodes'))
  assert.ok(report.errors.some((error) => error.code === 'commitment-resource-basis'))
})

test('event story echoes are bounded and failure echoes require an encounter', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const event = structuredClone(fixture.entities.get('RE001'))
  const option = event.options[0]
  option.story_echo = '潮'.repeat(100)
  await rewriteEntity(fixture, 'RE001', event)
  let report = await reportFor(fixture)
  assert.equal(report.ok, true, report.errors.map((error) => `${error.code}:${error.message}`).join('\n'))

  option.encounter = {
    enemy_id: 'EN-A1-C1',
    mode: 'nonlethal',
    failure_hp_floor: 1,
    failure_rewards: [],
    failure_outcome: '挑战失败，停在一滴气血。',
  }
  option.story_failure_echo = '挑战失手，仅剩 1 点气血。'
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.equal(report.ok, true, report.errors.map((error) => `${error.code}:${error.message}`).join('\n'))

  option.story_echo = '潮'.repeat(101)
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'story-echo-length'))

  option.story_echo = ' '
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'story-echo'))

  option.story_echo = '有效的行迹。'
  delete option.encounter
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'story-failure-echo'))
})

test('event checks strictly validate both branches, bonus references, and reward fields', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const event = structuredClone(fixture.entities.get('RE001'))
  const option = event.options[0]
  option.story_echo = '成功行迹。'
  option.check = {
    kind: 'chance',
    hint: '把握机会。',
    chance: 0.4,
    bonuses: [
      { type: 'stat', stat: 'speed', threshold: 10, amount: 0.1 },
      { type: 'method', id: 'RKF01', amount: 0.1 },
      { type: 'artifact', id: 'RC01', amount: 0.1 },
    ],
    failure_rewards: [],
    failure_outcome: '没有成功。',
    failure_echo: '你未能成事，继续前行。',
  }
  await rewriteEntity(fixture, 'RE001', event)
  let report = await reportFor(fixture)
  assert.equal(report.ok, true, report.errors.map((error) => error.message).join('\n'))

  option.check.unknown = true
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'event-check-fields'))
  delete option.check.unknown
  const bonuses = option.check.bonuses
  delete option.check.bonuses
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.equal(report.ok, true, 'chance bonuses are optional')
  option.check.bonuses = bonuses

  option.check.bonuses[1].id = 'RKF99'
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'event-check-bonus-reference'))
  option.check.bonuses[1].id = 'RKF01'

  option.check.failure_rewards = [{ type: 'resource', resource: 'coins', amount: 1, basis: 'flat', hidden: true }]
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'event-check-failure-reward-fields'))
  option.check.failure_rewards = []
  option.check.failure_rewards = [{ type: 'pool', pool: 'common_artifact', count: 1 }]
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'event-check-failure-reward'))
  option.check.failure_rewards = []

  option.check.failure_echo = '迹'.repeat(101)
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'story-echo-length'))

  option.check.failure_echo = '你未能成事，继续前行。'
  option.encounter = {
    enemy_id: 'EN-A1-C1',
    mode: 'nonlethal',
    failure_hp_floor: 1,
    failure_rewards: [],
    failure_outcome: '挑战失败。',
  }
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'encounter-check'))
})

test('hint reveal keeps known costs visible while hiding concrete check branches', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const event = structuredClone(fixture.entities.get('RE001'))
  const option = event.options[0]
  option.label = '沿水搜寻'
  option.quick = '付出公开的灵石成本，依提示寻找物资。'
  option.costs = [{ type: 'resource', resource: 'coins', amount: 0.3, basis: 'common_price' }]
  option.rewards = [{ type: 'artifact', id: 'RC17', count: 1 }]
  option.outcome = '秘密成功结果不应提前展示。'
  option.story_echo = '秘密成功回声不应提前展示。'
  option.reveal = 'hint'
  option.check = {
    kind: 'stat',
    hint: '观察水痕。',
    stat: 'speed',
    threshold: 10,
    failure_rewards: [{ type: 'resource', resource: 'xp', amount: 0.1, basis: 'next_xp' }],
    failure_outcome: '秘密失败结果也应隐藏。',
    failure_echo: '秘密失败回声也应隐藏。',
  }
  await rewriteEntity(fixture, 'RE001', event)
  const report = await reportFor(fixture)
  assert.equal(report.ok, true, report.errors.map((error) => error.message).join('\n'))
  const page = renderDocuments(report).get('events/ACT1.md')
  assert.match(page, /成本：灵石 30%（普通法宝价格参照）/)
  assert.match(page, /选择前隐藏具体奖励与分支结果/)
  assert.match(page, /检定提示：观察水痕/)
  assert.doesNotMatch(page, /秘密成功结果|秘密成功回声|秘密失败结果|秘密失败回声|行医囊/)
})

test('artifact awakening and min_stacks are bounded to the owning artifact', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const artifact = structuredClone(fixture.entities.get('RC01'))
  artifact.awakening = { at_stacks: 5, name: '青锋觉醒', quick: '满层时额外触发一次。' }
  artifact.effects[0].min_stacks = 5
  await rewriteEntity(fixture, 'RC01', artifact)
  let report = await reportFor(fixture)
  assert.equal(report.ok, true, report.errors.map((error) => error.message).join('\n'))
  const page = renderDocuments(report).get('artifacts/COMMON.md')
  assert.match(page, /觉醒条件：集齐 5 层/)
  assert.match(page, /至少 5 层；触发时只生效一次，不随总层数重复/)

  artifact.awakening.at_stacks = 4
  artifact.effects[0].min_stacks = 6
  await rewriteEntity(fixture, 'RC01', artifact)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'artifact-awakening-stacks'))
  assert.ok(report.errors.some((error) => error.code === 'number-range'))

  const method = structuredClone(fixture.entities.get('RKF01'))
  method.actions.basic.effects[0].min_stacks = 1
  method.awakening = { at_stacks: 1, name: '无效', quick: '无效。' }
  await rewriteEntity(fixture, 'RKF01', method)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'effect-min-stacks-owner'))
  assert.ok(report.errors.some((error) => error.code === 'artifact-awakening-owner'))
})

test('V2 resonance effects enforce owner, location, exact shape, and parameter ranges', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  let report = await reportFor(fixture)
  assert.equal(report.ok, true, report.errors.map((error) => error.message).join('\n'))

  const guard = structuredClone(fixture.entities.get('RKF01'))
  const guardRule = guard.passives.find((item) => item.id === 'RKF01-V2-RESONANCE')
  guardRule.extra = true
  guardRule.params.unknown_ratio = 0.2
  guardRule.params.release_ratio = 1.01
  await rewriteEntity(fixture, 'RKF01', guard)

  const returningBreath = structuredClone(fixture.entities.get('RKF02'))
  returningBreath.passives = returningBreath.passives.filter((item) => item.id !== 'RKF02-V2-RESONANCE')
  await rewriteEntity(fixture, 'RKF02', returningBreath)

  const springBloom = structuredClone(fixture.entities.get('RKF03'))
  const bloomRule = springBloom.passives.find((item) => item.id === 'RKF03-V2-RESONANCE')
  bloomRule.params.threshold_hp_ratio = 0
  bloomRule.params.burst_hp_ratio = Number.NaN
  await rewriteEntity(fixture, 'RKF03', springBloom)

  const burnAccelerate = structuredClone(fixture.entities.get('RKF04'))
  burnAccelerate.passives.find((item) => item.id === 'RKF04-V2-RESONANCE').params.resonance = 'unknown_kind'
  await rewriteEntity(fixture, 'RKF04', burnAccelerate)

  const swordArray = structuredClone(fixture.entities.get('RKF05'))
  swordArray.talents[0].effects = [structuredClone(swordArray.passives.find((item) => item.id === 'RKF05-V2-RESONANCE'))]
  await rewriteEntity(fixture, 'RKF05', swordArray)

  const induction = structuredClone(fixture.entities.get('RKF07'))
  const inductionRule = induction.passives.find((item) => item.id === 'RKF07-V2-RESONANCE')
  inductionRule.params.hit_threshold = 0
  inductionRule.params.max_per_action = 1.5
  await rewriteEntity(fixture, 'RKF07', induction)

  const moonHex = structuredClone(fixture.entities.get('RKF08'))
  moonHex.passives.find((item) => item.id === 'RKF08-V2-RESONANCE').id = 'RKF07-V2-RESONANCE'
  await rewriteEntity(fixture, 'RKF08', moonHex)

  const unownedRule = structuredClone(fixture.entities.get('RKF06'))
  unownedRule.passives.push(resonanceEffect('RKF06', METHOD_RESONANCE_RULES.RKF01))
  await rewriteEntity(fixture, 'RKF06', unownedRule)

  const missingArtifactParameter = structuredClone(fixture.entities.get('RR04'))
  delete missingArtifactParameter.effects[0].params.attack_ratio
  await rewriteEntity(fixture, 'RR04', missingArtifactParameter)

  const negativeArtifactParameter = structuredClone(fixture.entities.get('RR09'))
  negativeArtifactParameter.effects[0].params.rage_gain = -1
  await rewriteEntity(fixture, 'RR09', negativeArtifactParameter)

  const fractionalRage = structuredClone(fixture.entities.get('RR11'))
  fractionalRage.effects[0].params.rage_gain = 8.5
  await rewriteEntity(fixture, 'RR11', fractionalRage)

  report = await reportFor(fixture)
  const codes = new Set(report.errors.map((error) => error.code))
  for (const code of [
    'resonance-effect-fields',
    'resonance-params',
    'number-range',
    'invalid-number',
    'resonance-count',
    'resonance-kind',
    'resonance-location',
    'invalid-integer',
    'resonance-effect-id',
    'resonance-owner',
  ]) {
    assert.ok(codes.has(code), `expected ${code}; received ${[...codes].join(', ')}`)
  }
})

test('V2 roles, core rules, and shared insight sources/effects are strict', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const core = structuredClone(fixture.entities.get('RC09'))
  core.equipment_role = 'support'
  core.core_rule.extra = true
  core.core_rule.ratio = Number.NaN
  await rewriteEntity(fixture, 'RC09', core)

  const rules = structuredClone(fixture.entities.get('RULES'))
  rules.insights[0].id = 'RKF01-J1-A'
  rules.insights[1].tier = 2
  rules.insights[2].effects[0].params.speed_bonus = Number.NaN
  rules.insights[3].effects[0].params.hidden_bonus = 1
  rules.insights[4].effects[0].surprise = true
  rules.insights[5].effects[0].params.build = 'unrestricted'
  await rewriteEntity(fixture, 'RULES', rules)

  const report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'artifact-equipment-role'))
  assert.ok(report.errors.some((error) => error.code === 'artifact-core-rule-fields'))
  assert.ok(report.errors.some((error) => error.code === 'invalid-number'))
  assert.ok(report.errors.some((error) => error.code === 'insight-source'))
  assert.ok(report.errors.some((error) => error.code === 'insight-effect-params'))
  assert.ok(report.errors.some((error) => error.code === 'insight-effect-fields'))
  assert.ok(report.errors.some((error) => error.code === 'insight-effect-build'))
})

test('shared build effects accept the restricted schema and reject out-of-range or unknown params', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  let report = await reportFor(fixture)
  assert.equal(report.ok, true, report.errors.map((error) => error.message).join('\n'))

  const rules = structuredClone(fixture.entities.get('RULES'))
  rules.insights[0].effects[0].params.scale = 5.1
  rules.insights[0].effects[0].params.hidden = 1
  await rewriteEntity(fixture, 'RULES', rules)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'number-range'))
  assert.ok(report.errors.some((error) => error.code === 'insight-effect-params'))
})

test('enemy equipment allows any role mix up to four total artifacts', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const enemy = structuredClone(fixture.entities.get('EN-A1-C1'))
  enemy.artifacts = [
    { id: 'RC09', stacks: 1 },
    { id: 'RC10', stacks: 1 },
    { id: 'RC01', stacks: 1 },
    { id: 'RC02', stacks: 1 },
  ]
  await rewriteEntity(fixture, enemy.id, enemy)
  let report = await reportFor(fixture)
  assert.equal(report.ok, true, report.errors.map((error) => error.message).join('\n'))

  enemy.artifacts.push({ id: 'RC03', stacks: 1 })
  await rewriteEntity(fixture, enemy.id, enemy)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'enemy-equipment-count'))
})

test('missing files are errors and are not silently skipped', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const missing = path.join(fixture.root, 'methods', 'RKF01.yaml')
  await rm(missing)
  const report = await reportFor(fixture)
  assert.equal(report.ok, false)
  assert.ok(report.errors.some((error) => error.code === 'missing' && error.path === 'methods/RKF01.yaml'))
  assert.ok(report.errors.some((error) => error.code === 'missing-entity' && error.path === 'RKF01'))
})

test('duplicate keys, aliases, tags and non-finite values are rejected', () => {
  assert.throws(() => parseYaml('a: 1\na: 2\n', 'duplicate.yaml'), /unique|duplicate/i)
  assert.throws(() => parseYaml('a: &x 1\nb: *x\n', 'alias.yaml'), /anchor|alias/i)
  assert.throws(() => parseYaml('a: !!str 1\n', 'tag.yaml'), /tag/i)
  assert.equal(Number.isNaN(parseYaml('a: .nan\n', 'nan.yaml').a), true)
})

test('validator catches four-character names, invalid references and non-finite artifact values', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const method = structuredClone(fixture.entities.get('RKF01'))
  method.talents[0].name = '三字'
  await rewriteEntity(fixture, 'RKF01', method)
  const artifact = structuredClone(fixture.entities.get('RC01'))
  artifact.attributes.flat.attack = Number.NaN
  await rewriteEntity(fixture, 'RC01', artifact)
  const event = structuredClone(fixture.entities.get('RE001'))
  event.options[0].rewards = [{ type: 'artifact', id: 'NOPE', count: 1 }]
  await rewriteEntity(fixture, 'RE001', event)
  const report = await reportFor(fixture)
  assert.equal(report.ok, false)
  assert.ok(report.errors.some((error) => error.code === 'talent-name'))
  assert.ok(report.errors.some((error) => error.code === 'invalid-number' || error.code === 'artifact-value'))
  assert.ok(report.errors.some((error) => error.code === 'reward-reference'))
})

test('validator catches duplicate entity/effect ids and dangling local replacements', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const duplicateEntity = structuredClone(fixture.entities.get('RKF02'))
  duplicateEntity.id = 'RKF01'
  await rewriteEntity(fixture, 'RKF02', duplicateEntity)
  const duplicateEffect = structuredClone(fixture.entities.get('RC01'))
  duplicateEffect.effects[0].id = 'RKF01-BASIC'
  await rewriteEntity(fixture, 'RC01', duplicateEffect)
  const danglingReplace = structuredClone(fixture.entities.get('RKF01'))
  danglingReplace.actions.basic.effects[0].replaces = ['RKF01-MISSING']
  await rewriteEntity(fixture, 'RKF01', danglingReplace)
  const report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'duplicate-id'))
  assert.ok(report.errors.some((error) => error.code === 'duplicate-effect-id'))
  assert.ok(report.errors.some((error) => error.code === 'effect-replaces'))
})

test('validator catches blood-price, capacity, enemy stack, and final reward boundaries', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const event = structuredClone(fixture.entities.get('RE001'))
  event.options[0].costs = [{ type: 'resource', resource: 'hp', amount: 0.1, basis: 'reference_hp', must_survive: false }]
  event.options[0].rewards = [{ type: 'artifact', id: 'RC01', count: 2 }]
  await rewriteEntity(fixture, 'RE001', event)
  const enemy = structuredClone(fixture.entities.get('EN-A1-C1'))
  enemy.artifacts = [{ id: 'RC01', stacks: 99 }]
  await rewriteEntity(fixture, 'EN-A1-C1', enemy)
  const final = structuredClone(fixture.entities.get('EN-F1'))
  final.rewards = [{ type: 'resource', resource: 'coins', amount: 1, basis: 'flat' }]
  await rewriteEntity(fixture, 'EN-F1', final)
  const finalAct = structuredClone(fixture.entities.get('RF01'))
  finalAct.rewards = [{ type: 'resource', resource: 'coins', amount: 1, basis: 'flat' }]
  await rewriteEntity(fixture, 'RF01', finalAct)
  const report = await reportFor(fixture)
  assert.equal(report.ok, false)
  assert.ok(report.errors.some((error) => error.code === 'blood-price'))
  assert.ok(report.errors.some((error) => error.code === 'capacity'))
  assert.ok(report.errors.some((error) => error.code === 'enemy-artifact-stacks'))
  assert.ok(report.errors.some((error) => error.code === 'enemy-reward'))
  assert.ok(report.errors.some((error) => error.code === 'final-rewards'))
})

test('owned_artifact is distinct from capacity and encounters are option-scoped', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const event = structuredClone(fixture.entities.get('RE001'))
  event.options[0].requirements = [{ type: 'owned_artifact', id: 'RC07', count: 1 }]
  await rewriteEntity(fixture, 'RE001', event)
  let report = await reportFor(fixture)
  assert.equal(report.ok, true, report.errors.map((error) => error.message).join('\n'))

  event.encounter = {
    enemy_id: 'EN-A1-C1',
    mode: 'nonlethal',
    failure_hp_floor: 1,
    failure_rewards: [],
    failure_outcome: '失败',
  }
  await rewriteEntity(fixture, 'RE001', event)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'encounter-location'))
})

test('loader rejects empty content files', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  await writeFile(path.join(fixture.root, 'rules', 'RULES.yaml'), '\n', 'utf8')
  const model = await loadContent({ contentRoot: fixture.root, manifestPath: path.join(fixture.root, 'manifest.yaml') })
  assert.ok(model.issues.some((issue) => issue.code === 'empty' && issue.path === 'rules/RULES.yaml'))
  assert.equal(validateLoadedContent(model).ok, false)
})

test('renderer structures mappings, expands talent and event effects, and keeps option encounters readable', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))

  const method = structuredClone(fixture.entities.get('RKF01'))
  method.mechanic = { name: '护盾', max_stacks: 3, duration: 'battle' }
  method.stat_focus = { primary: 'defense', secondary: ['attack', 'max_hp'] }
  method.talents[0].effects = [effect('RKF01-J1-A-DETAIL')]
  method.travel = [effect('RKF01-TRAVEL-DETAIL')]
  await rewriteEntity(fixture, 'RKF01', method)

  const event = structuredClone(fixture.entities.get('RK001'))
  event.options[0].encounter = {
    enemy_id: 'EN-A1-C1',
    mode: 'nonlethal',
    victory_condition: '击败敌人后保留事件选项奖励',
    failure_hp_floor: 1,
    failure_rewards: [],
    failure_outcome: '挑战失败，停在一滴气血，不发奖励。',
  }
  event.options[0].story_echo = '胜利后拿到机缘，继续上路。'
  event.options[0].story_failure_echo = '试炼失手，仅剩 1 点气血。'
  await rewriteEntity(fixture, 'RK001', event)

  const storyline = structuredClone(fixture.entities.get('RS01'))
  storyline.commitment = {
    id: 'RS01-promised',
    form: 'resource_reserve',
    text: '留下灵石并取得回访资格。',
  }
  storyline.resolution = {
    condition: '完成第二次相遇',
    reward_shape: '胜利取得法宝。',
  }
  await rewriteEntity(fixture, 'RS01', storyline)

  const report = await reportFor(fixture)
  assert.equal(report.ok, true, report.errors.map((error) => error.message).join('\n'))
  const pages = renderDocuments(report)
  const methodPage = pages.get('methods/RKF01.md')
  const eventPage = pages.get('events/ACT1.md')
  const storylinePage = pages.get('storylines/RS01.md')
  assert.match(methodPage, /专属机制：名称=护盾；最大层数=3；持续范围=battle/)
  assert.match(methodPage, /RKF01-J1-A-DETAIL/)
  assert.match(methodPage, /参数：数量=1/)
  assert.match(methodPage, /行旅效果开发详情/)
  assert.match(eventPage, /内部挑战：EN-A1-C1/)
  assert.match(eventPage, /胜利条件：击败敌人后保留事件选项奖励/)
  assert.match(eventPage, /失败血线：1/)
  assert.match(eventPage, /成功行迹：胜利后拿到机缘，继续上路。/)
  assert.match(eventPage, /失败行迹：试炼失手，仅剩 1 点气血。/)
  assert.match(storylinePage, /第1次/)
  assert.match(storylinePage, /选择甲/)
  assert.match(storylinePage, /承诺：标识=RS01-promised/)
  assert.doesNotMatch(methodPage, /\[object Object\]|undefined|<br\s*\/?>/)
  assert.doesNotMatch(eventPage, /\[object Object\]|undefined|<br\s*\/?>/)
  assert.doesNotMatch(storylinePage, /\[object Object\]|undefined|<br\s*\/?>/)
})

test('rules and acts pages expose structured core content without treating prose as status rows', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))

  const rules = structuredClone(fixture.entities.get('RULES'))
  rules.statuses.cleanup = '战斗结束清除所有战斗状态。'
  rules.statuses.dot_snapshot = '持续伤害读取施加时快照。'
  await rewriteEntity(fixture, 'RULES', rules)

  const act = structuredClone(fixture.entities.get('RA01'))
  act.story = {
    goal: '穿过潮口',
    before: '幕前短句',
    after_battle: '普通战后短句',
    boss_before: '首领前短句',
    boss_after: '首领后短句',
    defeat: '未能越过潮门。',
    victory: '逆流暂时退去。',
    battle_after: { common: '普通战后回声。' },
    boss_variants: { 'EN-A1-B1': '遗影退去，石阶显露。' },
    runtime_extension: { note: true },
  }
  act.rewards = [{ type: 'artifact', id: 'RC01', count: 1 }]
  act.pools = { common_battles: ['EN-A1-C1'], ordinary_events: ['RE001'] }
  act.economy = { store: '公开商店', rest: '休整恢复', event_reward: '事件奖励' }
  act.cultivation = { xp: 120, threshold: '下一次突破门槛' }
  act.transition = { next_act: 'RA02', interlude: '幕间文案' }
  await rewriteEntity(fixture, 'RA01', act)

  const report = await reportFor(fixture)
  assert.equal(report.ok, true, report.errors.map((error) => error.message).join('\n'))
  const pages = renderDocuments(report)
  const rulesPage = pages.get('RULES.md')
  const actsPage = pages.get('ACTS.md')
  assert.match(rulesPage, /战斗结束清除所有战斗状态/)
  assert.doesNotMatch(rulesPage, /\|\s*cleanup\s*\|/)
  assert.match(actsPage, /普通战后短句/)
  assert.match(actsPage, /首领后短句/)
  assert.match(actsPage, /未能越过潮门。/)
  assert.match(actsPage, /逆流暂时退去。/)
  assert.match(actsPage, /青锋石/)
  assert.match(actsPage, /公开商店/)
  assert.match(actsPage, /下一次突破门槛/)
  assert.match(actsPage, /幕间文案/)
  assert.doesNotMatch(actsPage, /\[object Object\]|undefined/)

  act.story.victory = false
  await rewriteEntity(fixture, 'RA01', act)
  const invalidStoryReport = await reportFor(fixture)
  assert.ok(invalidStoryReport.errors.some((error) => error.code === 'act-story-string'))
})

test('document writes preserve unknown files and docs:check detects fixed-page drift and symlinks', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))
  const report = await reportFor(fixture)
  assert.equal(report.ok, true)
  const pages = renderDocuments(report)

  const outputRoot = await mkdtemp(path.join(tmpdir(), 'shanhai-content-pages-'))
  t.after(() => rm(outputRoot, { recursive: true, force: true }))
  await writeFile(path.join(outputRoot, 'keep.txt'), 'keep this file', 'utf8')
  await writeDocuments(pages, { outputRoot })
  assert.equal(await readFile(path.join(outputRoot, 'keep.txt'), 'utf8'), 'keep this file')
  await checkDocuments(pages, { outputRoot })

  const drifted = new Map(pages)
  drifted.set('INDEX.md', `${pages.get('INDEX.md')}drift`)
  await assert.rejects(checkDocuments(drifted, { outputRoot }), /drift: INDEX\.md/)

  const linkedRoot = `${outputRoot}-link`
  t.after(() => rm(linkedRoot, { force: true }))
  await symlink(outputRoot, linkedRoot, 'dir')
  await assert.rejects(writeDocuments(pages, { outputRoot: linkedRoot }), /symlink output path/)
})

test('validator rejects numeric-looking strings, unowned phase sources, extra route elites, and final economy loopholes', async (t) => {
  const fixture = await writeFixture()
  t.after(() => rm(fixture.root, { recursive: true, force: true }))

  const method = structuredClone(fixture.entities.get('RKF01'))
  method.actions.basic.effects[0].params.attack_ratio = '0.95'
  await rewriteEntity(fixture, 'RKF01', method)
  let report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'invalid-number'))

  const enemy = structuredClone(fixture.entities.get('EN-A1-C1'))
  enemy.phases = [{ name: '未授权阶段', source: 'RKF02-BASIC' }]
  await rewriteEntity(fixture, 'EN-A1-C1', enemy)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'enemy-phase-source'))

  const act = structuredClone(fixture.entities.get('RA01'))
  act.routes[0].nodes = ['EN-A1-L1', 'EN-A1-L2', 'EN-A1-L1', 'C', 'E', 'C', 'R', 'E', 'C', 'L', 'B']
  await rewriteEntity(fixture, 'RA01', act)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'route-elite-count'))

  const finalAct = structuredClone(fixture.entities.get('RF01'))
  finalAct.economy = { store: [], preparation: { shield: 0.1 } }
  await rewriteEntity(fixture, 'RF01', finalAct)
  report = await reportFor(fixture)
  assert.ok(report.errors.some((error) => error.code === 'final-economy'))
})
