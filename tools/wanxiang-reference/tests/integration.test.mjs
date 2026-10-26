import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateCatalog } from '../lib/validate.mjs';
import { renderReferenceDocs } from '../lib/browse.mjs';

const cli = fileURLToPath(new URL('../browse.mjs', import.meta.url));
const catalogUrl = new URL('../../../references/wanxiangqi/catalog.json', import.meta.url);

test('checked-in catalog validates and CLI resolves it independently of cwd', async () => {
  const catalog = validateCatalog(JSON.parse(await readFile(catalogUrl, 'utf8')));
  const result = spawnSync(process.execPath, [cli, 'stats', '--json'], {
    cwd: tmpdir(), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.stats.talents, catalog.talents.length);
  assert.equal(output.stats.commanders, catalog.commanders.length);
  assert.equal(output.stats.related_cards, catalog.related_cards.length);
});

test('real talent and commander mechanics can be retrieved without a network', () => {
  const query = (...args) => {
    const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
      cwd: tmpdir(), encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const talent = query('show', '毒奶', '--type', 'talent', '--mode', 'wanxiang');
  assert.equal(talent.record.id, 637010);
  assert.match(talent.record.description, /蔡文姬/);
  const commander = query('show', '常小娥', '--type', 'commander');
  assert.ok(commander.record.sections.some(section =>
    section.entries.some(entry => entry.name === '小菟助力')));
  const searches = query('search', '每购买4张牌', '--type', 'commander');
  assert.ok(searches.results.some(entry => entry.record.name === '小妲己'));
});

test('generated reference links have existing unique targets', async () => {
  const catalog = JSON.parse(await readFile(catalogUrl, 'utf8'));
  const docs = renderReferenceDocs(catalog);
  const anchors = new Map(Object.entries(docs).map(([name, text]) => {
    const ids = [...text.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size, `${name} has duplicate anchors`);
    return [name, new Set(ids)];
  }));
  for (const [name, text] of Object.entries(docs)) {
    for (const match of text.matchAll(/\]\(([^()\s]*\.md)?#([a-z0-9-]+)\)/g)) {
      const destination = match[1] || name;
      assert.ok(anchors.get(destination)?.has(match[2]), `${name}: missing ${destination}#${match[2]}`);
    }
  }
});

test('curated research index links identify the named source records', async () => {
  const catalog = JSON.parse(await readFile(catalogUrl, 'utf8'));
  const docs = renderReferenceDocs(catalog);
  const design = await readFile(new URL('DESIGN_INDEX.md', catalogUrl), 'utf8');
  const targets = new Map();
  for (const [filename, text] of Object.entries(docs)) {
    for (const match of text.matchAll(/<a id="([^"]+)"><\/a>\n## ([^\n]+)/g)) {
      targets.set(`${filename}#${match[1]}`, match[2]);
    }
  }
  for (const match of design.matchAll(/\[([^\]]+)\]\(((?:TALENTS|COMMANDERS)\.md#[^)]+)\)/g)) {
    assert.equal(targets.get(match[2]), match[1], `Wrong reference target for ${match[1]}`);
  }
});
