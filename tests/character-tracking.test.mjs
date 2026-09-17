import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Game,clone,fateOptions,replayRun,storyOpportunitiesForRelation} from '../build/engine.js';

const original=JSON.parse(await readFile(new URL('../data/game.json',import.meta.url),'utf8'));
const fresh=(content,seed)=>Game.create(content,seed,content.origins[0].id,fateOptions(content,seed)[0].id,'Tracker');

test('only a known character can be followed, without consuming RNG',()=>{
 const g=fresh(original,'TRACK-UNKNOWN');
 assert.throws(()=>g.followCharacter('char_ziya'),/Character not known/);

 const content=clone(original);
 content.rules.routeRows[0]=['event','event','event'];
 for(const event of content.events)if(event.id!=='character.ziya.1')event.weight=0;
 const seed='TRACK-KNOWN',gKnown=fresh(content,seed),eventNode=gKnown.available().find(node=>node.type==='event');
 assert(eventNode,'fixture needs a first-row event node');
 gKnown.enter(eventNode.id);
 assert.equal(gKnown.s.eventId,'character.ziya.1');
 gKnown.chooseEvent('ask');
 gKnown.leaveEvent();
 assert(gKnown.knownCharacters().includes('char_ziya'));

 const beforeRng=clone(gKnown.s.rng),beforeSeen=clone(gKnown.s.seenEvents),beforeLog=gKnown.s.actionLog.length;
 gKnown.followCharacter('char_ziya');
 assert.deepEqual(gKnown.s.rng,beforeRng);
 assert.deepEqual(gKnown.s.seenEvents,beforeSeen);
 assert.equal(gKnown.s.trackedCharacter,'char_ziya');
 assert.equal(gKnown.s.followedCharacter,undefined);
 assert.equal(gKnown.s.actionLog.length,beforeLog+1);
 assert.deepEqual(Game.load(content,JSON.stringify(gKnown.s)).s,clone(gKnown.s));
 assert.deepEqual(clone(replayRun(content,gKnown.s)),clone(gKnown.s));
});

test('tracking can be cleared without changing prior character facts',()=>{
 const g=fresh(original,'TRACK-CLEAR');
 g.s.phase='map';
 g.s.facts.met_ziya=true;
 g.followCharacter('char_ziya');
 const before=clone(g.s);
 g.clearCharacterFollow();
 assert.equal(g.s.trackedCharacter,undefined);
 assert.equal(g.s.followedCharacter,undefined);
 assert.equal(g.s.facts.met_ziya,true);
 assert.deepEqual(g.s.rng,before.rng);
 assert.deepEqual(g.s.seenEvents,before.seenEvents);
 assert.equal(g.s.actionLog.at(-1).command,'clearCharacterFollow');
});

test('canonical null tracking clears cleanly through save/load and replay',()=>{
 const g=fresh(original,'TRACK-NULL');
 g.s.trackedCharacter='char_ziya';
 g.trackCharacter(null);
 assert.equal(g.s.trackedCharacter,undefined);
 assert.equal(g.s.actionLog.at(-1).command,'trackCharacter');
 assert.deepEqual(Game.load(original,JSON.stringify(g.s)).s,clone(g.s));
 assert.deepEqual(clone(replayRun(original,g.s)),clone(g.s));
});

test('conflicting canonical and legacy tracking fields are rejected',()=>{
 const canonicalNull=fresh(original,'TRACK-CONFLICT-NULL');
 canonicalNull.s.trackedCharacter=null;
 canonicalNull.s.followedCharacter='char_ziya';
 assert.throws(()=>Game.load(original,JSON.stringify(canonicalNull.s)),/Conflicting tracked character/);

 const differentStrings=fresh(original,'TRACK-CONFLICT-STRING');
 differentStrings.s.trackedCharacter='char_ziya';
 differentStrings.s.followedCharacter='char_leizhenzi';
 assert.throws(()=>Game.load(original,JSON.stringify(differentStrings.s)),/Conflicting tracked character/);
});

test('tracking opportunities exclude skipped past rows and include reachable future rows only',()=>{
 const g=fresh(original,'TRACK-OPPORTUNITY');
 g.s.phase='map';g.s.act=0;g.s.row=1;g.s.lane=1;g.s.current=undefined;
 g.s.route=g.s.route.filter(node=>node.act!==0||node.row<3).map(node=>({...node}));
 for(const node of g.s.route.filter(node=>node.act===0&&node.row<3)){
  node.type=node.row===0?'event':'combat';
  node.ref=undefined;
 }
 g.s.visited=g.s.route.filter(node=>node.act===0&&node.row===1).map(node=>node.id);
 assert.deepEqual(storyOpportunitiesForRelation(original,g.s,'char_ziya'),[]);

 const future=g.s.route.find(node=>node.act===0&&node.row===2);
 assert(future);
 future.type='event';
 assert.deepEqual(storyOpportunitiesForRelation(original,g.s,'char_ziya').map(node=>node.id),[future.id]);
});

test('tracking multiplier is content-configured and inert without a tracked character',()=>{
 assert.equal(original.rules.trackingMultiplier,2);
 const make=(multiplier,seed,tracked)=>{
  const content=clone(original);
  content.rules.routeRows=[['event'],['boss']];
  content.rules.trackingMultiplier=multiplier;
  for(const event of content.events){
   if(event.id==='character.ziya.1'||event.id==='event.0.hermit'){
    event.requirements=[];event.weight=1;event.maxPerRun=1;
   }else event.requirements=[{type:'has_fact',key:'tracking_multiplier_only'}];
  }
  const g=fresh(content,seed);
  if(tracked){g.s.facts.met_ziya=true;g.s.trackedCharacter='char_ziya';}
  const node=g.available()[0],chosen=g.resolveStory(node);
  return {id:chosen.id,rng:clone(g.s.rng)};
 };
 const seed='TRACK-CONFIG-1';
 assert.equal(make(1,seed,true).id,'event.0.hermit');
 assert.equal(make(2,seed,true).id,'character.ziya.1');
 assert.deepEqual(make(1,seed,false),make(2,seed,false));
});
