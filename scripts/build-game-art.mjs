import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const previewRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../tools/ui-preview/public',
);
const frameCharacters = ['RKF01', 'RKF02', 'RKF03', 'RKF04', 'RKF05', 'EN-A1-L1'];
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

function publicAssetPath(source, label) {
  if (typeof source !== 'string' || !/^\/assets\/[a-zA-Z0-9][a-zA-Z0-9._-]*\.png$/.test(source)) {
    throw new Error(`Invalid public game-art path for ${label}: ${source}`);
  }
  return source;
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
  const [base, library, frames] = await Promise.all([
    readFile(path.join(sourceRoot, 'manifest.json'), 'utf8').then(JSON.parse),
    readFile(path.join(sourceRoot, 'library.json'), 'utf8').then(JSON.parse),
    readFile(path.join(sourceRoot, 'frames.json'), 'utf8').then(JSON.parse),
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

  const manifestRows = base.assets;
  const libraryRows = library.assets;
  if (!Array.isArray(manifestRows) || !Array.isArray(libraryRows)) {
    throw new Error('Game-art manifests must declare explicit asset arrays');
  }
  if (!library.artifacts || Object.keys(library.artifacts).length !== 44) {
    throw new Error('The approved art library must map all 44 artifacts');
  }
  if (!library.map || Object.keys(library.map).length !== 6) {
    throw new Error('The approved art library must map all six map illustrations');
  }
  if (!frames.characters || Object.keys(frames.characters).length !== frameCharacters.length) {
    throw new Error('The approved frame manifest must contain exactly six characters');
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
  for (const id of frameCharacters) {
    const character = frames.characters?.[id];
    if (!character) throw new Error(`Missing approved frame character: ${id}`);
    remember(character.src, character.sha256, `frames.${id}`);
  }

  const approvedAssets = new Map();
  const include = (source, kind, label) => {
    const assetPath = publicAssetPath(source, label);
    const digest = digestBySource.get(assetPath);
    if (!digest) throw new Error(`No manifest SHA-256 declared for approved asset: ${assetPath}`);
    approvedAssets.set(assetPath, { sha256: digest, kind });
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
  const characters = Object.fromEntries(frameCharacters.map(id => {
    const source = publicAssetPath(frames.characters[id].src, `frames.${id}`);
    return [id, include(source, 'animation-frame', `frames.${id}`)];
  }));

  const outputAssets = path.join(destination, 'assets');
  await mkdir(outputAssets, { recursive: true });
  await mkdir(path.join(destination, 'shanhai'), { recursive: true });
  for (const [source, record] of approvedAssets) {
    const bytes = await readFile(path.join(root, 'tools/ui-preview/public', source.slice(1)));
    if (sha256(bytes) !== record.sha256) {
      throw new Error(`SHA-256 mismatch for approved game art: ${source}`);
    }
    if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
      throw new Error(`Approved game-art resource is not a PNG: ${source}`);
    }
    await copyFile(
      path.join(root, 'tools/ui-preview/public', source.slice(1)),
      path.join(outputAssets, path.basename(source)),
    );
  }

  await copyFile(path.join(sourceRoot, 'frames.json'), path.join(outputAssets, 'frames.json'));
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
    frames: characters,
    assets: Object.fromEntries([...approvedAssets].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0).map(([source, record]) => [source, record])),
  };
  await writeFile(
    path.join(outputAssets, 'game-art.json'),
    `${JSON.stringify(releaseManifest, null, 2)}\n`,
  );
  return releaseManifest;
}
