import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Game,fateOptions,SLOT_ORDER,validateContent,simulateBattle,inRunPool} from '../build/engine.js';
import {buildPathProgress} from '../build/build-paths.js';
const c=JSON.parse(readFileSync('data/game.json','utf8'));
function fresh(race='human',seed='PATH'){return Game.create(c,seed,'wanderer',fateOptions(c,seed)[0].id,'Test','',race);}
function equip(g,ids){g.s.slots=Array(8).fill(null);for(const id of ids){const slot=c.abilities.find(a=>a.id===id).slot;const ix=SLOT_ORDER.findIndex((s,i)=>s===slot&&!g.s.slots[i]);assert(ix>=0);g.s.slots[ix]={id,rank:0};}}
test('each school has two sub-paths and six hybrids have independent recipes',()=>{assert.equal(c.buildPaths.length,22);for(const s of c.schools)assert.equal(c.buildPaths.filter(p=>p.school===s.id&&!p.hybrid).length,2);for(const h of c.hybrids)assert.equal(c.buildPaths.filter(p=>p.hybrid===h.id).length,1);validateContent(c);});
test('recipe inspection uses real inventory, eligible racial support and no RNG',()=>{for(const r of c.races){const g=fresh(r.id),before=JSON.stringify(g.s),paths=buildPathProgress(c,g.s);assert.equal(paths.length,10);assert.equal(JSON.stringify(g.s),before);for(const p of paths){assert.equal(p.owned,p.abilities.filter(id=>g.s.slots.some(x=>x?.id===id)).length);assert(p.supports.every(t=>['common',r.id].includes(c.talents.find(x=>x.id===t.id).race)));for(const x of p.pieces)assert.equal(x.available,inRunPool(c,g.s,c.abilities.find(a=>a.id===x.id)));}}});
test('all twenty-two three-piece loops fit the real eight-slot board',()=>{const g=fresh();for(const p of c.buildPaths){equip(g,p.abilities);assert.equal(g.s.slots.filter(Boolean).length,3);}});
test('broken and impossible recipes are rejected before starting a run',()=>{for(const mutate of [x=>x.buildPaths[0].abilities[0]='missing',x=>x.buildPaths[0].talents[0]='missing',x=>x.buildPaths[0].hybrid='missing',x=>x.buildPaths[0].abilities=['basic.fire','basic.fist','art.path.hex']]){const x=structuredClone(c);mutate(x);assert.throws(()=>validateContent(x));}});
test('each new artifact exercises its real trigger, bounded once per round',()=>{
 const setups={storm:['basic.thunder','aux.qi','art.flag'],ember:['basic.fire','aux.fire'],scale:['basic.fist','aux.stone','strategy.mountain'],sever:['basic.break','art.dragon_stake'],star:['basic.star','aux.focus'],echo:['basic.gale','aux.shadow'],bloom:['basic.spring','aux.breath'],hex:['basic.hex','aux.hex']};
 for(const [key,ids] of Object.entries(setups)){
  let triggered=false;
  for(let seed=0;seed<5&&!triggered;seed++){
   const g=fresh('human','PATH-'+key+seed);equip(g,[...ids,'art.path.'+key]);g.s.bonus.hp=5000;g.s.bonus.defense=25;g.s.bonus.luck=80;g.s.bonus.dodge=70;g.s.hp=1000;
   const e=structuredClone(c.enemies[0]);e.stats.hp=20000;e.stats.attack=12;e.stats.speed=20;e.stats.hit=0;e.stats.dodge=0;
   const b=simulateBattle(c,g.s,e),rows=b.frames.at(-1).p.used.filter(x=>x.startsWith('quota:art.path.'+key+':')); 
   if(rows.length){triggered=true;assert.equal(new Set(rows.map(x=>x.split(':').slice(0,-1).join(':'))).size,rows.length);}
   assert(b.frames.length<5000);
  }
  assert(triggered,'artifact not exercised: '+key);
 }
});
test('common converter pieces can link racial talents without changing enemy skills',()=>{const g=fresh('spirit','RACE-CONVERT');equip(g,['basic.fire','aux.fire','art.path.ember']);g.s.talents=['talent.spirit.root'];g.s.bonus.hp=500;g.s.hp=100;const e=structuredClone(c.enemies[0]);e.stats.hp=4000;e.stats.attack=8;const b=simulateBattle(c,g.s,e);assert(b.frames.some(f=>f.sourceId==='art.path.ember'&&f.kind==='heal'));assert(b.frames.some(f=>f.sourceId==='talent.spirit.root'));assert(!c.enemies.some(e=>e.abilities.some(id=>id.startsWith('art.path.'))));});
