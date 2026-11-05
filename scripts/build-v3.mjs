// Builds 山海劫 V3 into dist/: native ES modules, one stylesheet, keyed WebP art.
import { cp, copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
await rm('build/v3', { recursive: true, force: true });
const compile = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.v3.json', '--pretty', 'false'], { stdio: 'inherit' });
if (compile.status !== 0) process.exit(compile.status ?? 1);
await rm('dist', { recursive: true, force: true });
await mkdir('dist/assets/fonts', { recursive: true });
await cp('build/v3', 'dist/v3', { recursive: true });
await copyFile('src/v3/ui/v3.css', 'dist/v3/v3.css');
await cp('assets/v3', 'dist/assets/v3', { recursive: true, filter: source => !source.endsWith('manifest.json') });
for (const f of ['ma-shan-zheng-v3.woff2', 'MaShanZheng-OFL.txt', 'brush-fallback-v3.woff2', 'LXGWWenKai-OFL.txt']) await copyFile(`assets/fonts/${f}`, `dist/assets/fonts/${f}`);
await copyFile('index.html', 'dist/index.html');
await writeFile('dist/.nojekyll', '');
// GitHub Pages serves this branch as-is, so the compiled game is also committed at
// the repo root (v3/), next to index.html and assets/. Never edit v3/ by hand.
await rm('v3', { recursive: true, force: true });
await cp('dist/v3', 'v3', { recursive: true });
console.log('山海劫 V3 build OK: dist/index.html');
