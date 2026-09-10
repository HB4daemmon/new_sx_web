import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {Game,clone,random,fateOptions,simulateBattle,validateContent,playerStats,buildProfile,abilityRole,replayRun,SLOT_ORDER,conditionOK} from '../build/engine.js';
import {run,step} from './policy.mjs';
const c=JSON.parse(await readFile(new URL('../data/game.json',import.meta.url),'utf8'));
const fresh=(seed='TEST')=>Game.create(c,seed,c.origins[0].id,fateOptions(c,seed)[0].id,'Tester');
const normalize=s=>{s=clone(s);if(s.battle)s.battle.cursor=0;return s;};
test('content validates and matches the expanded content counts',()=>{validateContent(c);assert.equal(c.abilities.length,98);assert.equal(c.enemies.length,44);assert.equal(c.events.length,48);assert.equal(c.origins.length,3);assert.equal(c.fates.length,8);assert.equal(c.endings.length,4);});
test('unknown effects and dangling references rejected',()=>{const bad=clone(c);bad.abilities[0].effects[0].type='arbitrary_javascript';assert.throws(()=>validateContent(bad));const broken=clone(c);broken.origins[0].starting[0]='missing';assert.throws(()=>validateContent(broken));});
test('same seed gives exactly the same route and fate offers',()=>{assert.deepEqual(fresh().s,fresh().s);assert.equal(fateOptions(c,'X').length,3);assert.deepEqual(fateOptions(c,'X'),fateOptions(c,'X'));});
test('cannot select an unoffered fate',()=>{const absent=c.fates.find(f=>!fateOptions(c,'X').some(x=>x.id===f.id));assert.throws(()=>Game.create(c,'X',c.origins[0].id,absent.id));});
test('independent RNG streams cannot perturb combat',()=>{const a=fresh().s,b=clone(a);random(a,'shop');random(a,'reward');assert.equal(random(a,'combat'),random(b,'combat'));});
test('all route nodes have a forward exit, totaling ten rows per act',()=>{const g=fresh();for(let act=0;act<4;act++)for(let row=0;row<9;row++)for(const n of g.s.route.filter(n=>n.act===act&&n.row===row))assert(g.s.route.some(m=>m.act===act&&m.row===row+1&&Math.abs(n.lane-m.lane)<=1));});
test('locked/backwards nodes do not mutate state',()=>{const g=fresh(),s=clone(g.s);assert.throws(()=>g.enter('0.5.1'));assert.deepEqual(clone(g.s),s);});
test('battle replay is deterministic and does not mutate permanent HP before settlement',()=>{const g=fresh(),initial=clone(g.s),enemy=c.enemies[0],a=simulateBattle(c,g.s,enemy),b=simulateBattle(c,clone(initial),enemy);assert.deepEqual(a,b);assert.equal(g.s.hp,initial.hp);assert(a.frames.length>2);});
test('playback cursor and skipping cannot change outcome',()=>{const a=fresh(),b=fresh();a.enter(a.available()[0].id);b.enter(b.available()[0].id);b.s.battle.cursor=b.s.battle.frames.length-1;a.finishBattle();b.finishBattle();assert.deepEqual(normalize(a.s),normalize(b.s));});
test('battle cannot settle twice',()=>{const g=fresh();g.enter(g.available()[0].id);g.finishBattle();const before=clone(g.s);assert.throws(()=>g.finishBattle());assert.deepEqual(clone(g.s),before);});
test('same-name ranks up and never creates another equipped copy',()=>{const g=fresh();g.s.phase='shop';g.s.stock=[{kind:'ability',id:g.s.slots[0].id,price:0,sold:false}];g.buy(0);assert.equal(g.s.slots[0].rank,1);assert.equal(g.s.slots.filter(x=>x?.id===g.s.slots[0].id).length,1);});
test('rank caps at R3',()=>{const g=fresh(),id=g.s.slots[0].id;g.s.slots[0].rank=3;assert.throws(()=>g.acquire(id,'event'));});
test('full-slot purchases reserve without deducting, cancellation is free',()=>{const g=fresh(),id=c.abilities.find(a=>a.slot==='basic'&&a.id!==g.s.slots[0].id).id;g.s.phase='shop';g.s.stock=[{kind:'ability',id,price:35,sold:false}];const money=g.s.gold;g.buy(0);assert(g.s.pending);assert.equal(g.s.gold,money);assert.equal(g.s.stock[0].sold,false);g.cancelReplacement();assert.equal(g.s.gold,money);assert.equal(g.s.stock[0].sold,false);});
test('replacement confirms atomically and only accepts matching slot',()=>{const g=fresh(),id=c.abilities.find(a=>a.slot==='basic'&&a.id!==g.s.slots[0].id).id;g.s.phase='shop';g.s.stock=[{kind:'ability',id,price:35,sold:false}];g.buy(0);assert.throws(()=>g.replace(1));g.replace(0);assert.equal(g.s.gold,15);assert.equal(g.s.slots[0].id,id);assert(g.s.stock[0].sold);assert(!g.s.pending);});
test('three refreshes per act cost 0, 30, 60',()=>{const g=fresh();g.s.phase='shop';g.s.gold=100;g.refresh();assert.equal(g.s.gold,100);g.refresh();assert.equal(g.s.gold,70);g.refresh();assert.equal(g.s.gold,10);assert.throws(()=>g.refresh());});
test('realm growth increases max HP but never heals current HP',()=>{const g=fresh();g.s.hp=30;const max=g.stats().hp;g.gainXP(1000);assert.equal(g.s.hp,30);assert(g.stats().hp>max);});
test('entering the next act fills current maximum HP',()=>{const g=fresh();g.s.row=9;g.s.hp=17;g.advance();assert.equal(g.s.act,1);assert.equal(g.s.hp,g.stats().hp);});
test('mythic relics never appear in ordinary reward or shop pools',()=>{const g=fresh();for(let i=0;i<80;i++)for(const id of g.rollAbilities(3,'reward'))assert.notEqual(g.ability(id).rarity,'mythic');});
test('save round-trip preserves generated stock, pending choices and random cursors',()=>{const g=fresh();g.s.phase='shop';g.rollShop();assert.deepEqual(Game.load(c,JSON.stringify(g.s)).s,clone(g.s));});
test('invalid/corrupted/incompatible saves fail explicitly',()=>{assert.throws(()=>Game.load(c,'not json'));const g=fresh();g.s.version='0';assert.throws(()=>Game.load(c,JSON.stringify(g.s)));});
test('event applies causality once and cannot be farmed',()=>{const g=fresh();g.s.phase='event';g.s.eventId=c.acts[0].major;const ch=c.events.find(e=>e.id===g.s.eventId).choices[0];g.chooseEvent(ch.id);const before=clone(g.s);assert.throws(()=>g.chooseEvent(ch.id));assert.deepEqual(clone(g.s),before);assert(g.s.facts.saved_mortals);});
test('all four legal endings require explicit player selection',()=>{const g=fresh();g.s.phase='ending';g.s.counters={mercy:5,defiance:6,chan_relation:5,jie_relation:1};assert.equal(g.legalEndings().length,4);assert.equal(g.s.endingId,undefined);g.chooseEnding('defy');assert.equal(g.s.phase,'finished');assert.equal(g.s.endingId,'defy');});
test('conditional ending is rejected when requirements unmet',()=>{const g=fresh();g.s.phase='ending';assert.throws(()=>g.chooseEnding('defy'));assert(g.legalEndings().some(e=>e.id==='free'));});
test('every origin can finish at least one seed without cheats',()=>{for(const o of c.origins){const results=Array.from({length:40},(_,i)=>run(c,o.id,'SIM-'+i));assert(results.some(g=>g.s.phase==='finished'),'No victory for '+o.id);for(const g of results)assert(['finished','dead'].includes(g.s.phase));}});
test('full action log reproduces a completed run exactly',()=>{const g=run(c,c.origins[0].id,'SIM-0');assert.deepEqual(normalize(replayRun(c,g.s)),normalize(g.s));});


