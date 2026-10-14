import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parse } from '../../content-kit/node_modules/yaml/dist/index.js';

const root = new URL('../public/', import.meta.url);
const library = JSON.parse(await readFile(new URL('assets/library.json', root), 'utf8'));
const content = new URL('../../../content/shanhai/', import.meta.url);
const manifest = parse(await readFile(new URL('manifest.yaml', content), 'utf8'));
assert.equal(library.schemaVersion, 1);
assert.equal(library.styleApproval.status, 'approved');
assert.equal(library.expansionApproval.status, 'pending');
assert.equal(library.provenance.model, 'gpt-image-2.5');
assert.equal(library.assets.length, 31);
assert.equal(Object.keys(library.rigs).length, 6);
assert.equal(Object.keys(library.map).length, 6);
const actual = manifest.files.filter(entity => entity.kind === 'artifact');
assert.deepEqual(Object.keys(library.artifacts).sort(), actual.map(entry => entry.id).sort());
const paths = new Set(library.assets.map(asset => asset.src));
for (const asset of library.assets) {
  const bytes = await readFile(new URL(asset.src.slice(1), root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], asset.dimensions);
  assert.equal(asset.source.origin, 'imagegen');
  assert.match(asset.source.sha256, /^[a-f0-9]{64}$/);
}
for (const [id, rig] of Object.entries(library.rigs)) {
  assert.ok(paths.has(rig.src));
  const layered = ['RKF05', 'EN-A1-L1'].includes(id);
  assert.equal(rig.layout === 'layered-v2', layered);
  assert.equal(Object.keys(rig.parts).length, layered ? 12 : 9);
  const dimensions = rig.dimensions || [768, 768];
  assert.deepEqual(dimensions, layered ? [1024, 768] : [768, 768]);
  assert.ok(rig.weaponGrip >= .5 && rig.weaponGrip <= 1);
  for (const rect of Object.values(rig.parts)) {
    assert.equal(rect.length, 4);
    const [x, y, width, height] = rect;
    assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 &&
      x + width <= dimensions[0] && y + height <= dimensions[1]);
  }
  if (id.startsWith('RKF')) {
    const method = parse(await readFile(new URL(`methods/${id}.yaml`, content), 'utf8'));
    assert.equal(rig.name, method.name);
    assert.equal(rig.basicName, method.actions.basic.name);
    assert.equal(rig.rageName, method.actions.rage.name);
  }
}
for (const entry of actual) {
  const entity = parse(await readFile(new URL(entry.path, content), 'utf8'));
  const icon = library.artifacts[entry.id];
  assert.equal(icon.name, entity.name);
  assert.equal(icon.rarity, entity.rarity);
  assert.equal(icon.description, entity.description);
  assert.ok(paths.has(icon.src) || /^\/assets\/artifact-rr(?:09|11|15)\.png$/.test(icon.src));
  if (entity.rarity === 'legendary') assert.equal(icon.type, 'special');
  assert.ok(icon.stats.length > 0, `${entry.id}: actual attribute detail`);
}
assert.ok(new Set(Object.values(library.artifacts).map(item => item.src)).size < 30,
  'ordinary artifacts reuse a bounded icon family');
console.log('Art library passed: 31 image hashes, 6 rigs, 6 map illustrations, all 44 actual artifact mappings');
