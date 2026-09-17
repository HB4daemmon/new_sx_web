import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game,fateOptions,simulateBattle} from '../build/engine.js';

const c=JSON.parse(readFileSync('data/game.json','utf8'));
const slots=['basic','rage','component','component','component','component','relic','strategy'];
const fresh=(seed='A4-DIAG',origin='wanderer')=>Game.create(c,seed,origin,fateOptions(c,seed)[0].id,'诊断测试');
const equip=(g,ids)=>{
 g.s.slots=Array(8).fill(null);
 for(const id of ids){
  const a=c.abilities.find(x=>x.id===id);
  assert(a,`missing ability ${id}`);
  const role=a.equipRole??(a.slot==='basic'||a.slot==='rage'||a.slot==='strategy'||a.slot==='relic'?a.slot:a.slot==='artifact'&&a.rarity==='mythic'?'relic':'component');
  const index=slots.findIndex((slot,i)=>slot===role&&!g.s.slots[i]);
  assert(index>=0,`no slot for ${id}`);
  g.s.slots[index]={id,rank:0};
 }
};
const enemy=(hp=5000,attack=1)=>{
 const e=structuredClone(c.enemies.find(x=>x.kind==='combat'));
 e.stats={...e.stats,hp,attack,defense:0,speed:1,hit:0,dodge:0};
 return e;
};
const stripDiagnostics=b=>{
 const out=structuredClone(b);
 delete out.diagnostics;
 return out;
};
const trigger=(b,sourceId,index=0)=>b.diagnostics.triggers[`p:${sourceId}:${index}`];

test('diagnostics are deterministic and do not change old battle fields or RNG',()=>{
 const a=fresh('A4-STABLE'),b=fresh('A4-STABLE'),e=enemy(1200,1);
 const first=simulateBattle(c,a.s,e),second=simulateBattle(c,b.s,e);
 assert.deepEqual(first,second);
 assert.deepEqual(stripDiagnostics(first),stripDiagnostics(second));
 assert.deepEqual(a.s.rng,b.s.rng);
 assert.deepEqual(first.frames,second.frames);
 assert.equal(first.diagnostics.schemaVersion,1);
});

test('missing burn records zero fired attempts with the observed threshold',()=>{
 const g=fresh('A4-NO-BURN');equip(g,['basic.sword','rage.thunder','aux.ash']);
 const b=simulateBattle(c,g.s,enemy(3000,1)),d=trigger(b,'aux.ash');
 assert.equal(d.fired,0);
 assert(d.attempts>0);
 assert(d.blocked.missing_status>0);
 assert.equal(d.actual.burn,0);
 assert.equal(d.required.burn,5);
 assert.equal(b.frames.some(f=>f.sourceId==='aux.ash'),false);
});

test('burn source crosses the authored threshold and fires aux.ash',()=>{
 const g=fresh('A4-BURN');equip(g,['basic.fire','rage.lotus','aux.fire','aux.ash']);
 const b=simulateBattle(c,g.s,enemy(3500,1)),d=trigger(b,'aux.ash');
 assert(d.fired>0);
 assert(d.actual.burn>=d.required.burn);
 assert(b.diagnostics.resources.burn.produced>0);
 assert(b.diagnostics.resources.burn.consumed>0);
});

test('zero healing is observed without emitting an on_heal trigger',()=>{
 const g=fresh('A4-ZERO-HEAL');equip(g,['basic.sword','rage.thunder','art.herbal_basket','art.vitality_curse']);
 g.s.bonus.attack=1000;
 g.s.hp=g.stats().hp;
 const b=simulateBattle(c,g.s,enemy(1,1)),onHeal=trigger(b,'art.vitality_curse',0);
 const basket=trigger(b,'art.herbal_basket',0);
 assert.equal(b.diagnostics.events.on_heal,undefined);
 assert.equal(onHeal.attempts,0);
 assert.equal(basket.fired,1);
 assert.equal(basket.zeroNet,1);
 assert(b.diagnostics.resources.hp.zeroNet>0);
 assert.equal(b.summary.enemyDamage,0);
});

test('action events retain direct evidence for target trigger attempts',()=>{
 const g=fresh('A4-LINK');equip(g,['basic.fire','rage.lotus','aux.fire','aux.ash']);
 const b=simulateBattle(c,g.s,enemy(3500,1));
 const links=b.diagnostics.links.filter(x=>x.sourceActor==='p'&&x.sourceId==='basic.fire'&&x.event==='on_hit'&&x.targetActor==='p'&&x.targetId==='aux.fire'&&x.triggerIndex===0);
 assert.equal(links.length,1);
 assert(links[0].attempts>0);
 assert(links[0].fired>0);
 assert.equal(links[0].attempts,links[0].arrivals);
});

