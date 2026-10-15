import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadContent } from '../tools/content-kit/src/loader.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'assets/enemies/manifest.json');
const frameSize = [400, 448];
const atlasSize = [1200, 1792];
const anchor = [160, 420];
const framePadding = 2;

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function roundMetric(value) {
  return Math.round(value * 1000) / 1000;
}

function paeth(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

function decodeRgbaAlpha(buffer, label, cels = null) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a',
    `${label} must be a PNG`);

  let width;
  let height;
  let bitDepth;
  let colorType;
  let interlace;
  const imageData = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') {
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
      bitDepth = buffer[offset + 16];
      colorType = buffer[offset + 17];
      interlace = buffer[offset + 20];
    } else if (type === 'IDAT') {
      imageData.push(buffer.subarray(offset + 8, offset + 8 + length));
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }

  assert.equal(bitDepth, 8, `${label} uses 8-bit color channels`);
  assert.equal(colorType, 6, `${label} uses RGBA pixels`);
  assert.equal(interlace, 0, `${label} is not interlaced`);
  const rowBytes = width * 4;
  const scanlines = inflateSync(Buffer.concat(imageData));
  assert.equal(scanlines.length, (rowBytes + 1) * height,
    `${label} has complete RGBA scanlines`);

  const alpha = {
    transparent: 0,
    visible: 0,
    frames: cels?.map(() => ({
      visibleInsideBounds: 0,
      visibleOutsideBounds: 0,
      transparentOutsideBounds: 0,
    })) ?? null,
  };
  let previous = new Uint8Array(width);
  let current = new Uint8Array(width);

  for (let y = 0; y < height; y++) {
    const scanlineOffset = y * (rowBytes + 1);
    const filter = scanlines[scanlineOffset];
    for (let x = 0; x < width; x++) {
      const raw = scanlines[scanlineOffset + 1 + x * 4 + 3];
      const left = x ? current[x - 1] : 0;
      const above = previous[x];
      const upperLeft = x ? previous[x - 1] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      else assert.equal(filter, 0, `${label} uses a valid PNG filter`);

      const value = (raw + predictor) & 0xff;
      current[x] = value;
      const frameIndex = cels ? Math.floor(y / frameSize[1]) * 3 +
        Math.floor(x / frameSize[0]) : -1;
      if (value === 0) {
        alpha.transparent++;
      } else {
        alpha.visible++;
      }
      if (frameIndex >= 0 && frameIndex < cels.length) {
        const cel = cels[frameIndex];
        const localX = x % frameSize[0];
        const localY = y % frameSize[1];
        const [leftEdge, topEdge, rightEdge, bottomEdge] = cel.bounds;
        const withinBounds = localX >= leftEdge && localX < rightEdge &&
          localY >= topEdge && localY < bottomEdge;
        const frame = alpha.frames[frameIndex];
        if (value > 0) {
          frame[withinBounds ? 'visibleInsideBounds' : 'visibleOutsideBounds']++;
        } else if (!withinBounds) {
          frame.transparentOutsideBounds++;
        }
      }
    }
    [previous, current] = [current, previous];
  }

  return { dimensions: [width, height], ...alpha };
}

async function enemyIds() {
  const content = await loadContent({
    contentRoot: path.join(root, 'content/shanhai'),
    manifestPath: path.join(root, 'content/shanhai/manifest.yaml'),
  });
  assert.deepEqual(content.issues, []);
  return content.byKind.get('enemy').map(enemy => enemy.id).sort();
}

