import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const app = await readFile(new URL('../src/shanhai/app.ts', import.meta.url), 'utf8');

test('map and talent connectors use Canvas without SVG markup or namespace APIs', () => {
  assert.doesNotMatch(app, /<\s*\/?\s*svg\b|createElementNS|SVG[A-Z]/i);
  assert.equal((app.match(/<canvas class="map-lines"/g) || []).length, 2);
  assert.equal((app.match(/<canvas class="talent-tree-connectors"/g) || []).length, 1);
  assert.match(app, /canvas\.getContext\('2d'\)/);
  assert.match(app, /context\.setTransform\(dpr, 0, 0, dpr, 0, 0\)/);
  assert.match(app, /metadata\.dataset\.points = JSON\.stringify/);
});

test('route and talent connection metadata keeps stable node endpoints and state', () => {
  assert.match(app, /data-from-index="\$\{index\}" data-to-index="\$\{index \+ 1\}" data-completed="\$\{done\}"/);
  assert.match(app, /data-from-key="\$\{esc\(asText\(node\.key\)\)\}" data-to-key="\$\{esc\(asText\(next\.key\)\)\}"/);
  assert.match(app, /data-from-id="\$\{esc\(asText\(previous\.id\)\)\}" data-to-id="\$\{esc\(asText\(selected\.id\)\)\}" data-earned="true"/);
  assert.match(app, /data-from-id="\$\{esc\(asText\(previous\.id\)\)\}" data-to-id="\$\{esc\(asText\(choice\.id\)\)\}" data-next="true"/);
  assert.match(app, /this\.syncMapConnectors\(\)/);
  assert.match(app, /this\.syncTalentTreeConnectors\(\)/);
});

test('talent connectors resync after the modal entry transform completes', () => {
  assert.match(
    app,
    /addEventListener\('animationend', \(event\) => \{\s*if \(event\.animationName !== 'shanhai-modal-entry'\) return;\s*const modal = event\.target;\s*if \(!\(modal instanceof HTMLElement\) \|\| !modal\.matches\('\.modal'\) \|\|\s*!modal\.querySelector\('\.talent-tree-connectors'\)\) return;\s*this\.syncTalentTreeConnectors\(\);/,
  );
});
