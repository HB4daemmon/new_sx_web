from pathlib import Path
import re
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
engine_path = root / 'src/engine.ts'
app_path = root / 'src/app.ts'
css_path = root / 'src/style.css'
gen_path = root / 'scripts/create-content.py'
test_path = root / 'tests/engine.test.mjs'
doc_path = root / 'docs/GAMEPLAY_V6.md'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if text.count(old) != 1:
        raise RuntimeError(f'{label}: expected one match, got {text.count(old)}')
    return text.replace(old, new, 1)


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

profile_marker = "export interface BuildProfile {tags:Record<string,number>;resonances:BuildResonance[];dominant:string[];core:BuildResonance['id']|'none';bridge:BuildBridge;finisher:BuildFinisher;strategy:{name:string;count:number;tier:0|1|2;bonusPercent:number;description:string};score:number;}"
role_interfaces = "export type AbilityBuildRole='starter'|'core'|'amplifier'|'bridge'|'finisher';\nexport interface AbilityRoleInfo {role:AbilityBuildRole;label:string;reason:string;school:BuildResonance['id']|'none';fit:number;}\n"
engine = replace_once(engine, profile_marker, role_interfaces + profile_marker, 'v6 role interfaces')

fighter_marker = 'function fighter'
insert_at = engine.index(fighter_marker)
role_code = r'''const BUILD_SCHOOL_TAGS:Record<BuildResonance['id'],string[]>={rage:['rage','burst'],burn:['fire','burn'],guard:['shield','counter'],break:['break','sword']};
const BUILD_ROLE_LABELS:Record<AbilityBuildRole,string>={starter:'启动件',core:'核心件',amplifier:'放大件',bridge:'桥接件',finisher:'终局件'};

/** Contextual role of an ability inside the current board. The same ability may change role after the board pivots. */
export function abilityRole(c:Content,s:RunState,a:Ability):AbilityRoleInfo {
 const b=buildProfile(c,s),schoolScores=(Object.keys(BUILD_SCHOOL_TAGS) as BuildResonance['id'][]).map(id=>({id,n:a.tags.filter(t=>BUILD_SCHOOL_TAGS[id].includes(t)).length})).sort((x,y)=>y.n-x.n||x.id.localeCompare(y.id)),school=schoolScores[0]?.n?schoolScores[0].id:'none';
 const coreTags=b.core==='none'?[]:BUILD_SCHOOL_TAGS[b.core],coreMatch=a.tags.some(t=>coreTags.includes(t)),weakIndex=b.bridge.counts[0]<=b.bridge.counts[1]?0:1,weakSchool=b.bridge.schools[weakIndex],weakTags=BUILD_SCHOOL_TAGS[weakSchool],weakMatch=a.tags.some(t=>weakTags.includes(t)),slotHasRoom=SLOT_ORDER.some((slot,i)=>slot===a.slot&&!s.slots[i]),coreRes=b.core==='none'?undefined:b.resonances.find(x=>x.id===b.core),wouldCompleteCore=!!coreRes&&coreRes.count===3&&coreMatch;
 const triggerOns=new Set((a.triggers??[]).map(t=>t.on)),effectTypes=new Set((a.effects??[]).map(e=>e.type));let role:AbilityBuildRole,reason:string;
 if(a.slot==='strategy'||(b.finisher.progress>=2&&slotHasRoom&&coreMatch)||(wouldCompleteCore&&b.strategy.tier>=1)){role='finisher';reason=a.slot==='strategy'?'战策决定八槽的统摄方向，是终局法相的关键条件。':'这项能力能直接推进主轴或八槽终局条件。';}
 else if(b.bridge.tier<2&&weakMatch&&(weakSchool!==b.core||!coreMatch)){role='bridge';reason=`补强 ${weakSchool==='rage'?'怒潮':weakSchool==='burn'?'焚劫':weakSchool==='guard'?'玄甲':'破阵'} 一侧，推进「${b.bridge.name}」。`;}
 else if(a.slot==='basic'||triggerOns.has('battle_start')){role='starter';reason='负责稳定起手和基础循环，让构筑每场战斗都能可靠启动。';}
 else if(a.slot==='artifact'||(a.triggers??[]).length>0||effectTypes.has('modify_stat')){role='amplifier';reason=coreMatch?'放大当前主轴已有的资源、状态或触发收益。':'提供被动放大与容错，适合补足现有循环。';}
 else {role='core';reason=coreMatch?'直接服务当前主轴，是主要输出或资源循环的一部分。':'可作为新的构筑核心，适合主动转型。';}
 const fit=(coreMatch?3:0)+(weakMatch&&b.bridge.tier<2?2:0)+(role==='finisher'?3:role==='bridge'?2:role==='core'?2:role==='amplifier'?1:0)+(a.tags.reduce((n,t)=>n+Math.min(2,b.tags[t]??0),0));
 return {role,label:BUILD_ROLE_LABELS[role],reason,school,fit};
}

'''
engine = engine[:insert_at] + role_code + engine[insert_at:]

