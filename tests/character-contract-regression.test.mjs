import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
 Game,
 clone,
 fateOptions,
 replayRun,
 storyOpportunitiesForRelation,
} from '../build/engine.js';

const original=JSON.parse(await readFile(new URL('../data/game.json',import.meta.url),'utf8'));
const fresh=(content=original,seed='CHARACTER-CONTRACT')=>Game.create(
 content,
 seed,
 content.origins[0].id,
 fateOptions(content,seed)[0].id,
 'Contract Tester',
);

const stageEvent=(g,id,phase='root')=>{
 const event=g.c.events.find(item=>item.id===id);
 assert(event,`missing event ${id}`);
 g.s.phase='event';
 g.s.act=event.act;
 g.s.row=0;
 g.s.lane=1;
 g.s.current=undefined;
 g.s.battle=undefined;
 g.s.eventId=id;
 g.s.eventPhase=phase;
 g.s.eventStep=0;
};

const easyBattleFixture=(content)=>{
 content.enemies=content.enemies.map(enemy=>({
  ...enemy,
  abilities:[],
  stats:{...enemy.stats,hp:1,attack:0,defense:0,speed:0,hit:0,dodge:0},
 }));
 for(const key of Object.keys(content.rules.rewards))content.rules.rewards[key]={gold:0,xp:0};
};

test('legacy followedCharacter-only saves normalize through load and replay',()=>{
 const content=clone(original);
 content.rules.routeRows[0]=['event','event','event'];
 for(const event of content.events){
  if(event.id==='character.ziya.1'){
   event.requirements=[];
   event.weight=1;
  }else event.requirements=[{type:'has_fact',key:'tracking_contract_only'}];
 }

 const g=fresh(content,'TRACK-LEGACY-FIELD');
 const node=g.available().find(item=>item.type==='event');
 assert(node);
 g.enter(node.id);
 assert.equal(g.s.eventId,'character.ziya.1');
 g.chooseEvent('ask');
 g.leaveEvent();
 g.followCharacter('char_ziya');

 const legacy=clone(g.s);
 delete legacy.trackedCharacter;
 legacy.followedCharacter='char_ziya';
 const loaded=Game.load(content,JSON.stringify(legacy));

 assert.equal(loaded.s.trackedCharacter,'char_ziya');
 assert.equal(loaded.s.followedCharacter,undefined);
 assert.deepEqual(loaded.s.actionLog.slice(0,-1),g.s.actionLog);
 assert.equal(loaded.s.actionLog.at(-1)?.command,'__migrateLegacy');
 assert.deepEqual(loaded.s.actionLog.at(-1)?.args?.[0],{
  trackedCharacter:'char_ziya',
  promises:{},
  facts:{},
 });
 assert.deepEqual(clone(replayRun(content,loaded.s)),clone(loaded.s));
});

