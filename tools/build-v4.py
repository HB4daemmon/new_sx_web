from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
engine_path = root / 'src/engine.ts'
app_path = root / 'src/app.ts'
css_path = root / 'src/style.css'
gen_path = root / 'scripts/create-content.py'
test_path = root / 'tests/engine.test.mjs'
doc_path = root / 'docs/GAMEPLAY_V4.md'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if text.count(old) != 1:
        raise RuntimeError(f'{label}: expected one match, got {text.count(old)}')
    return text.replace(old, new, 1)


def replace_method(text: str, name: str, next_name: str, replacement: str) -> str:
    start_marker = f'  {name}('
    next_marker = f'  {next_name}('
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f'method {name} not found')
    end = text.find(next_marker, start + len(start_marker))
    if end < 0:
        raise RuntimeError(f'next method {next_name} not found')
    return text[:start] + replacement.rstrip() + '\n' + text[end:]


engine = engine_path.read_text(encoding='utf-8')

engine = replace_once(
    engine,
    "export interface CombatBreakdown { base:number; scaled:number; afterDefense:number; afterVulnerable:number; afterCrit:number; absorbed:number; hpLoss:number; }",
    "export interface CombatBreakdown { base:number; scaled:number; afterDefense:number; afterVulnerable:number; afterBuild:number; afterCrit:number; absorbed:number; hpLoss:number; }\nexport interface BuildResonance {id:'rage'|'burn'|'guard'|'break';name:string;tier:0|1|2;count:number;next:number;description:string;}\nexport interface BuildProfile {tags:Record<string,number>;resonances:BuildResonance[];dominant:string[];strategy:{name:string;count:number;tier:0|1|2;bonusPercent:number;description:string};score:number;}",
    'build interfaces',
)

player_stats_end = " for(const k of STAT_KEYS)r[k]=Math.max(k==='hp'?1:0,Math.floor(r[k]*(100+value(f.percent?.[k]))/100));return r;\n}\n"
profile_code = r''' for(const k of STAT_KEYS)r[k]=Math.max(k==='hp'?1:0,Math.floor(r[k]*(100+value(f.percent?.[k]))/100));return r;
}

/** Derived only from the equipped eight-slot board. It is deterministic and never stored. */
export function buildProfile(c:Content,s:RunState):BuildProfile {
 const equipped=s.slots.filter((x):x is Equipped=>!!x).map(eq=>({eq,a:c.abilities.find(x=>x.id===eq.id)!}));
 const tags:Record<string,number>={};for(const {a} of equipped)for(const tag of a.tags)tags[tag]=(tags[tag]??0)+1;
 const school=(id:BuildResonance['id'],name:string,match:string[],tier1:string,tier2:string):BuildResonance=>{const count=equipped.filter(({a})=>match.some(t=>a.tags.includes(t))).length;const tier=(count>=4?2:count>=2?1:0) as 0|1|2;return {id,name,tier,count,next:tier===0?2:4,description:tier===2?tier2:tier===1?tier1:`再有 ${Math.max(0,2-count)} 项同源能力可激活`};};
 const resonances=[
  school('rage','怒潮共鸣',['rage','burst'],'入战怒气 +15','入战怒气 +15；怒气技后返还 15 怒气'),
  school('burn','焚劫共鸣',['fire','burn'],'燃烧每层伤害 +1','燃烧每层伤害 +1；施加燃烧额外 +1 层'),
  school('guard','玄甲共鸣',['shield','counter'],'入战获得防御 80% 的护盾','入战获得防御 80% 的护盾；有护盾时造成伤害 +15%'),
  school('break','破阵共鸣',['break','sword'],'施加破甲时额外 +1 层','施加破甲额外 +1 层；对破甲目标伤害 +20%'),
 ];
 const strategyEq=s.slots.find((eq,i)=>eq&&SLOT_ORDER[i]==='strategy');const strategyAbility=strategyEq?c.abilities.find(a=>a.id===strategyEq.id):undefined;
 const aligned=strategyAbility?equipped.filter(({a})=>a.id!==strategyAbility.id&&a.tags.some(t=>strategyAbility.tags.includes(t))).length:0;const strategyTier=(aligned>=5?2:aligned>=3?1:0) as 0|1|2;const bonusPercent=strategyTier===2?18:strategyTier===1?10:0;
 const dominant=Object.entries(tags).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,4).map(([k])=>k);
 const ranks=equipped.reduce((n,{eq})=>n+eq.rank,0);const score=equipped.length*4+ranks*3+resonances.reduce((n,r)=>n+r.tier*10,0)+strategyTier*8;
 return {tags,resonances,dominant,strategy:{name:strategyAbility?.name??'未装配战策',count:aligned,tier:strategyTier,bonusPercent,description:strategyTier?`战策与 ${aligned} 项能力同源，全伤害 +${bonusPercent}%`:`战策与至少 3 项能力共享标签后激活统摄`},score};
}
'''
engine = replace_once(engine, player_stats_end, profile_code, 'build profile')