engine = replace_once(
    engine,
    " build():BuildProfile{return buildProfile(this.c,this.s);}\n",
    " build():BuildProfile{return buildProfile(this.c,this.s);}\n role(id:string):AbilityRoleInfo{return abilityRole(this.c,this.s,this.ability(id));}\n",
    'v6 Game.role method',
)

old_roll = " rollAbilities(n:number,streamName:string,slot?:Slot):string[]{const s=this.s,affinity=this.c.origins.find(o=>o.id===s.origin)!.affinity,build=this.build(),schoolTags:Record<string,string[]>={rage:['rage','burst'],burn:['fire','burn'],guard:['shield','counter'],break:['break','sword']},coreTags=schoolTags[build.core]??[],bridgeTarget=build.bridge.counts[0]<=build.bridge.counts[1]?build.bridge.schools[0]:build.bridge.schools[1],targetTags=schoolTags[bridgeTarget]??[];let pool=this.c.abilities.filter(a=>a.rarity!=='mythic'&&(!slot||a.slot===slot)&&!s.slots.some(eq=>eq?.id===a.id&&eq.rank===3));const out:string[]=[];while(pool.length&&out.length<n){const a=weighted(s,streamName,pool,x=>1+(x.tags.includes(affinity)?1:0)+x.tags.reduce((n,t)=>n+Math.min(2,build.tags[t]??0),0)+(x.tags.some(t=>coreTags.includes(t))?1:0)+(build.bridge.tier<2&&x.tags.some(t=>targetTags.includes(t))?2:0));out.push(a.id);pool=pool.filter(x=>x.id!==a.id);}return out;}"
new_roll = r''' rollAbilities(n:number,streamName:string,slot?:Slot):string[]{
  const s=this.s,affinity=this.c.origins.find(o=>o.id===s.origin)!.affinity,build=this.build(),coreTags=build.core==='none'?[]:BUILD_SCHOOL_TAGS[build.core],weakSchool=build.bridge.counts[0]<=build.bridge.counts[1]?build.bridge.schools[0]:build.bridge.schools[1],weakTags=BUILD_SCHOOL_TAGS[weakSchool];let pool=this.c.abilities.filter(a=>a.rarity!=='mythic'&&(!slot||a.slot===slot)&&!s.slots.some(eq=>eq?.id===a.id&&eq.rank===3)),out:string[]=[];
  const common=(a:Ability)=>1+(a.tags.includes(affinity)?1:0)+a.tags.reduce((sum,t)=>sum+Math.min(2,build.tags[t]??0),0)+this.role(a.id).fit;
  const choose=(lane:'core'|'bridge'|'pivot',index:number)=>{let candidates=pool;if(lane==='core'){const focused=pool.filter(a=>{const r=this.role(a.id);return r.role==='core'||r.role==='amplifier'||r.role==='finisher'||a.tags.some(t=>coreTags.includes(t));});if(focused.length)candidates=focused;}else if(lane==='bridge'){const focused=pool.filter(a=>this.role(a.id).role==='bridge'||a.tags.some(t=>weakTags.includes(t)));if(focused.length)candidates=focused;}else{const focused=pool.filter(a=>!s.slots.some(eq=>eq?.id===a.id)&&(!a.tags.some(t=>coreTags.includes(t))||this.role(a.id).role==='starter'));if(focused.length)candidates=focused;}const picked=weighted(s,`${streamName}.${lane}.${index}`,candidates,a=>{const r=this.role(a.id),coreHit=a.tags.some(t=>coreTags.includes(t)),weakHit=a.tags.some(t=>weakTags.includes(t)),novel=a.tags.filter(t=>!(build.tags[t]??0)).length;if(lane==='core')return common(a)+(coreHit?5:0)+(r.role==='core'?4:r.role==='amplifier'?3:r.role==='finisher'?2:0);if(lane==='bridge')return common(a)+(weakHit?6:0)+(r.role==='bridge'?6:0);return 2+novel*3+(r.role==='starter'?2:0)+(a.rarity==='rare'?1:0);});out.push(picked.id);pool=pool.filter(x=>x.id!==picked.id);};
  if(n>=3&&!slot){choose('core',0);if(pool.length)choose('bridge',1);if(pool.length)choose('pivot',2);while(pool.length&&out.length<n)choose(out.length%2?'bridge':'core',out.length);}else while(pool.length&&out.length<n){const picked=weighted(s,`${streamName}.fit.${out.length}`,pool,a=>common(a)+(a.tags.some(t=>coreTags.includes(t))?2:0)+(build.bridge.tier<2&&a.tags.some(t=>weakTags.includes(t))?2:0));out.push(picked.id);pool=pool.filter(x=>x.id!==picked.id);}return out;
 }'''
