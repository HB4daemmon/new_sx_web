import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetRoot = path.join(moduleRoot, 'public', 'assets');
const manifestPath = path.join(assetRoot, 'manifest.json');
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const expectedAssets = [
  { id: 'battle-scene', file: 'scene-battle.png', kind: 'scene', screen: 'battle', dimensions: [192, 384] },
  { id: 'start-scene', file: 'scene-start.png', kind: 'scene', screen: 'start', dimensions: [192, 384] },
  { id: 'map-scene', file: 'scene-map.png', kind: 'scene', screen: 'map', dimensions: [192, 384] },
  { id: 'player', file: 'player.png', kind: 'character', screen: 'battle', dimensions: [64, 96] },
  { id: 'enemy', file: 'enemy.png', kind: 'character', screen: 'battle', dimensions: [64, 96] },
  { id: 'artifact-rr09', file: 'artifact-rr09.png', kind: 'artifact', target: 'artifact-rr09', contentId: 'RR09', dimensions: [32, 32] },
  { id: 'artifact-rr11', file: 'artifact-rr11.png', kind: 'artifact', target: 'artifact-rr11', contentId: 'RR11', dimensions: [32, 32] },
  { id: 'artifact-rr15', file: 'artifact-rr15.png', kind: 'artifact', target: 'artifact-rr15', contentId: 'RR15', dimensions: [32, 32] },
  { id: 'ui-panel', file: 'ui-panel.png', kind: 'module', dimensions: [128, 64] },
  { id: 'ui-button-primary', file: 'ui-button-primary.png', kind: 'module', dimensions: [160, 32] },
  { id: 'ui-button-secondary', file: 'ui-button-secondary.png', kind: 'module', dimensions: [160, 32] },
  { id: 'ui-meter', file: 'ui-meter.png', kind: 'module', dimensions: [160, 16] },
];

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
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

function decodePng(buffer) {
  assert.ok(buffer.subarray(0, 8).equals(signature), 'PNG signature');
  let offset = 8;
  let header;
  let ended = false;
  const imageData = [];

  while (offset < buffer.length) {
    assert.ok(offset + 12 <= buffer.length, 'PNG chunk header is truncated');
    const length = buffer.readUInt32BE(offset);
    const name = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert.ok(dataEnd + 4 <= buffer.length, `${name} chunk is truncated`);
    const data = buffer.subarray(dataStart, dataEnd);
    const expectedCrc = buffer.readUInt32BE(dataEnd);
    assert.equal(crc32(buffer.subarray(offset + 4, dataEnd)), expectedCrc, `${name} chunk CRC`);

    if (name === 'IHDR') {
      assert.equal(header, undefined, 'one IHDR chunk');
      assert.equal(length, 13, 'IHDR length');
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (name === 'IDAT') {
      imageData.push(data);
    } else if (name === 'IEND') {
      assert.equal(length, 0, 'IEND is empty');
      ended = true;
      offset = dataEnd + 4;
      break;
    } else {
      assert.fail(`unexpected PNG chunk ${name}`);
    }
    offset = dataEnd + 4;
  }

  assert.ok(header && ended, 'PNG has complete header and end chunks');
  assert.equal(offset, buffer.length, 'PNG has no trailing bytes');
  assert.ok(header.width > 0 && header.height > 0, 'PNG has non-zero dimensions');
  assert.deepEqual(
    [header.bitDepth, header.colorType, header.compression, header.filter, header.interlace],
    [8, 6, 0, 0, 0],
    'PNG is non-interlaced 8-bit RGBA',
  );

  const stride = header.width * 4;
  const decodedRows = inflateSync(Buffer.concat(imageData));
  assert.equal(decodedRows.length, (stride + 1) * header.height, 'inflated scanline byte count');
  const pixels = Buffer.alloc(stride * header.height);
  for (let y = 0; y < header.height; y += 1) {
    const scanlineStart = y * (stride + 1);
    const filter = decodedRows[scanlineStart];
    assert.ok(filter <= 4, `scanline ${y} uses a supported PNG filter`);
    const inputStart = scanlineStart + 1;
    const outputStart = y * stride;
    const previousStart = outputStart - stride;

    for (let index = 0; index < stride; index += 1) {
      const left = index >= 4 ? pixels[outputStart + index - 4] : 0;
      const above = y > 0 ? pixels[previousStart + index] : 0;
      const upperLeft = y > 0 && index >= 4 ? pixels[previousStart + index - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paeth(left, above, upperLeft);
      pixels[outputStart + index] = (decodedRows[inputStart + index] + predictor) & 0xff;
    }
  }
  return { ...header, pixels };
}

function inspectPixels(image) {
  const palette = new Set();
  let alphaZeroPixels = 0;
  let alphaNonzeroPixels = 0;
  let left = image.width;
  let top = image.height;
  let right = 0;
  let bottom = 0;
  let alphaPartialPixels = 0;
  const rgbCounts = new Map();

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const offset = (y * image.width + x) * 4;
      const alpha = image.pixels[offset + 3];
      if (alpha > 0 && alpha < 255) alphaPartialPixels += 1;
      if (alpha === 0) {
        alphaZeroPixels += 1;
        continue;
      }
      alphaNonzeroPixels += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x + 1);
      bottom = Math.max(bottom, y + 1);
      const key = image.pixels.subarray(offset, offset + 3).toString('hex');
      palette.add(key);
      rgbCounts.set(key, (rgbCounts.get(key) ?? 0) + 1);
    }
  }
  assert.ok(alphaNonzeroPixels > 0, 'image contains visible pixels');
  const bbox = [left, top, right, bottom];
  const padding = [left, top, image.width - right, image.height - bottom];
  const colors = Object.fromEntries([...rgbCounts].map(([hex, count]) => [`#${hex}`, count]));
  return {
    alphaExtrema: [
      image.pixels.reduce((minimum, value, index) =>
        index % 4 === 3 ? Math.min(minimum, value) : minimum, 255),
      image.pixels.reduce((maximum, value, index) =>
        index % 4 === 3 ? Math.max(maximum, value) : maximum, 0),
    ],
    alphaZeroPixels,
    alphaNonzeroPixels,
    alphaNonzeroBBox: bbox,
    alphaTransparentPaddingPx: padding,
    paletteColors: palette.size,
    alphaPartialPixels,
    colorCounts: colors,
  };
}

