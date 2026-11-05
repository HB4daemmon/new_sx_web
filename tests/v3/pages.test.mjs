import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

// Pages publishes the branch root directly: the committed v3/ must be the current build.
async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await files(full)); else out.push(full);
  }
  return out;
}

test('committed v3/ matches the fresh build and index.html points at it', async () => {
  const built = (await files('dist/v3')).map(f => path.relative('dist/v3', f)).sort();
  const committed = (await files('v3')).map(f => path.relative('v3', f)).sort();
  assert.deepEqual(committed, built);
  for (const f of built) assert.ok((await readFile(path.join('v3', f))).equals(await readFile(path.join('dist/v3', f))), `v3/${f} is stale: run npm run build`);
  const html = await readFile('index.html', 'utf8');
  assert.match(html, /src="\.\/v3\/ui\/main\.js"/);
  assert.match(html, /href="\.\/v3\/v3\.css"/);
  await readFile('assets/fonts/lxgw-wenkai-v3.woff2');
  await readFile('assets/v3/bg-title.webp');
});
