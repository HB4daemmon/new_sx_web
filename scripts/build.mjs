import { mkdir, writeFile, copyFile, cp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertValidContent, validateContent } from '../tools/content-kit/src/validator.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const report = assertValidContent(await validateContent());
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
