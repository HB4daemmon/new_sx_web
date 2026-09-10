import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {run} from './policy.mjs';
const c=JSON.parse(await readFile(new URL('../data/game.json',import.meta.url),'utf8'));
const runs=[];for(const o of c.origins)for(let i=0;i<40;i++){const g=run(c,o.id,'SIM-'+i);runs.push({origin:o.id,seed:g.s.seed,won:g.s.phase==='finished',act:g.s.act+1,node:g.s.row+1,hp:g.s.hp,ending:g.s.endingId,build:g.s.slots,xp:g.s.xp,actions:g.s.actionLog.length});}
const summary=c.origins.map(o=>({origin:o.id,runs:40,wins:runs.filter(r=>r.origin===o.id&&r.won).length,deaths:runs.filter(r=>r.origin===o.id&&!r.won).reduce((a,r)=>(a[r.act]=(a[r.act]??0)+1,a),{})}));
await mkdir(new URL('../verification',import.meta.url),{recursive:true});await writeFile(new URL('../verification/simulation.json',import.meta.url),JSON.stringify({policy:'Greedy build synergy and HP-aware route; no stat cheats or resets',summary,runs},null,2));console.log(JSON.stringify(summary,null,2));