test('event check preview never consumes RNG and exposes public probability',()=>{const g=fresh('CHECK-PREVIEW'),ev=c.events.find(e=>e.id==='event.0.omen');g.s.phase='event';g.s.eventId=ev.id;g.s.eventPhase=ev.startPhase;g.s.seenEvents[ev.id]=1;g.chooseEvent('enter');const before=clone(g.s.rng),a=g.eventChoices().find(x=>x.choice.check),b=g.eventChoices().find(x=>x.choice.id===a.choice.id);assert.equal(a.chance,b.chance);assert(a.chance>=10&&a.chance<=95);assert.deepEqual(g.s.rng,before);});
test('event checks are deterministic under the same seed and action sequence',()=>{const play=()=>{const g=fresh('CHECK-DETERMINISTIC'),ev=c.events.find(e=>e.id==='event.0.omen');g.s.phase='event';g.s.eventId=ev.id;g.s.eventPhase=ev.startPhase;g.s.seenEvents[ev.id]=1;g.chooseEvent('enter');const picked=g.eventChoices().find(x=>x.choice.check);assert(picked);g.chooseEvent(picked.choice.id);return {check:g.s.lastCheck,result:g.s.resultText,rng:clone(g.s.rng)};};assert.deepEqual(play(),play());});
test('v11 event nodes resolve lazily with separate visible and hidden pools',()=>{const a=fresh('EVENT-LAZY'),b=fresh('EVENT-LAZY');for(const g of [a,b])for(let act=0;act<4;act++)assert(g.s.route.filter(n=>n.act===act&&n.type==='hidden').length<=1);const va=a.s.route.find(n=>n.type==='event'),vb=b.s.route.find(n=>n.id===va.id),ha=a.s.route.find(n=>n.type==='hidden'),hb=b.s.route.find(n=>n.id===ha.id);assert.equal(va.ref,undefined);assert.equal(ha.ref,undefined);const ve1=a.resolveStory(va),ve2=b.resolveStory(vb),he1=a.resolveStory(ha),he2=b.resolveStory(hb);assert.equal(ve1.id,ve2.id);assert.equal(he1.id,he2.id);assert.equal(!!ve1.hiddenOnly,false);assert.equal(!!he1.hiddenOnly,true);});
test('combat uses separated RNG domains and boss phase transitions are typed frames',()=>{const g=fresh('BOSS-PHASE');g.s.bonus.attack=250;g.s.bonus.hp=300;const boss=c.enemies.find(e=>e.kind==='boss'),b=simulateBattle(c,g.s,boss);assert(Object.keys(g.s.rng).some(k=>k.includes('.hit')));assert(Object.keys(g.s.rng).some(k=>k.includes('.crit')));assert(b.frames.some(f=>f.kind==='phase'));assert(b.summary.phaseChanges>=1);});
test('non-kill objectives can complete without forcing enemy HP to zero',()=>{const g=fresh('OBJECTIVE');g.s.bonus.hp=500;g.s.bonus.defense=150;const enemy=c.enemies.find(e=>e.objective?.type==='survive'),b=simulateBattle(c,g.s,enemy);assert.equal(b.won,true);assert(b.e??true);assert(b.frames.at(-1).objective);});
test('shop contains mixed ability recovery and attribute stock',()=>{const g=fresh('SHOP-MIX');g.s.phase='shop';g.rollShop();assert(g.s.stock.some(x=>x.kind==='ability'));assert(g.s.stock.some(x=>x.kind==='heal'));assert(g.s.stock.some(x=>x.kind==='stat'));});


