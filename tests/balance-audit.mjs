import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {run} from './policy.mjs';

const c=JSON.parse(await readFile(new URL('../data/game.json',import.meta.url),'utf8'));
const seeds=25;
const rows=[];
for(const race of c.races){
  for(const origin of c.origins){
    for(let i=0;i<seeds;i++){
      const g=run(c,origin.id,`BAL-${race.id}-${origin.id}-${i}`,450,race.id);
      rows.push({
        race:race.id,
        origin:origin.id,
        seed:i,
        won:g.s.phase==='finished',
        act:g.s.act+1,
        node:g.s.row+1,
        hp:g.s.hp,
        maxHp:g.stats().hp,
        ending:g.s.endingId,
        talents:[...g.s.talents],
        actions:g.s.actionLog.length
      });
    }
  }
}
const pct=(n,d)=>d?Math.round(n*1000/d)/10:0;
const avg=a=>a.length?Math.round(a.reduce((x,y)=>x+y,0)*10/a.length)/10:0;
const summarize=(key,items)=>items.map(item=>{
  const rs=rows.filter(r=>r[key]===item.id);
  const wins=rs.filter(r=>r.won);
  return {
    id:item.id,
    name:item.name,
    runs:rs.length,
    wins:wins.length,
    winRate:pct(wins.length,rs.length),
    avgWinHpRate:avg(wins.map(r=>r.maxHp?100*r.hp/r.maxHp:0)),
    avgActions:avg(rs.map(r=>r.actions)),
    deathsByAct:rs.filter(r=>!r.won).reduce((m,r)=>(m[r.act]=(m[r.act]??0)+1,m),{})
  };
});
const talentMap=new Map();
for(const r of rows)for(const id of r.talents){const x=talentMap.get(id)??{id,picks:0,wins:0};x.picks++;if(r.won)x.wins++;talentMap.set(id,x);}
const talents=[...talentMap.values()].map(x=>({...x,winRate:pct(x.wins,x.picks)})).sort((a,b)=>b.picks-a.picks||b.winRate-a.winRate);
const race=summarize('race',c.races);
const origin=summarize('origin',c.origins);
const matrix=c.races.map(rr=>({race:rr.id,origins:c.origins.map(o=>{const rs=rows.filter(r=>r.race===rr.id&&r.origin===o.id);const w=rs.filter(r=>r.won).length;return {origin:o.id,wins:w,runs:rs.length,winRate:pct(w,rs.length)};})}));
const rates=race.map(x=>x.winRate);
const audit={
  policy:'Current deterministic autoplay; first offered talent; 25 seeds per ancestry/vocation pair',
  totalRuns:rows.length,
  overallWinRate:pct(rows.filter(r=>r.won).length,rows.length),
  raceSpread:Math.max(...rates)-Math.min(...rates),
  race,
  origin,
  matrix,
  talents,
  rows
};
await mkdir(new URL('../verification',import.meta.url),{recursive:true});
await writeFile(new URL('../verification/balance-audit.json',import.meta.url),JSON.stringify(audit,null,2));
console.log(JSON.stringify({totalRuns:audit.totalRuns,overallWinRate:audit.overallWinRate,raceSpread:audit.raceSpread,race,origin,matrix,topTalents:talents.slice(0,16)},null,2));