test('strategy decisions and selected actions are included in diagnostics',()=>{
 const g=fresh('A4-STRATEGY');equip(g,['basic.sword','rage.thunder','strategy.rage']);
 const b=simulateBattle(c,g.s,enemy(3000,1)),actions=b.diagnostics.actions.p;
 assert(actions.selected>0);
 assert(actions.bySource['basic.sword'].selected>0);
 assert(actions.bySource['rage.thunder'].selected>0);
 assert(actions.strategy.decisions>0);
 assert(Object.keys(actions.strategy.byReason).length>0);
 assert(b.frames.some(f=>f.kind==='strategy'&&f.sourceId==='strategy.rage'));
});

test('relic diagnostics distinguish unattempted, zero-output, and blocked conversions',()=>{
 const unattempted=fresh('A4-RELIC-UNATTEMPTED');equip(unattempted,['basic.sword','rage.thunder','myth.basin']);unattempted.s.hp=unattempted.stats().hp;
 const noHeal=simulateBattle(c,unattempted.s,enemy(1,1)),noHealConversion=noHeal.diagnostics.conversions.bySource['p:myth.basin:0'];
 assert(noHealConversion);
 assert.equal(noHealConversion.attempts,0);
 assert(noHealConversion.unattempted>0);
 assert(noHealConversion.blocked.unattempted>0);

 const zeroContent=structuredClone(c),zeroRelic=zeroContent.abilities.find(x=>x.id==='myth.ring');
 zeroRelic.relicConversions=[{from:'damage',to:'rage',percent:1}];
 const zero=fresh('A4-RELIC-ZERO');zero.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},null,null,null,null,{id:'myth.ring',rank:0},null];
 const zeroBattle=simulateBattle(zeroContent,zero.s,enemy(2000,1)),zeroConversion=zeroBattle.diagnostics.conversions.bySource['p:myth.ring:0'];
 assert(zeroConversion.attempts>0);
 assert(zeroConversion.zeroOutput>0);
 assert(zeroConversion.blocked.zero_output>0);

 const blockedContent=structuredClone(c),blockedRelic=blockedContent.abilities.find(x=>x.id==='myth.ring');
 blockedRelic.relicConversions=[{from:'damage',to:'damage',percent:100}];
 const blocked=fresh('A4-RELIC-BLOCKED');blocked.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},null,null,null,null,{id:'myth.ring',rank:0},null];
 const blockedBattle=simulateBattle(blockedContent,blocked.s,enemy(2000,1)),blockedConversion=blockedBattle.diagnostics.conversions.bySource['p:myth.ring:0'];
 assert(blockedConversion.attempts>0);
 assert(blockedConversion.blocked.converted_chain>0);
});

test('timeout loss is recorded as a separate system failure',()=>{
 const g=fresh('A4-TIMEOUT');equip(g,['basic.sword','rage.thunder']);g.s.bonus.hp=10000;g.s.hp=g.stats().hp;
 const e=enemy(1_000_000_000,1);e.abilities=['basic.sword'];e.stats.defense=9999;
 const b=simulateBattle(c,g.s,e),loss=b.diagnostics.losses.player;
 assert.equal(b.won,false);
 assert(b.frames.some(f=>f.kind==='timeout'));
 assert(loss.byCategory.system_failure>0);
 assert.equal(b.summary.enemyDamage,loss.byCategory.enemy_attack);
 assert.equal(loss.total,(loss.byCategory.enemy_attack??0)+(loss.byCategory.system_failure??0)+(loss.byCategory.persistent??0)+(loss.byCategory.self??0));
});

test('shield absorption is separate from actual HP loss',()=>{
 const g=fresh('A4-SHIELD','alchemist');g.s.hp=g.stats().hp;
 const b=simulateBattle(c,g.s,enemy(5000,10));
 assert(b.summary.playerShieldAbsorbed>0);
 assert.equal(b.summary.enemyDamage,b.diagnostics.losses.player.total);
 assert(b.summary.enemyDamage<b.summary.playerShieldAbsorbed+b.diagnostics.losses.player.total);
 assert.equal(b.diagnostics.losses.player.byCategory.enemy_attack,b.summary.enemyDamage);
});

test('old saves without diagnostics remain loadable',()=>{
 const g=fresh('A4-LOAD');g.enter(g.available()[0].id);
 const saved=structuredClone(g.s);
 delete saved.battle.diagnostics;
 const loaded=Game.load(c,JSON.stringify(saved));
 assert.equal(loaded.s.battle.diagnostics,undefined);
});
