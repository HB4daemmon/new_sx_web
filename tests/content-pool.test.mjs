import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {Game,clone,fateOptions,simulateBattle,replayRun,inRunPool,validateContent,conditionOK,routeLength,SLOT_ORDER} from '../build/engine.js';
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

test('all origin and offered-fate combinations choose four base and two compatible hybrids',()=>{
 const coverage=new Set(),hybrids=new Set();
 for(let i=0;i<48;i++)for(const o of c.origins)for(const f of fateOptions(c,'DRAFT-'+i)){
  const g=fresh('DRAFT-'+i,o.id,f.id),p=g.s.contentPool;
  assert.equal(new Set(p.schools).size,4);assert.equal(new Set(p.hybrids).size,2);
  for(const id of f.resonanceBias)assert(p.schools.includes(id));
  for(const id of p.hybrids){assert(c.hybrids.find(h=>h.id===id).schools.every(k=>p.schools.includes(k)));hybrids.add(id);}
  p.schools.forEach(x=>coverage.add(x));
  for(const slot of new Set(SLOT_ORDER))assert(c.abilities.some(a=>a.slot===slot&&a.rarity!=='mythic'&&inRunPool(c,g.s,a)));
 }
 assert.equal(coverage.size,8);assert.equal(hybrids.size,6);
});

test('reward, shop, treasure and event grants share the saved pool with no off-pool leakage',()=>{
 const seen=new Set();
 for(let i=0;i<24;i++){
  const g=fresh('OFFER-'+i),initial=clone(g.s.contentPool);
  for(const stream of ['reward','shop','treasure','event.reward'])for(let n=0;n<10;n++){
   const ids=g.rollAbilities(3,stream,stream.includes('treasure')||stream.includes('event')?'artifact':undefined);
   assert.equal(ids.length,3);assert.equal(new Set(ids).size,3);
   for(const id of ids){const a=g.ability(id);assert(inRunPool(c,g.s,a));if(!g.s.slots.some(eq=>eq?.id===id)){assert(a.schools.every(k=>g.s.contentPool.schools.includes(k)));if(a.hybrid)assert(g.s.contentPool.hybrids.includes(a.hybrid));}assert.notEqual(a.rarity,'mythic');seen.add(id);}
  }
  assert.deepEqual(g.s.contentPool,initial);assert.deepEqual(Game.load(c,JSON.stringify(g.s)).s,clone(g.s));
 }
 for(const school of c.schools)assert(c.abilities.some(a=>seen.has(a.id)&&a.schools.includes(school.id)));
});

test('only a real act boundary refills HP, using final equipment and realm maximum',()=>{
 for(let act=0;act<3;act++)for(const advanceVia of ['skip','acquire']){
  const g=fresh();g.s.act=act;g.s.row=9;g.s.phase='reward';g.s.hp=1;g.s.bonus.hp=17;g.gainXP(210);
  g.s.slots[4]={id:'art.gourd',rank:0};
  if(advanceVia==='acquire'){g.s.reward=['art.gourd'];g.reward(0);}else g.skipReward();
  assert.equal(g.s.act,act+1);assert.equal(g.s.row,0);assert.equal(g.s.hp,g.stats().hp);
  const n=g.available()[0];g.s.hp=7;g.enter(n.id);assert.equal(g.s.hp,7); // entering a node never heals.
 }
 const g=fresh();g.s.row=8;g.s.hp=9;g.advance();assert.equal(g.s.hp,9);
 g.s.act=3;g.s.row=9;g.advance();assert.equal(g.s.phase,'ending');assert.equal(g.s.hp,9);
});

test('the full final row and pending treasure reward survive save/load without rerolling',()=>{
 const g=fresh();g.s.row=8;g.s.lane=1;
 const treasure=g.available().find(n=>n.type==='treasure');g.enter(treasure.id);
 assert.equal(g.s.phase,'reward');assert(g.s.reward.every(id=>g.ability(id).slot==='artifact'));
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

test('all eight base schools can equip a complete kit and exercise their actual combat loop',()=>{
 const kits={
  rage:['basic.thunder','rage.thunder','aux.qi','aux.river','art.flag','art.thunder_drum','art.thunder_chisel','strategy.rage'],
  burn:['basic.fire','rage.lotus','aux.fire','aux.ash','art.lamp','art.fire_cage','art.ash_bowl','strategy.fire'],
  guard:['basic.fist','rage.guard','aux.stone','aux.counter','art.mirror','art.turtle_plate','art.thorn_ring','strategy.guard'],
  break:['basic.break','rage.sky','aux.sight','aux.qi','art.needle','art.dragon_stake','art.jade_lance','strategy.hunt'],
  crit:['basic.star','rage.star','aux.focus','aux.star','art.star_bead','art.gold_shears','art.star_mirror','strategy.star'],
  evade:['basic.gale','rage.gale','aux.shadow','aux.flight','art.cloud_boots','art.wind_wheel','art.mist_cloak','strategy.gale'],
  vitality:['basic.spring','rage.spring','aux.breath','aux.renew','art.dew_vase','art.lotus_seed','art.herbal_basket','strategy.spring'],
  curse:['basic.hex','rage.hex','aux.hex','aux.doom','art.binding_rope','art.soul_banner','art.curse_nail','strategy.hex']
 };
 for(const [school,kit] of Object.entries(kits)){
  const g=fresh('KIT-'+school);g.s.slots=kit.map(id=>({id,rank:1}));g.s.hp=Math.floor(g.stats().hp*.65);
  const b=g.build();assert.equal(b.core,school);assert.equal(b.resonances.find(x=>x.id===school).tier,2);
  const enemy=clone(c.enemies[0]);enemy.stats={...enemy.stats,hp:1500,attack:16,defense:4,speed:18,hit:0,dodge:0};
  const state=clone(g.s),a=simulateBattle(c,g.s,enemy),repeated=simulateBattle(c,state,enemy);
  assert.deepEqual(a,repeated);assert(a.frames.length>5);assert(a.frames.length<4000);
  if(school==='crit')assert(a.summary.playerCrits>0);
  if(school==='evade')assert(a.summary.enemyMisses>0);
  if(school==='vitality')assert(a.frames.some(f=>f.kind==='heal'&&f.actor==='p'));
  if(school==='curse')assert(a.frames.some(f=>f.e.status.weak>0));
 }
});

test('hybrid resonance only activates one of the two selected run hybrids',()=>{
 const g=fresh();g.s.contentPool={schools:['crit','evade','vitality','curse'],hybrids:['crit_evade','vitality_curse']};
 for(const [pair,ids] of [['crit_evade',['basic.star','rage.gale','aux.focus','aux.shadow','art.star_bead','art.wind_wheel','art.crit_evade','strategy.star']],['vitality_curse',['basic.spring','rage.hex','aux.breath','aux.hex','art.dew_vase','art.curse_nail','art.vitality_curse','strategy.spring']]]){
  g.s.slots=ids.map(id=>({id,rank:0}));g.s.bonus.hp=1000;g.s.hp=500;assert.equal(g.build().bridge.id,pair);assert(g.build().bridge.tier>0);
  const enemy=clone(c.enemies[0]);enemy.stats={...enemy.stats,hp:3000,attack:10,hit:0,dodge:0};
  const result=simulateBattle(c,g.s,enemy);assert(result.frames.some(f=>f.sourceId==='build.bridge.'+pair));
 }
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
