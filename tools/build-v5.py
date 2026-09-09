from pathlib import Path
import re
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
engine_path = root / 'src/engine.ts'
app_path = root / 'src/app.ts'
css_path = root / 'src/style.css'
gen_path = root / 'scripts/create-content.py'
test_path = root / 'tests/engine.test.mjs'
doc_path = root / 'docs/GAMEPLAY_V5.md'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if text.count(old) != 1:
        raise RuntimeError(f'{label}: expected one match, got {text.count(old)}')
    return text.replace(old, new, 1)


def replace_between(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise RuntimeError(f'{label}: start marker not found')
    end = text.find(end_marker, start + len(start_marker))
    if end < 0:
        raise RuntimeError(f'{label}: end marker not found')
    return text[:start] + replacement.rstrip() + '\n' + text[end:]


def replace_method(text: str, name: str, next_name: str, replacement: str) -> str:
    start_match = re.search(rf'(?m)^[ \t]+{re.escape(name)}\(', text)
    if not start_match:
        raise RuntimeError(f'method {name} not found')
    next_match = re.search(rf'(?m)^[ \t]+{re.escape(next_name)}\(', text[start_match.end():])
    if not next_match:
        raise RuntimeError(f'next method {next_name} not found')
    start = start_match.start()
    end = start_match.end() + next_match.start()
    return text[:start] + replacement.rstrip() + '\n' + text[end:]


engine = engine_path.read_text(encoding='utf-8')

old_interfaces = "export interface BuildResonance {id:'rage'|'burn'|'guard'|'break';name:string;tier:0|1|2;count:number;next:number;description:string;}\nexport interface BuildProfile {tags:Record<string,number>;resonances:BuildResonance[];dominant:string[];strategy:{name:string;count:number;tier:0|1|2;bonusPercent:number;description:string};score:number;}"
new_interfaces = "export interface BuildResonance {id:'rage'|'burn'|'guard'|'break';name:string;tier:0|1|2;count:number;next:number;description:string;}\nexport interface BuildBridge {id:'rage_burn'|'rage_break'|'burn_guard'|'guard_break';name:string;schools:[BuildResonance['id'],BuildResonance['id']];tier:0|1|2;counts:[number,number];description:string;}\nexport interface BuildFinisher {id:BuildResonance['id']|'none';name:string;active:boolean;progress:number;description:string;requirement:string;}\nexport interface BuildProfile {tags:Record<string,number>;resonances:BuildResonance[];dominant:string[];core:BuildResonance['id']|'none';bridge:BuildBridge;finisher:BuildFinisher;strategy:{name:string;count:number;tier:0|1|2;bonusPercent:number;description:string};score:number;}"
engine = replace_once(engine, old_interfaces, new_interfaces, 'v5 build interfaces')

profile_start = engine.index('/** Derived only from the equipped eight-slot board.')
profile_end = engine.index('export function simulateBattle', profile_start)
profile_code = r'''/** Gameplay V5 build profile: a core school, one deterministic cross-school bridge, and a late-run finisher. */
export function buildProfile(c:Content,s:RunState):BuildProfile {
 const equipped=s.slots.filter((x):x is Equipped=>!!x).map(eq=>({eq,a:c.abilities.find(x=>x.id===eq.id)!}));
 const tags:Record<string,number>={};for(const {a} of equipped)for(const tag of a.tags)tags[tag]=(tags[tag]??0)+1;
 const school=(id:BuildResonance['id'],name:string,match:string[],tier1:string,tier2:string):BuildResonance=>{const count=equipped.filter(({a})=>match.some(t=>a.tags.includes(t))).length;const tier=(count>=4?2:count>=2?1:0) as 0|1|2;return {id,name,tier,count,next:tier===0?2:4,description:tier===2?tier2:tier===1?tier1:`再有 ${Math.max(0,2-count)} 项同源能力可激活`};};
 const resonances=[
  school('rage','怒潮共鸣',['rage','burst'],'入战怒气 +15','入战怒气 +15；怒气技后返还 18 怒气'),
  school('burn','焚劫共鸣',['fire','burn'],'燃烧每层伤害 +1','燃烧每层伤害 +1；施加燃烧额外 +1 层'),
  school('guard','玄甲共鸣',['shield','counter'],'入战获得防御 60% 的护盾','入战获得防御 60% 的护盾；有护盾时造成伤害 +10%'),
  school('break','破阵共鸣',['break','sword'],'施加破甲时额外 +1 层','施加破甲额外 +1 层；对破甲目标伤害 +20%'),
 ];
 const strategyEq=s.slots.find((eq,i)=>eq&&SLOT_ORDER[i]==='strategy'),strategyAbility=strategyEq?c.abilities.find(a=>a.id===strategyEq.id):undefined;
 const aligned=strategyAbility?equipped.filter(({a})=>a.id!==strategyAbility.id&&a.tags.some(t=>strategyAbility.tags.includes(t))).length:0,strategyTier=(aligned>=5?2:aligned>=3?1:0) as 0|1|2,bonusPercent=strategyTier===2?18:strategyTier===1?10:0;
 const order:BuildResonance['id'][]=['rage','burn','break','guard'];const ranked=[...resonances].sort((a,b)=>b.tier-a.tier||b.count-a.count||order.indexOf(a.id)-order.indexOf(b.id)),core=(ranked[0]?.count??0)>0?ranked[0].id:'none';
 const defs:{id:BuildBridge['id'];name:string;schools:[BuildResonance['id'],BuildResonance['id']];one:string;two:string}[]=[
  {id:'rage_burn',name:'雷火轮转',schools:['rage','burn'],one:'怒气技追加 1 层燃烧；高燃烧时引发劫火',two:'怒气技追加 2 层燃烧；劫火伤害进一步提高'},
  {id:'rage_break',name:'狂澜裂阵',schools:['rage','break'],one:'怒气技命中破甲目标返还 8 怒气',two:'返还 15 怒气；怒气技对破甲目标额外 +15% 伤害'},
  {id:'burn_guard',name:'炉心金身',schools:['burn','guard'],one:'敌方燃烧结算时获得防御 15% 护盾',two:'敌方燃烧结算时获得防御 25% 护盾'},
  {id:'guard_break',name:'铁壁摧锋',schools:['guard','break'],one:'每回合首次用护盾吸收伤害，使攻击者 +1 破甲',two:'每回合首次用护盾吸收伤害，使攻击者 +2 破甲'},
 ];
 const pairs=defs.map((d,index)=>{const a=resonances.find(x=>x.id===d.schools[0])!,b=resonances.find(x=>x.id===d.schools[1])!,tier=(a.tier>=2&&b.tier>=2?2:a.tier>=1&&b.tier>=1?1:0) as 0|1|2;return {...d,index,tier,counts:[a.count,b.count] as [number,number]};}).sort((a,b)=>b.tier-a.tier||Math.min(...b.counts)-Math.min(...a.counts)||(b.counts[0]+b.counts[1])-(a.counts[0]+a.counts[1])||a.index-b.index);
 const best=pairs[0]!,left=resonances.find(x=>x.id===best.schools[0])!,right=resonances.find(x=>x.id===best.schools[1])!,bridge:BuildBridge={id:best.id,name:best.name,schools:best.schools,tier:best.tier,counts:best.counts,description:best.tier===2?best.two:best.tier===1?best.one:`${left.name} ${left.count}/2 · ${right.name} ${right.count}/2；双系各达一重后激活`};
 const coreRes=core==='none'?undefined:resonances.find(x=>x.id===core),finishers={rage:{name:'九转雷劫',effect:'首个怒气技后追加一次以攻击为基准的雷劫追击'},burn:{name:'焚天劫火',effect:'燃烧达到 8 层时爆燃并消耗 3 层燃烧'},guard:{name:'玄武返照',effect:'首次护盾破碎时反震敌人并重铸部分护盾'},break:{name:'万剑决阵',effect:'破甲达到 6 层时追加易伤与一次决阵伤害'}} as const,finisherDef=core==='none'?undefined:finishers[core];
 const progress=(coreRes?.tier===2?1:0)+(strategyTier===2?1:0)+(equipped.length===8?1:0),finisher:BuildFinisher={id:core,name:finisherDef?.name??'未定法相',active:progress===3&&core!=='none',progress,description:progress===3&&finisherDef?finisherDef.effect:'需要主轴二重、战策二重与八槽全满',requirement:'主轴二重 · 战策二重 · 八槽全满'};
 const dominant=Object.entries(tags).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,4).map(([k])=>k),ranks=equipped.reduce((n,{eq})=>n+eq.rank,0),score=equipped.length*4+ranks*3+resonances.reduce((n,r)=>n+r.tier*10,0)+strategyTier*8+bridge.tier*12+progress*4+(finisher.active?15:0);
 return {tags,resonances,dominant,core,bridge,finisher,strategy:{name:strategyAbility?.name??'未装配战策',count:aligned,tier:strategyTier,bonusPercent,description:strategyTier?`战策与 ${aligned} 项能力同源，全伤害 +${bonusPercent}%`:`战策与至少 3 项能力共享标签后激活统摄`},score};
}

'''
engine = engine[:profile_start] + profile_code + engine[profile_end:]

old_decl = " const build=buildProfile(c,s),res=(id:BuildResonance['id'])=>build.resonances.find(x=>x.id===id)!.tier,rageTier=res('rage'),burnTier=res('burn'),guardTier=res('guard'),breakTier=res('break');"
new_decl = " const build=buildProfile(c,s),res=(id:BuildResonance['id'])=>build.resonances.find(x=>x.id===id)!.tier,rageTier=res('rage'),burnTier=res('burn'),guardTier=res('guard'),breakTier=res('break'),bridge=build.bridge,finisher=build.finisher;let finisherUsed=false,guardBreakRound=-1;\n const bridgeTier=(id:BuildBridge['id'])=>bridge.id===id?bridge.tier:0;"
engine = replace_once(engine, old_decl, new_decl, 'v5 combat build declaration')

new_hurt = r''' function hurt(a:Fighter,b:Fighter,n:number,label:string,crit=false,breakdown?:CombatBreakdown,sourceId?:string){
  n=Math.max(1,Math.floor(n));const shieldBefore=b.shield,absorbed=Math.min(b.shield,n);b.shield-=absorbed;const hpLoss=Math.max(0,n-absorbed);b.hp=Math.max(0,b.hp-hpLoss);let guardFinisher=false;
  if(b===p&&a===e&&absorbed>0){const gb=bridgeTier('guard_break');if(gb>0&&guardBreakRound!==round){guardBreakRound=round;a.status.break=clamp((a.status.break??0)+gb,0,20);}guardFinisher=finisher.active&&finisher.id==='guard'&&!finisherUsed&&shieldBefore>0&&b.shield===0;}
  if(b===p){summary.enemyDamage+=hpLoss;summary.playerShieldAbsorbed+=absorbed;}else{summary.playerDamage+=hpLoss;summary.enemyShieldAbsorbed+=absorbed;if(a===p)objectiveProgress+=hpLoss+absorbed;}if(breakdown){breakdown.absorbed=absorbed;breakdown.hpLoss=hpLoss;}
  frame(a,'damage',label,hpLoss,crit,{sourceId,breakdown,detail:absorbed?`护盾吸收 ${absorbed}`:undefined});
  if(guardFinisher&&a.hp>0){finisherUsed=true;const rebound=Math.max(1,Math.floor(stat(p,'defense')*160/100)),reforge=Math.max(1,Math.floor(stat(p,'defense')*50/100));p.shield=Math.min(9999,p.shield+reforge);hurt(p,a,rebound,'玄武返照',false,{base:rebound,scaled:rebound,afterDefense:rebound,afterVulnerable:rebound,afterBuild:rebound,afterCrit:rebound,absorbed:0,hpLoss:0},'build.finisher.guard');frame(undefined,'build','终局法相 · 玄武返照',0,false,{detail:`护盾破碎，反震 ${rebound} 并重铸 ${reforge} 护盾`});}
  if(objective.type==='break'&&objectiveProgress>=(objective.value??1))objectiveWon=true;if(b===e)checkBossPhase();
 }
'''
engine = replace_between(engine, ' function hurt(', ' function apply(', new_hurt, 'v5 hurt function')

old_build_percent = "let buildPercent=100;if(a===p&&t!==a){buildPercent+=build.strategy.bonusPercent;if(guardTier>=2&&a.shield>0)buildPercent+=15;if(breakTier>=2&&(t.status.break??0)>0)buildPercent+=20;}"
new_build_percent = "let buildPercent=100;if(a===p&&t!==a){buildPercent+=build.strategy.bonusPercent;if(guardTier>=2&&a.shield>0)buildPercent+=10;if(breakTier>=2&&(t.status.break??0)>0)buildPercent+=20;if(bridgeTier('rage_break')>=2&&(t.status.break??0)>0&&c.abilities.find(x=>x.id===sourceId)?.slot==='rage')buildPercent+=15;}"
engine = replace_once(engine, old_build_percent, new_build_percent, 'v5 damage build modifiers')

old_status = "case 'apply_status':if(a===p&&t===e&&ef.status==='burn'&&burnTier>=2)n++;if(a===p&&t===e&&ef.status==='break'&&breakTier>=1)n++;t.status[ef.status!]=clamp((t.status[ef.status!]??0)+n,0,ef.status==='stun'?1:20);break;"
new_status = "case 'apply_status':if(a===p&&t===e&&ef.status==='burn'&&burnTier>=2)n++;if(a===p&&t===e&&ef.status==='break'&&breakTier>=1)n++;t.status[ef.status!]=clamp((t.status[ef.status!]??0)+n,0,ef.status==='stun'?1:20);if(a===p&&t===e&&finisher.active&&!finisherUsed&&finisher.id==='burn'&&ef.status==='burn'&&(t.status.burn??0)>=8){finisherUsed=true;const stacks=t.status.burn??0,burst=stacks*4;t.status.burn=Math.max(0,stacks-3);hurt(p,e,burst,'焚天劫火',false,{base:burst,scaled:burst,afterDefense:burst,afterVulnerable:burst,afterBuild:burst,afterCrit:burst,absorbed:0,hpLoss:0},'build.finisher.burn');frame(undefined,'build','终局法相 · 焚天劫火',0,false,{detail:`爆燃 ${stacks} 层，消耗 3 层燃烧`});}if(a===p&&t===e&&finisher.active&&!finisherUsed&&finisher.id==='break'&&ef.status==='break'&&(t.status.break??0)>=6){finisherUsed=true;t.status.vulnerable=clamp((t.status.vulnerable??0)+2,0,20);const burst=Math.max(1,Math.floor(stat(p,'attack')*120/100));hurt(p,e,burst,'万剑决阵',false,{base:burst,scaled:burst,afterDefense:burst,afterVulnerable:burst,afterBuild:burst,afterCrit:burst,absorbed:0,hpLoss:0},'build.finisher.break');frame(undefined,'build','终局法相 · 万剑决阵',0,false,{detail:'破甲贯体，追加 2 层易伤'});}break;"
engine = replace_once(engine, old_status, new_status, 'v5 status finishers')

new_tick = r''' function tickStatuses(a:Fighter,b:Fighter){let changed=false;if(a.status.burn&&a.hp>0){const perStack=c.rules.burnDamage+(a===e&&burnTier>=1?1:0),n=a.status.burn*perStack;a.status.burn=Math.max(0,a.status.burn-1);summary.statusTicks++;hurt(b,a,n,'燃烧',false,{base:n,scaled:n,afterDefense:n,afterVulnerable:n,afterBuild:n,afterCrit:n,absorbed:0,hpLoss:0},'status.burn');if(a===e&&p.hp>0&&bridgeTier('burn_guard')>0){const pct=bridgeTier('burn_guard')>=2?25:15,gain=Math.max(1,Math.floor(stat(p,'defense')*pct/100));p.shield=Math.min(9999,p.shield+gain);frame(undefined,'build','炉心金身',0,false,{detail:`劫火炼甲，护盾 +${gain}`});}changed=true;}for(const st of ['weak','break','vulnerable'])if(a.status[st]){a.status[st]=Math.max(0,a.status[st]-1);changed=true;}if(changed&&a.hp>0)frame(undefined,'status_tick',a.name+' 状态结算',0,false,{detail:'持续状态衰减'});}
'''
engine = replace_between(engine, ' function tickStatuses(', ' function objectiveReached(', new_tick, 'v5 burn guard bridge')

old_start = " if(rageTier>=1)changeRage(p,15);if(guardTier>=1)p.shield=Math.min(9999,p.shield+Math.floor(stat(p,'defense')*.8));\n const active=build.resonances.filter(x=>x.tier>0).map(x=>`${x.name}·${x.tier===2?'二重':'一重'}`);if(build.strategy.tier)active.push(`战策统摄 +${build.strategy.bonusPercent}%`);if(active.length)frame(undefined,'build','构筑共鸣',0,false,{detail:active.join(' / ')});"
new_start = " if(rageTier>=1)changeRage(p,15);if(guardTier>=1)p.shield=Math.min(9999,p.shield+Math.floor(stat(p,'defense')*.6));\n const active=build.resonances.filter(x=>x.tier>0).map(x=>`${x.name}·${x.tier===2?'二重':'一重'}`);if(build.strategy.tier)active.push(`战策统摄 +${build.strategy.bonusPercent}%`);if(build.bridge.tier)active.push(`${build.bridge.name}·${build.bridge.tier===2?'二重':'一重'}`);if(build.finisher.active)active.push(`终局法相·${build.finisher.name}`);if(active.length)frame(undefined,'build','构筑共鸣',0,false,{detail:active.join(' / ')});"
engine = replace_once(engine, old_start, new_start, 'v5 battle start build activation')

old_rage_tail = "if(useRage){trigger(a,b,'on_rage_skill');if(a===p&&rageTier>=2)changeRage(a,15);}trigger(a,b,'after_action');trigger(a,b,'hp_threshold');const notes:string[]=[];if(ability.cooldown)notes.push(`进入 ${ability.cooldown} 回合冷却`);if(a===p&&useRage&&rageTier>=2)notes.push('怒潮回气 +15');frame(a,useRage?'rage':'action',ability.name,0,false,{sourceId:ability.id,detail:notes.join('；')||undefined});"
new_rage_tail = "if(useRage){trigger(a,b,'on_rage_skill');if(a===p&&rageTier>=2)changeRage(a,18);if(a===p&&b.hp>0){const rb=bridgeTier('rage_burn');if(rb>0){const add=rb>=2?2:1;b.status.burn=clamp((b.status.burn??0)+add,0,20);frame(undefined,'build','雷火轮转',0,false,{detail:`怒气技引燃 +${add}`});if((b.status.burn??0)>=6){const burst=(b.status.burn??0)*(rb>=2?3:2);hurt(p,b,burst,'雷火劫伤',false,{base:burst,scaled:burst,afterDefense:burst,afterVulnerable:burst,afterBuild:burst,afterCrit:burst,absorbed:0,hpLoss:0},'build.bridge.rage_burn');}}const rbreak=bridgeTier('rage_break');if(rbreak>0&&(b.status.break??0)>0)changeRage(a,rbreak>=2?15:8);if(finisher.active&&!finisherUsed&&finisher.id==='rage'&&b.hp>0){finisherUsed=true;const burst=Math.max(1,Math.floor(stat(p,'attack')*90/100));hurt(p,b,burst,'九转雷劫',false,{base:burst,scaled:burst,afterDefense:burst,afterVulnerable:burst,afterBuild:burst,afterCrit:burst,absorbed:0,hpLoss:0},'build.finisher.rage');frame(undefined,'build','终局法相 · 九转雷劫',0,false,{detail:`怒气技引动雷劫追击 ${burst}`});}}}trigger(a,b,'after_action');trigger(a,b,'hp_threshold');const notes:string[]=[];if(ability.cooldown)notes.push(`进入 ${ability.cooldown} 回合冷却`);if(a===p&&useRage&&rageTier>=2)notes.push('怒潮回气 +18');if(a===p&&useRage&&bridgeTier('rage_break')>0&&(b.status.break??0)>0)notes.push(`裂阵回潮 +${bridgeTier('rage_break')>=2?15:8} 怒气`);frame(a,useRage?'rage':'action',ability.name,0,false,{sourceId:ability.id,detail:notes.join('；')||undefined});"
engine = replace_once(engine, old_rage_tail, new_rage_tail, 'v5 rage bridges and finisher')

old_roll = " rollAbilities(n:number,streamName:string,slot?:Slot):string[]{const s=this.s,affinity=this.c.origins.find(o=>o.id===s.origin)!.affinity,build=this.build();let pool=this.c.abilities.filter(a=>a.rarity!=='mythic'&&(!slot||a.slot===slot)&&!s.slots.some(eq=>eq?.id===a.id&&eq.rank===3));const out:string[]=[];while(pool.length&&out.length<n){const a=weighted(s,streamName,pool,x=>1+(x.tags.includes(affinity)?2:0)+x.tags.reduce((n,t)=>n+Math.min(2,build.tags[t]??0),0));out.push(a.id);pool=pool.filter(x=>x.id!==a.id);}return out;}"
new_roll = " rollAbilities(n:number,streamName:string,slot?:Slot):string[]{const s=this.s,affinity=this.c.origins.find(o=>o.id===s.origin)!.affinity,build=this.build(),schoolTags:Record<string,string[]>={rage:['rage','burst'],burn:['fire','burn'],guard:['shield','counter'],break:['break','sword']},coreTags=schoolTags[build.core]??[],bridgeTarget=build.bridge.counts[0]<=build.bridge.counts[1]?build.bridge.schools[0]:build.bridge.schools[1],targetTags=schoolTags[bridgeTarget]??[];let pool=this.c.abilities.filter(a=>a.rarity!=='mythic'&&(!slot||a.slot===slot)&&!s.slots.some(eq=>eq?.id===a.id&&eq.rank===3));const out:string[]=[];while(pool.length&&out.length<n){const a=weighted(s,streamName,pool,x=>1+(x.tags.includes(affinity)?1:0)+x.tags.reduce((n,t)=>n+Math.min(2,build.tags[t]??0),0)+(x.tags.some(t=>coreTags.includes(t))?1:0)+(build.bridge.tier<2&&x.tags.some(t=>targetTags.includes(t))?2:0));out.push(a.id);pool=pool.filter(x=>x.id!==a.id);}return out;}"
engine = replace_once(engine, old_roll, new_roll, 'v5 build-directed reward weighting')
engine_path.write_text(engine, encoding='utf-8')

app = app_path.read_text(encoding='utf-8')
new_resonance_method = r'''  buildResonances(compact=false){const b=this.game!.build(),tier=(n:number)=>n===2?'二重':n===1?'一重':'未激活',core=b.core==='none'?undefined:b.resonances.find(r=>r.id===b.core),left=b.resonances.find(r=>r.id===b.bridge.schools[0])!,right=b.resonances.find(r=>r.id===b.bridge.schools[1])!,slotCount=this.game!.s.slots.filter(Boolean).length,missing=[core?.tier===2?'':`${core?.name??'主轴'}需二重`,b.strategy.tier===2?'':'战策需二重',slotCount===8?'':'八槽需全满'].filter(Boolean),advice=b.finisher.active?'终局法相已成。后续升阶会直接放大现有循环。':b.bridge.tier===0?`优先补齐 ${left.count<=right.count?left.name:right.name}，可开启双系桥接「${b.bridge.name}」。`:b.bridge.tier===1?`让 ${left.name} 与 ${right.name} 同达二重，可强化「${b.bridge.name}」。`:`终局法相尚缺：${missing.join(' / ')}`;return `<div class="resonance-panel v5 ${compact?'compact':''}"><div class="resonance-title"><span>命盘构筑</span><b>BUILD ${b.score}</b></div><div class="build-core-strip"><div class="build-core-card"><span>主轴</span><strong>${esc(core?.name??'尚未成形')}</strong><em>${core?tier(core.tier)+' · '+core.count+'/4':'等待能力入槽'}</em></div><div class="build-bridge-card tier-${b.bridge.tier}"><span>双系桥接</span><strong>${esc(b.bridge.name)}</strong><em>${left.count}/4 × ${right.count}/4 · ${tier(b.bridge.tier)}</em><p>${esc(b.bridge.description)}</p></div><div class="build-finisher-card ${b.finisher.active?'active':''}"><span>终局法相</span><strong>${esc(b.finisher.name)}</strong><em>${b.finisher.active?'已显化':b.finisher.progress+' / 3 条件'}</em><p>${esc(b.finisher.description)}</p></div></div><div class="finisher-seals"><i class="${core?.tier===2?'on':''}">主轴二重</i><i class="${b.strategy.tier===2?'on':''}">战策二重</i><i class="${slotCount===8?'on':''}">八槽全满</i></div><div class="build-advice"><span>下一步</span><p>${esc(advice)}</p></div><div class="resonance-grid">${b.resonances.map(r=>`<div class="resonance-row ${r.tier?'active':''} tier-${r.tier} ${b.core===r.id?'core':''}"><div><strong>${esc(r.name)}</strong><span>${tier(r.tier)} · ${r.count}/4${b.core===r.id?' · 主轴':''}</span></div><p>${esc(r.description)}</p><div class="resonance-track"><i style="width:${Math.min(100,r.count/4*100)}%"></i></div></div>`).join('')}</div><div class="strategy-link ${b.strategy.tier?'active':''}"><div><span>战策统摄</span><strong>${esc(b.strategy.name)}</strong></div><b>${b.strategy.count}/5${b.strategy.bonusPercent?' · +'+b.strategy.bonusPercent+'%':''}</b><p>${esc(b.strategy.description)}</p></div></div>`;}
'''
app = replace_method(app, 'buildResonances', 'buildPanel', new_resonance_method)
new_build_panel = r'''  buildPanel(){const s=this.game!.s,b=this.game!.build();return `<aside class="sidebar right-sidebar"><div class="side-section-title">八槽命盘<span>${s.slots.filter(Boolean).length} / 8 已装配</span></div><div class="mini-build">${s.slots.map((eq,i)=>this.mini(eq,i)).join('')}</div><div class="build-tags">${b.dominant.map(k=>`<span>${TAGS[k]??esc(k)}  ${b.tags[k]}</span>`).join('')}</div>${this.buildResonances()}<p class="small muted" style="margin-top:15px;font-size:10px;line-height:1.9">V5 构筑分为主轴、双系桥接、终局法相三层。奖励会轻度补齐当前桥接，但仍保留转型空间。</p></aside>`;}
'''
app = replace_method(app, 'buildPanel', 'heading', new_build_panel)
app_path.write_text(app, encoding='utf-8')

css = css_path.read_text(encoding='utf-8')
css += r'''

/* Gameplay v5: core school -> bridge -> finisher */
.build-core-strip{display:grid;grid-template-columns:1fr;gap:6px;margin-bottom:7px}.build-core-card,.build-bridge-card,.build-finisher-card{position:relative;padding:8px;border:1px solid #76887935;background:#101c19;overflow:hidden}.build-core-card:before,.build-finisher-card:before{content:'';position:absolute;inset:0 auto 0 0;width:2px;background:#7b957c}.build-core-card span,.build-bridge-card span,.build-finisher-card span{display:block;font-size:7px;letter-spacing:1.4px;color:#73867b;text-transform:uppercase}.build-core-card strong,.build-bridge-card strong,.build-finisher-card strong{display:block;margin-top:2px;font:12px var(--serif);color:#d7d1b8}.build-core-card em,.build-bridge-card em,.build-finisher-card em{display:block;margin-top:2px;font:8px ui-monospace,monospace;font-style:normal;color:#9aa590}.build-bridge-card{border-style:dashed}.build-bridge-card.tier-1{border-style:solid;border-color:#829e7555;background:linear-gradient(120deg,#20332455,#101c19)}.build-bridge-card.tier-2{border-style:solid;border-color:#c5a55d66;background:linear-gradient(120deg,#42351f68,#101c19)}.build-bridge-card p,.build-finisher-card p{font-size:8px;line-height:1.55;color:#798b80;margin-top:4px}.build-finisher-card.active{border-color:#d1b45f77;background:radial-gradient(circle at 100% 0,#7d5d2038,transparent 45%),#151b17}.build-finisher-card.active:before{background:#d1b45f;box-shadow:0 0 12px #d1b459}.build-finisher-card.active strong{color:#ead07a;text-shadow:0 0 10px #c49b423b}.finisher-seals{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin:6px 0}.finisher-seals i{padding:5px 3px;border:1px solid #6e7c7027;text-align:center;font:7px var(--sans);font-style:normal;letter-spacing:.5px;color:#65766c;background:#0b1513}.finisher-seals i.on{color:#d4bd79;border-color:#a68d4f55;background:#3027194a}.build-advice{display:flex;gap:7px;align-items:flex-start;margin:7px 0 9px;padding:7px;border-left:2px solid #738f7a;background:#12211c}.build-advice span{flex:0 0 auto;font-size:7px;letter-spacing:1px;color:#94ae9b}.build-advice p{margin:0;font-size:8px;line-height:1.6;color:#809389}.resonance-row.core{box-shadow:inset 0 0 0 1px #c2a65c2f}.resonance-row.core strong:after{content:' CORE';margin-left:5px;font:6px ui-monospace,monospace;color:#d1b46a;letter-spacing:1px}.resonance-panel.v5.compact .build-core-strip{grid-template-columns:repeat(3,minmax(0,1fr))}.resonance-panel.v5.compact .build-core-card,.resonance-panel.v5.compact .build-bridge-card,.resonance-panel.v5.compact .build-finisher-card{min-height:92px}.resonance-panel.v5.compact .finisher-seals{max-width:520px;margin:8px auto}.resonance-panel.v5.compact .build-advice{max-width:720px;margin:8px auto 12px}
@media(max-width:760px){.resonance-panel.v5.compact .build-core-strip{grid-template-columns:1fr}.resonance-panel.v5.compact .build-core-card,.resonance-panel.v5.compact .build-bridge-card,.resonance-panel.v5.compact .build-finisher-card{min-height:0}.finisher-seals{gap:2px}.finisher-seals i{padding:4px 2px;font-size:6px}.build-advice{gap:5px;padding:6px}}
'''
css_path.write_text(css, encoding='utf-8')

gen = gen_path.read_text(encoding='utf-8')
gen = replace_once(gen, "C['version']='2.1.0'", "C['version']='2.2.0'", 'v5 content version')
gen = replace_once(gen, "C['rulesVersion']='2.1.0'", "C['rulesVersion']='2.2.0'", 'v5 rules version')
gen_path.write_text(gen, encoding='utf-8')

tests = test_path.read_text(encoding='utf-8')
tests = replace_once(tests, "assert.equal(c.version,'2.1.0');assert.equal(c.rulesVersion,'2.1.0');", "assert.equal(c.version,'2.2.0');assert.equal(c.rulesVersion,'2.2.0');", 'v5 rules test version')
tests += r'''

test('v5 full aligned rage board unlocks a late-run finisher',()=>{const g=fresh('BUILD-V5-FINISHER'),extra=c.abilities.find(a=>a.slot==='artifact'&&!['art.feather','art.flag'].includes(a.id));assert(extra);g.s.slots=[{id:'basic.thunder',rank:0},{id:'rage.thunder',rank:0},{id:'aux.qi',rank:0},{id:'aux.river',rank:0},{id:'art.feather',rank:0},{id:'art.flag',rank:0},{id:extra.id,rank:0},{id:'strategy.rage',rank:0}];const b=buildProfile(c,g.s);assert.equal(b.core,'rage');assert.equal(b.finisher.progress,3);assert.equal(b.finisher.active,true);assert.equal(b.finisher.name,'九转雷劫');});
test('v5 bridge selection is deterministic and exposes cross-school progress',()=>{const g=fresh('BUILD-V5-BRIDGE'),cc=structuredClone(c);g.s.slots=[{id:'basic.thunder',rank:0},{id:'rage.thunder',rank:0},{id:'aux.qi',rank:0},{id:'aux.river',rank:0},{id:'art.feather',rank:0},{id:'art.flag',rank:0},null,{id:'strategy.rage',rank:0}];for(const id of ['basic.thunder','rage.thunder','aux.qi','aux.river']){const a=cc.abilities.find(x=>x.id===id);a.tags=[...new Set([...a.tags,'fire','burn'])];}const a=buildProfile(cc,g.s),b=buildProfile(cc,structuredClone(g.s));assert.deepEqual(a,b);assert.equal(a.bridge.id,'rage_burn');assert.equal(a.bridge.tier,2);});
test('v5 rage bridge and finisher emit deterministic typed combat frames',()=>{const setup=()=>{const cc=structuredClone(c),g=fresh('BUILD-V5-COMBAT'),extra=cc.abilities.find(a=>a.slot==='artifact'&&!['art.feather','art.flag'].includes(a.id));g.s.slots=[{id:'basic.thunder',rank:0},{id:'rage.thunder',rank:0},{id:'aux.qi',rank:0},{id:'aux.river',rank:0},{id:'art.feather',rank:0},{id:'art.flag',rank:0},{id:extra.id,rank:0},{id:'strategy.rage',rank:0}];for(const id of ['basic.thunder','rage.thunder','aux.qi','aux.river']){const a=cc.abilities.find(x=>x.id===id);a.tags=[...new Set([...a.tags,'fire','burn'])];}const enemy=structuredClone(cc.enemies[0]);enemy.stats.hp=999;enemy.stats.attack=1;enemy.stats.defense=0;return {cc,g,enemy};};const x=setup(),y=setup(),a=simulateBattle(x.cc,x.g.s,x.enemy),b=simulateBattle(y.cc,y.g.s,y.enemy);assert.deepEqual(a,b);assert(a.frames.some(f=>f.label==='雷火轮转'));assert(a.frames.some(f=>f.label==='九转雷劫'));});
test('v5 content and deterministic rules advance together',()=>{assert.equal(c.version,'2.2.0');assert.equal(c.rulesVersion,'2.2.0');});
'''
test_path.write_text(tests, encoding='utf-8')

doc_path.write_text(r'''# Gameplay V5 — build bridges and finishers

V5 turns the V4 resonance layer into a three-step build arc.

## 1. Core school

The strongest equipped resonance becomes the run's current core school. This is derived from the eight-slot board and is never stored in save data.

## 2. Cross-school bridge

Exactly one deterministic bridge is surfaced at a time. The closest/strongest pair wins the tie-break so the player always has a readable next target instead of several simultaneous hidden bonuses.

- Rage + Burn: **雷火轮转** — rage skills add Burn and can trigger extra fire damage.
- Rage + Break: **狂澜裂阵** — rage skills recycle rage against broken enemies; tier 2 also raises rage-skill damage.
- Burn + Guard: **炉心金身** — enemy Burn ticks forge Shield.
- Guard + Break: **铁壁摧锋** — the first shielded hit each round applies Break back to the attacker.

Each bridge has tier 1 when both schools are at least tier 1 and tier 2 when both are tier 2.

## 3. Finisher / 终局法相

A finisher unlocks only when all three conditions are true:

1. the core school is tier 2;
2. Strategy Alignment is tier 2;
3. all eight slots are filled.

Only the core school's finisher is active, so a complete build gains a clear identity instead of stacking every capstone.

- Rage: **九转雷劫** — first rage skill creates an attack-scaled follow-up strike.
- Burn: **焚天劫火** — at 8 Burn, detonate and consume 3 stacks.
- Guard: **玄武返照** — first shield break retaliates and reforges shield.
- Break: **万剑决阵** — at 6 Break, add Vulnerable and a pure follow-up strike.

## Reward direction

Ability rolls now consider origin affinity, current tags, the core school, and the weaker side of the surfaced bridge. The extra bridge weighting is deliberately mild so the system helps completion without removing pivot choices.

## Balance changes

V4's Guard resonance produced the strongest automated results, so its opening shield is reduced from 80% to 60% Defense and its shielded damage bonus from 15% to 10%. Rage tier 2 refund rises from 15 to 18. The new bridge/finisher mechanics add ceiling mainly to Rage, Burn, and Break rather than multiplying Guard's existing floor.

Because combat rules change, content/rules version advances to 2.2.0.
''', encoding='utf-8')

print('Gameplay V5 patch applied')
