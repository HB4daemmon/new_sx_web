import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Game,clone,fateOptions,simulateBattle,replayRun,inRunPool,validateContent,conditionOK,routeLength,SLOT_ORDER,abilityLoadoutSlot,abilityMechanicTags} from '../build/engine.js';
import {run,step} from './policy.mjs';
const c=JSON.parse(readFileSync(new URL('../data/game.json',import.meta.url)));
const fresh=(seed='POOL',origin='wanderer',fate)=>Game.create(c,seed,origin,fate??fateOptions(c,seed)[0].id);

test('ten-step routes have reachable rests, treasure and two boss alternatives in every act',()=>{
 const seenBosses=new Set();
 for(let i=0;i<64;i++){
  const g=fresh('ROUTE-'+i);assert.equal(routeLength(c),10);
  for(let act=0;act<4;act++){
   const nodes=g.s.route.filter(n=>n.act===act);assert.equal(new Set(nodes.map(n=>n.row)).size,10);
   for(const n of nodes){
    if(n.row<9)assert(nodes.some(m=>m.row===n.row+1&&Math.abs(n.lane-m.lane)<=1));
    if(n.row>0)assert(nodes.some(m=>m.row===n.row-1&&Math.abs(n.lane-m.lane)<=1));
   }
   assert.equal(nodes.filter(n=>n.type==='major').length,1);
   assert(nodes.some(n=>n.row===8&&n.type==='rest'));
   assert(nodes.some(n=>n.row===8&&n.type==='treasure'));
   seenBosses.add(nodes.find(n=>n.type==='boss').ref);
   const opening=nodes.filter(n=>n.row===0).map(n=>n.ref);assert.equal(new Set(opening).size,3);
  }
 }
 assert.equal(seenBosses.size,8);
});

test('all origin and offered-fate combinations expose the complete ability graph instead of a preset school pool',()=>{
 const coverage=new Set(),hybrids=new Set();
 for(let i=0;i<48;i++)for(const o of c.origins)for(const f of fateOptions(c,'DRAFT-'+i)){
  const g=fresh('DRAFT-'+i,o.id,f.id),p=g.s.contentPool;
  assert.equal(new Set(p.schools).size,c.schools.length);assert.equal(new Set(p.hybrids).size,c.hybrids.length);
  for(const id of p.hybrids)hybrids.add(id);
  p.schools.forEach(x=>coverage.add(x));
  for(const slot of new Set(SLOT_ORDER))assert(c.abilities.some(a=>abilityLoadoutSlot(a)===slot&&inRunPool(c,g.s,a)));
 }
 assert.equal(coverage.size,8);assert.equal(hybrids.size,6);
});

test('reward, shop and event drafting are deterministic without school-pool leakage',()=>{
 const seen=new Set();
 for(let i=0;i<24;i++){
  const g=fresh('OFFER-'+i),initial=clone(g.s.contentPool);
  for(const stream of ['reward','shop','treasure','event.reward'])for(let n=0;n<10;n++){
   const ids=g.rollAbilities(3,stream,stream.includes('treasure')||stream.includes('event')?'artifact':undefined);
   assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);
   for(const id of ids){const a=g.ability(id);assert(inRunPool(c,g.s,a));assert.notEqual(a.rarity,'mythic');seen.add(id);}
  }
  assert.deepEqual(g.s.contentPool,initial);assert.deepEqual(Game.load(c,JSON.stringify(g.s)).s,clone(g.s));
 }
 assert(seen.size>20);
});

test('only a real act boundary restores HP, using final equipment and realm maximum',()=>{
 for(let act=0;act<3;act++)for(const advanceVia of ['skip','acquire']){
  const g=fresh();g.s.act=act;g.s.row=9;g.s.phase='reward';g.s.hp=1;g.s.bonus.hp=17;g.gainXP(210);while(g.s.talentDraft)g.chooseTalent(g.s.talentDraft.offers[0]);
  g.s.slots[4]={id:'art.gourd',rank:0};
  if(advanceVia==='acquire'){g.s.reward=['art.gourd'];g.reward(0);}else g.skipReward();
  assert.equal(g.s.act,act+1);assert.equal(g.s.row,0);const max=g.stats().hp,expected=Math.max(1+Math.floor(max*c.rules.actStartHealPercent/100),Math.floor(max*c.rules.actStartMinHpPercent/100));assert.equal(g.s.hp,expected);assert(g.s.hp<max);
  const n=g.available()[0];g.s.hp=7;g.enter(n.id);assert.equal(g.s.hp,7); // entering a node never heals.
 }
 const g=fresh();g.s.row=8;g.s.hp=9;g.advance();assert.equal(g.s.hp,9);
 g.s.act=3;g.s.row=9;g.advance();assert.equal(g.s.phase,'ending');assert.equal(g.s.hp,9);
});

