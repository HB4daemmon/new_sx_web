import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = file => readFileSync(file, 'utf8');
const moduleStatement = /(?:^|\n)\s*(?:import|export)\b/m;
const requiredInterfaces = ['collectBuildSources', 'analyzeAbilityFit', 'compareLoadouts', 'buildStatusLabel'];

function embeddedBundle(html) {
  return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .find(script => script.includes('collectBuildSources'));
}

function normalizeAssetReferences(code) {
  return code
    .replace(/data:image\/webp;base64,[A-Za-z0-9+/=]+/g, '__GENERATED_ASSET__')
    .replace(/\.\/assets\/generated\/combat-vfx-atlas\.webp/g, '__GENERATED_ASSET__');
}

test('web and offline bundles contain the build-analysis interfaces without module statements', () => {
  const distApp = read('dist/app.js');
  const play = read('PLAY.html');
  const distPlay = read('dist/PLAY.html');
  const playApp = embeddedBundle(play);
  const distPlayApp = embeddedBundle(distPlay);

  assert.equal(typeof playApp, 'string');
  assert.equal(typeof distPlayApp, 'string');
  for (const name of requiredInterfaces) {
    assert.match(distApp, new RegExp(`\\b${name}\\b`), name);
    assert.match(playApp, new RegExp(`\\b${name}\\b`), name);
    assert.match(distPlayApp, new RegExp(`\\b${name}\\b`), name);
  }
  assert.doesNotMatch(distApp, moduleStatement);
  assert.doesNotMatch(playApp, moduleStatement);
  assert.doesNotMatch(distPlayApp, moduleStatement);
});

test('offline bundles use the same application code as the regular web bundle', () => {
  const distApp = read('dist/app.js');
  const playApp = embeddedBundle(read('PLAY.html'));
  const distPlay = read('dist/PLAY.html');
  const distPlayApp = embeddedBundle(distPlay);

  assert.equal(read('PLAY.html'), distPlay);
  assert.equal(normalizeAssetReferences(playApp), normalizeAssetReferences(distApp));
  assert.equal(playApp, distPlayApp);
});