sim_start = engine.index('export function simulateBattle')
sim_end = engine.index('export class Game {', sim_start)
new_sim = r'''export function simulateBattle(c:Content,s:RunState,enemy:Enemy):Battle {
 const p=fighter(c,s),e=fighter(c,s,enemy),frames:Frame[]=[];let round=0,eventBudget=0,objectiveProgress=0,objectiveWon=false;
 const build=buildProfile(c,s),res=(id:BuildResonance['id'])=>build.resonances.find(x=>x.id===id)!.tier,rageTier=res('rage'),burnTier=res('burn'),guardTier=res('guard'),breakTier=res('break');
 const objective:BattleObjective=clone(enemy.objective??{type:'kill',label:'击败敌人'});const summary:BattleSummary={playerDamage:0,enemyDamage:0,playerShieldAbsorbed:0,enemyShieldAbsorbed:0,playerCrits:0,enemyCrits:0,playerMisses:0,enemyMisses:0,playerRageSkills:0,enemyRageSkills:0,statusTicks:0,phaseChanges:0};
 const side=(f:Fighter)=>f===p?'p':f===e?'e':'system';
 const frame=(actor:Fighter|undefined,kind:string,label:string,amount=0,crit=false,meta:Partial<Frame>={})=>frames.push({round,actor:actor?side(actor):'system',kind,label,amount,crit,p:clone(p),e:clone(e),...meta});
 const stat=(f:Fighter,k:Stat)=>k==='attack'?Math.max(1,Math.floor(f.stats.attack*(f.status.weak?100-c.rules.weakPercent:100)/100)):k==='defense'?Math.max(0,f.stats.defense-(f.status.break??0)*c.rules.breakDefense):f.stats[k];
 const changeRage=(f:Fighter,n:number)=>{f.rage=clamp(f.rage+n,0,c.rules.rageMax);};
 const stream=(f:Fighter,kind:string)=>`combat.${f===p?'p':'e'}.${kind}`;
 function hurt(a:Fighter,b:Fighter,n:number,label:string,crit=false,breakdown?:CombatBreakdown,sourceId?:string){n=Math.max(1,Math.floor(n));const absorbed=Math.min(b.shield,n);b.shield-=absorbed;const hpLoss=Math.max(0,n-absorbed);b.hp=Math.max(0,b.hp-hpLoss);if(b===p){summary.enemyDamage+=hpLoss;summary.playerShieldAbsorbed+=absorbed;}else{summary.playerDamage+=hpLoss;summary.enemyShieldAbsorbed+=absorbed;if(a===p)objectiveProgress+=hpLoss+absorbed;}if(breakdown){breakdown.absorbed=absorbed;breakdown.hpLoss=hpLoss;}frame(a,'damage',label,hpLoss,crit,{sourceId,breakdown,detail:absorbed?`护盾吸收 ${absorbed}`:undefined});if(objective.type==='break'&&objectiveProgress>=(objective.value??1))objectiveWon=true;if(b===e)checkBossPhase();}
 function apply(a:Fighter,b:Fighter,ef:Effect,rank:number,label:string,secondary=false,sourceId?:string){if(++eventBudget>768)throw new Error('Combat effect budget exceeded');const t=ef.target==='self'?a:b;let n=value(ef.value,rank);switch(ef.type){case 'damage':{let base=n;let scaled=base+Math.floor(stat(a,ef.stat??'attack')*value(ef.coefficient,rank)/100)+Math.floor(t.stats.hp*(ef.maxHpPercent??0)/100);let afterDefense=ef.pure?Math.max(1,scaled):Math.max(1,scaled-stat(t,'defense'));let afterVulnerable=t.status.vulnerable?Math.floor(afterDefense*(100+c.rules.vulnerablePercent)/100):afterDefense;let buildPercent=100;if(a===p&&t!==a){buildPercent+=build.strategy.bonusPercent;if(guardTier>=2&&a.shield>0)buildPercent+=15;if(breakTier>=2&&(t.status.break??0)>0)buildPercent+=20;}let afterBuild=Math.max(1,Math.floor(afterVulnerable*buildPercent/100));let crit=false;if(t!==a&&!secondary){const hit=clamp(9500+a.stats.hit*50-t.stats.dodge*50,6000,10000);if(random(s,stream(a,'hit'))*10000>=hit){if(a===p)summary.playerMisses++;else summary.enemyMisses++;frame(a,'miss',label,0,false,{sourceId,detail:`命中率 ${(hit/100).toFixed(1)}%`});return false;}crit=random(s,stream(a,'crit'))*10000<Math.min(4000,500+a.stats.luck*30);if(crit){afterBuild=Math.floor(afterBuild*150/100);if(a===p)summary.playerCrits++;else summary.enemyCrits++;}}let afterCrit=afterBuild;if(a.fate?.damageByRound&&t!==a)afterCrit=Math.floor(afterCrit*a.fate.damageByRound[Math.min(Math.max(round-1,0),a.fate.damageByRound.length-1)]/100);const breakdown:CombatBreakdown={base,scaled,afterDefense,afterVulnerable,afterBuild,afterCrit,absorbed:0,hpLoss:0};hurt(a,t,afterCrit,label,crit,breakdown,sourceId);return true;}case 'heal':t.hp=Math.min(t.stats.hp,t.hp+n+Math.floor(t.stats.hp*(ef.maxHpPercent??0)/100));break;case 'gain_shield':t.shield=Math.min(9999,t.shield+n+Math.floor(stat(a,ef.stat??'defense')*value(ef.coefficient,rank)/100));break;case 'gain_rage':changeRage(t,n);break;case 'lose_rage':changeRage(t,-n);break;case 'apply_status':if(a===p&&t===e&&ef.status==='burn'&&burnTier>=2)n++;if(a===p&&t===e&&ef.status==='break'&&breakTier>=1)n++;t.status[ef.status!]=clamp((t.status[ef.status!]??0)+n,0,ef.status==='stun'?1:20);break;case 'remove_status':delete t.status[ef.status!];break;case 'modify_stat':{const k=ef.stat!;t.stats[k]=Math.max(k==='hp'?1:0,Math.floor(t.stats[k]*(100+value(ef.percent,rank))/100)+n);if(k==='hp')t.hp=Math.min(t.hp,t.stats.hp);break;}default:throw new Error('Non-combat effect in combat: '+ef.type);}return true;}
 function checkBossPhase(){const phases=enemy.phases??[];while(e.phase<phases.length&&e.hp*100<=e.stats.hp*phases[e.phase].hpPercent){const ph=phases[e.phase++];summary.phaseChanges++;frame(undefined,'phase',ph.label,0,false,{phase:e.phase,detail:`生命降至 ${ph.hpPercent}% 阈值`});for(const ef of ph.effects??[])apply(e,p,ef,0,ph.label,true,'boss.phase');}}
 function trigger(a:Fighter,b:Fighter,on:string){if(a.hp<=0)return;const list=[...a.abilities.map(eq=>({id:eq.id,rank:eq.rank,triggers:c.abilities.find(x=>x.id===eq.id)!.triggers})),...(a.fate?[{id:'fate',rank:0,triggers:a.fate.triggers??[]}]:[])];for(const item of list)for(let i=0;i<item.triggers.length;i++){const t=item.triggers[i],key=item.id+':'+i;if(t.on!==on||(t.once&&a.used.includes(key))||!(t.conditions??[]).every(q=>conditionOK(c,s,q,a,b)))continue;if(t.chance!==undefined&&random(s,stream(a,'trigger.'+on))*100>=t.chance)continue;if(t.once)a.used.push(key);for(const effect of t.effects){if(b.hp<=0&&effect.target!=='self')continue;apply(a,b,effect,item.rank,c.abilities.find(x=>x.id===item.id)?.name??a.fate?.name??on,true,item.id);}}}
 function legalActions(a:Fighter){return a.abilities.map(eq=>({eq,ability:c.abilities.find(x=>x.id===eq.id)!})).filter(x=>['basic','rage'].includes(x.ability.slot)&&(a.cooldown[x.ability.id]??0)<=0&&(x.ability.slot!=='rage'||a.rage>=x.ability.cost));}
 function actionScore(x:{eq:Equipped;ability:Ability}){const hit=x.ability.effects.find(e=>e.type==='damage');return (x.ability.priority??0)+(x.ability.slot==='rage'?200:0)+value(hit?.coefficient,x.eq.rank)+value(hit?.value,x.eq.rank);}
 function chooseAction(a:Fighter){const all=legalActions(a);if(!all.length)return undefined;if(a===p){const rage=all.filter(x=>x.ability.slot==='rage').sort((x,y)=>actionScore(y)-actionScore(x));if(rage.length)return rage[0];return all.filter(x=>x.ability.slot==='basic').sort((x,y)=>actionScore(y)-actionScore(x))[0]??all[0];}if(enemy.ai==='weighted')return weighted(s,'combat.enemy_ai',all,x=>Math.max(1,actionScore(x)));return [...all].sort((x,y)=>actionScore(y)-actionScore(x)||x.ability.id.localeCompare(y.ability.id))[0];}
 function tickStatuses(a:Fighter,b:Fighter){let changed=false;if(a.status.burn&&a.hp>0){const perStack=c.rules.burnDamage+(a===e&&burnTier>=1?1:0),n=a.status.burn*perStack;a.status.burn=Math.max(0,a.status.burn-1);summary.statusTicks++;hurt(b,a,n,'燃烧',false,{base:n,scaled:n,afterDefense:n,afterVulnerable:n,afterBuild:n,afterCrit:n,absorbed:0,hpLoss:0},'status.burn');changed=true;}for(const st of ['weak','break','vulnerable'])if(a.status[st]){a.status[st]=Math.max(0,a.status[st]-1);changed=true;}if(changed&&a.hp>0)frame(undefined,'status_tick',a.name+' 状态结算',0,false,{detail:'持续状态衰减'});}
 function objectiveReached(){if(p.hp<=0)return false;if(objective.type==='kill')return e.hp<=0;if(objective.type==='break')return objectiveWon;if(objective.type==='survive')return round>=(objective.rounds??1);return false;}
 frame(undefined,'start','斗法开始',0,false,{objective:objective.label??objective.type});
 if(rageTier>=1)changeRage(p,15);if(guardTier>=1)p.shield=Math.min(9999,p.shield+Math.floor(stat(p,'defense')*.8));
 const active=build.resonances.filter(x=>x.tier>0).map(x=>`${x.name}·${x.tier===2?'二重':'一重'}`);if(build.strategy.tier)active.push(`战策统摄 +${build.strategy.bonusPercent}%`);if(active.length)frame(undefined,'build','构筑共鸣',0,false,{detail:active.join(' / ')});
 trigger(p,e,'battle_start');trigger(e,p,'battle_start');frame(undefined,'ready','命格与法宝已生效');
 for(round=1;round<=c.rules.maxRounds&&p.hp>0&&e.hp>0&&!objectiveWon;round++){
  eventBudget=0;for(const a of [p,e])for(const id of Object.keys(a.cooldown))if(a.cooldown[id]>0)a.cooldown[id]--;
  const order=p.stats.speed>=e.stats.speed?[p,e]:[e,p];
  for(const a of order){const b=a===p?e:p;if(a.hp<=0||b.hp<=0||objectiveWon)break;if(a.status.stun){delete a.status.stun;frame(a,'stun','眩晕，跳过行动');continue;}trigger(a,b,'before_action');trigger(a,b,'hp_threshold');if(a.hp<=0||b.hp<=0)break;const picked=chooseAction(a);if(!picked){changeRage(a,5);frame(a,'wait','无可用主行动',0,false,{detail:'冷却或怒气条件未满足；怒气 +5'});continue;}const {eq,ability}=picked,useRage=ability.slot==='rage';if(useRage){changeRage(a,-ability.cost);if(a===p)summary.playerRageSkills++;else summary.enemyRageSkills++;}let hit=false;for(const ef of ability.effects){if(b.hp<=0&&ef.target!=='self')continue;const landed=apply(a,b,ef,eq.rank,ability.name,false,ability.id);if(ef.type==='damage'&&ef.target!=='self')hit=landed!==false;if(objectiveWon)break;}if(ability.cooldown)a.cooldown[ability.id]=ability.cooldown;if(ability.slot==='basic')changeRage(a,c.rules.basicRage);if(hit){changeRage(b,c.rules.hitRage);trigger(a,b,'on_hit');trigger(b,a,'on_damaged');trigger(b,a,'hp_threshold');}if(useRage){trigger(a,b,'on_rage_skill');if(a===p&&rageTier>=2)changeRage(a,15);}trigger(a,b,'after_action');trigger(a,b,'hp_threshold');const notes:string[]=[];if(ability.cooldown)notes.push(`进入 ${ability.cooldown} 回合冷却`);if(a===p&&useRage&&rageTier>=2)notes.push('怒潮回气 +15');frame(a,useRage?'rage':'action',ability.name,0,false,{sourceId:ability.id,detail:notes.join('；')||undefined});if(objectiveReached()){objectiveWon=true;break;}}
  if(p.hp<=0||e.hp<=0||objectiveWon)break;for(const a of [p,e]){const b=a===p?e:p;trigger(a,b,'round_end');tickStatuses(a,b);trigger(a,b,'hp_threshold');if(p.hp<=0||e.hp<=0)break;}if(objectiveReached()){objectiveWon=true;break;}
 }
 const won=p.hp>0&&(objectiveWon||(objective.type==='kill'&&e.hp<=0));if(won)trigger(p,e,'battle_end');if(!won&&p.hp>0){p.hp=0;frame(undefined,'timeout','劫气耗尽',0,false,{detail:'未在规则允许的回合内完成目标'});}frame(undefined,won?'win':'loss',won?'斗法告捷':'此身入劫',0,false,{objective:objective.label??objective.type,detail:won?`目标完成：${objective.label??objective.type}`:`目标失败：${objective.label??objective.type}`});
 return {enemyId:enemy.id,frames,won,rounds:Math.min(round,c.rules.maxRounds),hp:p.hp,cursor:0,objective,summary,objectiveProgress};
}

'''
engine = engine[:sim_start] + new_sim + engine[sim_end:]

