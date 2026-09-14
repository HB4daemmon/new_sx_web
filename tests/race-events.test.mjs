import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game,fateOptions} from '../build/engine.js';
import {narrativeAvailable} from '../build/presentation.js';
const c=JSON.parse(readFileSync('data/game.json','utf8'));
const fresh=(race='human',seed='RACE-EVENT')=>Game.create(c,seed,'wanderer',fateOptions(c,seed)[0].id,'Test','',race);
const ids=['race.human.0','race.human.2','race.spirit.0','race.spirit.2','race.dragon.1','race.dragon.3','race.ling.1','race.ling.3'];
test('eight ancestry stories form two-stage authored arcs with public checks',()=>{
 assert.equal(c.events.length,56);
 for(const id of ids){const e=c.events.find(x=>x.id===id);assert(e);assert(e.phases?.length>=2);assert(e.requirements?.some(q=>q.type==='race_is'));assert(e.phases.flatMap(p=>p.choices).some(ch=>ch.check));assert(e.phases.flatMap(p=>p.choices).every(ch=>ch.consequence||ch.preview));}
 for(const r of c.races)assert.equal(ids.map(id=>c.events.find(e=>e.id===id)).filter(e=>e.requirements.some(q=>q.type==='race_is'&&q.key===r.id)).length,2);
});
test('ancestry story checks are deterministic and logged with visible odds',()=>{
 const make=()=>{const g=fresh('spirit','RACE-EVENT-CHECK');g.s.phase='event';g.s.eventId='race.spirit.0';g.s.eventPhase='trail';return g;};
 const a=make(),b=make();const ca=a.eventChoices().find(x=>x.choice.id==='hide'),cb=b.eventChoices().find(x=>x.choice.id==='hide');assert.equal(ca.chance,cb.chance);a.chooseEvent('hide');b.chooseEvent('hide');assert.deepEqual(a.s.lastCheck,b.s.lastCheck);assert.deepEqual(a.s.storyLog,b.s.storyLog);assert(a.s.storyLog.at(-1).chance>=10&&a.s.storyLog.at(-1).chance<=95);
});
test('racial talents reveal alternate world solutions without replacing normal choices',()=>{
 const g=fresh('human');g.s.phase='event';g.s.eventId='race.human.0';g.s.eventPhase='gate';let options=g.eventChoices();const cite=options.find(x=>x.choice.id==='cite');assert(!cite.legal);assert(!narrativeAvailable(c,g.s,cite.choice));
 g.s.talents=['talent.human.learn'];options=g.eventChoices();const unlocked=options.find(x=>x.choice.id==='cite');assert(unlocked.legal);assert(narrativeAvailable(c,g.s,unlocked.choice));assert(options.some(x=>x.choice.id==='slip'&&x.chance));
});
test('later ancestry stories answer earlier facts instead of requiring a single canonical route',()=>{
 const expected=[['race.human.2','human_guarantee'],['race.spirit.2','spirit_freed_young'],['race.dragon.3','dragon_returned_bone'],['race.ling.3','ling_delivered_name']];
 for(const [id,key] of expected){const e=c.events.find(x=>x.id===id);assert(e.relevance?.some(q=>q.type==='has_fact'&&q.key===key));const choices=e.phases.flatMap(p=>p.choices);assert(choices.some(ch=>ch.conditions?.some(q=>q.type==='has_fact'&&q.key===key)));}
});
test('all ancestry story choices have authored presentation outcomes',()=>{
 const p=c.presentation;assert.equal(p.revision,'16.0');for(const id of ids){const e=c.events.find(x=>x.id===id),copy=p.events[id];assert(copy?.intro);for(const ph of e.phases)for(const ch of ph.choices){const x=copy.choices[`${ph.id}.${ch.id}`];assert(x,`${id}/${ph.id}/${ch.id}`);if(ch.check){assert(x.success&&x.failure);}else assert(x.outcome);}}
});
