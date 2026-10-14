import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { test } from 'node:test';

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(moduleRoot, 'scripts/prepare-rig-assets.py');
const parts = [
  'head', 'torso', 'backUpper', 'backForearm', 'frontUpper', 'frontForearm',
  'handGrip', 'skirt', 'legL', 'legR', 'weapon', 'ribbon',
];
const rigs = {
  RKF05: {
    asset: 'rig-rkf05',
    source: 'rig-sword-refined.png',
    prompt: 'prompts/rig-sword-v2-refinement.txt',
  },
  'EN-A1-L1': {
    asset: 'rig-en-a1-l1',
    source: 'rig-stone-refined.png',
    prompt: 'prompts/rig-stone-v2-refinement.txt',
  },
};
const targets = Object.values(rigs);

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, content) {
  const name = Buffer.from(type);
  const crcInput = Buffer.concat([name, content]);
  const result = Buffer.alloc(content.length + 12);
  result.writeUInt32BE(content.length, 0);
  name.copy(result, 4);
  content.copy(result, 8);
  result.writeUInt32BE(crc32(crcInput), result.length - 4);
  return result;
}

function makePng(width, height, channels, pixelAt) {
  const bytesPerPixel = channels;
  const scanlines = Buffer.alloc(height * (1 + width * bytesPerPixel));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * bytesPerPixel);
    scanlines[row] = 0;
    for (let x = 0; x < width; x++) {
      const values = pixelAt(x, y);
      for (let channel = 0; channel < channels; channel++) {
        scanlines[row + 1 + x * bytesPerPixel + channel] = values[channel];
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 4 ? 6 : 2;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function syntheticSource() {
  const width = 480, height = 360, cell = 120;
  return makePng(width, height, 4, (x, y) => {
    const column = Math.floor(x / cell), row = Math.floor(y / cell);
    const index = row * 4 + column;
    const localX = x - column * cell, localY = y - row * cell;
    const shapeWidth = 30 + (index % 4) * 7;
    const shapeHeight = 50 + (index % 3) * 9;
    const left = 20 + (index % 3) * 4, top = 17 + (index % 2) * 5;
    const inside = localX >= left && localX < left + shapeWidth &&
      localY >= top && localY < top + shapeHeight;
    const haze = localX === 4 && localY === 4;
    const edge = inside && (localX === left || localX === left + shapeWidth - 1 ||
      localY === top || localY === top + shapeHeight - 1);
    return [
      35 + index * 13,
      70 + index * 7,
      110 + index * 5,
      inside ? (edge ? 96 : 255) : haze ? 3 : 0,
    ];
  });
}

function makeLibrary() {
  const library = {
    schemaVersion: 1,
    styleApproval: { status: 'approved', by: 'user', date: '2026-10-13' },
    expansionApproval: { status: 'pending' },
    provenance: { model: 'gpt-image-2.5', keep: { nested: true } },
    rigs: {},
    map: Object.fromEntries(['coast', 'stairs', 'forest', 'gate', 'rest', 'shop']
      .map(name => [name, `/assets/map-${name}.png`])),
    artifacts: Object.fromEntries(Array.from({ length: 44 }, (_, index) => [
      `R${String(index).padStart(2, '0')}`, { src: `/assets/icon-${index}.png`, keep: index },
    ])),
    assets: [],
  };
  for (const id of ['RKF01', 'RKF02', 'RKF03', 'RKF04', ...Object.keys(rigs)]) {
    const assetName = rigs[id]?.asset ?? `rig-${id.toLowerCase()}`;
    library.rigs[id] = {
      name: `name-${id}`, src: `/assets/${assetName}.png`, parts: { legacy: [1, 2, 3, 4] },
      weaponGrip: id === 'RKF05' ? 0.77 : 0.9, preserveMe: { id },
    };
    library.assets.push({
      id: assetName, src: `/assets/${assetName}.png`, kind: 'rig',
      dimensions: [768, 768], sha256: 'old-hash', source: { old: id },
      preserveMe: { asset: id },
    });
  }
  library.assets.push({ id: 'unrelated', src: '/assets/unrelated.png', keep: true });
  return library;
}

function makeSpec() {
  const regions = Object.fromEntries(parts.map((part, index) => [
    part, [(index % 4) * 120, Math.floor(index / 4) * 120, 120, 120],
  ]));
  return {
    model: 'gpt-image-2.5',
    rigs: Object.fromEntries(Object.entries(rigs).map(([id, entry]) => [
      id, { source: entry.source, prompt: entry.prompt, regions: { ...regions } },
    ])),
  };
}

function runExporter({ specPath, sourceDir, outputDir, libraryPath }) {
  return spawnSync('uv', [
    'run', '--with', 'pillow', 'python', script,
    '--spec', specPath,
    '--source-dir', sourceDir,
    '--output-dir', outputDir,
    '--library', libraryPath,
  ], { cwd: moduleRoot, encoding: 'utf8' });
}

async function setupFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'rig-assets-test-'));
  const sourceDir = path.join(root, 'source');
  const outputDir = path.join(root, 'assets');
  await mkdir(sourceDir);
  await mkdir(outputDir);
  const png = syntheticSource();
  for (const target of targets) await writeFile(path.join(sourceDir, target.source), png);
  const specPath = path.join(root, 'rig-spec.json');
  const libraryPath = path.join(outputDir, 'library.json');
  const initialLibrary = makeLibrary();
  await writeFile(specPath, `${JSON.stringify(makeSpec(), null, 2)}\n`);
  await writeFile(libraryPath, `${JSON.stringify(initialLibrary, null, 2)}\n`);
  return { root, sourceDir, outputDir, specPath, libraryPath, initialLibrary };
}