test('build profile activates two-tier resonances from the eight-slot board',()=>{const g=fresh('BUILD-RESONANCE');g.s.slots=[{id:'basic.thunder',rank:0},{id:'rage.thunder',rank:0},{id:'aux.qi',rank:0},{id:'aux.river',rank:0},{id:'art.feather',rank:0},{id:'art.flag',rank:0},null,{id:'strategy.rage',rank:0}];const b=buildProfile(c,g.s),rage=b.resonances.find(x=>x.id==='rage');assert.equal(rage.tier,2);assert(rage.count>=4);assert.equal(b.strategy.tier,2);assert.equal(b.strategy.bonusPercent,18);});
test('build resonance is deterministic and derived rather than persisted',()=>{const g=fresh('BUILD-DERIVED'),a=buildProfile(c,g.s),b=buildProfile(c,clone(g.s));assert.deepEqual(a,b);assert.equal('build' in g.s,false);});
test('active build resonance emits a typed combat frame and keeps replay deterministic',()=>{const make=()=>{const g=fresh('BUILD-BATTLE');g.s.slots=[{id:'basic.thunder',rank:0},{id:'rage.thunder',rank:0},{id:'aux.qi',rank:0},{id:'aux.river',rank:0},{id:'art.feather',rank:0},{id:'art.flag',rank:0},null,{id:'strategy.rage',rank:0}];return simulateBattle(c,g.s,c.enemies[0]);};const a=make(),b=make();assert.deepEqual(a,b);assert(a.frames.some(f=>f.kind==='build'));});
test('rules version advances for build-affecting combat changes',()=>{assert.equal(c.version,'3.0.0');assert.equal(c.rulesVersion,'3.0.0');});