const [manifestSource, html, appSource] = await Promise.all([
  readFile(manifestPath, 'utf8'),
  readFile(path.join(moduleRoot, 'public', 'index.html'), 'utf8'),
  readFile(path.join(moduleRoot, 'public', 'app.js'), 'utf8'),
]);
const manifest = JSON.parse(manifestSource);
assert.equal(manifest.schemaVersion, 1);
assert.deepEqual(manifest.approval, { status: 'pending', reviewedBy: null });
assert.equal(manifest.provenance.method, 'imagegen pixel module kit');
assert.equal(manifest.provenance.imageModel, 'gpt-image-2.5');
assert.equal(manifest.provenance.generator, 'scripts/prepare-pixel-assets.py');
assert.deepEqual(manifest.assets.map(asset => asset.id), expectedAssets.map(asset => asset.id));
assert.equal(manifest.assets.length, 12, 'eight illustrations plus four reusable UI modules');

const expectedPlacements = new Map([
  ['battle-scene', 2],
  ['start-scene', 1],
  ['map-scene', 1],
  ['player', 2],
  ['enemy', 1],
  ['artifact-rr09', 1],
  ['artifact-rr11', 1],
  ['artifact-rr15', 1],
]);
const placements = [...html.matchAll(/\bdata-asset-target="([^"]+)"/g)].map(match => match[1]);
assert.equal(placements.length, 10, 'HTML has exactly ten active asset placements');
assert.deepEqual(
  [...new Set(placements)].sort(),
  [...expectedPlacements.keys()].sort(),
  'HTML placement IDs match the eight active manifest entries',
);
for (const [id, expectedCount] of expectedPlacements) {
  assert.equal(placements.filter(placement => placement === id).length, expectedCount,
    `${id}: HTML placement count`);
}

