import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {run} from './policy.mjs';
const root=new URL('../',import.meta.url);
const read=path=>readFile(new URL(path,root),'utf8');
const [contentText,packageText,presentationText,appText,policyText]=await Promise.all([
 read('data/game.json'),
 read('package.json'),
 read('src/presentation.ts'),
 read('src/app.ts'),
 read('tests/policy.mjs')
]);
const c=JSON.parse(contentText),pkg=JSON.parse(packageText);
const uiRevision= presentationText.match(/UI_REVISION='([^']+)'/)?.[1]??c.presentation?.revision;
const saveKey= appText.match(/const SAVE_KEY='([^']+)'/)?.[1];
if(pkg.version!==c.version||c.rulesVersion!==c.version||c.presentation?.revision!==uiRevision||!saveKey){
 throw new Error('Release metadata mismatch between package, content, presentation and save key');
}
const sha256=text=>createHash('sha256').update(text).digest('hex');
const policy='Greedy build synergy and HP-aware route; no stat cheats or resets';
const runs=[];for(const o of c.origins)for(let i=0;i<40;i++){const g=run(c,o.id,'SIM-'+i);runs.push({origin:o.id,seed:g.s.seed,won:g.s.phase==='finished',act:g.s.act+1,node:g.s.row+1,hp:g.s.hp,ending:g.s.endingId,build:g.s.slots,xp:g.s.xp,actions:g.s.actionLog.length});}
const summary=c.origins.map(o=>({origin:o.id,runs:40,wins:runs.filter(r=>r.origin===o.id&&r.won).length,deaths:runs.filter(r=>r.origin===o.id&&!r.won).reduce((a,r)=>(a[r.act]=(a[r.act]??0)+1,a),{})}));
const report={
 reportVersion:1,
 version:c.version,
 contentVersion:c.version,
 rulesVersion:c.rulesVersion,
 uiRevision,
 saveKey,
 command:'npm run simulate',
 reproductionCommand:'npm run build && npm run simulate',
 generatedBy:'tests/simulate.mjs',
 policy,
 policyFile:'tests/policy.mjs',
 policySha256:sha256(policyText),
 contentSha256:sha256(contentText),
 deterministic:true,
 seedPattern:'SIM-{0..39} for each origin',
 runsPerOrigin:40,
 totalRuns:runs.length,
 summary,
 runs
};
await mkdir(new URL('verification',root),{recursive:true});await writeFile(new URL('verification/simulation.json',root),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