test('the full final row and pending treasure reward survive save/load without rerolling',()=>{
 const g=fresh();g.s.row=8;g.s.lane=1;
 const treasure=g.available().find(n=>n.type==='treasure');g.enter(treasure.id);
 assert.equal(g.s.phase,'reward');assert(g.s.reward.every(id=>abilityLoadoutSlot(g.ability(id))==='component'));
 const h=Game.load(c,JSON.stringify(g.s));assert.deepEqual(clone(h.s),clone(g.s));h.skipReward();assert.equal(h.s.row,9);
 assert.equal(Game.load(c,JSON.stringify(h.s)).s.row,9);
});

test('random event openings are persisted and replay uses exactly the same opening',()=>{
 const starts=new Set();
 for(let i=0;i<32;i++){
  const g=fresh('ENTRY-'+i),n=g.s.route.find(n=>n.type==='event');n.ref='place.0.work';g.s.row=n.row;g.s.lane=n.lane;
  g.enter(n.id);starts.add(g.s.eventPhase);
  const loaded=Game.load(c,JSON.stringify(g.s)),before=JSON.stringify(loaded.s);
  loaded.eventChoices();loaded.eventPhase();assert.equal(JSON.stringify(loaded.s),before);
  assert.equal(loaded.s.eventPhase,g.s.eventPhase);
 }
 assert.deepEqual([...starts].sort(),['root','storm']);
});

test('character followups cannot appear before first meeting, and old promises unlock named relics',()=>{
 for(const key of ['ziya','leizhenzi','tuxingsun','yunxiao']){
  const g=fresh(),second=c.events.find(e=>e.id===`character.${key}.2`),third=c.events.find(e=>e.id===`character.${key}.3`);
  assert.equal(second.requirements.every(q=>conditionOK(c,g.s,q)),false);
  g.s.phase='event';g.s.eventId=`character.${key}.1`;g.s.eventPhase='root';g.chooseEvent('help');
  assert(g.s.facts['met_'+key]);assert(g.s.facts[key+'_promise']);
  g.chooseEvent('leave');g.s.phase='event';g.s.act=second.act;g.s.eventId=second.id;g.s.eventPhase='root';g.s.gold=100;
  g.chooseEvent('keep');assert(g.s.facts[key+'_kept']);
  g.s.phase='event';g.s.act=third.act;g.s.eventId=third.id;g.s.eventPhase='root';g.chooseEvent('borrow');
  const myth=third.phases[0].choices.find(ch=>ch.id==='borrow').grant.id;
  assert(g.s.slots.some(eq=>eq?.id===myth)||g.s.pending?.id===myth);
 }
});

test('all event phases retain an unconditional exit or legal safe branch, without leaking internal tokens',()=>{
 for(const e of c.events)for(const ph of e.phases??[{id:'root',choices:e.choices}]){
  const g=fresh();g.s.act=e.act;if(e.act>0)g.s.threads[`act_${e.act-1}_fate`]=c.events.find(x=>x.id===c.acts[e.act-1].major).choices.at(-1).id;g.s.hp=1;g.s.gold=0;g.s.phase='event';g.s.eventId=e.id;g.s.eventPhase=ph.id;
  assert(g.eventChoices().some(x=>x.legal),`${e.id}/${ph.id}`);
 }
});

test('the physical board enforces one basic, one rage, four components, one relic and one strategy',()=>{
 assert.deepEqual(SLOT_ORDER,['basic','rage','component','component','component','component','relic','strategy']);
 const g=fresh('LOADOUT');
 const components=['aux.qi','aux.river','art.flag','art.thunder_drum'];
 g.s.slots=[{id:'basic.thunder',rank:1},{id:'rage.thunder',rank:1},...components.map(id=>({id,rank:1})),{id:'myth.ring',rank:1},{id:'strategy.rage',rank:1}];
 g.s.hp=Math.floor(g.stats().hp*.65);assert.doesNotThrow(()=>Game.load(c,JSON.stringify(g.s)));
 assert.equal(g.s.slots.filter((eq,i)=>eq&&SLOT_ORDER[i]==='basic').length,1);assert.equal(g.s.slots.filter((eq,i)=>eq&&SLOT_ORDER[i]==='rage').length,1);assert.equal(g.s.slots.filter((eq,i)=>eq&&SLOT_ORDER[i]==='component').length,4);
 const tags=g.build().tags;assert(Object.keys(tags).every(k=>['burst','multi','duration','counter','charge','chain','convert','consume','evade','control'].includes(k)));
 const enemy=clone(c.enemies[0]);enemy.stats={...enemy.stats,hp:1500,attack:16,defense:4,speed:18,hit:0,dodge:0};const state=clone(g.s),a=simulateBattle(c,g.s,enemy),b=simulateBattle(c,state,enemy);assert.deepEqual(a,b);assert(a.frames.length>5&&a.frames.length<4000);
});