engine = replace_once(engine, " stats():Stats{return playerStats(this.c,this.s);}\n", " stats():Stats{return playerStats(this.c,this.s);}\n build():BuildProfile{return buildProfile(this.c,this.s);}\n", 'game build method')
old_roll = " rollAbilities(n:number,streamName:string,slot?:Slot):string[]{const s=this.s,affinity=this.c.origins.find(o=>o.id===s.origin)!.affinity;let pool=this.c.abilities.filter(a=>a.rarity!=='mythic'&&(!slot||a.slot===slot)&&!s.slots.some(eq=>eq?.id===a.id&&eq.rank===3));const out:string[]=[];while(pool.length&&out.length<n){const a=weighted(s,streamName,pool,x=>x.tags.includes(affinity)?3:1);out.push(a.id);pool=pool.filter(x=>x.id!==a.id);}return out;}"
new_roll = " rollAbilities(n:number,streamName:string,slot?:Slot):string[]{const s=this.s,affinity=this.c.origins.find(o=>o.id===s.origin)!.affinity,build=this.build();let pool=this.c.abilities.filter(a=>a.rarity!=='mythic'&&(!slot||a.slot===slot)&&!s.slots.some(eq=>eq?.id===a.id&&eq.rank===3));const out:string[]=[];while(pool.length&&out.length<n){const a=weighted(s,streamName,pool,x=>1+(x.tags.includes(affinity)?2:0)+x.tags.reduce((n,t)=>n+Math.min(2,build.tags[t]??0),0));out.push(a.id);pool=pool.filter(x=>x.id!==a.id);}return out;}"
engine = replace_once(engine, old_roll, new_roll, 'build-aware reward weighting')
engine_path.write_text(engine, encoding='utf-8')