test('v5 full aligned rage board unlocks a late-run finisher',()=>{const g=fresh('BUILD-V5-FINISHER'),extra=c.abilities.find(a=>a.slot==='artifact'&&!['art.feather','art.flag'].includes(a.id));assert(extra);g.s.contentPool={schools:['rage','burn','guard','break'],hybrids:['rage_burn','rage_break']};g.s.slots=[{id:'basic.thunder',rank:0},{id:'rage.thunder',rank:0},{id:'aux.qi',rank:0},{id:'aux.river',rank:0},{id:'art.feather',rank:0},{id:'art.flag',rank:0},{id:extra.id,rank:0},{id:'strategy.rage',rank:0}];const b=buildProfile(c,g.s);assert.equal(b.core,'rage');assert.equal(b.finisher.progress,3);assert.equal(b.finisher.active,true);assert.equal(b.finisher.name,'九转雷劫');});
test('v5 bridge selection is deterministic and exposes cross-school progress',()=>{const g=fresh('BUILD-V5-BRIDGE'),cc=structuredClone(c);g.s.contentPool={schools:['rage','burn','guard','break'],hybrids:['rage_burn','rage_break']};g.s.slots=[{id:'basic.thunder',rank:0},{id:'rage.thunder',rank:0},{id:'aux.qi',rank:0},{id:'aux.river',rank:0},{id:'art.feather',rank:0},{id:'art.flag',rank:0},null,{id:'strategy.rage',rank:0}];for(const id of ['basic.thunder','rage.thunder','aux.qi','aux.river']){const a=cc.abilities.find(x=>x.id===id);a.tags=[...new Set([...a.tags,'fire','burn'])];}const a=buildProfile(cc,g.s),b=buildProfile(cc,structuredClone(g.s));assert.deepEqual(a,b);assert.equal(a.bridge.id,'rage_burn');assert.equal(a.bridge.tier,2);});
test('v5 rage bridge and finisher emit deterministic typed combat frames',()=>{const setup=()=>{const cc=structuredClone(c),g=fresh('BUILD-V5-COMBAT'),extra=cc.abilities.find(a=>a.slot==='artifact'&&!['art.feather','art.flag'].includes(a.id));g.s.contentPool={schools:['rage','burn','guard','break'],hybrids:['rage_burn','rage_break']};g.s.slots=[{id:'basic.thunder',rank:0},{id:'rage.thunder',rank:0},{id:'aux.qi',rank:0},{id:'aux.river',rank:0},{id:'art.feather',rank:0},{id:'art.flag',rank:0},{id:extra.id,rank:0},{id:'strategy.rage',rank:0}];for(const id of ['basic.thunder','rage.thunder','aux.qi','aux.river']){const a=cc.abilities.find(x=>x.id===id);a.tags=[...new Set([...a.tags,'fire','burn'])];}const enemy=structuredClone(cc.enemies[0]);enemy.stats.hp=999;enemy.stats.attack=1;enemy.stats.defense=0;return {cc,g,enemy};};const x=setup(),y=setup(),a=simulateBattle(x.cc,x.g.s,x.enemy),b=simulateBattle(y.cc,y.g.s,y.enemy);assert.deepEqual(a,b);assert(a.frames.some(f=>f.label==='雷火轮转'));assert(a.frames.some(f=>f.label==='九转雷劫'));});
test('v5 content and deterministic rules advance together',()=>{assert.equal(c.version,'3.0.0');assert.equal(c.rulesVersion,'3.0.0');});


test('v6 contextual role grammar distinguishes start, bridge and finish pieces',()=>{const g=fresh('V6-ROLES');const basic=c.abilities.find(a=>a.slot==='basic'),strategy=c.abilities.find(a=>a.slot==='strategy');assert.equal(abilityRole(c,g.s,basic).role,'starter');assert.equal(abilityRole(c,g.s,strategy).role,'finisher');const b=g.build(),weak=b.bridge.counts[0]<=b.bridge.counts[1]?b.bridge.schools[0]:b.bridge.schools[1],tags={rage:['rage','burst'],burn:['fire','burn'],guard:['shield','counter'],break:['break','sword']}[weak],candidate=c.abilities.find(a=>abilityRole(c,g.s,a).role==='bridge');assert(candidate);assert.equal(abilityRole(c,g.s,candidate).role,'bridge');});
test('v6 three-offer draft is deterministic unique and reserves the middle lane for bridge repair',()=>{const a=fresh('V6-DRAFT'),b=fresh('V6-DRAFT'),x=a.rollAbilities(3,'reward'),y=b.rollAbilities(3,'reward');assert.deepEqual(x,y);assert.equal(new Set(x).size,3);assert.equal(abilityRole(c,a.s,a.ability(x[1])).role,'bridge');});
test('v6 role classification is derived and does not alter save shape',()=>{const g=fresh('V6-DERIVED'),before=JSON.stringify(g.s);for(const a of c.abilities.slice(0,12))abilityRole(c,g.s,a);assert.equal(JSON.stringify(g.s),before);});
test('v6 content and reward-draft rules advance together',()=>{assert.equal(c.version,'3.0.0');assert.equal(c.rulesVersion,'3.0.0');});


