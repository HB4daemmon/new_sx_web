from pathlib import Path
import re
import sys

root=Path(sys.argv[1] if len(sys.argv)>1 else '.')
gen_path=root/'scripts/create-content.py'
engine_path=root/'src/engine.ts'
app_path=root/'src/app.ts'
test_path=root/'tests/engine.test.mjs'
doc_path=root/'docs/GAMEPLAY_V8.md'


def replace_once(text, old, new, label):
    n=text.count(old)
    if n!=1:
        raise RuntimeError(f'{label}: expected one match, got {n}')
    return text.replace(old,new,1)


def replace_line(text, aid, new_line):
    pattern=re.compile(rf"(?m)^ability\('{re.escape(aid)}'.*$")
    ms=list(pattern.finditer(text))
    if len(ms)!=1:
        raise RuntimeError(f'{aid}: expected one line, got {len(ms)}')
    m=ms[0]
    return text[:m.start()]+new_line.rstrip()+text[m.end():]

# ---------------- content ----------------
gen=gen_path.read_text(encoding='utf-8')
gen=replace_line(gen,'basic.tide',"ability('basic.tide','沧浪式','basic','shield rage','wave','造成 {0}% 伤害，获得 5 护盾与 4 / 5 / 6 / 7 怒气。',[dmg([100,115,130,145]),shield(5),rage([4,5,6,7])])")
gen=replace_line(gen,'rage.lotus',"ability('rage.lotus','红莲业火','rage','fire burn burst','lotus','100 怒气：{0}% 伤害；敌方每层燃烧额外造成 14% / 16% / 18% / 20% 攻击伤害（最多 10 层），随后施加 2 层燃烧。',[dmg([180,205,230,260]),dict(type='resource_damage',resource='burn',resourceTarget='enemy',coefficient=[14,16,18,20],cap=10),status('burn',2)],rarity='rare',cost=100)")
gen=replace_line(gen,'rage.sky',"ability('rage.sky','斩天一剑','rage','break burst sword','sword','100 怒气：{0}% 伤害；敌方每层破甲额外造成 18% / 22% / 26% / 30% 攻击伤害（最多 6 层），并施加易伤。',[dmg([230,255,280,310]),dict(type='resource_damage',resource='break',resourceTarget='enemy',coefficient=[18,22,26,30],cap=6),status('vulnerable')],rarity='rare',cost=100)")
gen=replace_line(gen,'myth.orbs',"ability('myth.orbs','定海神珠','artifact','fire burn shield','orbs','攻击 +5+，防御 +5。每轮获得 8 护盾，并向敌方施加 1 层燃烧。',stats={'attack':[5,7,9,11],'defense':5},triggers=[trig('round_end',[shield(8),status('burn')])],rarity='mythic')")

marker="base=dict(hp=100,attack=20,defense=10,speed=10,hit=10,dodge=10,luck=10)"
roles="""MECHANIC_GROUPS={
 'starter':['basic.sword'],
 'generator':['basic.fist','basic.fire','basic.thunder','basic.break','rage.fire','rage.guard','aux.qi','aux.river','aux.stone','art.mirror','art.flag','art.bracer','art.feather','art.lamp','art.needle','strategy.mountain'],
 'converter':['aux.ash','strategy.guard','strategy.fire','strategy.hunt'],
 'amplifier':['aux.fire','aux.guard','aux.counter','aux.sight','aux.wind','art.pearl','art.bell','art.jade','art.sword','art.coin','art.gourd'],
 'bridge':['basic.tide','myth.orbs'],
 'keystone':['rage.thunder','myth.ring','myth.seal','strategy.rage'],
 'risk':['rage.army','aux.last','strategy.last'],
 'payoff':['rage.lotus','rage.sky'],
}
_mechanic={aid:role for role,ids in MECHANIC_GROUPS.items() for aid in ids}
assert set(_mechanic)=={a['id'] for a in A},('mechanic role coverage mismatch',set(a['id'] for a in A)-set(_mechanic),set(_mechanic)-set(a['id'] for a in A))
for a in A:a['mechanicRole']=_mechanic[a['id']]

"""
gen=replace_once(gen,marker,roles+marker,'mechanic role map')
gen=replace_once(gen,"C['version']='2.4.0'","C['version']='2.5.0'",'content version')
gen=replace_once(gen,"C['rulesVersion']='2.4.0'","C['rulesVersion']='2.5.0'",'rules version')
gen_path.write_text(gen,encoding='utf-8')