engine = replace_once(engine, old_roll, new_roll, 'v6 structured ability draft')
engine_path.write_text(engine, encoding='utf-8')

app = app_path.read_text(encoding='utf-8')

new_build = r'''  buildResonances(compact=false){const b=this.game!.build(),s=this.game!.s,tier=(n:number)=>n===2?'二重':n===1?'一重':'未激活',core=b.core==='none'?undefined:b.resonances.find(r=>r.id===b.core),left=b.resonances.find(r=>r.id===b.bridge.schools[0])!,right=b.resonances.find(r=>r.id===b.bridge.schools[1])!,slotCount=s.slots.filter(Boolean).length,roles=s.slots.map(eq=>eq?{eq,a:this.game!.ability(eq.id),role:this.game!.role(eq.id)}:null).filter(Boolean) as {eq:Equipped;a:Ability;role:any}[],roleCounts=roles.reduce((m,x)=>(m[x.role.role]=(m[x.role.role]??0)+1,m),{} as Record<string,number>),steps=[{id:'starter',label:'启动',on:!!s.slots[0],text:'基础循环'},{id:'core',label:'成轴',on:(core?.tier??0)>=1,text:'主轴一重'},{id:'amplifier',label:'放大',on:(roleCounts.amplifier??0)>0||b.strategy.tier>=1,text:'被动/战策'},{id:'bridge',label:'桥接',on:b.bridge.tier>=1,text:'双系一重'},{id:'finisher',label:'终局',on:b.finisher.active,text:'法相显化'}],firstMissing=steps.find(x=>!x.on),missing=[core?.tier===2?'':`${core?.name??'主轴'}需二重`,b.strategy.tier===2?'':'战策需二重',slotCount===8?'':'八槽需全满'].filter(Boolean),advice=b.finisher.active?'循环已经闭合。后续优先升阶核心件与放大件，而不是继续扩标签。':firstMissing?.id==='core'?`先让 ${core?.name??'当前主轴'} 达到一重，建立稳定循环。`:firstMissing?.id==='amplifier'?'当前能启动但放大不足，优先寻找法宝、触发型辅法或同源战策。':firstMissing?.id==='bridge'?`主轴已成，补齐 ${left.count<=right.count?left.name:right.name} 可开启「${b.bridge.name}」。`:firstMissing?.id==='finisher'?`桥接已成，终局尚缺：${missing.join(' / ')}`:'保持当前主轴并用升阶提高效率。';return `<div class="resonance-panel v6 ${compact?'compact':''}"><div class="resonance-title"><span>命盘构筑</span><b>BUILD ${b.score}</b></div><div class="build-stage-path">${steps.map((x,i)=>`<div class="build-stage ${x.on?'on':''} ${firstMissing?.id===x.id?'next':''}"><i>${String(i+1).padStart(2,'0')}</i><strong>${x.label}</strong><span>${x.text}</span></div>`).join('')}</div><div class="build-core-strip"><div class="build-core-card"><span>主轴</span><strong>${esc(core?.name??'尚未成形')}</strong><em>${core?tier(core.tier)+' · '+core.count+'/4':'等待能力入槽'}</em></div><div class="build-bridge-card tier-${b.bridge.tier}"><span>双系桥接</span><strong>${esc(b.bridge.name)}</strong><em>${left.count}/4 × ${right.count}/4 · ${tier(b.bridge.tier)}</em><p>${esc(b.bridge.description)}</p></div><div class="build-finisher-card ${b.finisher.active?'active':''}"><span>终局法相</span><strong>${esc(b.finisher.name)}</strong><em>${b.finisher.active?'已显化':b.finisher.progress+' / 3 条件'}</em><p>${esc(b.finisher.description)}</p></div></div><div class="role-roster">${roles.map(x=>`<button data-action="inspect" data-id="${x.a.id}" class="role-chip role-${x.role.role}" title="${esc(x.role.reason)}"><span>${x.role.label}</span><strong>${esc(x.a.name)}</strong></button>`).join('')}</div><div class="build-advice"><span>当前缺口</span><p>${esc(advice)}</p></div><div class="resonance-grid">${b.resonances.map(r=>`<div class="resonance-row ${r.tier?'active':''} tier-${r.tier} ${b.core===r.id?'core':''}"><div><strong>${esc(r.name)}</strong><span>${tier(r.tier)} · ${r.count}/4${b.core===r.id?' · 主轴':''}</span></div><p>${esc(r.description)}</p><div class="resonance-track"><i style="width:${Math.min(100,r.count/4*100)}%"></i></div></div>`).join('')}</div><div class="strategy-link ${b.strategy.tier?'active':''}"><div><span>战策统摄</span><strong>${esc(b.strategy.name)}</strong></div><b>${b.strategy.count}/5${b.strategy.bonusPercent?' · +'+b.strategy.bonusPercent+'%':''}</b><p>${esc(b.strategy.description)}</p></div></div>`;}'''
app = replace_method(app, 'buildResonances', 'buildPanel', new_build)

