import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { icon, landscape, portrait, sigil } from '../build/art.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_DIR = path.join(ROOT, 'assets/casual');
const ICON_ASSETS = {
  sword: '2694.png',
  swords: '2694.png',
  spear: '2694.png',
  flame: '1f525.png',
  shield: '1f6e1.png',
  mirror: '1fa9e.png',
  fist: '270a.png',
  bolt: '26a1.png',
  lotus: '1fab7.png',
  sun: '2600.png',
  moon: '1f319.png',
  eye: '1f441.png',
  mountain: '26f0.png',
  cloud: '2601.png',
  wave: '1f30a.png',
  pearl: '1f52e.png',
  orbs: '1f52e.png',
  bell: '1f514.png',
  flag: '1f6a9.png',
  jade: '1f48e.png',
  feather: '1fab6.png',
  lamp: '1fa94.png',
  coin: '1fa99.png',
  gourd: '1f3fa.png',
  ring: '1f48d.png',
  seal: '1f4dc.png',
  book: '1f4d6.png',
  gate: '26e9.png',
  camp: '1f3d5.png',
  diamond: '1f48e.png',
  skull: '1f480.png',
  gear: '2699.png',
  sound: '1f50a.png',
  help: '2754.png',
  arrow: '27a1.png',
  check: '2714.png',
  close: '274c.png',
  heart: '2764.png',
  star: '2b50.png',
};
const PORTRAIT_ASSETS = {
  swordsman: '1f472.png',
  hermit: '1f474.png',
  guardian: '1f9d8.png',
  nezha: '1f466.png',
  sorcerer: '1f9d9.png',
  fox: '1f98a.png',
  demon: '1f479.png',
  peacock: '1f99a.png',
  golem: '1faa8.png',
  traveler: '1f9d1.png',
};
const SIGIL_NAMES = ['book', 'close', 'gate', 'gourd', 'shield', 'swords'];
const ART_PNGS = [
  ...new Set([
    ...Object.values(ICON_ASSETS),
    ...Object.values(PORTRAIT_ASSETS),
    '1f332.png',
    'landscape.png',
  ]),
];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function attributes(markup) {
  const match = markup.match(/^<img\b([^>]*)>$/);
  assert.ok(match, `expected one img element, received ${markup}`);
  assert.doesNotMatch(markup, /<svg\b/i, 'art output must not contain SVG');
  return Object.fromEntries(
    [...match[1].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)]
      .map(([, name, value]) => [name, value]),
  );
}

async function assertPng(filename, width = 72, height = 72) {
  const bytes = await readFile(path.join(ASSET_DIR, filename));
  assert.deepEqual(bytes.subarray(0, 8), PNG_SIGNATURE, `${filename} PNG signature`);
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', `${filename} IHDR`);
  assert.equal(bytes.readUInt32BE(16), width, `${filename} width`);
  assert.equal(bytes.readUInt32BE(20), height, `${filename} height`);
}

test('icons and sigils use fixed-size PNG images with Chinese alt text', async () => {
  for (const [name, filename] of Object.entries(ICON_ASSETS)) {
    const image = attributes(icon(name, 19, 'test-class'));
    assert.equal(image.class, 'icon test-class', name);
    assert.equal(image.width, '19', name);
    assert.equal(image.height, '19', name);
    assert.equal(image.src, `./assets/casual/${filename}`, name);
    assert.ok(image.alt.length > 0, `${name} should have Chinese alt text`);
    assert.equal(image['data-icon'], name);
    assert.equal(image.draggable, 'false');
  }

  const fallback = attributes(icon('not-a-known-icon'));
  assert.equal(fallback.src, './assets/casual/2b50.png');
  assert.equal(fallback.alt, '星星');

  for (const name of SIGIL_NAMES) {
    const image = attributes(sigil(name, 'mythic'));
    assert.equal(image.class, 'sigil', name);
    assert.equal(image.src, `./assets/casual/${ICON_ASSETS[name]}`, name);
    assert.ok(image.alt.length > 0, `${name} sigil should have Chinese alt text`);
    assert.equal(image['data-sigil'], name);
    assert.equal(image['data-tone'], 'mythic');
  }

  for (const filename of ART_PNGS) {
    await assertPng(filename, filename === 'landscape.png' ? 800 : 72, filename === 'landscape.png' ? 840 : 72);
  }
});