const auditResults = [];
for (const [index, expected] of expectedAssets.entries()) {
  const asset = manifest.assets[index];
  const src = `/assets/${expected.file}`;
  assert.equal(asset.src, src, `${expected.id}: active asset path`);
  assert.equal(asset.kind, expected.kind, `${expected.id}: kind`);
  assert.equal(asset.required, true, `${expected.id}: required`);
  if (expected.screen) assert.equal(asset.screen, expected.screen, `${expected.id}: screen`);
  if (expected.target) assert.equal(asset.target, expected.target, `${expected.id}: target`);
  if (expected.contentId) assert.equal(asset.contentId, expected.contentId, `${expected.id}: content id`);
  assert.ok(
    appSource.includes(`['${expected.id}', { src: '${src}', kind: '${expected.kind}'`),
    `${expected.id}: application path contract`,
  );

  const filename = path.join(assetRoot, expected.file);
  const [bytes, info] = await Promise.all([readFile(filename), stat(filename)]);
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(info.size, bytes.length, `${expected.id}: filesystem size`);
  assert.match(asset.source.path, /^output\/imagegen-pixel-kit\/[a-z0-9-]+\.png$/);
  assert.match(asset.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(asset.processed.sha256, hash, `${expected.id}: exported hash`);
  assert.equal(asset.source.origin, 'imagegen', `${expected.id}: source origin`);
  assert.deepEqual(asset.processed.dimensions, expected.dimensions, `${expected.id}: output dimensions`);
  assert.equal(asset.processed.format, 'png', `${expected.id}: output format`);
  assert.equal(asset.processed.pixelArt, true, `${expected.id}: pixel art`);
  assert.equal(asset.processed.antialias, 'none', `${expected.id}: hard alpha edges`);
  assert.equal(asset.processed.bytes, bytes.length, `${expected.id}: manifest byte count`);

  const decoded = decodePng(bytes);
  assert.deepEqual([decoded.width, decoded.height], expected.dimensions, `${expected.id}: decoded dimensions`);
  const pixels = inspectPixels(decoded);
  for (const field of [
    'alphaExtrema',
    'alphaZeroPixels',
    'alphaNonzeroPixels',
    'alphaNonzeroBBox',
    'alphaTransparentPaddingPx',
    'paletteColors',
  ]) {
    assert.deepEqual(asset.processed[field], pixels[field], `${expected.id}: manifest ${field}`);
  }
  assert.ok(pixels.paletteColors >= 4 && pixels.paletteColors <= 24,
    `${expected.id}: shared limited palette`);
  assert.equal(pixels.alphaPartialPixels, 0, `${expected.id}: no glow or blurred alpha`);

  if (expected.kind === 'scene') {
    assert.deepEqual(pixels.alphaExtrema, [255, 255], `${expected.id}: opaque scene`);
    assert.equal(pixels.alphaZeroPixels, 0, `${expected.id}: opaque scene pixel count`);
    assert.deepEqual(pixels.alphaNonzeroBBox, [0, 0, 192, 384], `${expected.id}: full-bleed scene bounds`);
    const backgroundPixels = pixels.colorCounts['#e4ebe2'] ?? 0;
    assert.ok(backgroundPixels > 192 * 384 * 0.65,
      `${expected.id}: at least 65% plain negative space`);
    for (let y = 0; y < 256; y += 1) {
      for (let x = 0; x < decoded.width; x += 1) {
        const offset = (y * decoded.width + x) * 4;
        assert.equal(decoded.pixels.subarray(offset, offset + 3).toString('hex'), 'e4ebe2',
          `${expected.id}: the upper text region must remain perfectly plain`);
      }
    }
  } else if (expected.kind === 'character') {
    assert.deepEqual(pixels.alphaExtrema, [0, 255], `${expected.id}: transparent sprite`);
    assert.ok(pixels.alphaTransparentPaddingPx.every(value => value >= 4),
      `${expected.id}: character has full-body transparent edge padding`);
    assert.ok(pixels.alphaNonzeroPixels > 1200, `${expected.id}: substantial full-body silhouette`);
  } else if (expected.kind === 'artifact') {
    assert.deepEqual(pixels.alphaExtrema, [0, 255], `${expected.id}: transparent icon`);
    assert.ok(pixels.alphaTransparentPaddingPx.every(value => value >= 3),
      `${expected.id}: icon has transparent edge padding`);
    assert.ok(pixels.alphaNonzeroPixels > 120, `${expected.id}: readable artifact silhouette`);
  } else {
    assert.equal(asset.slice.length, 4, `${expected.id}: explicit inspected nine-slice margins`);
    assert.ok(pixels.alphaNonzeroPixels > 200, `${expected.id}: populated UI module`);
  }
  auditResults.push({ id: expected.id, dimensions: expected.dimensions, ...pixels });
}

console.log(`Offline raster audit passed: ${auditResults.length} imagegen PNG exports decoded; ` +
  'hashes, hard alpha, shared palette, quiet sky and asset mappings match.');