app = app_path.read_text(encoding='utf-8')
app = replace_once(app, "modalAbility='';toastText='';timer=0;toastTimer=0;speed=2;paused=false;muted=true;audio?:AudioContext;", "modalAbility='';toastText='';timer=0;toastTimer=0;speed=2;paused=false;muted=true;detailedLog=false;audio?:AudioContext;", 'detailed log property')
app = replace_once(app, "this.muted=localStorage.getItem('fengshen-muted')!=='false';", "this.muted=localStorage.getItem('fengshen-muted')!=='false';this.detailedLog=localStorage.getItem('fengshen-detailed-log')==='true';", 'load detailed log setting')
app = replace_once(app, "case 'sound':this.muted=!this.muted;try{localStorage.setItem('fengshen-muted',String(this.muted));}catch{}break;", "case 'sound':this.muted=!this.muted;try{localStorage.setItem('fengshen-muted',String(this.muted));}catch{}break;\n     case 'detailedLog':this.detailedLog=!this.detailedLog;try{localStorage.setItem('fengshen-detailed-log',String(this.detailedLog));}catch{}break;", 'detailed log action')

new_build_panel = r'''  buildResonances(compact=false){const b=this.game!.build(),tier=(n:number)=>n===2?'二重':n===1?'一重':'未激活';return `<div class="resonance-panel ${compact?'compact':''}"><div class="resonance-title"><span>流派共鸣</span><b>BUILD ${b.score}</b></div><div class="resonance-grid">${b.resonances.map(r=>`<div class="resonance-row ${r.tier?'active':''} tier-${r.tier}"><div><strong>${esc(r.name)}</strong><span>${tier(r.tier)} · ${r.count}/4</span></div><p>${esc(r.description)}</p><div class="resonance-track"><i style="width:${Math.min(100,r.count/4*100)}%"></i></div></div>`).join('')}</div><div class="strategy-link ${b.strategy.tier?'active':''}"><div><span>战策统摄</span><strong>${esc(b.strategy.name)}</strong></div><b>${b.strategy.count}/5${b.strategy.bonusPercent?' · +'+b.strategy.bonusPercent+'%':''}</b><p>${esc(b.strategy.description)}</p></div></div>`;}
  buildPanel(){const s=this.game!.s,b=this.game!.build();return `<aside class="sidebar right-sidebar"><div class="side-section-title">八槽命盘<span>${s.slots.filter(Boolean).length} / 8 已装配</span></div><div class="mini-build">${s.slots.map((eq,i)=>this.mini(eq,i)).join('')}</div><div class="build-tags">${b.dominant.map(k=>`<span>${TAGS[k]??esc(k)}  ${b.tags[k]}</span>`).join('')}</div>${this.buildResonances()}<p class="small muted" style="margin-top:15px;font-size:10px;line-height:1.9">同名升阶，最高 R3。共鸣按同源能力数量激活；战策与其他槽位共享标签可形成统摄。</p></aside>`;}
'''
app = replace_method(app, 'buildPanel', 'heading', new_build_panel)

