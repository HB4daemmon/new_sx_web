import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parse } from 'acorn';
import { collectAndWriteCatalog, collectCatalog } from '../lib/collect.mjs';
import { extractReferenceData, readStaticLiteral } from '../lib/extract.mjs';
import { validateCatalog } from '../lib/validate.mjs';

const talent = (gameType, visible = true) => ({
  id: 1,
  name: `天赋-${gameType}`,
  gameType,
  type: 'talent',
  typeName: '天赋牌',
  quality: 1,
  description: 'source description',
  cardGetDescription: '',
  visibleOnOfficialSite: visible,
  keywords: [],
  labels: [],
  talentStageDescription: '',
  previewCards: gameType === 'wanxiang'
    ? [{ id: 11, name: '英雄一', type: 1, quality: 1, description: '引用描述', image: 'https://static.datatft.com/ref.png' }]
    : [],
  sourceCards: [],
});

const commander = {
  id: 'commander-r1',
  lordId: 10,
  roleIndex: 1,
  name: '小妲己',
  quote: '原始引言',
  sections: [{
    type: '技能',
    level: 1,
    entries: [{
      id: 22,
      name: '技能牌',
      description: '技能描述',
      cardImage: 'https://static.datatft.com/skill.png',
    }],
  }],
  relatedCards: [{
    id: 22,
    name: '技能牌',
    description: '技能描述',
    cardImage: 'https://static.datatft.com/skill.png',
  }, 9099],
};

function arrayLiteral(values) {
  return JSON.stringify(values).replaceAll('"', "'");
}

function buildSeoSource({ duplicateModeTalent = false } = {}) {
  const talents = [talent('wanxiang'), talent('diamond', false)];
  if (duplicateModeTalent) talents.push(talent('wanxiang'));
  const commanders = [commander];
  const relatedCards = [{
    id: 11,
    name: '英雄一',
    gameType: 'wanxiang',
    type: 'hero',
    typeName: '英雄牌',
    quality: 1,
    description: '完整来源描述',
  }];
  return [
    `const talentData = ${arrayLiteral(talents)};`,
    `const commanderData = ${arrayLiteral(commanders)};`,
    `const cardData = ${arrayLiteral(relatedCards)};`,
  ].join('\n');
}

function buildFixture() {
  const html = '<!doctype html><script type="module" crossorigin src="/assets/index-fixture.js"></script>';
  const sources = new Map([
    ['https://www.datawxq.com/assets/index-fixture.js', `
      import("./app-fixture.js");
      const preload = ["assets/catalog-fixture.js", "assets/admin-panel.js"];
      const ignored = ["https://elsewhere.example/assets/secret.js", "/admin/private.js"];
    `],
    ['https://www.datawxq.com/assets/app-fixture.js', 'export const app = true;'],
    ['https://www.datawxq.com/assets/catalog-fixture.js', buildSeoSource()],
  ]);
  return { html, sources };
}

function responseFor(url, fixture) {
  if (url === 'https://www.datawxq.com/lineups' || url === 'https://www.datawxq.com/database') {
    return new Response(fixture.html, { status: 200, headers: { 'content-type': 'text/html' } });
  }
  if (fixture.sources.has(url)) {
    return new Response(fixture.sources.get(url), { status: 200, headers: { 'content-type': 'text/javascript' } });
  }
  return new Response('missing', { status: 404 });
}

function readArrayExpression(source) {
  const ast = parse(`const value = ${source};`, { ecmaVersion: 'latest' });
  return ast.body[0].declarations[0].init;
}

test('literal reader supports primitive literals and safe unary operators', () => {
  const value = readStaticLiteral(readArrayExpression(`[
    { id: -3, quality: +2, visible: !0, hidden: !1, absent: null, label: '字面值' },
    { values: [true, false, 0, 1.5, 'text'] }
  ]`));
  assert.equal(value[0].id, -3);
  assert.equal(value[0].quality, 2);
  assert.equal(value[0].visible, true);
  assert.equal(value[0].hidden, false);
  assert.equal(value[0].absent, null);
  assert.deepEqual(value[1].values, [true, false, 0, 1.5, 'text']);
  assert.equal(Object.getPrototypeOf(value[0]), null);
});