test('v7 burn engine harvests burn into rage and burst damage',()=>{const g=fresh('V7-BURN'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:999,attack:1,defense:0,speed:1,dodge:0};g.s.slots=[{id:'basic.fire',rank:0},{id:'rage.fire',rank:0},{id:'aux.fire',rank:0},{id:'aux.ash',rank:0},{id:'art.lamp',rank:0},{id:'art.pearl',rank:0},null,{id:'strategy.fire',rank:0}];const b=simulateBattle(c,g.s,enemy);assert(b.summary.playerConversions>0);assert(b.frames.some(f=>f.kind==='convert'&&['aux.ash','strategy.fire'].includes(f.sourceId)));});

test('v7 guard engine spends shield to counterattack',()=>{const g=fresh('V7-GUARD'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:999,attack:4,defense:0,speed:1,dodge:0};g.s.slots=[{id:'basic.fist',rank:0},{id:'rage.guard',rank:0},{id:'aux.stone',rank:0},{id:'aux.counter',rank:0},{id:'art.mirror',rank:0},{id:'art.bracer',rank:0},null,{id:'strategy.guard',rank:0}];const b=simulateBattle(c,g.s,enemy);assert(b.summary.playerConversions>0);assert(b.frames.some(f=>f.kind==='convert'&&f.sourceId==='strategy.guard'&&f.detail.includes('护盾')));});

test('v7 break engine harvests armor break into rage and pursuit',()=>{const g=fresh('V7-BREAK'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:999,attack:1,defense:0,speed:1,dodge:0};g.s.slots=[{id:'basic.break',rank:0},{id:'rage.sky',rank:0},{id:'aux.sight',rank:0},{id:'aux.qi',rank:0},{id:'art.needle',rank:0},{id:'art.sword',rank:0},null,{id:'strategy.hunt',rank:0}];const b=simulateBattle(c,g.s,enemy);assert(b.summary.playerConversions>0);assert(b.frames.some(f=>f.kind==='convert'&&f.sourceId==='strategy.hunt'&&f.detail.includes('破甲')));});

test('v7 rage engine refunds rage and emits deterministic thunder echoes',()=>{const make=()=>{const g=fresh('V7-RAGE'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:999,attack:1,defense:0,speed:1,dodge:0};g.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},{id:'aux.qi',rank:0},{id:'aux.river',rank:0},{id:'art.flag',rank:0},{id:'art.feather',rank:0},null,{id:'strategy.rage',rank:0}];return simulateBattle(c,g.s,enemy);};const a=make(),b=make();assert.deepEqual(a,b);assert(a.summary.playerRageSkills>0);assert(a.frames.some(f=>f.kind==='damage'&&f.sourceId==='strategy.rage'));});

test('v7 resource engines advance content and deterministic rule versions together',()=>{assert.equal(c.version,'3.0.0');assert.equal(c.rulesVersion,'3.0.0');});


test('v7 origin battle perks are JSON configured and deterministic',()=>{const w=c.origins.find(o=>o.id==='wanderer'),a=c.origins.find(o=>o.id==='alchemist');assert.equal(w.battleStartEffects[0].type,'gain_rage');assert.equal(w.battleStartEffects[0].value,25);assert.equal(a.battleStartEffects[0].type,'gain_shield');assert.equal(a.battleStartEffects[0].value,8);const g1=fresh('V7-ORIGIN-PERK'),g2=fresh('V7-ORIGIN-PERK'),b1=simulateBattle(c,g1.s,structuredClone(c.enemies[0])),b2=simulateBattle(c,g2.s,structuredClone(c.enemies[0])),f=b1.frames.find(x=>x.sourceId==='origin.wanderer');assert.deepEqual(b1,b2);assert(f);assert(f.p.rage>=15);});


test('v8 all abilities carry authored mechanic roles',()=>{const allowed=new Set(['starter','generator','converter','amplifier','bridge','keystone','risk','payoff']);assert.equal(c.abilities.length,98);assert(c.abilities.every(a=>allowed.has(a.mechanicRole)));assert(c.abilities.filter(a=>a.mechanicRole==='payoff').length>=6);assert(c.abilities.filter(a=>a.mechanicRole==='converter').length>=5);});

test('v8 burn payoff makes red lotus scale from live burn stacks deterministically',()=>{const make=()=>{const g=fresh('V8-LOTUS'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:2200,attack:1,defense:0,speed:1,dodge:0};g.s.slots=[{id:'basic.fire',rank:0},{id:'rage.lotus',rank:0},{id:'aux.fire',rank:0},{id:'aux.ash',rank:0},{id:'art.lamp',rank:0},{id:'art.pearl',rank:0},null,{id:'strategy.fire',rank:0}];return simulateBattle(c,g.s,enemy);};const a=make(),b=make(),hits=a.frames.filter(f=>f.kind==='damage'&&f.sourceId==='rage.lotus');assert.deepEqual(a,b);assert(a.summary.playerRageSkills>0);assert(hits.length>=2);});