new_log_method = r'''  statusChanges(frame:Frame,index:number,frames:Frame[]){if(index<=0)return [] as {side:'p'|'e';name:string;status:string;before:number;after:number}[];const prev=frames[index-1],enemy=this.content.enemies.find(e=>e.id===this.game!.s.battle!.enemyId)!,out:{side:'p'|'e';name:string;status:string;before:number;after:number}[]=[];for(const side of ['p','e'] as const){const before=prev[side],after=frame[side],name=side==='p'?this.game!.s.name:enemy.name;for(const k of new Set([...Object.keys(before.status),...Object.keys(after.status)])){const a=before.status[k]??0,b=after.status[k]??0;if(a!==b)out.push({side,name,status:k,before:a,after:b});}}return out;}
  battleLogRow(frame:Frame,index:number,frames:Frame[],enemyName:string,detailed=this.detailedLog){const prev=frames[Math.max(0,index-1)],actor=frame.actor==='p'?this.game!.s.name:frame.actor==='e'?enemyName:'天道',actorClass=frame.actor==='p'?'player':frame.actor==='e'?'enemy':'system',actorBadge=frame.actor==='p'?'我方':frame.actor==='e'?'敌方':'天道',statusChanges=this.statusChanges(frame,index,frames);if(!detailed){const damage=frame.kind==='damage'?`<div class="simple-damage"><span class="log-actor-badge ${actorClass}">${actorBadge}</span><strong>${esc(actor)}</strong><span>${esc(frame.label)}</span><b>${frame.crit?'暴击 · ':''}${frame.amount} 伤害</b>${frame.breakdown?.absorbed?`<em>护盾吸收 ${frame.breakdown.absorbed}</em>`:''}</div>`:'';const statuses=statusChanges.length?`<div class="simple-status-list">${statusChanges.map(x=>`<div class="simple-status ${x.side==='p'?'player':'enemy'}"><span>${x.side==='p'?'我方':'敌方'}</span><strong>${esc(x.name)}</strong><em>${esc(this.content.labels.statuses[x.status]??x.status)}</em><b>${x.before} → ${x.after} ${x.after-x.before>0?'+':''}${x.after-x.before}</b></div>`).join('')}</div>`:'';return `<article class="battle-log-row simple actor-${actorClass} ${frame.crit?'critical':''}">${damage}${statuses}</article>`;}const details:string[]=[];const delta=(label:string,before:number,after:number,cls:string)=>before===after?'':`<span class="log-delta ${cls}">${label} ${before}→${after} <b>${after-before>0?'+':''}${after-before}</b></span>`;for(const side of ['p','e'] as const){const before=prev[side],after=frame[side],who=side==='p'?this.game!.s.name:enemyName,changes:string[]=[];for(const x of [delta('生命',before.hp,after.hp,'hp'),delta('护盾',before.shield,after.shield,'shield'),delta('怒气',before.rage,after.rage,'rage')])if(x)changes.push(x);for(const k of new Set([...Object.keys(before.status),...Object.keys(after.status)])){const a=before.status[k]??0,b=after.status[k]??0;if(a!==b)changes.push(`<span class="log-delta status">${esc(this.content.labels.statuses[k]??k)} ${a}→${b} <b>${b-a>0?'+':''}${b-a}</b></span>`);}if(changes.length)details.push(`<div class="log-side ${side==='p'?'player':'enemy'}"><em>${side==='p'?'我方':'敌方'} · ${esc(who)}</em>${changes.join('')}</div>`);}const outcome=frame.kind==='damage'?`<span class="log-amount">${frame.crit?'暴击 · ':''}${frame.amount} 伤害</span>`:frame.kind==='miss'?'<span class="log-outcome">闪避</span>':frame.kind==='rage'?'<span class="log-outcome rage">怒气技</span>':frame.kind==='phase'?'<span class="log-outcome phase">阶段转换</span>':'';const b=frame.breakdown,formula=b?`<div class="combat-formula"><span>原始 ${b.base}</span><span>倍率后 ${b.scaled}</span><span>防御后 ${b.afterDefense}</span><span>易伤后 ${b.afterVulnerable}</span><span>构筑后 ${b.afterBuild}</span><span>暴击后 ${b.afterCrit}</span>${b.absorbed?`<span>护盾吸收 ${b.absorbed}</span>`:''}<b>生命损失 ${b.hpLoss}</b></div>`:'';return `<article class="battle-log-row detailed actor-${actorClass} kind-${frame.kind.replace(/[^a-z_-]/g,'')} ${frame.crit?'critical':''}"><div class="battle-log-main"><span class="round">${String(frame.round).padStart(2,'0')}</span><span class="log-actor-badge ${actorClass}">${actorBadge}</span><span class="log-actor">${esc(actor)}</span><strong>${esc(frame.label)}</strong>${outcome}</div>${frame.detail?`<div class="log-note">${esc(frame.detail)}</div>`:''}${formula}${details.length?`<div class="battle-log-detail">${details.join('')}</div>`:''}</article>`;}
'''
app = replace_method(app, 'battleLogRow', 'battle', new_log_method)

