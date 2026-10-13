import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../public/cartoon.css', import.meta.url), 'utf8');
const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
assert.match(html, /href="\/cartoon.css"/);
assert.doesNotMatch(html, /href="\/pixel.css"/);
for (const module of ['panel', 'button-primary', 'button-secondary', 'meter']) {
  assert.ok(css.includes(`/assets/ui-${module}.png`), `${module}: real raster module used`);
}
assert.match(css, /image-rendering:\s*auto/);
assert.doesNotMatch(css, /pixelated/);
assert.doesNotMatch(css, /\.game-screen::before/, 'no decorative wash over the background');
assert.match(css, /prefers-reduced-motion:\s*reduce/);
assert.match(css, /\.artifact-details\s*\{[^}]*right:\s*6px/s);
assert.match(css, /\.battle-actors\s*\{[^}]*inset:\s*35%/s);

function luminance(hex) {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
const pairs = [
  ['#303b36', '#f1f4ef'],
  ['#526357', '#f1f4ef'],
  ['#785a27', '#f1f4ef'],
  ['#af453a', '#f1f4ef'],
  ['#38644f', '#f1f4ef'],
  ['#ffffff', '#af453a'],
];
for (const [ink, surface] of pairs) {
  const values = [luminance(ink), luminance(surface)].sort((a, b) => b - a);
  assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, `${ink} / ${surface}: text contrast`);
}
console.log('Cartoon surfaces passed: raster modules, quiet scene, contrast and reduced motion');