test('facts-only character promise markers migrate and a real bypass save replays exactly',()=>{
 const markerCases=[
  ['ziya.reserve_currency','ziya_promise_fulfilled'],
  ['leizhenzi.elite_trial','leizhenzi_elite_completed'],
  ['tuxingsun.bypass_escort','tuxingsun_bypass_used'],
  ['yunxiao.rescue_chan','yunxiao_saved_chan_envoy'],
 ];
 for(const [promiseId,fact] of markerCases){
  const legacy=fresh(original,`PROMISE-FACT-${promiseId}`);
  delete legacy.s.promises;
  legacy.s.facts[fact]=true;
  const loaded=Game.load(original,JSON.stringify(legacy.s));
  const state=loaded.promiseState(promiseId);
  assert.equal(state?.status,'fulfilled',promiseId);
  assert.equal(state?.settlementClaimed,true,promiseId);
  assert.equal(loaded.s.facts[fact],true,promiseId);
 }

 const content=clone(original);
 content.rules.routeRows=[['major'],['combat'],['boss']];
 content.acts[0].major='character.tuxingsun.1';
 content.acts[1].major='character.tuxingsun.2';
 content.acts[2].major='character.tuxingsun.3';
 easyBattleFixture(content);
 const g=fresh(content,'PROMISE-FACT-REPLAY');
 const enterType=(type)=>{
  const node=g.available().find(item=>item.type===type);
  assert(node,`missing ${type} at ${g.s.act}.${g.s.row}`);
  g.enter(node.id);
  return node;
 };
 const resolveBattle=()=>{
  g.finishBattle();
  while(g.s.talentDraft)g.chooseTalent(g.s.talentDraft.offers[0]);
  g.skipReward();
 };

 enterType('major');
 assert.equal(g.s.eventId,'character.tuxingsun.1');
 g.chooseEvent('ask');
 g.leaveEvent();
 enterType('combat');
 resolveBattle();
 enterType('boss');
 resolveBattle();
 enterType('major');
 assert.equal(g.s.eventId,'character.tuxingsun.2');
 g.chooseEvent('accept_bypass');
 g.leaveEvent();
 const combat=g.available().find(item=>item.type==='combat');
 assert(combat);
 assert.equal(g.s.phase,'map');
 g.bypassCombat(combat.id);
 assert.equal(g.s.promises['tuxingsun.bypass_escort']?.status,'fulfilled');
 assert.equal(g.s.facts.tuxingsun_bypass_used,true);

 const legacy=clone(g.s);
 delete legacy.promises;
 const loaded=Game.load(content,JSON.stringify(legacy));
 assert.equal(loaded.promiseState('tuxingsun.bypass_escort')?.status,'fulfilled');
 assert.equal(loaded.s.facts.tuxingsun_bypass_available,undefined);
 assert.deepEqual(clone(replayRun(content,loaded.s)),clone(loaded.s));
});

test('tracking uses a paired seed, read-only clues, and reachable route nodes',()=>{
 const content=clone(original);
 content.rules.routeRows[0]=['event'];
 for(const event of content.events){
  if(event.id==='character.ziya.1'||event.id==='place.0.work'){
   event.requirements=[];
   event.weight=1;
   event.maxPerRun=1;
  }else event.requirements=[{type:'has_fact',key:'tracking_contract_only'}];
 }
 const seed='TRACK-PAIR-6';
 const make=(tracked)=>{
  const g=fresh(content,seed);
  g.s.facts.met_ziya=true;
  if(tracked)g.s.trackedCharacter='char_ziya';
  return g;
 };
 const plain=make(false);
 const tracked=make(true);
 const node=tracked.available()[0];
 assert(node);
 const before=clone(tracked.s);
 const clues=storyOpportunitiesForRelation(content,tracked.s,'char_ziya');

 assert.deepEqual(clone(tracked.s),before);
 assert(clues.some(item=>item.id===node.id));
 assert(clues.every(item=>tracked.s.route.some(routeNode=>routeNode.id===item.id)));
 assert(clues.every(item=>!tracked.s.visited.includes(item.id)));

 const routeCase=make(true);
 routeCase.s.phase='map';
 routeCase.s.act=0;
 routeCase.s.row=1;
 routeCase.s.lane=1;
 routeCase.s.current=undefined;
 routeCase.s.route=routeCase.s.route
  .filter(item=>item.act!==0||item.row<3)
  .map(item=>({...item}));
 for(const item of routeCase.s.route.filter(item=>item.act===0&&item.row<3)){
  item.type=item.row===0?'event':'combat';
  item.ref=undefined;
 }
 routeCase.s.visited=routeCase.s.route
  .filter(item=>item.act===0&&item.row===1)
  .map(item=>item.id);
 const future=routeCase.s.route.find(item=>item.act===0&&item.row===2);
 assert(future);
 future.type='event';
 assert.deepEqual(
  storyOpportunitiesForRelation(content,routeCase.s,'char_ziya').map(item=>item.id),
  [future.id],
 );

 plain.enter(node.id);
 tracked.enter(node.id);
 assert.equal(plain.s.eventId,'place.0.work');
 assert.equal(tracked.s.eventId,'character.ziya.1');
 assert.deepEqual(
  plain.s.route.map(({id,act,row,lane,type})=>({id,act,row,lane,type})),
  tracked.s.route.map(({id,act,row,lane,type})=>({id,act,row,lane,type})),
 );
 assert.deepEqual(plain.s.visited,tracked.s.visited);
});

