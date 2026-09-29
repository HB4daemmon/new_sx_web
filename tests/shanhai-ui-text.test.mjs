import assert from 'node:assert/strict';
import test from 'node:test';
import { semanticTextMarkup } from '../src/shanhai/ui-text.ts';

test('escapes authored markup while marking semantic numbers and keywords', () => {
  assert.equal(
    semanticTextMarkup('<img src=x>气血 +1,200，暴击率 12.5%'),
    '&lt;img src=x&gt;<strong class="text-keyword">气血</strong> <strong class="text-number">+1,200</strong>，<strong class="text-keyword">暴击率</strong> <strong class="text-number">12.5%</strong>',
  );
});

test('uses the longest matching keyword and does not nest emphasis', () => {
  assert.equal(
    semanticTextMarkup('护盾吸收 20 点', ['盾', '护盾', '护盾吸收']),
    '<strong class="text-keyword">护盾吸收</strong> <strong class="text-number">20</strong> 点',
  );
});

test('escapes custom keyword text and ignores non-text values', () => {
  assert.equal(semanticTextMarkup('<safe>', ['<safe>']), '<strong class="text-keyword">&lt;safe&gt;</strong>');
  assert.equal(semanticTextMarkup({ html: '<b>unsafe</b>' }), '');
});
