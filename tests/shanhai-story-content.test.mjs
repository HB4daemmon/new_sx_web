import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'tools/content-kit/package.json'));
const { parse } = require('yaml');
const contentRoot = join(root, 'content/shanhai');

function yaml(source) {
  return parse(source, { uniqueKeys: true, prettyErrors: true }) ?? {};
}

function yamlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) return yamlFiles(fullPath);
    return /\.ya?ml$/i.test(entry.name) ? [relative(root, fullPath)] : [];
  }).sort();
}

function readCurrent(file) {
  return yaml(readFileSync(join(root, file), 'utf8'));
}

const manifest = readCurrent('content/shanhai/manifest.yaml');
const entities = new Map(manifest.files.map(entry => [
  entry.id,
  readCurrent(`content/shanhai/${entry.path}`),
]));

test('story content preserves the 45-node shell and uses factual read-only endings', () => {
  assert.equal(entities.size, 154);
  for (const id of ['RA01', 'RA02', 'RA03', 'RA04']) {
    const act = entities.get(id);
    assert.equal(Object.values(act.node_budget).reduce((sum, count) => sum + count, 0), 11);
    assert.ok(act.routes.every(route => route.nodes.length === 11));
    assert.equal(act.story.no_core_requirement, true);
  }
  const final = entities.get('RF01');
  assert.deepEqual(final.node_budget, { F: 1 });
  assert.equal(final.story.completed_story_endings.source, 'completed_event_history');
  assert.equal(final.story.completed_story_endings.read_only, true);
  assert.deepEqual(final.story.completed_story_endings.grants, []);
});

test('all event options have a bounded story echo and all encounter branches have failure echoes', () => {
  const events = [...entities.values()].filter(entity => entity.kind === 'event');
  assert.equal(events.length, 52);

  const options = events.flatMap(event => event.options);
  assert.equal(options.length, 157);

  let encounterCount = 0;
  for (const option of options) {
    assert.equal(typeof option.story_echo, 'string', `${option.id} lacks story_echo`);
    assert.ok(option.story_echo.trim(), `${option.id} has an empty story_echo`);
    assert.ok([...option.story_echo].length <= 100, `${option.id} story_echo exceeds 100 characters`);
    if (!option.encounter) continue;

    encounterCount += 1;
    assert.equal(typeof option.story_failure_echo, 'string', `${option.id} lacks story_failure_echo`);
    assert.ok(option.story_failure_echo.trim(), `${option.id} has an empty story_failure_echo`);
    assert.ok(
      [...option.story_failure_echo].length <= 100,
      `${option.id} story_failure_echo exceeds 100 characters`,
    );
  }
  assert.equal(encounterCount, 21);
});

test('the four acts and final act have explicit motivations, outcomes, and one keyed variant per boss', () => {
  const acts = [...entities.values()].filter(entity => entity.kind === 'act');
  assert.equal(acts.length, 5);
  assert.deepEqual(
    acts.map(act => act.id).sort(),
    ['RA01', 'RA02', 'RA03', 'RA04', 'RF01'],
  );

  for (const act of acts) {
    const { story } = act;
    for (const field of ['goal', 'prelude', 'ordinary_route', 'boss_before', 'boss_after', 'passage', 'defeat']) {
      assert.equal(typeof story[field], 'string', `${act.id}.story.${field} is missing`);
      assert.ok(story[field].trim(), `${act.id}.story.${field} is empty`);
    }

    const candidateIds = act.index === 5
      ? act.pools.enemies.final_candidates
      : act.pools.enemies.boss_candidates;
    assert.deepEqual(
      Object.keys(story.boss_variants).sort(),
      [...candidateIds].sort(),
      `${act.id} needs exactly one keyed story variant for each boss candidate`,
    );
    for (const [enemyId, text] of Object.entries(story.boss_variants)) {
      assert.ok(typeof text === 'string' && text.trim(), `${act.id} has an empty variant for ${enemyId}`);
    }

    if (act.index === 5) {
      assert.equal(typeof story.victory, 'string', 'RF01 needs an explicit victory ending');
      assert.ok(story.victory.trim(), 'RF01.story.victory is empty');
    }
  }
});

test('nonlethal failure copy describes the configured HP floor without promising exactly one HP', () => {
  const exactOneHp = /(?:仅剩|只剩|剩余|只留)\s*1\s*点(?:\s*(?:气血|生命))?/u;
  const violations = [];

  for (const file of yamlFiles(join(contentRoot, 'events'))) {
    const event = readCurrent(file);
    const texts = [
      ['summary', event.summary],
      ['description', event.description],
      ['scene', event.scene],
      ...event.options.flatMap(option => [
        [`${option.id}.quick`, option.quick],
        [`${option.id}.outcome`, option.outcome],
        [`${option.id}.story_echo`, option.story_echo],
        [`${option.id}.story_failure_echo`, option.story_failure_echo],
        [`${option.id}.encounter.failure_outcome`, option.encounter?.failure_outcome],
      ]),
    ];
    for (const [field, text] of texts) {
      if (typeof text === 'string' && exactOneHp.test(text)) {
        violations.push(`${file}:${field}`);
      }
    }
  }

  for (const file of yamlFiles(join(contentRoot, 'storylines'))) {
    const line = readCurrent(file);
    for (const [field, text] of [
      ['summary', line.summary],
      ['description', line.description],
      ['premise', line.premise],
      ['commitment.text', line.commitment?.text],
      ['commitment.requirement', line.commitment?.requirement],
      ['commitment.cancellation', line.commitment?.cancellation],
      ['resolution.condition', line.resolution?.condition],
      ['resolution.reward_shape', line.resolution?.reward_shape],
      ['resolution.tradeoff', line.resolution?.tradeoff],
    ]) {
      if (typeof text === 'string' && exactOneHp.test(text)) violations.push(`${file}:${field}`);
    }
  }

  assert.equal(
    violations.length,
    0,
    `failure_hp_floor is a lower bound, not a guaranteed final HP value (${violations.length} claims):\n` +
      violations.slice(0, 12).join('\n'),
  );
});