test('literal reader rejects executable expressions, computed keys, spreads, and prototype keys', () => {
  for (const expression of [
    '[run()]',
    '[...records]',
    '[{ [key]: 1 }]',
    '[{ get value() { return 1 } }]',
    '[{ __proto__: { polluted: true } }]',
    '[{ constructor: 1 }]',
    '[{ prototype: 1 }]',
    '[1e400]',
  ]) {
    assert.throws(() => readStaticLiteral(readArrayExpression(expression)));
  }
  assert.equal({}.polluted, undefined);
});

test('candidate data arrays reject calls, dangerous keys, and truncation', () => {
  const base = `{
    id: 1, name: '天赋', gameType: 'wanxiang', type: 'talent', typeName: '天赋牌',
    quality: 1, description: '', cardGetDescription: '', visibleOnOfficialSite: true,
    keywords: [], labels: [], talentStageDescription: '', previewCards: [], sourceCards: []
  }`;
  assert.throws(() => extractReferenceData(`const talents = [${base.replace("description: ''", 'description: danger()')}];`),
    /Unsafe or non-literal data array/);
  assert.throws(() => extractReferenceData(`const talents = [${base.slice(0, -1)}, __proto__: {} }];`),
    /Unsafe or non-literal data array/);
  assert.throws(() => extractReferenceData(`const talents = [${base}`), /Could not parse/);
});

test('detected records missing required fields and malformed arrays fail validation', () => {
  assert.throws(() => extractReferenceData(`const talents = [{ id: 1, type: 'talent' }];`),
    /incomplete or contains an invalid record/);
  assert.throws(() => extractReferenceData(`const commanders = [{ id: 'commander-missing', lordId: 1, roleIndex: 1, name: '缺分节' }];`),
    /incomplete or contains an invalid record/);
  assert.throws(() => extractReferenceData(`const commanders = [{ id: 'commander-empty', lordId: 1, roleIndex: 1, name: '空分节', sections: null }];`),
    /incomplete or contains an invalid record/);
  assert.throws(() => extractReferenceData(`const cards = [{ id: 2, name: '英雄', gameType: 'wanxiang', type: 'hero', description: execute() }];`),
    /Unsafe or non-literal related card/);
});

test('collector follows bounded same-origin bundles and records source hashes', async () => {
  const fixture = buildFixture();
  const requests = [];
  const catalog = await collectCatalog({
    fetchImpl: async (url) => {
      requests.push(url);
      return responseFor(url, fixture);
    },
    now: () => new Date('2026-10-26T12:00:00.000Z'),
  });

  assert.equal(catalog.talents.length, 2);
  assert.equal(catalog.commanders.length, 1);
  assert.deepEqual(catalog.metadata.counts.talents_by_mode, { wanxiang: 1, diamond: 1 });
  assert.deepEqual(catalog.metadata.counts.talents_by_quality, { '1': 2, '2': 0, '3': 0 });
  assert.deepEqual(catalog.metadata.counts.talents_by_official_visibility, { visible: 1, hidden: 1 });
  assert.equal(catalog.metadata.coverage.talents.includes_hidden, true);
  assert.equal(catalog.metadata.coverage.linked_cards.full_records, 1);
  assert.equal(catalog.metadata.coverage.linked_cards.reference_ids, 3);
  assert.deepEqual(catalog.metadata.coverage.linked_cards.unresolved.map((item) => item.id), [9099]);
  assert.deepEqual({ ...catalog.commanders[0].sections[0].entries[0] }, commander.sections[0].entries[0]);
  assert(catalog.related_cards.some((card) => card.id === 11 && card.type === 'hero'));
  assert(catalog.related_cards.some((card) => card.id === 11 && card.type === 1));

  const assets = catalog.metadata.source_assets;
  assert.deepEqual(assets.map((asset) => asset.url), [
    'https://www.datawxq.com/assets/app-fixture.js',
    'https://www.datawxq.com/assets/catalog-fixture.js',
    'https://www.datawxq.com/assets/index-fixture.js',
  ]);
  for (const asset of assets) {
    const source = fixture.sources.get(asset.url);
    const bytes = Buffer.from(source);
    assert.equal(asset.bytes, bytes.length);
    assert.equal(asset.sha256, createHash('sha256').update(bytes).digest('hex'));
  }
  assert(!requests.some((url) => url.includes('elsewhere.example') || /admin/i.test(url)));
  assert.equal(requests.filter((url) => url.endsWith('index-fixture.js')).length, 1);
  assert.equal(validateCatalog(catalog), catalog);
});

