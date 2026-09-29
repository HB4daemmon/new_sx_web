import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const artModule = process.env.SHANHAI_ART_MODULE
  ? pathToFileURL(process.env.SHANHAI_ART_MODULE).href
  : new URL('../dist/art.js', import.meta.url).href;
const { esc, icon, landscape, portrait, sigil } = await import(artModule);

const existingIcons = [
  'sword', 'swords', 'spear', 'flame', 'shield', 'mirror', 'fist', 'bolt', 'lotus',
  'sun', 'moon', 'eye', 'mountain', 'cloud', 'wave', 'pearl', 'bell', 'flag', 'jade',
  'feather', 'lamp', 'coin', 'gourd', 'ring', 'seal', 'orbs', 'book', 'gate', 'camp',
  'diamond', 'skull', 'gear', 'sound', 'help', 'arrow', 'check', 'close', 'heart', 'star',
  'tree', 'archive', 'restart',
];
const portraitKinds = [
  'swordsman', 'hermit', 'guardian', 'nezha', 'sorcerer', 'fox', 'demon', 'peacock', 'golem',
];

function assertSvg(markup) {
  assert.match(markup, /^<svg\b[\s\S]*<\/svg>$/);
}

test('all established and added icon names render complete inline SVGs', () => {
  for (const name of existingIcons) assertSvg(icon(name));
  assert.notEqual(icon('book'), icon('tree'));
  assert.notEqual(icon('book'), icon('archive'));
  assert.notEqual(icon('mirror'), icon('restart'));
});

test('portraits identify each supported role in Chinese and retain their rendering classes', () => {
  for (const kind of portraitKinds) {
    const markup = portrait(kind, true);
    assertSvg(markup);
    assert.match(markup, /class="portrait portrait-large"/);
    assert.match(markup, /class="portrait-ground"/);
    assert.match(markup, /class="portrait-halo"/);
    assert.match(markup, /class="portrait-figure"/);
    const label = markup.match(/\baria-label="([^"]+)"/)?.[1] ?? '';
    assert.match(label, /[\u3400-\u9fff]/);
    assert.notEqual(label, kind);
  }
});

test('landscape exposes its styling layers and separate instances have unique definition ids', () => {
  const scenes = `${landscape()}${landscape()}`;
  for (const layer of ['sky', 'distant', 'middle', 'near', 'architecture']) {
    assert.match(scenes, new RegExp(`class="landscape-${layer}"`));
  }
  const ids = [...scenes.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.ok(ids.length >= 2);
  assert.equal(new Set(ids).size, ids.length);
});

test('portraits have no opaque full-canvas background that can mask the battle stage', () => {
  for (const kind of portraitKinds) {
    const markup = portrait(kind);
    assertSvg(markup);
    assert.doesNotMatch(markup, /<rect\b/);
    assert.doesNotMatch(markup, /<image\b/);
  }
});

test('public exports remain string-producing functions and escape untrusted attributes', () => {
  for (const exported of [esc, icon, landscape, portrait, sigil]) {
    assert.equal(typeof exported, 'function');
  }
  const unsafeIcon = icon('sword', 18, 'tool" onload="alert(1)');
  assert.match(unsafeIcon, /class="icon tool&quot; onload=&quot;alert\(1\)"/);
  assert.doesNotMatch(unsafeIcon, /tool" onload=/);

  for (const markup of [portrait('fox" onload="alert(1)'), sigil('bell', 'jade" onload="alert(1)'), landscape()]) {
    assert.equal(typeof markup, 'string');
    assertSvg(markup);
    assert.doesNotMatch(markup, /\bonload=/);
  }

  assert.equal(esc(`<svg title='x'>&`), '&lt;svg title=&#39;x&#39;&gt;&amp;');
  assert.match(icon('sword', Number.NaN), /width="28" height="28"/);
  assert.match(portrait('<img src=x>'), /aria-label="行旅修士"/);
});
