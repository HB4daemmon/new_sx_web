import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const result = await build({
  entryPoints: [new URL('../src/frames.js', import.meta.url).pathname],
  outfile: new URL('../public/rig.js', import.meta.url).pathname,
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  minify: true, legalComments: 'eof',
  write: false, metafile: true,
  banner: { js: '/*! PixiJS drawn-frame player; complete notices: /animation-LICENSE.txt */' },
});
const bundledPackages = new Set();
for (const output of Object.values(result.metafile.outputs)) {
  for (const [filename, detail] of Object.entries(output.inputs)) {
    if (!detail.bytesInOutput) continue;
    const match = filename.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/);
    if (match) bundledPackages.add(match[1]);
  }
}
let notices = await readFile(new URL('../src/animation-base-LICENSE.txt', import.meta.url), 'utf8');
for (const name of [...bundledPackages].sort()) {
  if (['pixi.js', 'pixi-dragonbones-runtime'].includes(name)) continue;
  const root = new URL(`../node_modules/${name}/`, import.meta.url);
  const info = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const license = name === '@pixi/colord'
    ? await readFile(new URL('../src/colord-LICENSE.txt', import.meta.url), 'utf8')
    : await readFile(new URL('LICENSE', root), 'utf8');
  notices += `\n\n${name} ${info.version}\n${'='.repeat(40)}\n${license.trim()}\n`;
}
const files = [
  [new URL('../public/rig.js', import.meta.url),
    Buffer.from(result.outputFiles[0].text.replace(/[ \t]+$/gm, ''))],
  [new URL('../public/animation-LICENSE.txt', import.meta.url), Buffer.from(notices)],
];
for (const [filename, bytes] of files) {
  if (process.argv.includes('--check')) {
    assert.ok(Buffer.from(bytes).equals(await readFile(filename)), `${filename.pathname}: run npm run build:animation`);
  } else {
    await writeFile(filename, bytes);
  }
}
console.log(`${process.argv.includes('--check') ? 'Verified' : 'Built'} pinned PixiJS drawn-frame player and notices`);