test('yunxiao mercy accept_aid survives save and action-log replay',()=>{
 const content=clone(original);
 content.rules.routeRows=[['major'],['rest'],['boss']];
 content.acts[0].major='character.yunxiao.1';
 content.acts[1].major='character.yunxiao.2';
 content.acts[2].major='event.3.ruins';
 content.rules.startingGold=18;
 easyBattleFixture(content);
 const g=fresh(content,'MERCY-ACCEPT-REPLAY');
 const resolveTalents=()=>{
  while(g.s.talentDraft)g.chooseTalent(g.s.talentDraft.offers[0]);
 };
 const enterType=(type)=>{
  const node=g.available().find(item=>item.type===type);
  assert(node,`missing ${type} at ${g.s.act}.${g.s.row}`);
  g.enter(node.id);
  return node;
 };
 const clearActRow=()=>{
  enterType('rest');
  g.rest('heal',0);
  enterType('boss');
  g.finishBattle();
  resolveTalents();
  g.skipReward();
 };

 enterType('major');
 assert.equal(g.s.eventId,'character.yunxiao.1');
 g.chooseEvent('ask');
 g.leaveEvent();
 clearActRow();

 enterType('major');
 assert.equal(g.s.eventId,'character.yunxiao.2');
 assert.equal(g.s.gold,18);
 g.chooseEvent('rescue');
 assert.equal(g.s.promises['yunxiao.rescue_chan']?.status,'fulfilled');
 assert.equal(g.s.facts.yunxiao_saved_chan_envoy,true);
 g.leaveEvent();
 clearActRow();

 enterType('major');
 assert.equal(g.s.eventId,'event.3.ruins');
 assert.equal(g.s.eventPhase,'mercy');
 g.chooseEvent('accept_aid');
 assert.equal(g.s.facts.yunxiao_crossline_acknowledged,true);
 assert.equal(g.s.threads.char_yunxiao,'跨阵相认');

 const loaded=Game.load(content,JSON.stringify(g.s));
 assert.deepEqual(clone(loaded.s),clone(g.s));
 assert.deepEqual(clone(replayRun(content,loaded.s)),clone(g.s));
});

test('final promise reward pending survives load and cancellation cannot claim it twice',()=>{
 const g=fresh(original,'FINAL-REWARD-PENDING');
 g.s.facts.ziya_promise_fulfilled=true;
 g.s.promises['ziya.reserve_currency']={
  definitionId:'ziya.reserve_currency',
  status:'fulfilled',
  acceptedAt:{act:0,row:0,nodeId:'legacy'},
  evidenceNodeId:'legacy',
  finalRewardOffered:false,
  settlementClaimed:true,
 };
 g.s.slots[6]={id:'myth.ring',rank:0};
 stageEvent(g,'character.ziya.3');
 g.chooseEvent('borrow');
 assert.equal(g.s.pending?.id,'myth.whip');
 assert.equal(g.s.promises['ziya.reserve_currency'].finalRewardOffered,true);

 const loaded=Game.load(original,JSON.stringify(g.s));
 assert.deepEqual(clone(loaded.s),clone(g.s));
 loaded.cancelReplacement();
 assert.equal(loaded.s.pending,undefined);
 assert.equal(loaded.s.promises['ziya.reserve_currency'].finalRewardOffered,true);
 const slotsAfterCancel=clone(loaded.s.slots);
 const storyLogLength=loaded.s.storyLog.length;

 stageEvent(loaded,'character.ziya.3');
 const rewardChoice=loaded.eventChoices().find(item=>item.choice.id==='borrow');
 assert.equal(rewardChoice?.legal,false);
 assert.throws(()=>loaded.chooseEvent('borrow'),/Choice locked/);
 assert.deepEqual(loaded.s.slots,slotsAfterCancel);
 assert.equal(loaded.s.storyLog.length,storyLogLength);
});
