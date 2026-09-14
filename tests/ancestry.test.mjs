import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game,fateOptions,simulateBattle,replayRun,conditionOK,validateContent} from '../build/engine.js';
const c=JSON.parse(readFileSync('data/game.json','utf8'));
const fresh=(race='human',origin='wanderer',seed='ANCESTRY')=>Game.create(c,seed,origin,fateOptions(c,seed)[0].id,'无名','',race);
test('all race and vocation combinations are valid and retain independent identities',()=>{
 assert.equal(c.races.length,4);assert.equal(c.origins.length,5);
 for(const r of c.races)for(const o of c.origins){const g=fresh(r.id,o.id);assert.equal(g.s.race,r.id);assert.equal(g.s.origin,o.id);assert.equal(g.s.slots.filter(Boolean).length,3);assert(g.s.hp>0);assert.deepEqual(Game.load(c,JSON.stringify(g.s)).s,JSON.parse(JSON.stringify(g.s)));}
});
test('race stat differences and racial conditions are derived without altering vocation',()=>{
 const human=fresh(),dragon=fresh('dragon');
 assert.equal(dragon.stats().hp-human.stats().hp,8);assert.equal(dragon.stats().speed-human.stats().speed,-1);
 assert(conditionOK(c,dragon.s,{type:'race_is',key:'dragon'}));assert(!conditionOK(c,human.s,{type:'race_is',key:'dragon'}));
 assert.throws(()=>fresh('invalid'));
});
test('racial passives apply to the player only and remain deterministic',()=>{
 for(const r of c.races){const a=fresh(r.id),b=fresh(r.id),enemy=c.enemies[0];const x=simulateBattle(c,a.s,enemy),y=simulateBattle(c,b.s,enemy);assert.deepEqual(x,y);
 assert(x.frames.filter(f=>f.sourceId?.startsWith('race.')).every(f=>f.actor==='p'));}
});
test('new replay retains race and old-version saves are explicitly rejected',()=>{
 const g=fresh('spirit');g.enter(g.available().find(n=>n.type==='combat').id);
 const s=replayRun(c,g.s);assert.deepEqual(s,g.s);
 const old=structuredClone(g.s);old.version=old.rulesVersion='3.0.0';assert.throws(()=>Game.load(c,JSON.stringify(old)),/version mismatch/);
 const bad=structuredClone(c);bad.races[0].triggers[0].effects[0].type='typo';assert.throws(()=>validateContent(bad));
});
test('UI preserves the legacy save key and skill SVGs while offering race selection',()=>{
 const app=readFileSync('src/app.ts','utf8');assert(app.includes("SAVE_KEY='fengshen-run-v4'"));assert(app.includes("LEGACY_SAVE_KEY='fengshen-run-v1'"));assert(app.includes('racePicker()'));assert(app.includes('sigil(a.art'));assert(!app.includes('removeItem(LEGACY_SAVE_KEY)'));
});