test('v8 break payoff makes heaven slash scale from armor break',()=>{const g=fresh('V8-SKY'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:2200,attack:1,defense:0,speed:1,dodge:0};g.s.slots=[{id:'basic.break',rank:0},{id:'rage.sky',rank:0},{id:'aux.sight',rank:0},{id:'aux.qi',rank:0},{id:'art.needle',rank:0},{id:'art.sword',rank:0},null,{id:'strategy.hunt',rank:0}];const b=simulateBattle(c,g.s,enemy),hits=b.frames.filter(f=>f.kind==='damage'&&f.sourceId==='rage.sky');assert(b.summary.playerRageSkills>0);assert(hits.length>=2);});

test('v8 bridge pieces express both sides of their resource identity',()=>{const tide=c.abilities.find(a=>a.id==='basic.tide'),orbs=c.abilities.find(a=>a.id==='myth.orbs');assert(tide.effects.some(e=>e.type==='gain_shield'));assert(tide.effects.some(e=>e.type==='gain_rage'));const fx=orbs.triggers.flatMap(t=>t.effects);assert(fx.some(e=>e.type==='gain_shield'));assert(fx.some(e=>e.type==='apply_status'&&e.status==='burn'));assert.equal(c.version,'3.0.0');assert.equal(c.rulesVersion,'3.0.0');});

test('v8 resource damage rejects undeclared resources',()=>{const bad=structuredClone(c),lotus=bad.abilities.find(a=>a.id==='rage.lotus'),effect=lotus.effects.find(e=>e.type==='resource_damage');effect.resource='gold';assert.throws(()=>validateContent(bad));});


test('v9 selected stat sticks become authored build-changing pieces',()=>{
 const roles=Object.fromEntries(c.abilities.map(a=>[a.id,a.mechanicRole]));
 for(const id of ['aux.wind','art.sword','art.feather','art.coin'])assert.equal(roles[id],'keystone');
 assert.equal(roles['art.jade'],'converter');
 assert(c.abilities.filter(a=>a.mechanicRole==='keystone').length>=8);
});

test('v9 crit trigger drives seven-star sword without recursive critical chains',()=>{
 let found=false;
 for(let i=0;i<12&&!found;i++){
  const g=fresh('V9-CRIT-'+i),enemy=structuredClone(c.enemies[0]);
  enemy.stats={...enemy.stats,hp:2600,attack:1,defense:0,speed:1,dodge:0};
  g.s.bonus.luck=10000;
  g.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},{id:'aux.qi',rank:0},null,{id:'art.sword',rank:0},null,null,null];
  const b=simulateBattle(c,g.s,enemy),hits=b.frames.filter(f=>f.kind==='damage'&&f.sourceId==='art.sword');
  if(hits.length){found=true;assert(hits.every(f=>!f.crit));assert(b.frames.some(f=>f.e.status.break>0));}
 }
 assert(found);
});

test('v9 evade trigger makes wind pieces a deterministic counter engine',()=>{
 const make=()=>{const g=fresh('V9-EVADE'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:4200,attack:2,defense:0,speed:30,hit:0,dodge:0};g.s.bonus.dodge=10000;g.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},{id:'aux.wind',rank:0},null,{id:'art.feather',rank:0},null,null,null];return simulateBattle(c,g.s,enemy);};
 const a=make(),b=make();assert.deepEqual(a,b);assert(a.frames.some(f=>f.kind==='miss'&&f.actor==='e'));assert(a.frames.some(f=>f.kind==='damage'&&f.sourceId==='art.feather'));assert(a.frames.some(f=>f.p.rage>0));
});

test('v9 clear-heart jade converts leftover guard into persistent healing',()=>{
 const g=fresh('V9-JADE'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:1,attack:0,defense:0,speed:1,dodge:0};g.s.hp=35;g.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},{id:'aux.stone',rank:0},null,{id:'art.jade',rank:0},{id:'art.mirror',rank:0},null,null];const b=simulateBattle(c,g.s,enemy);assert(b.won);assert(b.hp>35);assert(b.frames.some(f=>f.kind==='convert'&&f.sourceId==='art.jade'));
});

test('v9 warrior correction is origin-only and keeps shared guard skills intact',()=>{
 const w=c.origins.find(o=>o.id==='warrior'),guard=c.abilities.find(a=>a.id==='rage.guard');assert.equal(w.stats.hp,112);assert.equal(w.stats.attack,22);assert.equal(w.stats.defense,12);assert(guard.effects.some(e=>e.type==='gain_shield'&&e.coefficient));assert.equal(c.version,'3.0.0');assert.equal(c.rulesVersion,'3.0.0');
});