test('the 34 enemy atlas entries match the content library and their raster sources', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const ids = await enemyIds();
  assert.equal(ids.length, 34);
  assert.equal(new Set(ids).size, 34);
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.frameSize, frameSize);
  assert.equal(manifest.targetBodyHeight, 300);
  assert.deepEqual(Object.keys(manifest.characters).sort(), ids);
  assert.deepEqual(manifest.review, {
    status: 'agent-reviewed',
    reviewedBy: 'agent',
    date: '2026-10-15',
  });
  assert.equal(manifest.userApproval, 'not-yet-requested');
  assert.equal(manifest.provenance.model, 'gpt-image-2.5');
  assert.equal(manifest.provenance.exporter, 'scripts/prepare-enemy-art.py');

  const atlasHashes = new Set();
  for (const id of ids) {
    const character = manifest.characters[id];
    assert.deepEqual(character.anchor, anchor, `${id} keeps the shared foot anchor`);
    assert.deepEqual(character.dimensions, atlasSize, `${id} uses a 3x4 fixed-size atlas`);
    assert.ok(Number.isFinite(character.scale) && character.scale > 0 &&
      character.scale <= 1.1, `${id} uses a positive scale that fits the frame`);
    assert.ok(Number.isFinite(character.bodyHeight) && character.bodyHeight > 0,
      `${id} records its rendered body height`);
    assert.equal(character.frames.length, 12, `${id} has twelve frame rectangles`);
    assert.equal(character.cels.length, 12, `${id} has twelve independently extracted cels`);
    assert.equal(character.src, `/assets/frames-${id.toLowerCase()}.png`);

    const filename = path.basename(character.src);
    const atlasPath = id === 'EN-A1-L1'
      ? path.join(root, 'tools/ui-preview/public/assets', filename)
      : path.join(root, 'assets/enemies', filename);
    const atlas = await readFile(atlasPath);
    const atlasAlpha = decodeRgbaAlpha(atlas, `${id} atlas`, character.cels);
    assert.deepEqual(atlasAlpha.dimensions, atlasSize);
    assert.ok(atlasAlpha.transparent > 0 && atlasAlpha.visible > 0,
      `${id} atlas contains both transparent and visible pixels`);
    assert.equal(digest(atlas), character.sha256, `${id} atlas hash matches its manifest`);
    assert.ok(!atlasHashes.has(character.sha256), `${id} has a distinct atlas`);
    atlasHashes.add(character.sha256);

    const [sourceWidth, sourceHeight] = character.source.dimensions;
    assert.ok(sourceWidth > 0 && sourceHeight > 0, `${id} records source dimensions`);
    const sourcePath = path.resolve(root, character.source.path);
    assert.ok(sourcePath.startsWith(`${root}${path.sep}`),
      `${id} source stays inside the repository`);
    assert.match(character.source.sha256, /^[a-f0-9]{64}$/);
    const source = await readFile(sourcePath).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (source) {
      assert.equal(digest(source), character.source.sha256,
        `${id} source hash matches its manifest`);
      const sourceAlpha = decodeRgbaAlpha(source, `${id} source`);
      assert.deepEqual(sourceAlpha.dimensions, [sourceWidth, sourceHeight]);
      assert.ok(sourceAlpha.transparent > 0 && sourceAlpha.visible > 0,
        `${id} source contains transparency and visible character pixels`);
    }

    const sourceCels = new Set();
    const sourceMetrics = [];
    const renderedMetrics = [];
    for (let index = 0; index < 12; index++) {
      const column = index % 3;
      const row = Math.floor(index / 3);
      assert.deepEqual(character.frames[index], [
        column * frameSize[0], row * frameSize[1], ...frameSize,
      ]);
      const cel = character.cels[index];
      assert.ok(Array.isArray(cel.sourceBounds) && cel.sourceBounds.length === 4);
      const [left, top, right, bottom] = cel.sourceBounds;
      assert.ok([left, top, right, bottom].every(Number.isInteger));
      assert.ok(left >= 0 && top >= 0 && right > left && bottom > top &&
        right <= sourceWidth && bottom <= sourceHeight,
      `${id}/${index} source bounds stay in the raw image`);
      assert.ok(Array.isArray(cel.bounds) && cel.bounds.length === 4);
      const [x, y, rightEdge, bottomEdge] = cel.bounds;
      assert.ok(x >= framePadding && y >= framePadding &&
        rightEdge <= frameSize[0] - framePadding &&
        bottomEdge <= frameSize[1] - framePadding &&
        rightEdge > x && bottomEdge > y,
      `${id}/${index} leaves transparent padding in its frame`);
      const pixelStats = atlasAlpha.frames[index];
      assert.ok(pixelStats.visibleInsideBounds > 0,
        `${id}/${index} has visible pixels within its manifest bounds`);
      assert.equal(pixelStats.visibleOutsideBounds, 0,
        `${id}/${index} has no visible pixels outside its manifest bounds`);
      assert.ok(pixelStats.transparentOutsideBounds > 0,
        `${id}/${index} has actual transparent frame padding`);
      sourceCels.add(cel.sourceBounds.join(','));

      if (cel.sourceSizeMetric && cel.sizeMetric) {
        const sourceCelWidth = right - left;
        const sourceCelHeight = bottom - top;
        const renderedWidth = rightEdge - x;
        const renderedHeight = bottomEdge - y;
        const expectedSourceEffective = roundMetric(
          Math.max(sourceCelHeight, sourceCelWidth * 0.85),
        );
        const expectedRenderedEffective = roundMetric(
          Math.max(renderedHeight, renderedWidth * 0.85),
        );
        assert.deepEqual(cel.sourceSizeMetric, {
          width: sourceCelWidth,
          height: sourceCelHeight,
          effective: expectedSourceEffective,
        }, `${id}/${index} source size metric describes its source bounds`);
        assert.deepEqual(cel.sizeMetric, {
          width: renderedWidth,
          height: renderedHeight,
          effective: expectedRenderedEffective,
        }, `${id}/${index} rendered size metric describes its atlas bounds`);
        assert.ok(Math.abs(renderedWidth - Math.round(sourceCelWidth * character.scale)) <= 1 &&
          Math.abs(renderedHeight - Math.round(sourceCelHeight * character.scale)) <= 1,
        `${id}/${index} preserves the shared cel scale`);
        sourceMetrics.push(expectedSourceEffective);
        renderedMetrics.push(expectedRenderedEffective);
      }
    }
    assert.equal(sourceCels.size, 12, `${id} keeps twelve separate source cel regions`);
    if (renderedMetrics.length) {
      const bodyHeight = Math.round(Math.max(...renderedMetrics));
      assert.equal(character.bodyHeight, bodyHeight,
        `${id} bodyHeight is measured from the rendered cel dimensions`);
      assert.equal(character.sizeMetric.bodyHeight, bodyHeight);
      assert.equal(character.sizeMetric.basis,
        'max(actual height, actual width * 0.85)');
      assert.equal(character.sizeMetric.maximumSourceMetric,
        roundMetric(Math.max(...sourceMetrics)));
    }
  }
  assert.equal(atlasHashes.size, 34);
});
