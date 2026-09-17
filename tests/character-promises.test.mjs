import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Game,clone,fateOptions,replayRun} from '../build/engine.js';

const c=JSON.parse(await readFile(new URL('../data/game.json',import.meta.url),'utf8'));
const fresh=(seed='PROMISE-TEST')=>Game.create(c,seed,c.origins[0].id,fateOptions(c,seed)[0].id,'Tester');
const stage=(g,id,phase='root')=>{
 const event=c.events.find(e=>e.id===id);
 g.s.phase='event';g.s.act=event.act;g.s.row=0;g.s.lane=1;g.s.current=undefined;g.s.battle=undefined;g.s.eventId=id;g.s.eventPhase=phase;g.s.eventStep=0;
};

test('same-action rescue can pay and fulfill without a prior active state',()=>{
 const g=fresh('PROMISE-RESCUE');
 g.s.phase='event';g.s.eventId='character.yunxiao.2';g.s.eventPhase='root';g.s.act=2;g.s.row=0;g.s.gold=18;
 const choice=g.eventChoices().find(x=>x.choice.id==='rescue');
 assert.equal(choice.legal,true);
 assert.equal(g.promiseState('yunxiao.rescue_chan'),undefined);
 g.chooseEvent('rescue');
 assert.equal(g.s.gold,0);
 assert.equal(g.promiseState('yunxiao.rescue_chan').status,'fulfilled');
 assert.equal(g.s.facts.yunxiao_saved_chan_envoy,true);
});

test('elite evidence after the definition deadline does not fulfill the promise',()=>{
 const g=fresh('PROMISE-ELITE-LATE');
 g.s.promises['leizhenzi.elite_trial']={definitionId:'leizhenzi.elite_trial',status:'active',acceptedAt:{act:0,row:0,nodeId:'0.0.1'},finalRewardOffered:false,settlementClaimed:false};
 g.s.current={id:'2.3.1',act:2,row:3,lane:1,type:'elite'};
 g.s.battle={won:true};
 g.recordElitePromiseEvidence();
 assert.equal(g.promiseState('leizhenzi.elite_trial').status,'active');
 assert.equal(g.s.facts.leizhenzi_elite_completed,undefined);
});

test('advancing from the final row clears current before promise deadlines settle',()=>{
 const g=fresh('PROMISE-ADVANCE');
 g.s.promises['leizhenzi.elite_trial']={definitionId:'leizhenzi.elite_trial',status:'active',acceptedAt:{act:0,row:0,nodeId:'0.0.1'},finalRewardOffered:false,settlementClaimed:false};
 g.s.act=3;g.s.row=9;g.s.phase='reward';g.s.current={id:'3.9.1',act:3,row:9,lane:1,type:'boss'};
 g.advance();
 g.settlePromisesAfterAction('test');
 assert.equal(g.s.phase,'ending');
 assert.equal(g.s.current,undefined);
 assert.equal(g.promiseState('leizhenzi.elite_trial').status,'expired');
});

test('legacy facts-only bypass completion migrates to a valid consumed permit',()=>{
 const g=fresh('PROMISE-LEGACY-TUX');
 delete g.s.promises;
 g.s.facts.tuxingsun_bypass_used=true;
 const loaded=Game.load(c,JSON.stringify(g.s)),state=loaded.promiseState('tuxingsun.bypass_escort');
 assert.equal(state?.status,'fulfilled');
 assert.equal(state?.evidenceNodeId,'legacy');
 assert.deepEqual(state?.bypassPermit,{state:'consumed',issuedAtNodeId:'legacy',usedAtNodeId:'legacy'});
 assert.equal(loaded.s.facts.tuxingsun_bypass_used,true);
});