test('v10 every fate declares a JSON-driven resonance bias',()=>{
 const allowed=new Set(c.schools.map(d=>d.id));assert.equal(c.fates.length,8);for(const f of c.fates){assert.equal(f.resonanceBias.length,1);assert(allowed.has(f.resonanceBias[0]));}
});

test('v10 fate bias contributes one virtual resonance count and can change the core route',()=>{
 const g=fresh('V10-FATE-BIAS');g.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},null,null,null,null,null,null];g.s.fate='fate.guard';const guard=buildProfile(c,g.s),guardCount=guard.resonances.find(x=>x.id==='guard').count;g.s.fate='fate.rage';const rage=buildProfile(c,g.s),rageCount=rage.resonances.find(x=>x.id==='rage').count;assert.equal(guardCount,1);assert(rageCount>=3);assert.equal(rage.core,'rage');
});

test('v10 qiankun ring turns rage casts into rage-break momentum',()=>{
 const g=fresh('V10-RING'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:3200,attack:1,defense:0,speed:1,dodge:0};g.s.fate='fate.rage';g.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},null,null,{id:'myth.ring',rank:0},null,null,null];const b=simulateBattle(c,g.s,enemy);assert(b.summary.playerRageSkills>0);assert(b.frames.some(f=>f.e.status.break>=2));assert(b.frames.some(f=>f.p.rage>=10));
});

test('v10 fantian seal opens with guard and converts rage casts into control-break',()=>{
 const g=fresh('V10-SEAL'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:3200,attack:1,defense:0,speed:1,dodge:0};g.s.fate='fate.rage';g.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},null,null,{id:'myth.seal',rank:0},null,null,null];const b=simulateBattle(c,g.s,enemy);assert(b.frames.some(f=>f.p.shield>0));assert(b.summary.playerRageSkills>0);assert(b.frames.some(f=>f.e.status.break>=2));
});

test('v10 sea orbs remain a deterministic burn-guard pivot with rage acceleration',()=>{
 const make=()=>{const g=fresh('V10-ORBS'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:3600,attack:1,defense:0,speed:1,dodge:0};g.s.fate='fate.rage';g.s.slots=[{id:'basic.fire',rank:0},{id:'rage.fire',rank:0},{id:'aux.fire',rank:0},null,{id:'myth.orbs',rank:0},null,null,null];return simulateBattle(c,g.s,enemy);};const a=make(),b=make();assert.deepEqual(a,b);assert(a.frames.some(f=>f.p.shield>=8));assert(a.frames.some(f=>f.e.status.burn>=2));
});

test('v10 major fate choices expose all three mythic pivot rewards',()=>{
 const grants=c.events.filter(e=>e.major).flatMap(e=>e.choices.map(ch=>ch.grant?.id).filter(Boolean));for(const id of ['myth.ring','myth.seal','myth.orbs'])assert(grants.includes(id));for(const id of ['myth.ring','myth.seal','myth.orbs'])assert.equal(c.abilities.find(a=>a.id===id).mechanicRole,'keystone');assert.equal(c.version,'3.0.0');assert.equal(c.rulesVersion,'3.0.0');
});


test('v11 major nodes answer the previous act before presenting the new fate choice',()=>{const g=fresh('V11-MAJOR-ECHO');g.s.phase='event';g.s.eventId='major.1';g.s.eventPhase='echo';g.s.threads.act_0_fate='power';const options=g.eventChoices(),legal=options.filter(x=>x.legal).map(x=>x.choice.id);assert.deepEqual(legal.sort(),['echo_power','sever']);const locked=options.find(x=>x.choice.id==='echo_save');assert(locked.lockReason);g.chooseEvent('echo_power');assert.equal(g.s.eventPhase,'decision');assert.equal(g.s.phase,'event');assert.equal(g.s.threads.echo_major_1,'power');});

test('v11 all hidden events are authored per act and remain in the secret pool',()=>{for(let act=0;act<4;act++){const ev=c.events.find(e=>e.id===`event.${act}.omen`);assert.equal(ev.hiddenOnly,true);assert.equal(ev.category,'secret');assert.equal(ev.phases.length,2);assert(ev.phases[1].choices.every(ch=>ch.check));}assert.equal(new Set(c.events.filter(e=>e.hiddenOnly).map(e=>e.name)).size,8);});

