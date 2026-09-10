import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync,existsSync} from 'node:fs';

test('UI15 uses one compressed sprite atlas and keeps ability SVG art',()=>{
 const app=readFileSync('src/app.ts','utf8'),css=readFileSync('src/style.css','utf8'),build=readFileSync('scripts/build.mjs','utf8');
 assert(app.includes("const VFX_ATLAS='./assets/generated/combat-vfx-atlas.webp'"));
 assert(statSync('assets/generated/combat-vfx-atlas.webp').size<100000);
 for(const old of ['combat-damage.webp','combat-heal.webp','combat-shield.webp','combat-dispel.webp'])assert.equal(existsSync('assets/generated/'+old),false);
 const card=app.slice(app.indexOf(' card('),app.indexOf(' rewards()'));
 assert(card.includes('sigil(a.art'));
 assert(!card.includes('VFX_ATLAS'));
 assert(css.includes('@keyframes ui15-vfx-strip'));
 assert(build.includes("const generatedNames=['combat-vfx-atlas']"));
});

test('combat overlay exposes damage healing shields and status changes without touching engine rules',()=>{
 const app=readFileSync('src/app.ts','utf8');
 for(const kind of ["kind:'damage'","kind:'heal'","kind:'shield'","kind:'shield-loss'","kind:'status-add'","kind:'status-use'"])assert(app.includes(kind));
 assert(app.includes('combatVfx(frame:Frame'));
 assert(app.includes("kind='attack'"));
 assert(app.includes("kind='dispel'"));
 assert(app.includes('vfx-particles'));
 assert.equal(readFileSync('src/engine.ts','utf8').includes('combatVfx'),false);
});

test('UI15 keeps presentation-only compatibility',()=>{
 assert(readFileSync('src/presentation.ts','utf8').includes("UI_REVISION='15.0'"));
 assert.equal(JSON.parse(readFileSync('data/presentation.json','utf8')).revision,'15.0');
 assert.equal(JSON.parse(readFileSync('package.json','utf8')).version,'3.0.0');
});
