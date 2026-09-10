
import {readFileSync} from 'node:fs';
import {Game,fateOptions,clone,simulateBattle} from '../build/engine.js';
const c=JSON.parse(readFileSync(new URL('../data/game.json',import.meta.url),'utf8'));
const make=()=>Game.create(c,'IMMERSION-UI','wanderer',fateOptions(c,'IMMERSION-UI')[0].id,'无名');
const fresh=make(), fixtures={map:clone(fresh.s)};
const battle=make();
battle.enter(battle.available()[0].id);
const enemy=clone(c.enemies[0]);enemy.stats={...enemy.stats,hp:2200,attack:3,defense:5};
battle.s.battle=simulateBattle(c,battle.s,enemy);battle.s.battle.cursor=Math.min(65,battle.s.battle.frames.length-1);
fixtures.battle=clone(battle.s);
const reward=make();reward.s.phase='reward';reward.s.reward=['basic.sword','myth.orbs','art.jade'];reward.s.rewardInfo={gold:25,xp:20};
fixtures.reward=clone(reward.s);
for(const e of c.events){
 const g=make();g.s.phase='event';g.s.act=e.act;g.s.eventId=e.id;g.s.eventPhase=e.startPhase;g.s.seenEvents[e.id]=1;
 if(e.act>0){g.s.threads[`act_${e.act-1}_fate`]=['save','nezha','free'][e.act-1];g.s.facts.met_nezha=e.act>=2;g.s.facts.met_yangjian=e.act>=3;}
 fixtures[e.id]=clone(g.s);
}
const familiar=clone(fixtures['event.1.hermit']);familiar.facts.met_nezha=true;familiar.threads.char_nezha='信你一回';fixtures.returning=familiar;
const cost=clone(fixtures['event.0.ruins']);cost.gold=0;fixtures.cost=cost;
const check=clone(fixtures['event.3.hermit']);check.facts.met_zhaogongming=true;check.threads.char_zhaogongming='赌友';fixtures.check=check;
const shop=make();shop.s.phase='shop';shop.s.stock=[{kind:'ability',id:'myth.orbs',price:45,sold:false},{kind:'ability',id:'basic.sword',price:25,sold:false},{kind:'heal',price:30,sold:false},{kind:'stat',stat:'attack',value:2,price:25,sold:false}];fixtures.shop=clone(shop.s);
const rest=make();rest.s.phase='rest';rest.s.temper=['hp','attack','defense'];fixtures.rest=clone(rest.s);
const full=make();full.s.slots=[{id:'basic.sword',rank:1},{id:'rage.thunder',rank:1},{id:'aux.qi',rank:1},{id:'aux.fire',rank:0},{id:'art.jade',rank:0},{id:'art.flag',rank:0},{id:'art.sword',rank:0},{id:'strategy.rage',rank:0}];full.s.phase='event_result';full.s.eventId='event.0.deal';full.acquire('myth.orbs','event');fixtures.replacement=clone(full.s);
const end=make();end.s.phase='finished';end.s.endingId='free';end.s.act=3;end.s.threads={act_0_fate:'save',act_1_fate:'dragon',act_2_fate:'free',act_3_fate:'beyond',shen_gongbao:'scheme'};fixtures.final=clone(end.s);
console.log(JSON.stringify(fixtures));