new_battle = r'''  battle(){const b=this.game!.s.battle!,cursor=bi(b.cursor,0,b.frames.length-1),f=b.frames[cursor],done=cursor>=b.frames.length-1,enemy=this.content.enemies.find(e=>e.id===b.enemyId)!,sum=b.summary,obj=b.objective,all=b.frames.slice(0,cursor+1).map((row,index)=>({row,index})),visible=this.detailedLog?all:all.filter(x=>x.row.kind==='damage'||this.statusChanges(x.row,x.index,b.frames).length>0);return `${this.heading(done?(b.won?'此战告捷':'此身入劫'):'斗法','',enemy.kind==='boss'?'BOSS / HEAVENLY TRIAL':'ROUND '+String(f.round).padStart(2,'0'))}<div class="battle-objective"><div><span>斗法目标</span><strong>${esc(obj.label??obj.type)}</strong></div><div><span>敌方决策</span><strong>${enemy.ai==='weighted'?'权重择法':'贪心择法'}</strong></div>${obj.type==='survive'?`<div><span>坚持</span><strong>${obj.rounds} 回合</strong></div>`:obj.type==='break'?`<div><span>破阵</span><strong>${b.objectiveProgress} / ${obj.value}</strong></div>`:''}</div><div class="combat-arena">${landscape()}${this.fighterFrame(f,'p')}<div class="versus"><small>斗法</small>VS</div>${this.fighterFrame(f,'e')}${f.amount>0?`<div class="damage-number" key="${cursor}">${f.crit?'<small>暴击</small>':''}${f.amount}</div>`:''}</div><div class="battle-controls"><div class="speeds">${[1,2,4].map(n=>`<button class="${this.speed===n?'active':''}" data-action="speed" data-index="${n}" aria-label="${n}倍速">${n}×</button>`).join('')}<button data-action="pause" ${done?'disabled':''}>${this.paused?'继续':'暂停'}</button></div>${done?btn('finishBattle',b.won?'领取机缘 '+icon('arrow',16):'查看命途','primary small'):btn('skip','略过回放 '+icon('arrow',16),'small')}</div>${done?`<div class="battle-summary"><div><span>造成伤害</span><b>${sum.playerDamage}</b></div><div><span>承受伤害</span><b>${sum.enemyDamage}</b></div><div><span>护盾承伤</span><b>${sum.playerShieldAbsorbed}</b></div><div><span>暴击 / 闪避</span><b>${sum.playerCrits} / ${sum.enemyMisses}</b></div><div><span>怒气技</span><b>${sum.playerRageSkills}</b></div><div><span>状态结算</span><b>${sum.statusTicks}</b></div>${sum.phaseChanges?`<div><span>Boss 变相</span><b>${sum.phaseChanges}</b></div>`:''}</div>`:''}<div class="battle-log-head"><span>斗法战报 <i class="log-mode ${this.detailedLog?'detailed':'simple'}">${this.detailedLog?'详细':'简易'}</i></span><small>${this.detailedLog?`${cursor+1} / ${b.frames.length} 帧`:`${visible.length} 条 · 仅伤害与状态`} · 最新在上</small></div><div class="battle-log ${this.detailedLog?'detailed-mode':'simple-mode'}" aria-live="polite" tabindex="0">${visible.map(({row,index})=>this.battleLogRow(row,index,b.frames,enemy.name,this.detailedLog)).reverse().join('')||'<div class="simple-log-empty">等待伤害或状态变化…</div>'}</div><p class="battle-caption">${esc(enemy.intent)}</p>`;}
'''
app = replace_method(app, 'battle', 'event', new_battle)

new_codex = r'''  codex(){const s=this.game!.s,list=this.codexFilter==='equipped'?s.slots.filter((x):x is Equipped=>!!x).map(x=>({a:this.game!.ability(x.id),rank:x.rank})):this.content.abilities.filter(a=>this.codexFilter==='all'||a.slot===this.codexFilter).map(a=>({a,rank:s.slots.find(eq=>eq?.id===a.id)?.rank??0}));return `${this.heading('道藏','一法一因果，一宝一修行。','THE COLLECTION')}${this.buildResonances(true)}<div class="filters">${[['equipped','当前命盘'],['all','全部'],...Object.entries(this.content.labels.slots)].map(([id,label])=>`<button class="${this.codexFilter===id?'active':''}" data-action="filter" data-id="${id}">${esc(label)}</button>`).join('')}</div><p class="codex-count">${list.length} 项 · 图鉴不是背包，不可从此处自由更换</p><div class="deck-grid">${list.map(({a,rank})=>this.card(a.id,rank)).join('')}</div>`;}
'''
app = replace_method(app, 'codex', 'karma', new_codex)

