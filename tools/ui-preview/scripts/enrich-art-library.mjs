import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { parse } from '../../content-kit/node_modules/yaml/dist/index.js';

const contentRoot = new URL('../../../content/shanhai/', import.meta.url);
const libraryUrl = new URL('../public/assets/library.json', import.meta.url);
const library = JSON.parse(await readFile(libraryUrl, 'utf8'));
const manifest = parse(await readFile(new URL('manifest.yaml', contentRoot), 'utf8'));
const names = {
  attack: '攻击', defense: '防御', max_hp: '最大气血', crit_rate: '暴击率', speed: '速度',
};
const signed = value => `${value >= 0 ? '+' : ''}${value}`;
const expected = manifest.files.filter(entity => entity.kind === 'artifact');
assert.deepEqual(Object.keys(library.artifacts).sort(), expected.map(entity => entity.id).sort(),
  'Every actual artifact must have an explicit icon mapping');
for (const entry of manifest.files) {
  if (!['artifact', 'method'].includes(entry.kind)) continue;
  const entity = parse(await readFile(new URL(entry.path, contentRoot), 'utf8'));
  if (entry.kind === 'artifact') {
    Object.assign(library.artifacts[entry.id], {
      name: entity.name, rarity: entity.rarity, description: entity.description,
      stats: [
        ...Object.entries(entity.attributes.flat).map(([stat, value]) =>
          [names[stat], stat === 'crit_rate' ? `${signed(Math.round(value * 100))}%` : signed(value)]),
        ...Object.entries(entity.attributes.percent).map(([stat, value]) =>
          [names[stat], `${signed(Math.round(value * 100))}%`]),
      ],
    });
  } else if (library.rigs[entry.id]) {
    Object.assign(library.rigs[entry.id], {
      name: entity.name, basicName: entity.actions.basic.name,
      rageName: entity.actions.rage.name, contentSource: entry.path,
    });
  }
}
await writeFile(libraryUrl, JSON.stringify(library, null, 2) + '\n');
console.log(`Art library enriched from ${expected.length} actual artifact entities`);
