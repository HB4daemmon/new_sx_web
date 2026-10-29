import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadContent } from '../tools/content-kit/src/loader.mjs';

const previewRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../tools/ui-preview/public',
);
const playerCharacters = ['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05'];
const baseFrameCharacters = [...playerCharacters, 'EN-A1-L1'];
const frameSize = [400, 448];
const sceneAssets = [
  ['start', 'start-scene'],
  ['map', 'map-scene'],
  ['battle', 'battle-scene'],
];
const moduleAssets = [
  ['panel', 'ui-panel'],
  ['buttonPrimary', 'ui-button-primary'],
  ['buttonSecondary', 'ui-button-secondary'],
  ['meter', 'ui-meter'],
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function readJson(filename, label) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Missing ${label}: ${filename}`);
    throw error;
  }
}

function publicAssetPath(source, label) {
  if (typeof source !== 'string' || !/^\/assets\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/.test(source)) {
    throw new Error(`Invalid public game-art path for ${label}: ${source}`);
  }
  return source;
}

function pngDimensions(buffer, source) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`Enemy animation resource is not a PNG: ${source}`);
  }
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

function validateFrameCharacter(character, id, dimensions, { enemy = false } = {}) {
  const source = publicAssetPath(character?.src, `frames.${id}`);
  if (!Array.isArray(character.frames) || character.frames.length !== 12 ||
      new Set(character.frames.map(frame => JSON.stringify(frame))).size !== 12 ||
      !character.frames.every(frame =>
        Array.isArray(frame) && frame.length === 4 &&
        frame.every(Number.isInteger) && frame[2] === frameSize[0] &&
        frame[3] === frameSize[1] && frame[0] >= 0 && frame[1] >= 0 &&
        frame[0] + frame[2] <= dimensions[0] && frame[1] + frame[3] <= dimensions[1])) {
    throw new Error(`Invalid twelve-pose frame rectangles for ${id}`);
  }
  if (!Array.isArray(character.anchor) || character.anchor[0] !== 160 ||
      character.anchor[1] !== 420 ||
      !Number.isFinite(character.bodyHeight) || character.bodyHeight <= 0) {
    throw new Error(`Invalid animation anchor or body height for ${id}`);
  }
  if (enemy && (!Array.isArray(character.dimensions) ||
      character.dimensions[0] !== dimensions[0] ||
      character.dimensions[1] !== dimensions[1] ||
      !Array.isArray(character.cels) || character.cels.length !== 12 ||
      !character.cels.every(cel => Array.isArray(cel?.bounds) && cel.bounds.length === 4 &&
        cel.bounds.every(Number.isFinite)))) {
    throw new Error(`Missing dimensions or cel bounds for enemy animation: ${id}`);
  }
  return source;
}

function enemySizeMetric(character) {
  return Math.round(Math.max(...character.cels.map(({ bounds }) =>
    Math.max(bounds[3] - bounds[1], (bounds[2] - bounds[0]) * 0.85))));
}

function approved(manifest, name, predicate) {
  if (!predicate(manifest)) throw new Error(`${name} has not been approved for production`);
}

function requireRow(rows, id, kind, label) {
  const row = rows.find(asset => asset.id === id);
  if (!row || row.kind !== kind || row.required === false) {
    throw new Error(`Missing approved ${label} asset: ${id}`);
  }
  return row;
}

export async function buildGameArt({ root, destination }) {
  const sourceRoot = path.join(previewRoot, 'assets');
  const [base, library, frames, enemyFrames, content] = await Promise.all([
    readJson(path.join(sourceRoot, 'manifest.json'), 'cartoon asset manifest'),
    readJson(path.join(sourceRoot, 'library.json'), 'expanded art library'),
    readJson(path.join(sourceRoot, 'frames.json'), 'combat frame manifest'),
    readJson(path.join(root, 'assets/enemies/manifest.json'), 'enemy animation manifest'),
    loadContent({
      contentRoot: path.join(root, 'content/shanhai'),
      manifestPath: path.join(root, 'content/shanhai/manifest.yaml'),
    }),
  ]);

  approved(
    base,
    'Cartoon asset manifest',
    value => value.approval?.status === 'approved' && value.approval?.reviewedBy === 'user',
  );
  approved(
    library,
    'Expanded art library',
    value => value.expansionApproval?.status === 'approved' &&
      value.expansionApproval?.by === 'user' &&
      value.expansionApproval?.date === '2026-10-15',
  );
  approved(frames, 'Combat frame manifest', value => value.approval === 'approved');
  if (content.issues.length) throw new Error('Cannot build enemy art against invalid content');

  const manifestRows = base.assets;
  const libraryRows = library.assets;
  const artifactIds = (content.byKind.get('artifact') || []).map(artifact => artifact.id);
  const enemyIds = (content.byKind.get('enemy') || []).map(enemy => enemy.id);
  const enemyManifestIds = Object.keys(enemyFrames.characters || {});
  if (enemyIds.length !== 34 || new Set(enemyIds).size !== enemyIds.length ||
      enemyManifestIds.length !== enemyIds.length ||
      enemyIds.some(id => !Object.hasOwn(enemyFrames.characters, id)) ||
      enemyManifestIds.some(id => !enemyIds.includes(id))) {
    throw new Error('Enemy frame manifest must match all 34 content-loader enemy IDs');
  }
  if (enemyFrames.schemaVersion !== 1 ||
      !Array.isArray(enemyFrames.frameSize) ||
      enemyFrames.frameSize[0] !== frameSize[0] ||
      enemyFrames.frameSize[1] !== frameSize[1] ||
      enemyFrames.targetBodyHeight !== 300) {
    throw new Error('Invalid enemy animation frame manifest header');
  }
  if (!Array.isArray(manifestRows) || !Array.isArray(libraryRows)) {
    throw new Error('Game-art manifests must declare explicit asset arrays');
  }
  const mappedArtifactIds = Object.keys(library.artifacts || {});
  const contentArtifactIds = new Set(artifactIds);
  if (artifactIds.length !== 46 || mappedArtifactIds.length !== artifactIds.length ||
      artifactIds.some(id => !Object.hasOwn(library.artifacts || {}, id)) ||
      mappedArtifactIds.some(id => !contentArtifactIds.has(id))) {
    throw new Error('The approved art library must map exactly all 46 content artifacts');
  }
  if (!library.map || Object.keys(library.map).length !== 6) {
    throw new Error('The approved art library must map all six map illustrations');
  }
  if (!frames.characters || Object.keys(frames.characters).length !== baseFrameCharacters.length) {
    throw new Error('The approved frame manifest must contain five players and the stone guard');
  }
  if (!Object.hasOwn(enemyFrames.characters, 'EN-A1-L1') ||
      !isDeepStrictEqual(enemyFrames.characters['EN-A1-L1'], frames.characters['EN-A1-L1'])) {
    throw new Error('EN-A1-L1 must reuse the approved stone-guard frame entry');
  }
  const mergedFrameCharacters = {
    ...frames.characters,
    ...Object.fromEntries(enemyIds
      .filter(id => id !== 'EN-A1-L1')
      .map(id => {
        const character = enemyFrames.characters[id];
        return [id, { ...character, review: enemyFrames.review }];
      })),
  };
  if (Object.keys(mergedFrameCharacters).length !== playerCharacters.length + enemyIds.length) {
    throw new Error('Merged frame manifest contains duplicate or missing characters');
  }

  const digestBySource = new Map();
  const remember = (source, digest, label) => {
    const assetPath = publicAssetPath(source, label);
    if (!/^[a-f0-9]{64}$/.test(digest ?? '')) {
      throw new Error(`Missing SHA-256 for approved asset: ${assetPath}`);
    }
    const existing = digestBySource.get(assetPath);
    if (existing && existing !== digest) {
      throw new Error(`Conflicting SHA-256 declarations for approved asset: ${assetPath}`);
    }
    digestBySource.set(assetPath, digest);
  };

  for (const row of manifestRows) {
    if (row?.src && row.processed?.sha256) remember(row.src, row.processed.sha256, row.id);
  }
  for (const row of libraryRows) {
    if (row?.src && row.sha256) remember(row.src, row.sha256, row.id);
  }
  for (const id of baseFrameCharacters) {
    const character = frames.characters?.[id];
    if (!character) throw new Error(`Missing approved frame character: ${id}`);
    remember(character.src, character.sha256, `frames.${id}`);
  }

  const assetSources = new Map();
  const include = (source, kind, label, sourcePath, review) => {
    const assetPath = publicAssetPath(source, label);
    const digest = digestBySource.get(assetPath);
    if (!digest) throw new Error(`No manifest SHA-256 declared for approved asset: ${assetPath}`);
    assetSources.set(assetPath, {
      sha256: digest,
      kind,
      sourcePath: sourcePath || path.join(previewRoot, assetPath.slice(1)),
      ...(review ? { review } : {}),
    });
    return assetPath;
  };

  const scenes = Object.fromEntries(sceneAssets.map(([screen, id]) => {
    const row = requireRow(manifestRows, id, 'scene', 'scene');
    return [screen, include(row.src, 'scene', id)];
  }));
  const modules = Object.fromEntries(moduleAssets.map(([name, id]) => {
    const row = requireRow(manifestRows, id, 'module', 'UI module');
    return [name, include(row.src, 'module', id)];
  }));
  const maps = Object.fromEntries(Object.entries(library.map).map(([type, source]) => {
    const assetPath = publicAssetPath(source, `map.${type}`);
    const libraryRow = libraryRows.find(row => row.src === assetPath && row.kind === 'icon');
    if (!libraryRow) throw new Error(`No approved map asset declaration for ${type}`);
    return [type, include(assetPath, 'map', type)];
  }));
  const artifacts = Object.fromEntries(Object.entries(library.artifacts).map(([id, value]) => {
    const assetPath = publicAssetPath(value?.src, `artifact.${id}`);
    const libraryRow = libraryRows.find(row => row.src === assetPath && row.kind === 'icon');
    const baseRow = manifestRows.find(row => row.src === assetPath && row.kind === 'artifact');
    if (!libraryRow && !baseRow) throw new Error(`No approved artifact asset declaration for ${id}`);
    return [id, include(assetPath, 'artifact', id)];
  }));
  for (const id of baseFrameCharacters) {
    const source = publicAssetPath(frames.characters[id].src, `frames.${id}`);
    include(source, 'animation-frame', `frames.${id}`);
  }

  const enemySourceRoot = path.join(root, 'assets/enemies');
  const enemyHashes = new Set();
  const baseFrameHashes = new Set(baseFrameCharacters.map(id => frames.characters[id].sha256));
  for (const id of enemyIds) {
    const character = enemyFrames.characters[id];
    if (id === 'EN-A1-L1') {
      validateFrameCharacter(character, id, frames.characters[id].dimensions || [1200, 1792]);
      continue;
    }

    if (enemyFrames.review?.status !== 'agent-reviewed' ||
        enemyFrames.review.reviewedBy !== 'agent' ||
        enemyFrames.review.date !== '2026-10-15') {
      throw new Error(`Enemy art review must remain agent-reviewed: ${id}`);
    }
    if (character.approval?.status === 'approved' || character.approval === 'approved') {
      throw new Error(`Enemy art must not be marked user-approved: ${id}`);
    }

    const src = validateFrameCharacter(character, id, character.dimensions || []);
    const visualBodyHeight = enemySizeMetric(character);
    if (character.bodyHeight !== visualBodyHeight ||
        300 / visualBodyHeight < 0.6 || 300 / visualBodyHeight > 1.5) {
      throw new Error(`Enemy visual size metric is outside the supported range: ${id}`);
    }
    const expectedSrc = `/assets/frames-${id.toLowerCase()}.png`;
    if (src !== expectedSrc) throw new Error(`Unexpected enemy frame source for ${id}: ${src}`);
    const filename = path.basename(src);
    const filePath = path.join(enemySourceRoot, filename);
    const bytes = await readFile(filePath).catch(error => {
      if (error?.code === 'ENOENT') throw new Error(`Missing enemy frame PNG for ${id}: ${filePath}`);
      throw error;
    });
    const dimensions = pngDimensions(bytes, src);
    if (dimensions[0] % frameSize[0] !== 0 || dimensions[1] % frameSize[1] !== 0 ||
        dimensions[0] < frameSize[0] || dimensions[1] < frameSize[1] ||
        character.dimensions?.[0] !== dimensions[0] ||
        character.dimensions?.[1] !== dimensions[1]) {
      throw new Error(`Enemy frame dimensions do not match the PNG: ${id}`);
    }
    const digest = sha256(bytes);
    if (digest !== character.sha256) throw new Error(`SHA-256 mismatch for enemy art: ${id}`);
    if (enemyHashes.has(digest) || baseFrameHashes.has(digest)) {
      throw new Error(`Enemy frame PNG must have an independent SHA-256: ${id}`);
    }
    enemyHashes.add(digest);
    remember(src, digest, `frames.${id}`);
    include(src, 'animation-frame', `frames.${id}`, filePath, enemyFrames.review);
  }

  const outputAssets = path.join(destination, 'assets');
  await mkdir(outputAssets, { recursive: true });
  await mkdir(path.join(destination, 'shanhai'), { recursive: true });
  for (const [source, record] of assetSources) {
    const bytes = await readFile(record.sourcePath);
    if (sha256(bytes) !== record.sha256) {
      throw new Error(`SHA-256 mismatch for game art: ${source}`);
    }
    pngDimensions(bytes, source);
    await copyFile(
      record.sourcePath,
      path.join(outputAssets, path.basename(source)),
    );
  }

  const runtimeFrames = {
    ...frames,
    characters: mergedFrameCharacters,
  };
  await writeFile(
    path.join(outputAssets, 'frames.json'),
    `${JSON.stringify(runtimeFrames, null, 2)}\n`,
  );
  await copyFile(path.join(previewRoot, 'rig.js'), path.join(destination, 'shanhai/animation.js'));
  await copyFile(
    path.join(previewRoot, 'animation-LICENSE.txt'),
    path.join(destination, 'animation-LICENSE.txt'),
  );
  const releaseManifest = {
    schemaVersion: 1,
    approval: { ...base.approval },
    scenes,
    modules,
    map: maps,
    artifacts,
    frames: Object.fromEntries(Object.entries(mergedFrameCharacters).map(([id, character]) => [
      id,
      publicAssetPath(character.src, `frames.${id}`),
    ])),
    assets: Object.fromEntries([...assetSources].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0).map(([source, record]) => [source, {
      sha256: record.sha256,
      kind: record.kind,
      ...(record.review ? { review: record.review } : {}),
    }])),
  };
  await writeFile(
    path.join(outputAssets, 'game-art.json'),
    `${JSON.stringify(releaseManifest, null, 2)}\n`,
  );
  return releaseManifest;
}
