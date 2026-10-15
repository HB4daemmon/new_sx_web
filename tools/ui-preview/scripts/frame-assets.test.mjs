import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = path.join(moduleRoot, 'public');
const ids = ['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05', 'EN-A1-L1'];
const frameSize = [400, 448];
const anchor = [160, 420];
const expectedBodyHeights = [296, 331, 291, 300, 298, 288];

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function resolveRelative(root, relative, label) {
  assert.equal(typeof relative, 'string', `${label} must be a path`);
  assert.ok(relative.length > 0 && !path.isAbsolute(relative), `${label} must be relative`);
  const resolved = path.resolve(root, relative);
  assert.ok(resolved.startsWith(`${root}${path.sep}`), `${label} must stay inside its root`);
  return resolved;
}

function pngDimensions(buffer, label) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a',
    `${label} must be a PNG`);
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

test('the six combat atlases keep their manifest paths, hashes and source provenance', async () => {
  const manifest = JSON.parse(await readFile(
    path.join(publicRoot, 'assets/frames.json'), 'utf8',
  ));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.frameSize, frameSize);
  assert.equal(manifest.targetBodyHeight, 300);
  assert.deepEqual(Object.keys(manifest.characters), ids);
  assert.equal(manifest.approval, 'approved');
  assert.equal(manifest.provenance.model, 'gpt-image-2.5');
  assert.equal(manifest.provenance.mode, 'reference-edit');

  const exporter = resolveRelative(moduleRoot, manifest.provenance.exporter, 'exporter');
  const prompt = resolveRelative(moduleRoot, manifest.provenance.prompt, 'prompt');
  assert.match(manifest.provenance.exporter, /^scripts\/.+\.py$/);
  assert.match(manifest.provenance.prompt, /^prompts\/.+\.txt$/);
  await readFile(exporter);
  await readFile(prompt);

  const atlasHashes = new Set();
  const calibratedHeights = [];
  for (const [index, id] of ids.entries()) {
    const character = manifest.characters[id];
    assert.deepEqual(character.anchor, anchor, `${id} keeps the shared foot anchor`);
    assert.deepEqual(character.dimensions, [1200, 1792], `${id} uses the fixed 3x4 atlas`);
    assert.ok(Number.isFinite(character.scale) && character.scale > 0 && character.scale <= 1.3,
      `${id} keeps one positive, bounded scale`);

    const expectedName = `frames-${id.toLowerCase()}.png`;
    assert.equal(character.src, `/assets/${expectedName}`, `${id} uses its fixed atlas path`);
    const atlasPath = resolveRelative(publicRoot, character.src.slice(1), `${id} atlas`);
    const atlas = await readFile(atlasPath);
    assert.deepEqual(pngDimensions(atlas, `${id} atlas`), character.dimensions);
    assert.equal(digest(atlas), character.sha256, `${id} atlas hash matches its manifest`);
    assert.ok(!atlasHashes.has(character.sha256), 'each character has its own atlas');
    atlasHashes.add(character.sha256);

    const sourcePath = resolveRelative(moduleRoot, character.source?.path, `${id} source`);
    const source = await readFile(sourcePath).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    assert.match(character.source.sha256, /^[a-f0-9]{64}$/, `${id} records a source hash`);
    if (source) assert.equal(digest(source), character.source.sha256, `${id} source hash matches provenance`);

    assert.equal(character.frames.length, 12, `${id} has twelve pose rectangles`);
    assert.equal(character.cels.length, 12, `${id} has twelve source cel records`);
    const sourceSize = source ? pngDimensions(source, `${id} source`) : character.source.dimensions;
    assert.ok(Array.isArray(sourceSize) && sourceSize.length === 2 &&
      sourceSize.every(value => Number.isInteger(value) && value > 0),
    `${id} records dimensions even when the ignored originals are unavailable`);
    const rects = new Set();
    const sourceBounds = new Set();
    for (let index = 0; index < 12; index++) {
      const column = index % 3, row = Math.floor(index / 3);
      const expectedRect = [column * frameSize[0], row * frameSize[1], ...frameSize];
      const rect = character.frames[index];
      assert.deepEqual(rect, expectedRect, `${id} pose ${index} has the expected atlas cell`);
      assert.ok(rect.every(Number.isInteger), `${id} pose ${index} uses integer bounds`);
      assert.ok(rect[0] >= 0 && rect[1] >= 0 &&
        rect[0] + rect[2] <= character.dimensions[0] &&
        rect[1] + rect[3] <= character.dimensions[1],
      `${id} pose ${index} stays inside its atlas`);
      rects.add(rect.join(','));

      const cel = character.cels[index];
      assert.ok(Array.isArray(cel.sourceBounds) && cel.sourceBounds.length === 4,
        `${id} pose ${index} has source bounds`);
      const [left, top, right, bottom] = cel.sourceBounds;
      assert.ok([left, top, right, bottom].every(Number.isInteger));
      assert.ok(left >= 0 && top >= 0 && right > left && bottom > top &&
        right <= sourceSize[0] && bottom <= sourceSize[1],
      `${id} pose ${index} source bounds stay inside its source image`);
      assert.ok(Array.isArray(cel.sourceAnchor) && cel.sourceAnchor.length === 2 &&
        cel.sourceAnchor.every(Number.isFinite),
      `${id} pose ${index} records its extracted source anchor`);

      assert.ok(Array.isArray(cel.bounds) && cel.bounds.length === 4 &&
        cel.bounds.every(Number.isInteger),
      `${id} pose ${index} has raster bounds`);
      const [x, y, rightEdge, bottomEdge] = cel.bounds;
      assert.ok(x >= 4 && y >= 4 &&
        rightEdge <= frameSize[0] - 4 && bottomEdge <= frameSize[1] - 4 &&
        rightEdge > x && bottomEdge > y,
      `${id} pose ${index} leaves padding inside its fixed frame`);
      sourceBounds.add(cel.sourceBounds.join(','));
    }
    assert.ok(Number.isInteger(character.bodyHeight) && character.bodyHeight > 0,
      `${id} has a positive integer body height`);
    const readyHeight = character.anchor[1] - character.cels[0].bounds[1];
    assert.equal(character.bodyHeight, readyHeight, `${id} body height matches its ready pose`);
    assert.equal(character.bodyHeight, expectedBodyHeights[index],
      `${id} retains its reviewed body height`);
    const heightFactor = manifest.targetBodyHeight / character.bodyHeight;
    assert.ok(heightFactor >= 0.85 && heightFactor <= 1.1,
      `${id} has a bounded body-height calibration factor`);
    calibratedHeights.push(character.bodyHeight * heightFactor);
    assert.equal(rects.size, 12, `${id} rectangles are distinct`);
    assert.ok(sourceBounds.size > 1, `${id} actions retain distinct source cel regions`);
  }
  assert.equal(atlasHashes.size, ids.length);
  for (const [index, height] of calibratedHeights.entries()) {
    assert.ok(Math.abs(height - manifest.targetBodyHeight) < 1e-9,
      `${ids[index]} calibrates to the shared target body height`);
  }
});
