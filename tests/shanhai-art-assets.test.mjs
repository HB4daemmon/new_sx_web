import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { buildGameArt } from '../scripts/build-game-art.mjs';
import { loadContent } from '../tools/content-kit/src/loader.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

test('game-art release manifest is explicit, approved and hash-verified', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'shanhai-game-art-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const destination = path.join(temporary, 'dist');

  const manifest = await buildGameArt({ root: ROOT, destination });
  const content = await loadContent();
  const enemyIds = content.byKind.get('enemy').map(enemy => enemy.id).sort();
  assert.deepEqual(manifest.approval, { status: 'approved', reviewedBy: 'user' });
  assert.equal(Object.keys(manifest.scenes).length, 3);
  assert.equal(Object.keys(manifest.modules).length, 4);
  assert.equal(Object.keys(manifest.artifacts).length, 48);
  assert.deepEqual(
    { RL06: manifest.artifacts.RL06, RL07: manifest.artifacts.RL07, RL08: manifest.artifacts.RL08 },
    { RL06: '/assets/icon-bottle.png', RL07: '/assets/icon-jade.png', RL08: '/assets/icon-jade.png' },
  );
  assert.equal(Object.keys(manifest.map).length, 6);
  assert.equal(Object.keys(manifest.frames).length, 39);
  assert.deepEqual(Object.keys(manifest.frames).filter(id => id.startsWith('EN-')).sort(), enemyIds);
  assert.equal(Object.hasOwn(manifest, 'rigs'), false);
  assert.ok(Object.values(manifest.artifacts).every(source => !source.includes('rig-')));
  assert.ok(Object.keys(manifest.assets).every(source =>
    /^\/assets\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/.test(source)));

  const outputAssets = path.join(destination, 'assets');
  const enemyDigests = [];
  for (const [source, record] of Object.entries(manifest.assets)) {
    const sourceRoot = source.startsWith('/assets/frames-en-') &&
      source !== '/assets/frames-en-a1-l1.png'
      ? path.join(ROOT, 'assets/enemies')
      : path.join(ROOT, 'tools/ui-preview/public');
    const sourcePath = sourceRoot.endsWith('/assets/enemies')
      ? path.join(sourceRoot, path.basename(source))
      : path.join(sourceRoot, source.slice(1));
    const original = await readFile(sourcePath);
    const output = await readFile(path.join(outputAssets, path.basename(source)));
    assert.equal(digest(original), record.sha256, `${source} source hash`);
    assert.deepEqual(output, original, `${source} copy`);
    if (source.startsWith('/assets/frames-en-') && source !== '/assets/frames-en-a1-l1.png') {
      enemyDigests.push(record.sha256);
      assert.deepEqual(record.review, {
        status: 'agent-reviewed',
        reviewedBy: 'agent',
        date: '2026-10-15',
      });
    }
  }
  assert.equal(new Set(enemyDigests).size, 33);
  assert.ok(enemyDigests.every(hash => !Object.values(manifest.assets)
    .filter(record => record.kind === 'animation-frame' && !record.review)
    .some(record => record.sha256 === hash)));
  const publishedNames = await readdir(outputAssets);
  assert.ok(publishedNames.includes('frames.json'));
  assert.ok(publishedNames.includes('game-art.json'));
  assert.equal(publishedNames.filter(name => /^frames-en-(?!a1-l1)[a-z0-9-]+\.png$/.test(name)).length, 33);
  const runtimeFrames = JSON.parse(await readFile(path.join(outputAssets, 'frames.json'), 'utf8'));
  assert.equal(runtimeFrames.approval, 'approved');
  assert.equal(Object.keys(runtimeFrames.characters).length, 39);
  assert.equal(runtimeFrames.characters['EN-A1-L1'].src, '/assets/frames-en-a1-l1.png');
  assert.equal(runtimeFrames.characters['EN-A1-C1'].review.status, 'agent-reviewed');
  const sourceEnemyFrames = JSON.parse(await readFile(
    path.join(ROOT, 'assets/enemies/manifest.json'),
    'utf8',
  ));
  for (const id of enemyIds.filter(id => id !== 'EN-A1-L1')) {
    const sourceCharacter = sourceEnemyFrames.characters[id];
    const metric = Math.round(Math.max(...sourceCharacter.cels.map(({ bounds }) =>
      Math.max(bounds[3] - bounds[1], (bounds[2] - bounds[0]) * 0.85))));
    assert.equal(runtimeFrames.characters[id].bodyHeight, metric);
    assert.equal(runtimeFrames.characters[id].bodyHeight, sourceCharacter.bodyHeight);
  }
  assert.equal(publishedNames.some(name => name.endsWith('.webp')), false);
  assert.equal(publishedNames.some(name => name.startsWith('rig-')), false);
  assert.deepEqual(
    await readFile(path.join(destination, 'shanhai/animation.js')),
    await readFile(path.join(ROOT, 'tools/ui-preview/public/rig.js')),
  );
  assert.deepEqual(
    await readFile(path.join(destination, 'animation-LICENSE.txt')),
    await readFile(path.join(ROOT, 'tools/ui-preview/public/animation-LICENSE.txt')),
  );
  const rawManifest = JSON.parse(await readFile(path.join(outputAssets, 'game-art.json'), 'utf8'));
  assert.deepEqual(rawManifest, manifest);
});