new_card = r'''  card(id:string,rank=0,action='inspect',attrs='',foot=''){const a=this.content.abilities.find(x=>x.id===id)!,role=this.game?.role(id),coefficient=a.effects.find(e=>e.type==='damage')?.coefficient,text=a.description.replace('{0}',String(value(coefficient,rank)));return `<button class="ability-card ${tone(a)} slot-${a.slot} rarity-${a.rarity}" data-action="${action}" data-id="${a.id}" ${attrs}><div class="card-top"><span class="slot-pill slot-${a.slot}"><i>${SLOT_SIGNS[a.slot]}</i>${esc(this.content.labels.slots[a.slot])}</span>${role?`<span class="build-role role-${role.role}" title="${esc(role.reason)}">${role.label}</span>`:''}<span class="rarity-label rarity-${a.rarity}">${RARITY_LABELS[a.rarity]??a.rarity}</span><span class="card-rank">R${rank}</span></div>${sigil(a.art,a.rarity==='mythic'?'mythic':a.tags.includes('burn')?'fire':a.tags.includes('shield')?'shield':'jade')}<h3 class="card-title rarity-title rarity-${a.rarity}">${esc(a.name)}</h3><p class="card-description">${esc(text)}</p>${role?`<div class="card-role-note role-${role.role}"><b>${role.label}</b><span>${esc(role.reason)}</span></div>`:''}<div class="card-foot"><span>${a.tags.slice(0,2).map(t=>TAGS[t]??esc(t)).join(' / ')}</span><span class="gain">${foot||'RANK '+rank+' '+icon('diamond',13)}</span></div></button>`;}'''
app = replace_method(app, 'card', 'rewards', new_card)

new_rewards = r'''  rewards(){const s=this.game!.s,lanes=[{name:'同轴精进',sub:'强化主轴',cls:'core'},{name:'旁门合流',sub:'补全桥接',cls:'bridge'},{name:'异变机缘',sub:'保留转型',cls:'pivot'}];return `<section class="reward-page">${this.heading('机缘已至','取一项，让命盘朝一个更明确的方向生长。','VICTORY / REWARD')}<div class="reward-tally"><span>${icon('coin',18)}+ ${s.rewardInfo?.gold} 灵石</span><span>${icon('lotus',18)}+ ${s.rewardInfo?.xp} 修为</span></div><div class="reward-cards directed-draft">${s.reward.map((id,i)=>{const eq=s.slots.find(x=>x?.id===id),lane=lanes[i]??lanes[0],role=this.game!.role(id);return `<div class="draft-lane lane-${lane.cls}"><div class="draft-lane-head"><span>${lane.name}</span><strong>${lane.sub}</strong><em>${role.label}</em></div>${this.card(id,eq?eq.rank+1:0,'reward',`data-index="${i}"`,eq?'同名升阶':'收入命盘')}</div>`;}).join('')}</div><p class="center">三选一 · 第一项偏主轴，第二项偏桥接，第三项保留转型空间 · 当前生命 ${s.hp}</p><div class="actions">${btn('skipReward','放下机缘，继续前行 '+icon('arrow',17),'quiet')}</div></section>`;}'''
app = replace_method(app, 'rewards', 'event', new_rewards)

