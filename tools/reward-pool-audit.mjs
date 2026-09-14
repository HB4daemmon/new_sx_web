import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {Game,fateOptions} from '../build/engine.js';

const c=JSON.parse(readFileSync(new URL('../data/game.json',import.meta.url),'utf8'));
const rarityCatalog=Object.fromEntries(['common','rare','mythic'].map(r=>[r,c.abilities.filter(a=>a.rarity===r).length]));
const dist={0:0,1:0,2:0,3:0};
let identical=0;
const samples=[];
for(let i=0;i<400;i++){
  const seed=`REWARD-AUDIT-${i}`;
  const origin=c.origins[i%c.origins.length].id;
  const race=c.races[i%c.races.length].id;
  const fate=fateOptions(c,seed)[0].id;
  const elite=Game.create(c,seed,origin,fate,'Audit','',race);
  const boss=Game.create(c,seed,origin,fate,'Audit','',race);
  elite.s.current={id:'audit-elite',act:0,row:0,lane:0,type:'elite'};
  boss.s.current={id:'audit-boss',act:0,row:0,lane:0,type:'boss'};
  const a=elite.rollAbilities(3,'reward');
  const b=boss.rollAbilities(3,'reward');
  if(JSON.stringify(a)===JSON.stringify(b))identical++;
  assert.deepEqual(a,b,'elite and boss currently share identical reward generation');
  const rare=a.filter(id=>c.abilities.find(x=>x.id===id)?.rarity==='rare').length;
  dist[rare]++;
  if(samples.length<8)samples.push({seed,offers:a.map(id=>{const x=c.abilities.find(y=>y.id===id);return {id,name:x.name,rarity:x.rarity};})});
}
const report={catalog:rarityCatalog,samples:400,eliteBossIdentical:identical,rareChoiceCountDistribution:dist,allCommonRatePercent:Number((dist[0]/4).toFixed(1)),cause:"finishBattle() calls rollAbilities(3, 'reward') for combat, elite and boss alike; rollAbilities has no encounter-type rarity floor or bias"};
mkdirSync(new URL('../verification',import.meta.url),{recursive:true});
writeFileSync(new URL('../verification/reward-pool-audit.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
