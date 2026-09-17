
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Game,clone,fateOptions,validateContent,SLOT_ORDER,slotLabel} from '../build/engine.js';
import {abilityLines,abilityBehaviorLines,abilityBehaviorSummary,choiceEffects,choiceCopy,creationHint,creationLoadout,creationSummary,storyText,resultText,narrativeAvailable,threadText,rankName,validatePresentation,conversionText} from '../build/presentation.js';
const c=JSON.parse(readFileSync(new URL('../data/game.json',import.meta.url),'utf8'));
const contract=JSON.parse(readFileSync(new URL('./fixtures/v12-contract.json',import.meta.url),'utf8'));
const hash=s=>createHash('sha256').update(s).digest('hex');
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const fresh=()=>Game.create(c,'IMMERSION-PRESENTATION','wanderer',fateOptions(c,'IMMERSION-PRESENTATION')[0].id,'Review');
const rootPhase=e=>e.phases?.find(p=>p.id===e.startPhase)??{id:'root',text:e.text,choices:e.choices};
test('expansion preserves the simulation policy and the authored presentation contract',()=>{
 const policy=readFileSync(new URL('./policy.mjs',import.meta.url),'utf8').replace(" if(s.talentDraft){g.chooseTalent(s.talentDraft.offers[0]);return;}\n",'').replace("seed,max=400,race='human'){","seed,max=400){").replace("Game.create(c,seed,origin,fate.id,'Sim','',race)","Game.create(c,seed,origin,fate.id,'Sim')");
 assert.equal(hash(policy),contract.policySha256);
 validateContent(c);
});
test('v13 presentation covers all event outcomes, including checks and phases',()=>{
 let choices=0;
 for(const e of c.events)for(const ph of e.phases??[rootPhase(e)])for(const ch of ph.choices){
  const cp=choiceCopy(c,e.id,ph.id,ch.id);
  for(const k of ch.check?['success','failure']:['outcome'])assert(cp[k]?.length>5,`${e.id}/${ph.id}/${ch.id}/${k}`);
  choices++;
 }
 assert.equal(choices,281);
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
test('v14 creation choices all have non-empty qualitative copy',()=>{
 const groups=[
  ['race',c.races,4],
  ['origin',c.origins,5],
  ['fate',c.fates,8]
 ];
 for(const [kind,items,count] of groups){
 assert.equal(items.length,count,`${kind} count`);
  for(const item of items){
   const summary=creationSummary(c,kind,item.id),hint=creationHint(c,kind,item.id),copy=`${summary} ${hint}`.trim();
   assert(summary.trim().length>10,`${kind}/${item.id} summary`);
   assert(hint.trim().length>0,`${kind}/${item.id} hint`);
   assert(!/undefined|NaN/.test(copy),`${kind}/${item.id} unresolved copy`);
   assert(!/[0-9%]/.test(copy),`${kind}/${item.id} exposes a numeric rule`);
  }
 }
 assert.notEqual(creationSummary(c,'race',c.races[0].id),creationSummary(c,'race',c.races[1].id));
 assert.notEqual(creationSummary(c,'origin',c.origins[0].id),creationSummary(c,'origin',c.origins[1].id));
 assert.notEqual(creationSummary(c,'fate',c.fates[0].id),creationSummary(c,'fate',c.fates[1].id));
});
test('v14 presentation contract rejects missing qualitative copy before build output',()=>{
 const missingCreation=structuredClone(c);
 delete missingCreation.presentation.creation.origins[missingCreation.origins[0].id];
 assert.throws(()=>validatePresentation(missingCreation),/Missing creation origins copy/);
 const missingBehavior=structuredClone(c);
 delete missingBehavior.presentation.abilityBehaviors['strategy.rage'];
 assert.throws(()=>validatePresentation(missingBehavior),/Missing ability behavior copy/);
 const wrongRevision=structuredClone(c);
 wrongRevision.presentation.revision='17.1';
 assert.throws(()=>validatePresentation(wrongRevision),/Presentation revision mismatch/);
});
test('v14 starting copy lists the same abilities and physical slots as a new run',()=>{
 for(const origin of c.origins){
  const loadout=creationLoadout(c,origin.id);
  assert.equal(loadout.length,origin.starting.length,`${origin.id} loadout length`);
  assert.deepEqual(loadout.map(item=>item.id),origin.starting,`${origin.id} loadout ids`);
  const expected=Array(SLOT_ORDER.length).fill(null);
  for(const item of loadout){
   const index=SLOT_ORDER.findIndex((slot,i)=>slot===item.slot&&expected[i]===null);
   assert.notEqual(index,-1,`${origin.id}/${item.id} slot capacity`);
   expected[index]=item.id;
   assert.equal(item.slotLabel,slotLabel(item.slot),`${origin.id}/${item.id} slot label`);
  }
  const seed=`PRESENTATION-LOADOUT-${origin.id}`;
  const game=Game.create(c,seed,origin.id,fateOptions(c,seed)[0].id,'Review','', 'human');
  assert.deepEqual(game.s.slots.map(item=>item?.id??null),expected,`${origin.id} physical slots`);
  assert.equal(game.s.slots.filter(Boolean).length,4,`${origin.id} starting ability count`);
 }
});
test('v14 strategy and relic behavior summaries are complete and player-facing',()=>{
 const strategies=c.abilities.filter(a=>a.slot==='strategy');
 const relics=c.abilities.filter(a=>a.relicConversions?.length);
 assert.equal(strategies.length,10);
 assert.equal(relics.length,8);
 const internal=/\b(?:battle_start|round_start|round_end|before_action|after_action|on_hit|on_damage|on_damaged|on_rage_skill|on_rage_spend|on_crit|on_evade|on_heal|on_shield_gain|on_status_apply|on_status_tick|on_consume|hp_threshold|battle_end|damage_taken|shield_gain|rage_spend|status_tick|status_consume|basic|rage|self|enemy)\b/;
 for(const ability of [...strategies,...relics]){
  const lines=abilityBehaviorLines(c,ability,3);
  const summary=abilityBehaviorSummary(c,ability,3);
  assert(lines.length>0,`${ability.id} behavior lines`);
  assert(summary.trim().length>10,`${ability.id} behavior summary`);
  assert(!/undefined|NaN/.test(summary),`${ability.id} unresolved behavior`);
  assert(!internal.test(summary),`${ability.id} leaks an internal enum: ${summary}`);
  assert(!/[0-9%]/.test(summary),`${ability.id} exposes a numeric rule: ${summary}`);
  assert(summary.includes(c.presentation.abilityBehaviors[ability.id].summary),`${ability.id} authored copy`);
 }
 assert.match(abilityBehaviorSummary(c,'myth.seal'),/不扣除刚获得的护盾/);
 assert.match(abilityBehaviorSummary(c,'myth.basin'),/满血时没有实际回复/);
 assert.match(abilityBehaviorSummary(c,'strategy.mountain'),/短暂保留怒气/);
 for(const relic of relics){
  const details=relic.relicConversions.map(x=>conversionText(c,x,3)).join('\n');
  assert(!internal.test(details),`${relic.id} leaks an internal enum in exact detail`);
  assert.match(details,/→/);
  assert.match(details,/%/);
 }
});
test('v14 authored behavior copy takes precedence without mutating the run state',()=>{
 const game=fresh(),before=JSON.stringify(game.s);
 for(const ability of c.abilities.filter(a=>a.slot==='strategy'||a.relicConversions?.length)){
  assert.equal(abilityBehaviorSummary(c,ability),abilityBehaviorSummary(c,ability,3));
  abilityBehaviorLines(c,ability,3);
 }
 assert.equal(JSON.stringify(game.s),before);
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