app = replace_once(app, 'V5 构筑分为主轴、双系桥接、终局法相三层。奖励会轻度补齐当前桥接，但仍保留转型空间。', 'V6 构筑增加能力角色与定向三选一。先让循环成立，再决定强化主轴、补桥接或主动转型。', 'v6 build panel copy')
app_path.write_text(app, encoding='utf-8')

css = css_path.read_text(encoding='utf-8')
css += r'''

/* Gameplay v6: role grammar + directed draft */
.build-stage-path{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin:8px 0 10px}.build-stage{position:relative;min-width:0;padding:7px 5px;border:1px solid #6c796c2c;background:#0d1714;opacity:.48}.build-stage.on{opacity:1;border-color:#75977b4d;background:#102219}.build-stage.next{opacity:1;border-color:#c7a85d73;box-shadow:inset 0 0 16px #a07d2530}.build-stage i{display:block;font:7px ui-monospace,monospace;color:#66766d}.build-stage strong{display:block;margin-top:2px;font:10px var(--serif);color:#d2ccb0}.build-stage span{display:block;margin-top:2px;font-size:7px;color:#768980;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.role-roster{display:flex;gap:4px;overflow-x:auto;padding:3px 0 8px;scrollbar-width:thin}.role-chip{flex:0 0 auto;display:flex;align-items:center;gap:5px;padding:5px 7px;border:1px solid #70807535;background:#0d1714;color:#aab8ad}.role-chip span,.build-role{font-size:7px;font-weight:800;letter-spacing:.7px}.role-chip strong{font:9px var(--serif);font-weight:600}.role-starter{--role:#77a9a2}.role-core{--role:#d2b261}.role-amplifier{--role:#8e9dca}.role-bridge{--role:#bd846e}.role-finisher{--role:#d9c67d}.role-chip[class*="role-"],.build-role[class*="role-"],.card-role-note[class*="role-"]{border-color:color-mix(in srgb,var(--role) 55%,transparent)!important}.role-chip span,.build-role{color:var(--role)}.build-role{display:inline-flex;padding:2px 5px;border:1px solid;background:#0e1715;white-space:nowrap}.card-role-note{margin:-2px 14px 10px;padding:6px 7px;border-left:2px solid var(--role);background:#0b1513aa;text-align:left}.card-role-note b{display:block;font-size:8px;color:var(--role);letter-spacing:1px}.card-role-note span{display:block;margin-top:2px;color:#73877d;font-size:7px;line-height:1.45}.directed-draft{align-items:stretch}.draft-lane{display:flex;flex-direction:column;min-width:0}.draft-lane .ability-card{width:100%;height:100%}.draft-lane-head{display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:end;margin-bottom:7px;padding:6px 8px;border-top:2px solid #7a88774a;border-bottom:1px solid #74807026;background:#0d1714}.draft-lane-head span{font:11px var(--serif);color:#d9d2b5}.draft-lane-head strong{font-size:8px;color:#87988d}.draft-lane-head em{grid-column:1/-1;font-size:7px;font-style:normal;color:#687c71}.lane-core .draft-lane-head{border-top-color:#c3a557}.lane-bridge .draft-lane-head{border-top-color:#b77c67}.lane-pivot .draft-lane-head{border-top-color:#779b95}.resonance-panel.v6 .build-advice span{min-width:48px}
@media(max-width:760px){.build-stage-path{gap:2px}.build-stage{padding:5px 2px}.build-stage strong{font-size:8px}.build-stage span{font-size:6px}.role-roster{margin-right:-4px}.card-role-note{margin-left:8px;margin-right:8px}.draft-lane-head{margin-top:8px}.directed-draft{display:block}.draft-lane{margin-bottom:12px}}
'''
css_path.write_text(css, encoding='utf-8')

