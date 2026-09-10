import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';

test('generated combat art stays small and isolated from ability SVGs',()=>{
 const app=readFileSync('src/app.ts','utf8'),css=readFileSync('src/style.css','utf8');
 for(const name of ['combat-damage','combat-heal','combat-shield','combat-dispel']){
  assert(app.includes(`./assets/generated/${name}.webp`));
  assert(statSync(`assets/generated/${name}.webp`).size<4096);
 }
 const card=app.slice(app.indexOf(' card('),app.indexOf(' rewards()'));
 assert(card.includes('sigil(a.art'));
 assert(!card.includes('generatedFx('));
 assert(css.includes('.combat-feedback-layer'));
});

test('combat overlay covers hp, shield and debuff consumption without changing rules',()=>{
 const app=readFileSync('src/app.ts','utf8');
 assert(app.includes("kind:'damage'"));
 assert(app.includes("kind:'heal'"));
 assert(app.includes("kind:'shield'"));
 assert(app.includes("kind:'shield-loss'"));
 assert(app.includes("kind:'dispel'"));
 assert.equal(readFileSync('src/engine.ts','utf8').includes('combatFeedback'),false);
});