test('art access helpers resolve under a subpath and return escaped production markup', async t => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'shanhai-art-runtime-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const destination = path.join(temporary, 'site');
  const moduleDirectory = path.join(destination, 'shanhai');
  await mkdir(moduleDirectory, { recursive: true });
  await buildGameArt({ root: ROOT, destination });

  const source = await readFile(path.join(ROOT, 'src/shanhai/art-assets.ts'), 'utf8');
  const emitted = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText;
  const modulePath = path.join(moduleDirectory, 'art-assets.js');
  await writeFile(modulePath, emitted);
  const art = await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`);

  assert.equal(art.getAnimationManifest(), null);
  const imageUrl = new URL(art.assetUrl('/assets/ui-panel.png'));
  assert.equal(imageUrl.protocol, 'file:');
  assert.equal(imageUrl.pathname, path.join(destination, 'assets/ui-panel.png'));
  assert.equal(imageUrl.pathname.startsWith('/assets/'), false);
  assert.throws(() => art.assetUrl('/assets/../private.png'), /Invalid public asset path/);
  assert.equal(art.characterSkin('RKF03'), 'RKF03');
  assert.equal(art.characterSkin('RKF06'), 'RKF01');
  assert.equal(art.characterSkin('RKF10'), 'RKF05');
  assert.equal(art.characterSkin('RKF10', 'EN-A1-L1'), 'EN-A1-L1');
  assert.equal(art.characterSkin('RKF01', 'EN-A4-B2'), 'EN-A4-B2');
  assert.equal(art.characterSkin('RKF01', 'EN-NOT-REAL'), 'EN-A1-L1');
  assert.match(art.characterArt('RKF01', 'EN-NOT-REAL'), /data-art-fallback="unknown-enemy:EN-A1-L1"/);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    try {
      return new Response(await readFile(fileURLToPath(url)), { status: 200 });
    } catch {
      return new Response('', { status: 404 });
    }
  };
  try {
    await art.loadArtLibrary();
  } finally {
    globalThis.fetch = originalFetch;
  }

  const animationManifest = art.getAnimationManifest();
  assert.equal(animationManifest.approval, 'approved');
  assert.equal(Object.keys(animationManifest.characters).length, 39);
  assert.equal(animationManifest.characters['RKF01'].src, '/assets/frames-rkf01.png');
  assert.equal(animationManifest.characters['EN-A4-B2'].review.status, 'agent-reviewed');
  assert.match(art.characterArt('RKF01'), /class="character-art" data-art-skin="RKF01"/);
  assert.match(art.characterArt('RKF01'), /class="character-cel" style="background-image:url\(file:/);
  assert.match(art.characterArt('RKF01'), /--stature:1\.0135135135135136/);
  assert.match(art.characterArt('RKF01', 'EN-A1-L1'), /data-art-skin="EN-A1-L1"/);
  assert.match(art.characterArt('RKF01', 'EN-A1-L1'), /frames-en-a1-l1\.png/);
  assert.match(art.characterArt('RKF01', 'EN-A4-B2'), /frames-en-a4-b2\.png/);
  assert.match(art.characterArt('RKF01', 'EN-A1-L1'), /aria-hidden="true"/);
  assert.match(art.artifactArt('RL01'), /class="artifact-art"[^>]+alt=""/);
  assert.equal(art.artifactArt('UNKNOWN'), '');
  assert.match(art.mapArt('R'), /class="map-node-art"[^>]+data-node-type="R"[^>]+aria-hidden="true"/);
  assert.match(art.sceneArt('battle'), /class="game-scene"[^>]+alt="" aria-hidden="true"/);
  assert.equal(art.mapArt('unknown'), '');
});
