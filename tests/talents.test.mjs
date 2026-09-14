import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game,fateOptions,simulateBattle,validateContent,talentEligible,talentCheckBonus,replayRun} from '../build/engine.js';
import {run} from './policy.mjs';
const c=JSON.parse(readFileSync('data/game.json','utf8'));
const fresh=(race='human',origin='wanderer',seed='TALENT')=>Game.create(c,seed,origin,fateOptions(c,seed)[0].id,'Test','',race);
const snap=g=>JSON.parse(JSON.stringify(g.s));
test('forty authored talents contain common and two racial chains per ancestry',()=>{
 assert.equal(c.talents.length,40);assert.equal(c.talents.filter(t=>t.race==='common').length,16);
 for(const r of c.races){const ts=c.talents.filter(t=>t.race===r.id);assert.equal(ts.length,6);assert.equal(new Set(ts.map(t=>t.path)).size,2);}
});
test('all twenty identities can resolve four queued breakthroughs without exhausted offers',()=>{
 for(const r of c.races)for(const o of c.origins){const g=fresh(r.id,o.id);g.gainXP(1000);const slots=JSON.stringify(g.s.slots);assert.deepEqual(g.s.talentQueue,[1,2,3,4]);
  for(let level=1;level<=4;level++){const d=g.s.talentDraft;assert.equal(d.level,level);assert(d.offers.some(id=>c.talents.find(t=>t.id===id).race==='common'));assert(d.offers.some(id=>c.talents.find(t=>t.id===id).race===r.id));const restored=Game.load(c,JSON.stringify(g.s));assert.deepEqual(snap(restored),snap(g));g.chooseTalent(d.offers[0]);}
  assert.equal(g.s.talents.length,4);assert.equal(JSON.stringify(g.s.slots),slots);assert(!g.s.talentDraft);Game.load(c,JSON.stringify(g.s));
 }
});
test('saved and repeated draft inspections never reroll or consume RNG',()=>{
 const g=fresh('dragon');g.gainXP(75);const before=snap(g);for(let i=0;i<5;i++){g.prepareTalents();g.stats();g.build();Game.load(c,JSON.stringify(g.s));}assert.deepEqual(snap(g),before);
});
test('unoffered and duplicate talent selection is rejected atomically',()=>{
 const g=fresh();g.gainXP(75);let before=snap(g);assert.throws(()=>g.chooseTalent('talent.spirit.sun'));assert.deepEqual(snap(g),before);
 const id=g.s.talentDraft.offers[0];g.chooseTalent(id);before=snap(g);assert.throws(()=>g.chooseTalent(id));assert.deepEqual(snap(g),before);
});
test('prerequisites and minimum level prevent skipping racial chain steps',()=>{
 const g=fresh();const t=c.talents.find(t=>t.id==='talent.human.enlighten');assert(!talentEligible(c,g.s,t,4));g.s.talents=['talent.human.learn','talent.human.insight'];assert(talentEligible(c,g.s,t,4));assert(!talentEligible(c,g.s,t,3));
});
test('human learning path creates four choices only for subsequent drafts',()=>{
 const g=fresh();g.gainXP(75);assert(g.s.talentDraft.offers.includes('talent.human.learn'));g.chooseTalent('talent.human.learn');
 const t=c.talents.find(t=>t.id==='talent.human.insight');g.s.talents.push(t.id);g.s.talentHistory.push({level:2,id:t.id});g.s.level=2;g.s.xp=200;
 g.gainXP(180);assert.equal(g.s.talentDraft.offers.length,4);assert.equal(talentCheckBonus(c,g.s),5);Game.load(c,JSON.stringify(g.s));
});
test('unresolved breakthrough blocks advancing or spending a reward',()=>{
 const g=fresh();g.gainXP(75);const before=snap(g);assert.throws(()=>g.enter(g.available()[0].id),/talent/);assert.deepEqual(snap(g),before);
});
test('talent history, duplicate offers and mixed pool validation reject corrupt saves',()=>{
 const g=fresh();g.gainXP(75);for(const mutate of [s=>s.talentQueue.push(4),s=>s.talentDraft.offers[1]=s.talentDraft.offers[0],s=>s.talentHistory.push({level:1,id:'bad'}),s=>s.talents.push('talent.human.defy')]){const s=snap(g);mutate(s);assert.throws(()=>Game.load(c,JSON.stringify(s)));}
});
test('maximum realm creates no extra choices and leaves current health unchanged',()=>{
 const g=fresh();g.s.hp=20;g.gainXP(1000);while(g.s.talentDraft)g.chooseTalent(g.s.talentDraft.offers.find(id=>c.talents.find(t=>t.id===id).race==='common'));assert.equal(g.s.hp,20);g.gainXP(10000);assert.equal(g.s.talentHistory.length,4);assert(!g.s.talentDraft);
});
test('on-hit talent quota is enforced for each round and independent fight',()=>{
 const g=fresh('spirit');g.s.talents=['talent.spirit.fox'];g.s.bonus.hp=1500;const enemy=structuredClone(c.enemies[0]);enemy.stats.hp=2000;enemy.stats.attack=1;
 const b=simulateBattle(c,g.s,enemy);const seen=new Set();let count=0;for(const f of b.frames.filter(f=>f.kind==='talent'&&f.sourceId==='talent.spirit.fox')){assert(!seen.has(f.round));seen.add(f.round);count++;}assert(count>1);
});
test('talents change actual combat without adding equipment or resonance counts',()=>{
 const g=fresh('ling');const before=g.build().resonances;g.s.talents=['talent.ling.whisper'];assert.deepEqual(g.build().resonances,before);const b=simulateBattle(c,g.s,c.enemies[0]);assert(b.frames.some(f=>f.sourceId==='talent.ling.whisper'));assert(b.frames.filter(f=>f.kind==='talent').every(f=>f.actor==='p'));
});
test('complete runs containing talent choices replay exactly',()=>{
 const g=run(c,'warrior','TALENT-REPLAY',400,'dragon');assert(g.s.actionLog.some(x=>x.command==='chooseTalent'));assert.deepEqual(replayRun(c,g.s),g.s);
});
test('talent validator rejects unknown race, forward prerequisite, unsafe cap and unknown trigger',()=>{
 for(const mutate of [x=>x.talents[0].race='missing',x=>x.talents[0].requires=['talent.human.enlighten'],x=>x.talents[0].triggers[0].maxPerRound=0,x=>x.talents[0].triggers[0].on='oops']){const d=structuredClone(c);mutate(d);assert.throws(()=>validateContent(d));}
});
