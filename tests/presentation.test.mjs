
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Game,clone,fateOptions,validateContent} from '../build/engine.js';
import {abilityLines,choiceEffects,choiceCopy,storyText,resultText,narrativeAvailable,threadText,rankName} from '../build/presentation.js';
const c=JSON.parse(readFileSync(new URL('../data/game.json',import.meta.url),'utf8'));
const contract=JSON.parse(readFileSync(new URL('./fixtures/v12-contract.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const fresh=()=>Game.create(c,'IMMERSION-PRESENTATION','wanderer',fateOptions(c,'IMMERSION-PRESENTATION')[0].id,'Review');
const rootPhase=e=>e.phases?.find(p=>p.id===e.startPhase)??{id:'root',text:e.text,choices:e.choices};
test('expansion preserves the simulation policy and the authored presentation contract',()=>{
 assert.equal(hash(readFileSync(new URL('./policy.mjs',import.meta.url))),contract.policySha256);
 validateContent(c);
});
test('v13 presentation covers all event outcomes, including checks and phases',()=>{
 let choices=0;
 for(const e of c.events)for(const ph of e.phases??[rootPhase(e)])for(const ch of ph.choices){
  const cp=choiceCopy(c,e.id,ph.id,ch.id);
  for(const k of ch.check?['success','failure']:['outcome'])assert(cp[k]?.length>5,`${e.id}/${ph.id}/${ch.id}/${k}`);
  choices++;
 }
 assert.equal(choices,221);
});
test('v13 strangers are never described as returning friends',()=>{
 const g=fresh();
 for(const id of ['event.1.hermit','event.1.deal','event.2.ruins','event.2.deal','event.3.deal']){
  const e=c.events.find(e=>e.id===id),text=storyText(c,g.s,e,rootPhase(e));
  assert(!/认出|上次|上一次|第一次相遇|第二次|终于不笑/.test(text),id);
 }
});
test('v13 returning and repeated encounters select appropriate prose without RNG',()=>{
 const g=fresh(),e=c.events.find(e=>e.id==='event.1.hermit');
 const first=storyText(c,g.s,e,rootPhase(e));g.s.facts.met_nezha=true;
 const before=JSON.stringify(g.s);
 assert.match(storyText(c,g.s,e,rootPhase(e)),/认出/);assert.equal(JSON.stringify(g.s),before);
 g.s.seenEvents[e.id]=2;
 assert.notEqual(storyText(c,g.s,e,rootPhase(e)),first);
 assert(!storyText(c,g.s,e,rootPhase(e)).includes('第一次'));
});
test('v13 hides unearned narrative branches but leaves unaffordable visible costs',()=>{
 const g=fresh(),a=c.events.find(e=>e.id==='event.1.hermit').choices.find(x=>x.id==='back');
 assert.equal(narrativeAvailable(c,g.s,a),false);
 g.s.threads.char_nezha='信你一回';assert.equal(narrativeAvailable(c,g.s,a),true);
 g.s.gold=0;
 const pay=c.events.find(e=>e.id==='event.0.ruins').choices.find(x=>x.id==='pay');
 assert.equal(narrativeAvailable(c,g.s,pay),true);
});
test('v13 ability cards display current rank rather than ambiguous plus markers',()=>{
 const a=c.abilities.find(a=>a.id==='basic.sword');
 assert.match(abilityLines(c,a,0).join(''),/110%/);
 assert.match(abilityLines(c,a,3).join(''),/160%/);
 assert(!abilityLines(c,a,0).join('').includes('160%'));
 assert.equal(rankName(0),'初阶');
 for(const ability of c.abilities)for(let rank=0;rank<4;rank++)
  assert(!/undefined|NaN/.test(abilityLines(c,ability,rank).join('')));
});
test('v13 trigger prerequisites and resource damage caps remain legible',()=>{
 const all=c.abilities.flatMap(a=>abilityLines(c,a,0)).join('\n');
 assert.match(all,/护盾/);assert.match(all,/燃烧/);assert.match(all,/每战一次/);
 assert(!all.includes('因缘未至'));
 const ruby=c.abilities.find(a=>a.id==='rage.lotus');
 assert.match(abilityLines(c,ruby,0).join(''),/上限/);
});
test('v13 choices show losses, grants and both probability outcomes',()=>{
 const ev=c.events.find(e=>e.id==='event.0.deal');
 assert(choiceEffects(c,ev.choices.find(x=>x.id==='deal')).some(x=>x==='生命 -12'));
 const check=c.events.find(e=>e.id==='event.3.hermit').choices.find(x=>x.id==='last_coin');
 assert(choiceEffects(c,check,'failure').some(x=>x==='生命 -8'));
 assert.match(choiceCopy(c,'event.3.hermit','root','last_coin').label,/气血/);
});
test('v13 resolves geographic and seal semantics without rewriting rewards',()=>{
 const cp=choiceCopy(c,'event.2.hermit','root','scale');
 assert.match(cp.label,/托人送还/);assert(!cp.label.includes('海边'));
 assert.match(choiceCopy(c,'event.2.ruins','root','seal_fire').hint,/不会扣回/);
});
test('current saves keep the same state and outcome log while rendering new copy',()=>{
 const g=fresh();g.s.phase='event';g.s.eventId='major.0';g.chooseEvent('away');
 const before=JSON.stringify(g.s),loaded=Game.load(c,before),item=loaded.s.storyLog.at(-1);
 assert.equal(JSON.stringify(loaded.s),before);
 const text=resultText(c,item);assert.notEqual(text,item.result);
 assert.equal(JSON.stringify(loaded.s),before);
});
test('v13 former raw thread tokens render as story terms',()=>{
 assert.equal(threadText(c,'shen_gongbao','scheme'),'局中同谋');
 assert.equal(threadText(c,'act_1_fate','dragon'),'与龙族调停');
 assert(!/act_|scheme|dragon/.test(threadText(c,'act_2_fate','free')));
});
test('v13 inspecting every event and ability is a pure view operation',()=>{
 const g=fresh(),before=JSON.stringify(g.s);
 for(const e of c.events)for(const ph of e.phases??[rootPhase(e)]){
  storyText(c,g.s,e,ph);
  for(const ch of ph.choices){narrativeAvailable(c,g.s,ch);choiceEffects(c,ch);choiceCopy(c,e.id,ph.id,ch.id);}
 }
 for(const a of c.abilities)abilityLines(c,a,3);
 assert.equal(JSON.stringify(g.s),before);
});