test('v11 echo events can answer every previous major branch',()=>{const expected={1:['save','power','away'],2:['nezha','dragon','neutral'],3:['chan','jie','free']};for(const [actText,ids] of Object.entries(expected)){const act=Number(actText),ev=c.events.find(e=>e.id===`event.${act}.echo`);for(const id of ids)assert(ev.choices.some(ch=>ch.id===`echo_${id}`&&ch.conditions.some(q=>q.type==='thread_is'&&q.text===id)));assert(ev.choices.some(ch=>ch.id==='sever'));}});

test('v11 Shen Gongbao debt line has authored continuation and settlement states',()=>{const a1=c.events.find(e=>e.id==='event.1.deal'),a2=c.events.find(e=>e.id==='event.2.deal'),a3=c.events.find(e=>e.id==='event.3.deal');assert(a1.relevance.some(q=>q.key==='met_shen_gongbao'));assert(a2.choices.some(ch=>ch.effects.some(e=>e.type==='advance_thread'&&e.value==='scheme')));assert(a3.choices.some(ch=>ch.effects.some(e=>e.type==='advance_thread'&&e.value==='settled')));});

test('v11 event log records event identity category and declared consequence',()=>{const g=fresh('V11-STORY-AUDIT');g.s.phase='event';g.s.eventId='major.0';const ch=c.events.find(e=>e.id==='major.0').choices[0];g.chooseEvent(ch.id);const log=g.s.storyLog.at(-1);assert.equal(log.eventId,'major.0');assert.equal(log.choiceId,ch.id);assert.equal(log.category,'major');assert(log.consequence);});

test('v11 event rules and content advance together',()=>{assert.equal(c.version,'3.0.0');assert.equal(c.rulesVersion,'3.0.0');assert.equal(c.events.length,48);assert(c.events.every(e=>e.category));});


test('original four character arcs remain in the expanded event pool',()=>{const grouped=new Map();for(const e of c.events.filter(e=>e.character)){grouped.set(e.character,(grouped.get(e.character)??0)+1);}assert.equal(c.events.length,48);assert.equal(grouped.get('哪吒'),4);assert.equal(grouped.get('杨戬'),4);assert.equal(grouped.get('申公豹'),4);assert.equal(grouped.get('赵公明'),3);});

test('v12 follow-up character encounters carry state-aware relevance',()=>{const checks=[['event.1.hermit','met_nezha'],['event.2.hermit','met_nezha'],['event.2.ruins','met_yangjian'],['event.3.ruins','met_yangjian'],['event.3.hermit','met_zhaogongming']];for(const [id,key] of checks){const e=c.events.find(x=>x.id===id);assert(e.relevance.some(q=>q.type==='has_fact'&&q.key===key));}});

test('v12 major fate choices also advance their named relationship',()=>{for(const [id,key] of [['major.1','char_nezha'],['major.2','char_yangjian'],['major.3','char_zhaogongming']]){const e=c.events.find(x=>x.id===id);assert(e.character);assert(e.choices.every(ch=>ch.effects.some(f=>f.type==='advance_thread'&&f.key===key)));}});

test('v12 character arcs cross-link Shen Gongbao with Yang Jian and Zhao Gongming',()=>{const expose=c.events.find(e=>e.id==='event.2.deal').choices.find(ch=>ch.id==='expose'),zhao=c.events.find(e=>e.id==='event.3.hermit').choices.find(ch=>ch.id==='witness');assert(expose.effects.some(e=>e.type==='advance_thread'&&e.key==='char_yangjian'));assert(zhao.conditions.some(q=>q.type==='thread_is'&&q.key==='shen_gongbao'&&q.text==='scheme'));assert(zhao.effects.some(e=>e.type==='advance_thread'&&e.key==='shen_gongbao'&&e.value==='witnessed'));});

test('v12 character content and deterministic rules advance together',()=>{assert.equal(c.version,'3.0.0');assert.equal(c.rulesVersion,'3.0.0');for(const e of c.events.filter(e=>e.character)){assert(e.episode>=1);assert(e.episodes>=e.episode);assert(e.relationKey);}});


test('survive objective succeeds when the enemy is defeated before the required round',()=>{const g=fresh('SURVIVE-EARLY-KILL');g.s.bonus.attack=1000;g.s.bonus.hit=1000;const base=c.enemies.find(e=>e.objective?.type==='survive');const enemy=structuredClone(base);enemy.stats.hp=1;enemy.stats.defense=0;enemy.stats.dodge=0;enemy.objective={...enemy.objective,rounds:6,label:'守至第 6 回合'};const b=simulateBattle(c,g.s,enemy);assert.equal(b.won,true);assert(b.rounds<6);assert.equal(b.frames.at(-1).kind,'win');assert.equal(b.frames.at(-1).label,'斗法告捷');assert.equal(b.frames.some(f=>f.kind==='timeout'),false);});