settings_start = app.find("   else if(this.modal==='settings')body=")
settings_end = app.find("   else if(this.modal==='ability')", settings_start)
if settings_start < 0 or settings_end < 0:
    raise RuntimeError('settings dialog block not found')
settings_block = r'''   else if(this.modal==='settings')body=`<h2>静室</h2><p>设置与存档</p><div class="setting-row"><span>原创合成音效</span>${btn('sound',this.muted?'已关闭':'已开启','small')}</div><div class="setting-row"><div><span>详细战报</span><small class="setting-hint">默认关闭；关闭时战报只显示伤害与状态变化</small></div>${btn('detailedLog',this.detailedLog?'已开启':'已关闭',this.detailedLog?'small active-setting':'small')}</div><div class="setting-row"><span>本地存档</span><span class="small ${this.storageOK?'jade':'red'}">${this.storageOK?'每次决策自动保存':'浏览器存储不可用'}</span></div><div class="setting-row"><span>备份 / 迁移</span><div class="row" style="gap:5px">${btn('export','导出','small',this.game?'':'disabled')}${btn('import','导入','small')}</div></div>${this.game?`<div class="setting-row"><span>本局种子</span><span class="mono">${esc(this.game.s.seed)}</span></div><div class="setting-row"><span>新的命途</span>${btn('new','重新入劫','small')}</div>`:''}<div class="setting-row"><span>内容 / 规则版本</span><span class="mono">${esc(this.content.version)} / ${esc(this.content.rulesVersion)}</span></div><p class="small muted" style="text-align:left;margin-top:19px;line-height:2">简易/详细战报只改变显示，不影响战斗结果；设置保存在当前浏览器。存档不会上传。</p>`;
'''
app = app[:settings_start] + settings_block + app[settings_end:]
app_path.write_text(app, encoding='utf-8')

css = css_path.read_text(encoding='utf-8')
css += r'''

/* Gameplay v4: readable logs + build resonance */
.log-mode{display:inline-flex;margin-left:7px;padding:1px 6px;border:1px solid #8a9a8438;font:8px var(--sans);font-style:normal;letter-spacing:1px}.log-mode.simple{color:#9eb8aa}.log-mode.detailed{color:#e3c47c;border-color:#b79b5d66}.battle-log-row.actor-player{border-left:3px solid #68a98f;padding-left:10px;background:linear-gradient(90deg,#2b604222,transparent 42%)}.battle-log-row.actor-enemy{border-left:3px solid #b5655b;padding-left:10px;background:linear-gradient(90deg,#6d30282b,transparent 42%)}.battle-log-row.actor-system{border-left:3px solid #9a8358;padding-left:10px}.log-actor-badge{display:inline-flex;align-items:center;justify-content:center;min-width:32px;padding:1px 5px;border:1px solid;font-size:8px;font-weight:800;letter-spacing:1px}.log-actor-badge.player{color:#93d0b2;border-color:#68a98f66;background:#234c382b}.log-actor-badge.enemy{color:#e2a098;border-color:#b5655b66;background:#5a2c272b}.log-actor-badge.system{color:#d6c28f;border-color:#9a835866;background:#4d42262b}.simple-mode .battle-log-row{padding-top:9px;padding-bottom:9px}.simple-damage{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.simple-damage>strong{font:12px var(--serif);letter-spacing:1px}.simple-damage>span:not(.log-actor-badge){color:#8fa096;font-size:9px}.simple-damage>b{margin-left:auto;color:#eaa08b;font-size:11px}.simple-damage>em{width:100%;padding-left:40px;color:#7ea9a7;font-size:8px;font-style:normal}.simple-status-list{display:grid;gap:4px;margin-top:5px}.simple-status{display:flex;align-items:center;gap:7px;padding:4px 7px;border:1px solid #81947e26;background:#101d19}.simple-status>span{font-size:8px;font-weight:800;letter-spacing:1px}.simple-status.player>span{color:#8bc9aa}.simple-status.enemy>span{color:#dd8e85}.simple-status>strong{font-size:9px;min-width:56px}.simple-status>em{font-style:normal;color:#c4a8d3;font-size:9px}.simple-status>b{margin-left:auto;font:9px ui-monospace,monospace;color:#c8cbb6}.simple-log-empty{text-align:center;padding:28px 10px;color:#71847a;font-size:10px}.log-side.player em{color:#85bba2}.log-side.enemy em{color:#c88479}.active-setting{border-color:#bda25f!important;color:#e6c977!important;background:#3c332033!important}.setting-hint{display:block;color:#74877d;font-size:9px;margin-top:3px;max-width:260px}
.resonance-panel{margin-top:15px;border:1px solid #8e9d8030;background:#0c1816;padding:10px}.resonance-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;color:#9bad9f;font-size:9px;letter-spacing:1.5px}.resonance-title b{font:10px ui-monospace,monospace;color:#d1b775}.resonance-grid{display:grid;gap:6px}.resonance-row{border:1px solid #78887825;background:#111e1a;padding:7px;opacity:.66}.resonance-row.active{opacity:1;border-color:#8fae8245}.resonance-row.tier-2{border-color:#c09f5a66;background:linear-gradient(120deg,#352c1e52,#10201a)}.resonance-row>div{display:flex;align-items:center;justify-content:space-between;gap:5px}.resonance-row strong{font:11px var(--serif);color:#d6d0b7}.resonance-row>div span{font-size:8px;color:#9ca88f}.resonance-row p{font-size:8px;color:#778c80;line-height:1.55;margin:4px 0}.resonance-track{height:2px;background:#08110f!important}.resonance-track i{display:block;height:100%;background:#a8975c}.strategy-link{margin-top:7px;padding:8px;border:1px dashed #80785d48;background:#151b18}.strategy-link.active{border-style:solid;border-color:#b59c6060}.strategy-link>div{display:flex;justify-content:space-between;gap:6px}.strategy-link span{font-size:8px;color:#7f9187}.strategy-link strong{font:10px var(--serif);color:#d4c69f}.strategy-link>b{display:block;margin-top:3px;font-size:9px;color:#c2a768}.strategy-link p{font-size:8px;color:#71837a;line-height:1.55;margin-top:3px}.resonance-panel.compact{max-width:860px;margin:0 auto 18px;padding:13px}.resonance-panel.compact .resonance-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.resonance-panel.compact .resonance-row{min-height:88px}
@media(max-width:760px){.battle-log-row.actor-player,.battle-log-row.actor-enemy,.battle-log-row.actor-system{padding-left:7px}.simple-damage{gap:5px}.simple-damage>b{font-size:10px}.simple-status{gap:5px;padding:4px}.simple-status>strong{min-width:42px}.resonance-panel.compact .resonance-grid{grid-template-columns:1fr}.resonance-panel.compact{padding:9px}.setting-hint{max-width:190px}}
'''
css_path.write_text(css, encoding='utf-8')