test('fulfilled character rewards are idempotent and a cancelled full-slot gift stays consumed',()=>{
 const cases=[
  ['ziya','ziya.reserve_currency','ziya_promise_fulfilled','myth.whip'],
  ['leizhenzi','leizhenzi.elite_trial','leizhenzi_elite_completed','myth.wings'],
  ['tuxingsun','tuxingsun.bypass_escort','tuxingsun_bypass_used','myth.earth'],
  ['yunxiao','yunxiao.rescue_chan','yunxiao_saved_chan_envoy','myth.basin'],
 ];
 for(const [line,promiseId,fact,rewardId] of cases){
  const g=fresh(`PROMISE-IDEMPOTENT-${line}`);
  g.s.facts[fact]=true;
  g.s.promises[promiseId]={definitionId:promiseId,status:'fulfilled',acceptedAt:{act:0,row:0,nodeId:'legacy'},evidenceNodeId:'legacy',finalRewardOffered:false,settlementClaimed:true};
  stage(g,`character.${line}.3`);
  g.chooseEvent('borrow');
  assert(g.s.slots.some(eq=>eq?.id===rewardId)||g.s.pending?.id===rewardId,rewardId);
  const afterFirst=clone(g.s);
  stage(g,`character.${line}.3`);
  assert.throws(()=>g.chooseEvent('borrow'),/Choice locked/);
  assert.deepEqual(g.s.slots,afterFirst.slots);
  assert.deepEqual(g.s.promises,afterFirst.promises);
  assert.equal(g.s.storyLog.length,afterFirst.storyLog.length);
 }

 const full=fresh('PROMISE-FULL-SLOT-GIFT');
 full.s.facts.ziya_promise_fulfilled=true;
 full.s.promises['ziya.reserve_currency']={definitionId:'ziya.reserve_currency',status:'fulfilled',acceptedAt:{act:0,row:0,nodeId:'legacy'},evidenceNodeId:'legacy',finalRewardOffered:false,settlementClaimed:true};
 full.s.slots[6]={id:'myth.ring',rank:0};
 stage(full,'character.ziya.3');
 full.chooseEvent('borrow');
 assert.equal(full.s.pending?.id,'myth.whip');
 assert.equal(full.s.promises['ziya.reserve_currency'].finalRewardOffered,true);
 full.cancelReplacement();
 stage(full,'character.ziya.3');
 assert.throws(()=>full.chooseEvent('borrow'),/Choice locked/);
});

test('cloud rescue cross-line echo preserves rescue fact through save/load and the hold-line branch',()=>{
 const fixture=clone(c);
 fixture.rules.routeRows=[['major'],['rest'],['boss']];
 fixture.acts[0].major='character.yunxiao.1';
 fixture.acts[1].major='character.yunxiao.2';
 fixture.acts[2].major='event.3.ruins';
 fixture.enemies=fixture.enemies.map(enemy=>({...enemy,abilities:[],stats:{...enemy.stats,hp:1,attack:0,defense:0,speed:0,hit:0,dodge:0}}));
 const seed='PROMISE-YUNXIAO-ECHO';
 const g=Game.create(fixture,seed,fixture.origins[0].id,fateOptions(fixture,seed)[0].id,'Tester');
 const resolveTalents=()=>{while(g.s.talentDraft)g.chooseTalent(g.s.talentDraft.offers[0]);};
 const enterType=type=>{const node=g.available().find(item=>item.type===type);assert(node,`missing ${type} node`);g.enter(node.id);return node;};
 const clearRow=()=>{
  enterType('rest');g.rest('heal',0);
  enterType('boss');g.finishBattle();resolveTalents();g.skipReward();
 };

 enterType('major');
 assert.equal(g.s.eventId,'character.yunxiao.1');
 g.chooseEvent('ask');g.leaveEvent();
 clearRow();

 enterType('major');
 assert.equal(g.s.eventId,'character.yunxiao.2');
 g.chooseEvent('rescue');resolveTalents();g.leaveEvent();
 assert.equal(g.s.promises['yunxiao.rescue_chan']?.status,'fulfilled');
 assert.equal(g.s.facts.yunxiao_saved_chan_envoy,true);
 clearRow();

 enterType('major');
 assert.equal(g.s.eventId,'event.3.ruins');
 assert.equal(g.s.eventPhase,'mercy');
 g.chooseEvent('hold_line');
 assert.equal(g.s.facts.yunxiao_saved_chan_envoy,true);
 assert.equal(g.s.facts.yunxiao_crossline_deferred,true);
 assert.equal(g.s.facts.yunxiao_crossline_acknowledged,undefined);
 assert.equal(g.s.eventPhase,'root');
 const loaded=Game.load(fixture,JSON.stringify(g.s));
 assert.equal(loaded.s.eventId,'event.3.ruins');
 assert.equal(loaded.s.phase,'event');
 assert.equal(loaded.s.eventPhase,'root');
 assert.equal(loaded.s.facts.yunxiao_saved_chan_envoy,true);
 assert.deepEqual(clone(loaded.s),clone(g.s));
 assert.deepEqual(clone(replayRun(fixture,g.s)),clone(g.s));
});