# ---------------- engine ----------------
engine=engine_path.read_text(encoding='utf-8')
engine=replace_once(engine,
"export interface Effect { type:string; target?:string; value?:any; coefficient?:Num; stat?:Stat; maxHpPercent?:number; percent?:Num; status?:string; pure?:boolean; key?:string; }",
"export interface Effect { type:string; target?:string; value?:any; coefficient?:Num; stat?:Stat; maxHpPercent?:number; percent?:Num; status?:string; pure?:boolean; key?:string; resource?:string; resourceTarget?:string; cap?:number; }",
'Effect resource fields')
engine=replace_once(engine,
"export interface Ability { id:string; name:string; slot:Slot; tags:string[]; art:string; description:string; effects:Effect[]; triggers:Trigger[]; stats:Partial<Record<Stat,Num>>; rarity:string; cost:number; cooldown?:number; priority?:number; }",
"export interface Ability { id:string; name:string; slot:Slot; tags:string[]; art:string; description:string; effects:Effect[]; triggers:Trigger[]; stats:Partial<Record<Stat,Num>>; rarity:string; cost:number; cooldown?:number; priority?:number; mechanicRole?:'starter'|'generator'|'converter'|'amplifier'|'bridge'|'keystone'|'risk'|'payoff'; }",
'Ability mechanic role')
engine=replace_once(engine,
"export const EFFECT_TYPES=['damage','heal','gain_shield','gain_rage','lose_rage','consume_status','consume_shield','apply_status','remove_status','modify_stat','gain_currency','gain_xp','rank_up','set_fact','add_counter','advance_thread'];",
"export const EFFECT_TYPES=['damage','resource_damage','heal','gain_shield','gain_rage','lose_rage','consume_status','consume_shield','apply_status','remove_status','modify_stat','gain_currency','gain_xp','rank_up','set_fact','add_counter','advance_thread'];",
'EFFECT_TYPES resource damage')
engine=replace_once(engine,
"if(['apply_status','remove_status','consume_status'].includes(e.type)&&!['burn','weak','break','stun','vulnerable'].includes(e.status??''))throw new Error('Unknown status effect');",
"if(['apply_status','remove_status','consume_status'].includes(e.type)&&!['burn','weak','break','stun','vulnerable'].includes(e.status??''))throw new Error('Unknown status effect');if(e.type==='resource_damage'&&!['burn','break','shield','rage'].includes(e.resource??''))throw new Error('Unknown combat resource');if(e.type==='resource_damage'&&e.resourceTarget&&!['self','enemy'].includes(e.resourceTarget))throw new Error('Unknown resource target');",
'resource effect validation')
engine=replace_once(engine,
"return true;}case 'heal':t.hp=Math.min(t.stats.hp,t.hp+n+Math.floor(t.stats.hp*(ef.maxHpPercent??0)/100));break;",
"return true;}case 'resource_damage':{const holder=ef.resourceTarget==='self'?a:b,key=ef.resource!,raw=key==='shield'?holder.shield:key==='rage'?holder.rage:(holder.status[key]??0),units=Math.min(Math.max(0,raw),Math.max(0,ef.cap??9999)),per=value(ef.coefficient,rank);if(units<=0||per<=0)break;return apply(a,b,{type:'damage',target:ef.target,coefficient:units*per,stat:ef.stat??'attack',pure:ef.pure},rank,label,true,sourceId);}case 'heal':t.hp=Math.min(t.stats.hp,t.hp+n+Math.floor(t.stats.hp*(ef.maxHpPercent??0)/100));break;",
'resource damage runtime')
engine_path.write_text(engine,encoding='utf-8')

# ---------------- UI ----------------
app=app_path.read_text(encoding='utf-8')
app=replace_once(app,
"const tone=(a:{tags:string[];rarity:string})=>a.rarity==='mythic'?'mythic':a.tags.includes('burn')?'burn':a.tags.includes('shield')?'shield':'jade';",
"const tone=(a:{tags:string[];rarity:string})=>a.rarity==='mythic'?'mythic':a.tags.includes('burn')?'burn':a.tags.includes('shield')?'shield':'jade';\nconst MECHANIC_LABELS:Record<string,string>={starter:'起手式',generator:'产能件',converter:'炼化件',amplifier:'放大件',bridge:'桥接件',keystone:'核心件',risk:'险招',payoff:'终结件'};",
'UI mechanic labels')
old="<div class=\"card-foot\"><span>${a.tags.slice(0,2).map(t=>TAGS[t]??esc(t)).join(' / ')}</span><span class=\"gain\">${foot||'RANK '+rank+' '+icon('diamond',13)}</span></div>"
new="<div class=\"card-foot\"><span>${esc(MECHANIC_LABELS[a.mechanicRole??'amplifier']??a.mechanicRole??'能力')} · ${a.tags.slice(0,2).map(t=>TAGS[t]??esc(t)).join(' / ')}</span><span class=\"gain\">${foot||'RANK '+rank+' '+icon('diamond',13)}</span></div>"
app=replace_once(app,old,new,'ability mechanic label in card foot')
app=replace_once(app,
"<p class=\"small muted\" style=\"margin-top:15px;font-size:10px;line-height:1.9\">V7 四派改为资源发动机：先生成，再炼化，再回到循环。能力角色与定向三选一继续保留。</p>",
"<p class=\"small muted\" style=\"margin-top:15px;font-size:10px;line-height:1.9\">V8 为 43 项能力补齐机制定位：产能、炼化、放大、桥接、核心、险招与终结。卡牌底部显示静态定位，上方仍显示当前命盘中的动态角色。</p>",
'build panel V8 note')
app_path.write_text(app,encoding='utf-8')