test('mechanic links are derived from actual effects rather than selected hybrid recipes',()=>{
 const g=fresh('LINKS');g.s.slots=[{id:'basic.fire',rank:0},{id:'rage.lotus',rank:0},{id:'aux.fire',rank:0},{id:'aux.ash',rank:0},{id:'art.lamp',rank:0},{id:'art.fire_cage',rank:0},null,{id:'strategy.fire',rank:0}];
 const before=clone(g.build());g.s.contentPool={schools:['crit'],hybrids:[]};const after=g.build();assert.deepEqual(after,before);assert(after.tags.duration>0);assert(after.tags.consume>0||after.tags.chain>0);assert(after.links.every(x=>!x.id.includes('hybrid')));
});

test('survival wins also cover status and opening kills; a full round requires the enemy response',()=>{
 const g=fresh(),enemy=clone(c.enemies[0]);enemy.objective={type:'survive',rounds:2};enemy.stats={...enemy.stats,hp:10000,attack:1,defense:1000,hit:1000};
 const result=simulateBattle(c,g.s,enemy);assert(result.won);assert(result.frames.some(f=>f.round===2&&f.actor==='e'));
 const cc=clone(c),gg=fresh();const basic=cc.abilities.find(a=>a.id===gg.s.slots[0].id);basic.triggers.push({on:'battle_start',effects:[{type:'damage',target:'enemy',value:99999,pure:true}]});
 assert(simulateBattle(cc,gg.s,enemy).won);
 const status=clone(enemy);status.stats={...status.stats,hp:3,attack:0,defense:1000};const gs=fresh();gs.s.slots=[{id:'basic.fire',rank:0},{id:'rage.fire',rank:0},null,null,null,null,null,null];
 assert(simulateBattle(c,gs.s,status).won);
});

test('content rejects broken school, hybrid and random-phase references',()=>{
 for(const alter of [x=>x.abilities[0].schools.push('missing'),x=>x.hybrids[0].schools[0]='missing',x=>x.events.find(e=>e.starts).starts[0].phase='missing',x=>x.rules.routeRows[0][0]='missing']){
  const bad=clone(c);alter(bad);assert.throws(()=>validateContent(bad));
 }
 const g=fresh();g.s.contentPool.hybrids[0]='missing';assert.throws(()=>Game.load(c,JSON.stringify(g.s)));
});

test('expanded long runs replay to identical state after intervening save/load and inspections',()=>{
 for(const origin of c.origins){const g=run(c,origin.id,'SIM-7'),replayed=replayRun(c,g.s);assert.deepEqual(clone(replayed),clone(g.s));if(g.s.phase==='finished')assert.equal(g.s.visited.length,40);}
 const g=fresh('RESUME');for(let i=0;i<12&&!['finished','dead'].includes(g.s.phase);i++)step(g);
 const h=Game.load(c,JSON.stringify(g.s));for(let i=0;i<400&&!['finished','dead'].includes(g.s.phase);i++){h.build();h.stats();step(g);step(h);}
 assert.deepEqual(clone(g.s),clone(h.s));
});

test('the shipped browser bundle includes presentation code and renders expanded map and cards',()=>{
 let App;const context={HTMLElement:class{},customElements:{define:(name,cls)=>{App=cls;}},console,window:{},crypto:{getRandomValues:a=>a},setTimeout,clearTimeout};
 vm.runInNewContext(readFileSync(new URL('../dist/app.js',import.meta.url),'utf8'),context);
 assert(App);const ui=new App();ui.content=c;ui.game=fresh();ui.home=false;ui.view='journey';
 const html=ui.map();assert.match(html,/map-scroll/);assert(!/NaN|undefined/.test(html));assert.match(html,/\/ 10/);
 for(const a of c.abilities)assert(!/NaN|undefined/.test(ui.card(a.id,3)));
 assert.match(ui.codex(),/此途道藏/);
});

test('healing passives require real recovery and recursive healing triggers terminate',()=>{
 const cc=clone(c),g=fresh('HEAL-GUARD');g.s.slots=[{id:'basic.spring',rank:0},{id:'rage.spring',rank:0},{id:'aux.breath',rank:0},null,{id:'art.lotus_seed',rank:0},null,null,null];g.s.hp=g.stats().hp;
 const enemy=clone(cc.enemies[0]);enemy.stats={...enemy.stats,hp:2000,attack:1,defense:0,speed:0};
 const first=simulateBattle(cc,clone(g.s),enemy);const firstHit=first.frames.findIndex(f=>f.actor==='p'&&f.kind==='damage');
 assert.equal(first.frames[firstHit].p.shield,0);assert(!first.frames.slice(0,firstHit+1).some(f=>f.kind==='heal'));
 const relic=cc.abilities.find(a=>a.id==='art.lotus_seed');relic.triggers.push({on:'on_heal',effects:[{type:'heal',target:'self',value:1}]});
 g.s.hp=20;const repeated=simulateBattle(cc,g.s,enemy);assert(repeated.frames.length<4000);assert(repeated.frames.some(f=>f.kind==='heal'));
});