gen = gen_path.read_text(encoding='utf-8')
gen = replace_once(gen, "C['version']='2.0.0'", "C['version']='2.1.0'", 'content version')
gen = replace_once(gen, "C['rulesVersion']='2.0.0'", "C['rulesVersion']='2.1.0'", 'rules version')
gen_path.write_text(gen, encoding='utf-8')

tests = test_path.read_text(encoding='utf-8')
tests = replace_once(tests, "simulateBattle,validateContent,playerStats,replayRun,SLOT_ORDER,conditionOK", "simulateBattle,validateContent,playerStats,buildProfile,replayRun,SLOT_ORDER,conditionOK", 'test import')
tests += r'''

test('build profile activates two-tier resonances from the eight-slot board',()=>{const g=fresh('BUILD-RESONANCE');g.s.slots=[{id:'basic.thunder',rank:0},{id:'rage.thunder',rank:0},{id:'aux.qi',rank:0},{id:'aux.river',rank:0},{id:'art.feather',rank:0},{id:'art.flag',rank:0},null,{id:'strategy.rage',rank:0}];const b=buildProfile(c,g.s),rage=b.resonances.find(x=>x.id==='rage');assert.equal(rage.tier,2);assert(rage.count>=4);assert.equal(b.strategy.tier,2);assert.equal(b.strategy.bonusPercent,18);});
test('build resonance is deterministic and derived rather than persisted',()=>{const g=fresh('BUILD-DERIVED'),a=buildProfile(c,g.s),b=buildProfile(c,clone(g.s));assert.deepEqual(a,b);assert.equal('build' in g.s,false);});
test('active build resonance emits a typed combat frame and keeps replay deterministic',()=>{const make=()=>{const g=fresh('BUILD-BATTLE');g.s.slots=[{id:'basic.thunder',rank:0},{id:'rage.thunder',rank:0},{id:'aux.qi',rank:0},{id:'aux.river',rank:0},{id:'art.feather',rank:0},{id:'art.flag',rank:0},null,{id:'strategy.rage',rank:0}];return simulateBattle(c,g.s,c.enemies[0]);};const a=make(),b=make();assert.deepEqual(a,b);assert(a.frames.some(f=>f.kind==='build'));});
test('rules version advances for build-affecting combat changes',()=>{assert.equal(c.version,'2.1.0');assert.equal(c.rulesVersion,'2.1.0');});
'''
test_path.write_text(tests, encoding='utf-8')

doc_path.write_text(r'''# Gameplay V4 — readable combat logs and build resonance

This revision keeps the V3 deterministic auto-battle/event architecture and deepens two areas.

## Combat log modes

- Simple log is the default. It renders only damage and status changes.
- Player and enemy rows have separate visual identity and badges.
- Detailed log is opt-in from Settings and is stored in browser preferences, not the run save.
- Detailed mode retains action frames, hit/miss information, HP/shield/rage deltas and the complete damage pipeline, now including the build-modifier stage.
- Log mode never changes simulation, RNG, replay or settlement.

## Build depth

`buildProfile()` is derived from the eight equipped slots and is not persisted.

Four two-tier resonances are supported:

1. Rage/Burst — start rage, then rage-skill refund.
2. Fire/Burn — stronger burn ticks, then extra burn application.
3. Shield/Counter — opening shield, then bonus damage while shielded.
4. Break/Sword — extra break stacks, then bonus damage against broken targets.

The Strategy slot is now a keystone. Sharing its tags with 3/5 other equipped abilities activates Strategy Alignment for +10%/+18% outgoing damage.

Reward and shop ability rolls are weighted by the current board's existing tags as well as origin affinity, so a run increasingly expresses the build the player has actually assembled.

Because these rules change deterministic combat results, content/rules version is 2.1.0.
''', encoding='utf-8')

print('Gameplay V4 patch applied')