# ---------------- tests/docs ----------------
tests=test_path.read_text(encoding='utf-8').replace("'2.4.0'","'2.5.0'")
if "test('v8 all abilities carry authored mechanic roles'" in tests:
    raise RuntimeError('V8 tests already present')
tests += r'''

test('v8 all abilities carry authored mechanic roles',()=>{const allowed=new Set(['starter','generator','converter','amplifier','bridge','keystone','risk','payoff']);assert.equal(c.abilities.length,43);assert(c.abilities.every(a=>allowed.has(a.mechanicRole)));assert.equal(c.abilities.filter(a=>a.mechanicRole==='payoff').length,2);assert.equal(c.abilities.filter(a=>a.mechanicRole==='converter').length,4);});

test('v8 burn payoff makes red lotus scale from live burn stacks deterministically',()=>{const make=()=>{const g=fresh('V8-LOTUS'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:2200,attack:1,defense:0,speed:1,dodge:0};g.s.slots=[{id:'basic.fire',rank:0},{id:'rage.lotus',rank:0},{id:'aux.fire',rank:0},{id:'aux.ash',rank:0},{id:'art.lamp',rank:0},{id:'art.pearl',rank:0},null,{id:'strategy.fire',rank:0}];return simulateBattle(c,g.s,enemy);};const a=make(),b=make(),hits=a.frames.filter(f=>f.kind==='damage'&&f.sourceId==='rage.lotus');assert.deepEqual(a,b);assert(a.summary.playerRageSkills>0);assert(hits.length>=2);});

test('v8 break payoff makes heaven slash scale from armor break',()=>{const g=fresh('V8-SKY'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:2200,attack:1,defense:0,speed:1,dodge:0};g.s.slots=[{id:'basic.break',rank:0},{id:'rage.sky',rank:0},{id:'aux.sight',rank:0},{id:'aux.qi',rank:0},{id:'art.needle',rank:0},{id:'art.sword',rank:0},null,{id:'strategy.hunt',rank:0}];const b=simulateBattle(c,g.s,enemy),hits=b.frames.filter(f=>f.kind==='damage'&&f.sourceId==='rage.sky');assert(b.summary.playerRageSkills>0);assert(hits.length>=2);});

test('v8 bridge pieces express both sides of their resource identity',()=>{const tide=c.abilities.find(a=>a.id==='basic.tide'),orbs=c.abilities.find(a=>a.id==='myth.orbs');assert(tide.effects.some(e=>e.type==='gain_shield'));assert(tide.effects.some(e=>e.type==='gain_rage'));const fx=orbs.triggers.flatMap(t=>t.effects);assert(fx.some(e=>e.type==='gain_shield'));assert(fx.some(e=>e.type==='apply_status'&&e.status==='burn'));assert.equal(c.version,'2.5.0');assert.equal(c.rulesVersion,'2.5.0');});

test('v8 resource damage rejects undeclared resources',()=>{const bad=structuredClone(c),lotus=bad.abilities.find(a=>a.id==='rage.lotus'),effect=lotus.effects.find(e=>e.type==='resource_damage');effect.resource='gold';assert.throws(()=>validateContent(bad));});
'''
test_path.write_text(tests,encoding='utf-8')

doc_path.write_text('''# Gameplay V8 — Ability Identity Pass\n\nV8 moves the 43-ability pool from mostly tag/stat variations toward authored mechanical identities while keeping the existing eight-slot, deterministic auto-combat and JSON-first content model.\n\n## Static mechanic roles\n\nEvery ability now carries one JSON-authored `mechanicRole`: `starter`, `generator`, `converter`, `amplifier`, `bridge`, `keystone`, `risk`, or `payoff`. This is intentionally separate from V6 contextual `abilityRole`: the mechanic role says what the authored piece fundamentally does, while contextual role says what that piece would do for the current run.\n\n## Generic payoff primitive\n\n`resource_damage` is a deterministic combat effect that reads a declared live resource (`burn`, `break`, `shield`, or `rage`) from self/enemy and turns each unit into additional stat-scaled damage, with an optional cap. It does not consume the resource; explicit `consume_status` / `consume_shield` remain the converter primitives.\n\n## Reworked pieces\n\n- 红莲业火 is now a Burn payoff rather than a second large Burn generator.\n- 斩天一剑 is now a Break payoff rather than a generic high-coefficient rage skill.\n- 沧浪式 now links Shield and Rage and is authored as a bridge starter.\n- 定海神珠 now actually expresses both halves of its Burn/Shield identity every round.\n\nThis gives generators → converters → payoffs a clearer division of labor, while keystones and risk pieces can still redirect a run.\n''',encoding='utf-8')

print('Gameplay V8 ability identity refactor applied')