test('portraits preserve their layout contract and named character kinds', async () => {
  for (const [kind, filename] of Object.entries(PORTRAIT_ASSETS)) {
    const compact = attributes(portrait(kind));
    assert.equal(compact.class, 'portrait');
    assert.equal(compact.width, '240');
    assert.equal(compact.height, '280');
    assert.equal(compact.src, `./assets/casual/${filename}`, kind);
    assert.ok(compact.alt.length > 0, `${kind} should have Chinese alt text`);
    assert.equal(compact['data-kind'], kind);

    const large = attributes(portrait(kind, true));
    assert.equal(large.class, 'portrait portrait-large');
    assert.equal(large.width, '240');
    assert.equal(large.height, '280');
  }

  const fallback = attributes(portrait('unmapped-kind', true));
  assert.equal(fallback.src, './assets/casual/1f9d1.png');
  assert.equal(fallback.alt, '成人');
  assert.equal(fallback['data-kind'], 'unmapped-kind');

  const scene = attributes(landscape());
  assert.equal(scene.class, 'landscape');
  assert.equal(scene.width, '800');
  assert.equal(scene.height, '840');
  assert.equal(scene.src, './assets/casual/landscape.png');
  assert.equal(scene.alt, '');
  await assertPng('landscape.png', 800, 840);
});

test('asset sources retain the upstream attribution and graphics license', async () => {
  const sources = await readFile(path.join(ASSET_DIR, 'SOURCES.md'), 'utf8');
  const license = await readFile(path.join(ASSET_DIR, 'LICENSE'), 'utf8');
  assert.match(sources, /jdecked\/twemoji\/tree\/v17\.0\.3/);
  assert.match(sources, /CC BY 4\.0/);
  assert.match(sources, /1f52e\.png.*水晶球/);
  assert.match(license, /Creative Commons Attribution 4\.0 International Public License/);
});

function resolvePlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    '/opt/tools/browser-tools/node_modules/playwright',
    '/product/wxq/node_modules/playwright',
    '/home/ubuntu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Continue through the locally configured browser-tool locations.
    }
  }
  return null;
}

const playwright = resolvePlaywright();
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
  '/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux/chrome';

test('all generated art img elements complete and decode in Chromium', {
  skip: !playwright || !existsSync(executablePath),
}, async () => {
  const markup = [
    ...Object.keys(ICON_ASSETS).map(name => icon(name)),
    ...SIGIL_NAMES.map(name => sigil(name)),
    ...Object.keys(PORTRAIT_ASSETS).map(kind => portrait(kind, true)),
    landscape(),
  ];
  const htmlImages = [];
  for (const item of markup) {
    const image = attributes(item);
    const filename = image.src.slice('./assets/casual/'.length);
    const bytes = await readFile(path.join(ASSET_DIR, filename));
    const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
    htmlImages.push(item.replace(image.src, dataUrl));
  }

  const browser = await playwright.chromium.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(`<main>${htmlImages.join('')}</main>`);
    const images = await page.evaluate(async () => {
      const elements = [...document.images];
      await Promise.all(elements.map(element => element.decode().catch(() => undefined)));
      return elements.map(element => ({
        complete: element.complete,
        naturalWidth: element.naturalWidth,
        naturalHeight: element.naturalHeight,
        alt: element.alt,
      }));
    });
    assert.equal(images.length, markup.length);
    assert.deepEqual(
      images.filter(image => !image.complete || !image.naturalWidth || !image.naturalHeight),
      [],
      'art image failed to load or decode',
    );
  } finally {
    await browser.close();
  }
});