gen = gen_path.read_text(encoding='utf-8')
gen = replace_once(gen, "C['version']='2.2.0'", "C['version']='2.3.0'", 'v6 content version')
gen = replace_once(gen, "C['rulesVersion']='2.2.0'", "C['rulesVersion']='2.3.0'", 'v6 rules version')
gen_path.write_text(gen, encoding='utf-8')

tests = test_path.read_text(encoding='utf-8')
tests = replace_once(tests, 'buildProfile,replayRun', 'buildProfile,abilityRole,replayRun', 'v6 test import')
tests = replace_once(tests, "assert.equal(c.version,'2.2.0');assert.equal(c.rulesVersion,'2.2.0');", "assert.equal(c.version,'2.3.0');assert.equal(c.rulesVersion,'2.3.0');", 'v6 version assertion')
tests += r'''

test('v6 contextual role grammar distinguishes start, bridge and finish pieces',()=>{const g=fresh('V6-ROLES');const basic=c.abilities.find(a=>a.slot==='basic')!,strategy=c.abilities.find(a=>a.slot==='strategy')!;assert.equal(abilityRole(c,g.s,basic).role,'starter');assert.equal(abilityRole(c,g.s,strategy).role,'finisher');const b=g.build(),weak=b.bridge.counts[0]<=b.bridge.counts[1]?b.bridge.schools[0]:b.bridge.schools[1],tags={rage:['rage','burst'],burn:['fire','burn'],guard:['shield','counter'],break:['break','sword']}[weak],candidate=c.abilities.find(a=>a.slot!=='strategy'&&a.rarity!=='mythic'&&a.tags.some(t=>tags.includes(t)));assert(candidate);assert.equal(abilityRole(c,g.s,candidate).role,'bridge');});
test('v6 three-offer draft is deterministic unique and reserves the middle lane for bridge repair',()=>{const a=fresh('V6-DRAFT'),b=fresh('V6-DRAFT'),x=a.rollAbilities(3,'reward'),y=b.rollAbilities(3,'reward');assert.deepEqual(x,y);assert.equal(new Set(x).size,3);assert.equal(abilityRole(c,a.s,a.ability(x[1])).role,'bridge');});
test('v6 role classification is derived and does not alter save shape',()=>{const g=fresh('V6-DERIVED'),before=JSON.stringify(g.s);for(const a of c.abilities.slice(0,12))abilityRole(c,g.s,a);assert.equal(JSON.stringify(g.s),before);});
test('v6 content and reward-draft rules advance together',()=>{assert.equal(c.version,'2.3.0');assert.equal(c.rulesVersion,'2.3.0');});
'''
test_path.write_text(tests, encoding='utf-8')

doc_path.write_text(r'''# Gameplay V6 — ability roles and directed drafts

V6 stops adding raw resonance tiers and improves the quality of each build decision.

## Contextual ability roles

Every ability is evaluated against the current eight-slot board and labelled as one of five roles:

- Starter — reliable opening / base loop.
- Core — primary damage or resource loop for the current axis.
- Amplifier — passive, trigger, artifact or scaling layer that multiplies an existing loop.
- Bridge — repairs the weaker side of the currently closest two-school bridge.
- Finisher — strategy or a piece that directly closes late-run finisher requirements.

Roles are derived, never persisted. The same ability may change role after the player pivots the board.

## Directed three-choice draft

Battle rewards (and three-ability shop rolls) are now generated in three deterministic lanes:

1. Core lane — biased toward the current axis and its amplifiers.
2. Bridge lane — biased toward the weaker side of the closest bridge.
3. Pivot lane — biased toward novel tags and non-equipped abilities, preserving the option to change direction.

The lanes use separate RNG domains, so changes to one lane do not silently perturb the other two.

## Build diagnosis UI

The build panel now presents a five-step path: Start → Core → Amplify → Bridge → Finish. Equipped pieces show contextual role badges, and the next missing layer is called out explicitly. Reward cards also show their role and why they matter to the current board.

Because reward generation and deterministic run outcomes change, content/rules version advances to 2.3.0.
''', encoding='utf-8')

print('Gameplay V6 patch applied')