test('network failures retry without replacing an existing snapshot', async () => {
  const fixture = buildFixture();
  const directory = await mkdtemp(join(tmpdir(), 'wanxiang-reference-'));
  const outputPath = join(directory, 'catalog.json');
  await writeFile(outputPath, 'keep the existing snapshot');
  let failedIndexAttempts = 0;

  try {
    await assert.rejects(collectAndWriteCatalog({
      outputPath,
      fetchImpl: async (url) => {
        if (url.endsWith('/index-fixture.js') && failedIndexAttempts++ < 3) {
          throw new Error('temporary network failure');
        }
        return responseFor(url, fixture);
      },
    }), /after 3 attempts/);
    assert.equal(await readFile(outputPath, 'utf8'), 'keep the existing snapshot');

    const catalog = await collectAndWriteCatalog({
      outputPath,
      fetchImpl: (url) => responseFor(url, fixture),
    });
    assert.equal(JSON.parse(await readFile(outputPath, 'utf8')).talents.length, 2);
    assert.equal(catalog.commanders.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('cross-mode talent id collisions are valid but duplicate ids within one mode fail', async () => {
  const fixture = buildFixture();
  const source = fixture.sources.get('https://www.datawxq.com/assets/catalog-fixture.js');
  const extracted = extractReferenceData(source);
  assert.equal(extracted.talents.length, 2);

  const duplicateFixture = buildFixture();
  duplicateFixture.sources.set(
    'https://www.datawxq.com/assets/catalog-fixture.js',
    buildSeoSource({ duplicateModeTalent: true }),
  );
  await assert.rejects(collectCatalog({
    fetchImpl: (url) => responseFor(url, duplicateFixture),
  }), /duplicate talent id wanxiang:1/);
});

test('collector continues when the second game mode is in another asset', async () => {
  const fixture = buildFixture();
  fixture.sources.set('https://www.datawxq.com/assets/catalog-fixture.js', [
    `const talents = ${arrayLiteral([talent('wanxiang')])};`,
    `const commanders = ${arrayLiteral([commander])};`,
    'import "./diamond-fixture.js";',
  ].join('\n'));
  fixture.sources.set('https://www.datawxq.com/assets/diamond-fixture.js',
    `const talents = ${arrayLiteral([talent('diamond')])};`);
  const catalog = await collectCatalog({ fetchImpl: (url) => responseFor(url, fixture) });
  assert.deepEqual(catalog.metadata.counts.talents_by_mode, { wanxiang: 1, diamond: 1 });
  assert.ok(catalog.metadata.source_assets.some(asset => asset.url.endsWith('/diamond-fixture.js')));

  fixture.sources.set('https://www.datawxq.com/assets/diamond-fixture.js', 'export const missing = true;');
  await assert.rejects(collectCatalog({ fetchImpl: (url) => responseFor(url, fixture) }), /Both wanxiang and diamond/);
});