async function writeSpec(fixture, spec) {
  await writeFile(fixture.specPath, `${JSON.stringify(spec, null, 2)}\n`);
}

async function pngDimensions(filename) {
  const bytes = await readFile(filename);
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function expectedRegion(index) {
  const column = index % 4, row = Math.floor(index / 4);
  return [column * 120, row * 120, 120, 120];
}

test('exports two 12-part layered-v2 atlases with matching hashes and preserves unrelated library data', async () => {
  const fixture = await setupFixture();
  try {
    const result = runExporter(fixture);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const updated = JSON.parse(await readFile(fixture.libraryPath, 'utf8'));
    assert.equal(updated.schemaVersion, 1);
    assert.deepEqual(updated.styleApproval, fixture.initialLibrary.styleApproval);
    assert.deepEqual(updated.expansionApproval, fixture.initialLibrary.expansionApproval);
    assert.deepEqual(updated.provenance, fixture.initialLibrary.provenance);
    assert.deepEqual(updated.map, fixture.initialLibrary.map);
    assert.deepEqual(updated.artifacts, fixture.initialLibrary.artifacts);

    for (const [rigId, target] of Object.entries(rigs)) {
      const imagePath = path.join(fixture.outputDir, `${target.asset}.png`);
      const imageBytes = await readFile(imagePath);
      const rig = updated.rigs[rigId];
      const originalRig = fixture.initialLibrary.rigs[rigId];
      assert.equal(rig.layout, 'layered-v2');
      assert.deepEqual(rig.dimensions, [1024, 768]);
      assert.deepEqual(Object.keys(rig.parts), parts);
      assert.deepEqual(rig.sourceRegions, makeSpec().rigs[rigId].regions);
      assert.deepEqual(
        Object.fromEntries(Object.entries(rig).filter(([key]) =>
          !['layout', 'dimensions', 'parts', 'sourceRegions'].includes(key))),
        Object.fromEntries(Object.entries(originalRig).filter(([key]) => key !== 'parts')),
      );
      assert.deepEqual(await pngDimensions(imagePath), [1024, 768]);

      const asset = updated.assets.find(item => item.id === target.asset);
      const originalAsset = fixture.initialLibrary.assets.find(item => item.id === target.asset);
      assert.deepEqual(asset.dimensions, [1024, 768]);
      assert.equal(asset.sha256, createHash('sha256').update(imageBytes).digest('hex'));
      assert.deepEqual(asset.source, {
        path: path.join('source', target.source),
        sha256: createHash('sha256').update(await readFile(path.join(fixture.sourceDir, target.source))).digest('hex'),
        origin: 'imagegen',
        model: 'gpt-image-2.5',
        prompt: target.prompt,
      });
      assert.deepEqual(
        Object.fromEntries(Object.entries(asset).filter(([key]) =>
          !['dimensions', 'sha256', 'source'].includes(key))),
        Object.fromEntries(Object.entries(originalAsset).filter(([key]) =>
          !['dimensions', 'sha256', 'source'].includes(key))),
      );

      for (const [index, part] of parts.entries()) {
        const [x, y, width, height] = rig.parts[part];
        const cellX = (index % 4) * 256, cellY = Math.floor(index / 4) * 256;
        assert.ok(x >= cellX + 16 && y >= cellY + 16, `${rigId}.${part} respects cell padding`);
        assert.ok(width > 0 && height > 0);
        assert.ok(x + width <= cellX + 240 && y + height <= cellY + 240);
        assert.deepEqual(rig.sourceRegions[part], expectedRegion(index));
      }
    }

    for (const id of ['RKF01', 'RKF02', 'RKF03', 'RKF04']) {
      assert.deepEqual(updated.rigs[id], fixture.initialLibrary.rigs[id]);
    }
    assert.deepEqual(
      updated.assets.filter(asset => !targets.some(target => target.asset === asset.id)),
      fixture.initialLibrary.assets.filter(asset => !targets.some(target => target.asset === asset.id)),
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('rejects invalid model, traversal, missing parts, out-of-bounds and alpha-less inputs without partial writes', async () => {
  const fixture = await setupFixture();
  try {
    let result = runExporter(fixture);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const outputPaths = [
      ...targets.map(target => path.join(fixture.outputDir, `${target.asset}.png`)),
      fixture.libraryPath,
    ];
    const baseline = await Promise.all(outputPaths.map(filename => readFile(filename)));
    const unchanged = async () => {
      const current = await Promise.all(outputPaths.map(filename => readFile(filename)));
      current.forEach((value, index) => assert.deepEqual(value, baseline[index], outputPaths[index]));
    };
    const rejected = async spec => {
      await writeSpec(fixture, spec);
      const attempt = runExporter(fixture);
      assert.notEqual(attempt.status, 0, `${attempt.stdout}\n${attempt.stderr}`);
      await unchanged();
    };

    const wrongModel = makeSpec();
    wrongModel.model = 'gpt-image-2';
    await rejected(wrongModel);

    const traversingSource = makeSpec();
    traversingSource.rigs.RKF05.source = '../rig-sword-v2.png';
    await rejected(traversingSource);

    const traversingPrompt = makeSpec();
    traversingPrompt.rigs.RKF05.prompt = '../prompts/rig-sword-v2.txt';
    await rejected(traversingPrompt);

    const missingPart = makeSpec();
    delete missingPart.rigs.RKF05.regions.ribbon;
    await rejected(missingPart);

    const lateOutOfBounds = makeSpec();
    lateOutOfBounds.rigs['EN-A1-L1'].regions.ribbon = [470, 350, 20, 20];
    await rejected(lateOutOfBounds);

    await writeSpec(fixture, makeSpec());
    await writeFile(path.join(fixture.sourceDir, rigs.RKF05.source),
      makePng(480, 360, 3, () => [40, 80, 120]));
    result = runExporter(fixture);
    assert.notEqual(result.status, 0);
    await unchanged();
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test('rejects unsupported library schema before replacing either atlas', async () => {
  const fixture = await setupFixture();
  try {
    const result = runExporter(fixture);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const outputPaths = [
      ...targets.map(target => path.join(fixture.outputDir, `${target.asset}.png`)),
      fixture.libraryPath,
    ];
    const before = await Promise.all(outputPaths.map(filename => readFile(filename)));
    const library = { ...fixture.initialLibrary, schemaVersion: 2 };
    await writeFile(fixture.libraryPath, `${JSON.stringify(library, null, 2)}\n`);
    const invalidLibrary = await readFile(fixture.libraryPath);
    const rejected = runExporter(fixture);
    assert.notEqual(rejected.status, 0);
    for (let index = 0; index < 2; index++) {
      assert.deepEqual(await readFile(outputPaths[index]), before[index]);
    }
    assert.deepEqual(await readFile(fixture.libraryPath), invalidLibrary);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
