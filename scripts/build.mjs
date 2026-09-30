import { mkdir, writeFile, copyFile, cp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertValidContent, validateContent } from '../tools/content-kit/src/validator.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const report = assertValidContent(await validateContent());
const casualAssets = [
  '1f30a.png',
  '1f319.png',
  '1f332.png',
  '1f3d5.png',
  '1f3fa.png',
  '1f441.png',
  '1f466.png',
  '1f472.png',
  '1f474.png',
  '1f479.png',
  '1f480.png',
  '1f48d.png',
  '1f48e.png',
  '1f4d6.png',
  '1f4dc.png',
  '1f50a.png',
  '1f514.png',
  '1f525.png',
  '1f52e.png',
  '1f6a9.png',
  '1f6e1.png',
  '1f98a.png',
  '1f99a.png',
  '1f9d1.png',
  '1f9d8.png',
  '1f9d9.png',
  '1fa94.png',
  '1fa99.png',
  '1fa9e.png',
  '1faa8.png',
  '1fab6.png',
  '1fab7.png',
  '2600.png',
  '2601.png',
  '2694.png',
  '2699.png',
  '26a1.png',
  '26e9.png',
  '26f0.png',
  '270a.png',
  '2714.png',
  '274c.png',
  '2754.png',
  '2764.png',
  '27a1.png',
  '2b50.png',
  'landscape.png',
];
await rm('build', { recursive: true, force: true });
const compile = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--pretty', 'false'], {
  stdio: 'inherit',
});
if (compile.status !== 0) process.exit(compile.status ?? 1);

// dist is exclusively the new game, with no bundles from another runtime.
await rm('dist', { recursive: true, force: true });
await rm('PLAY.html', { force: true });
await mkdir('dist/content', { recursive: true });
await cp('build/shanhai', 'dist/shanhai', { recursive: true });
await copyFile('build/art.js', 'dist/art.js');
await copyFile('src/shanhai/style.css', 'dist/shanhai/style.css');
await copyFile('src/shanhai/casual-theme.css', 'dist/shanhai/casual-theme.css');
await mkdir('dist/assets/generated', { recursive: true });
await copyFile(
  'assets/generated/combat-vfx-atlas.webp',
  'dist/assets/generated/combat-vfx-atlas.webp',
);
await mkdir('dist/assets/casual', { recursive: true });
for (const file of casualAssets) {
  await copyFile(`assets/casual/${file}`, `dist/assets/casual/${file}`);
}
await copyFile('assets/casual/CREDITS.txt', 'dist/assets/casual/CREDITS.txt');
await copyFile('assets/casual/LICENSE', 'dist/assets/casual/LICENSE.txt');
await copyFile('index.html', 'dist/index.html');
await writeFile('dist/.nojekyll', '');

const files = [];
for (const authored of report.model.entities) {
  const { __manifest, __path, ...entity } = authored;
  const relative = __path.replace(/\.ya?ml$/i, '.json');
  const destination = path.join('dist/content', relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(entity));
  files.push(relative);
}
await writeFile('dist/content/manifest.json', JSON.stringify({
  version: report.model.manifest.content_version,
  files,
}));
console.log(`Shanhai build OK: ${files.length} validated content entities; native ES modules; dist/index.html`);
