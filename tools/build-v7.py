from pathlib import Path
import re
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
engine_path = root / 'src/engine.ts'
app_path = root / 'src/app.ts'
css_path = root / 'src/style.css'
gen_path = root / 'scripts/create-content.py'
test_path = root / 'tests/engine.test.mjs'
doc_path = root / 'docs/GAMEPLAY_V7.md'


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, got {count}')
    return text.replace(old, new, 1)


def replace_ability(text: str, ability_id: str, replacement: str) -> str:
    pattern = re.compile(rf"(?m)^ability\('{re.escape(ability_id)}'.*$")
    matches = list(pattern.finditer(text))
    if len(matches) != 1:
        raise RuntimeError(f'ability {ability_id}: expected one line, got {len(matches)}')
    m = matches[0]
    return text[:m.start()] + replacement.rstrip() + text[m.end():]


engine = engine_path.read_text(encoding='utf-8')

engine = replace_once(
    engine,
    "export const EFFECT_TYPES=['damage','heal','gain_shield','gain_rage','lose_rage','apply_status','remove_status','modify_stat','gain_currency','gain_xp','rank_up','set_fact','add_counter','advance_thread'];",
    "export const EFFECT_TYPES=['damage','heal','gain_shield','gain_rage','lose_rage','consume_status','consume_shield','apply_status','remove_status','modify_stat','gain_currency','gain_xp','rank_up','set_fact','add_counter','advance_thread'];",
    'v7 effect types',
)

engine = replace_once(
    engine,
    "export interface BattleSummary {playerDamage:number;enemyDamage:number;playerShieldAbsorbed:number;enemyShieldAbsorbed:number;playerCrits:number;enemyCrits:number;playerMisses:number;enemyMisses:number;playerRageSkills:number;enemyRageSkills:number;statusTicks:number;phaseChanges:number;}",
    "export interface BattleSummary {playerDamage:number;enemyDamage:number;playerShieldAbsorbed:number;enemyShieldAbsorbed:number;playerCrits:number;enemyCrits:number;playerMisses:number;enemyMisses:number;playerRageSkills:number;enemyRageSkills:number;playerConversions:number;enemyConversions:number;statusTicks:number;phaseChanges:number;}",
    'v7 battle summary interface',
)

engine = replace_once(
    engine,
    "playerRageSkills:0,enemyRageSkills:0,statusTicks:0,phaseChanges:0",
    "playerRageSkills:0,enemyRageSkills:0,playerConversions:0,enemyConversions:0,statusTicks:0,phaseChanges:0",
    'v7 battle summary init',
)

engine = replace_once(
    engine,
    "case 'lose_rage':changeRage(t,-n);break;case 'apply_status':",
    "case 'lose_rage':changeRage(t,-n);break;case 'consume_status':{const key=ef.status!,before=t.status[key]??0,spent=Math.min(before,Math.max(0,n));t.status[key]=Math.max(0,before-spent);if(spent>0){if(a===p)summary.playerConversions++;else summary.enemyConversions++;const resource=key==='burn'?'燃烧':key==='break'?'破甲':key;frame(a,'convert',label,0,false,{sourceId,detail:`炼化 ${spent} 层${resource}`});}break;}case 'consume_shield':{const spent=Math.min(t.shield,Math.max(0,n));t.shield=Math.max(0,t.shield-spent);if(spent>0){if(a===p)summary.playerConversions++;else summary.enemyConversions++;frame(a,'convert',label,0,false,{sourceId,detail:`炼化 ${spent} 护盾`});}break;}case 'apply_status':",
    'v7 conversion effects',
)

engine = replace_once(
    engine,
    "const checkEffects=(a:Effect[])=>{for(const e of a){if(!EFFECT_TYPES.includes(e.type))throw new Error('Unknown effect '+e.type);if(e.coefficient!==undefined&&[e.coefficient].flat().some(x=>!Number.isFinite(x)||x<0||x>2000))throw new Error('Unsafe coefficient');if(e.stat&&!STAT_KEYS.includes(e.stat))throw new Error('Unknown stat');}};",
    "const checkEffects=(a:Effect[])=>{for(const e of a){if(!EFFECT_TYPES.includes(e.type))throw new Error('Unknown effect '+e.type);if(e.coefficient!==undefined&&[e.coefficient].flat().some(x=>!Number.isFinite(x)||x<0||x>2000))throw new Error('Unsafe coefficient');if(e.stat&&!STAT_KEYS.includes(e.stat))throw new Error('Unknown stat');if(['apply_status','remove_status','consume_status'].includes(e.type)&&!['burn','weak','break','stun','vulnerable'].includes(e.status??''))throw new Error('Unknown status effect');}};",
    'v7 status effect validation',
)

engine_path.write_text(engine, encoding='utf-8')


gen = gen_path.read_text(encoding='utf-8')

# Starter and engine pieces: keep IDs stable so events, saves-by-version, and art references stay deterministic.
gen = replace_ability(gen, 'basic.sword', "ability('basic.sword','青锋诀','basic','burst sword','sword','造成 {0}% 攻击伤害。',[dmg([115,130,145,165])])")
gen = replace_ability(gen, 'rage.thunder', "ability('rage.thunder','九天雷动','rage','rage burst','bolt','100 怒气：{0}% 伤害，返还 20 / 24 / 28 / 34 怒气。',[dmg([250,275,300,335]),rage([20,24,28,34])],rarity='rare',cost=100)")
gen = replace_ability(gen, 'aux.qi', "ability('aux.qi','纳气','aux','rage','cloud','入战获得 8 怒气；每轮结束获得 10 / 12 / 14 / 17 怒气。',triggers=[trig('battle_start',[rage(8)]),trig('round_end',[rage([10,12,14,17])])])")
gen = replace_ability(gen, 'aux.ash', "ability('aux.ash','焚心','aux','fire burn rage','flame','回合结束，敌方燃烧≥4：炼化 2 层燃烧，获得 14 / 18 / 22 / 28 怒气，并造成 35% / 45% / 55% / 70% 攻击纯伤害。',triggers=[trig('round_end',[dict(type='consume_status',target='enemy',status='burn',value=2),rage([14,18,22,28]),dmg([35,45,55,70],pure=True)],conditions=[cond('status_stack_at_least',status='burn',target='enemy',value=4)])])")
gen = replace_ability(gen, 'art.flag', "ability('art.flag','聚灵幡','artifact','rage','flag','攻击 +2+。入战获得 10 怒气；每轮获得 6 / 7 / 8 / 10 怒气。',stats={'attack':[2,3,4,5]},triggers=[trig('battle_start',[rage(10)]),trig('round_end',[rage([6,7,8,10])])])")

# Four school engines. These are generators/spenders rather than unconditional damage bonuses.
gen = replace_ability(gen, 'strategy.rage', "ability('strategy.rage','怒海','strategy','rage burst','wave','入战 +10 怒气；每次怒气技后返还 28 / 32 / 36 / 42 怒气，并引发 55% / 70% / 85% / 105% 攻击纯伤害的雷劫余震。',triggers=[trig('battle_start',[rage(10)]),trig('on_rage_skill',[rage([28,32,36,42]),dmg([55,70,85,105],pure=True)])],rarity='rare')")
gen = replace_ability(gen, 'strategy.guard', "ability('strategy.guard','以守为攻','strategy','shield counter','shield','命中且自身护盾≥12：炼化 12 护盾，追加 120% / 145% / 170% / 210% 防御伤害。',triggers=[trig('on_hit',[dict(type='consume_shield',target='self',value=12),dmg([120,145,170,210],stat='defense')],conditions=[cond('status_stack_at_least',status='shield',target='self',value=12)])],rarity='rare')")
gen = replace_ability(gen, 'strategy.fire', "ability('strategy.fire','燎原','strategy','fire burn','flame','命中且敌方燃烧≥6：炼化 3 层燃烧，追加 100% / 125% / 150% / 185% 攻击纯伤害。',triggers=[trig('on_hit',[dict(type='consume_status',target='enemy',status='burn',value=3),dmg([100,125,150,185],pure=True)],conditions=[cond('status_stack_at_least',status='burn',target='enemy',value=6)])],rarity='rare')")
gen = replace_ability(gen, 'strategy.mountain', "ability('strategy.mountain','不动如山','strategy','shield','mountain','每轮获得防御 45% / 55% / 65% / 80% 的护盾。',triggers=[trig('round_end',[shield(c=[45,55,65,80])])],rarity='rare')")
gen = replace_ability(gen, 'strategy.hunt', "ability('strategy.hunt','破绽猎杀','strategy','break burst','eye','命中且敌方破甲≥3：炼化 2 层破甲，获得 12 / 15 / 18 / 22 怒气，并追加 90% / 110% / 130% / 155% 攻击伤害。',triggers=[trig('on_hit',[dict(type='consume_status',target='enemy',status='break',value=2),rage([12,15,18,22]),dmg([90,110,130,155])],conditions=[cond('status_stack_at_least',status='break',target='enemy',value=3)])],rarity='rare')")

# Bump both content and deterministic combat rule versions.
for old, new, label in [
    ("C['version']='2.3.0'", "C['version']='2.4.0'", 'v7 content version'),
    ("C['rulesVersion']='2.3.0'", "C['rulesVersion']='2.4.0'", 'v7 rules version'),
]:
    count = gen.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, got {count}')
    gen = gen.replace(old, new, 1)

gen_path.write_text(gen, encoding='utf-8')


app = app_path.read_text(encoding='utf-8')

# Show conversion pieces directly on cards without creating another abstract build layer.
app = replace_once(
    app,
    "card(id:string,rank=0,action='inspect',attrs='',foot=''){const a=this.content.abilities.find(x=>x.id===id)!,role=this.game?.role(id),coefficient=a.effects.find(e=>e.type==='damage')?.coefficient,text=a.description.replace('{0}',String(value(coefficient,rank)));",
    "card(id:string,rank=0,action='inspect',attrs='',foot=''){const a=this.content.abilities.find(x=>x.id===id)!,role=this.game?.role(id),combatEffects=[...(a.effects??[]),...(a.triggers??[]).flatMap(t=>t.effects??[])],converter=combatEffects.some(e=>e.type==='consume_status'||e.type==='consume_shield'),coefficient=a.effects.find(e=>e.type==='damage')?.coefficient,text=a.description.replace('{0}',String(value(coefficient,rank)));",
    'v7 card converter detection',
)

app = replace_once(
    app,
    "<p class=\"card-description\">${esc(text)}</p>${role?`<div class=\"card-role-note role-${role.role}\"><b>${role.label}</b><span>${esc(role.reason)}</span></div>`:''}",
    "<p class=\"card-description\">${esc(text)}</p>${converter?`<div class=\"converter-note\"><b>资源炼化</b><span>主动消耗积累，换取即时收益</span></div>`:''}${role?`<div class=\"card-role-note role-${role.role}\"><b>${role.label}</b><span>${esc(role.reason)}</span></div>`:''}",
    'v7 card converter note',
)

app = replace_once(
    app,
    "<div><span>怒气技</span><b>${sum.playerRageSkills}</b></div><div><span>状态结算</span><b>${sum.statusTicks}</b></div>",
    "<div><span>怒气技</span><b>${sum.playerRageSkills}</b></div><div><span>资源炼化</span><b>${sum.playerConversions}</b></div><div><span>状态结算</span><b>${sum.statusTicks}</b></div>",
    'v7 battle conversion summary',
)

app = app.replace(
    'V6 构筑增加能力角色与定向三选一。先让循环成立，再决定强化主轴、补桥接或主动转型。',
    'V7 四派改为资源发动机：先生成，再炼化，再回到循环。能力角色与定向三选一继续保留。',
    1,
)

# Replace the old three-route help block with the four actual engines.
help_pattern = re.compile(r"<h3>\\u56db.*?</p>(?=<h3>\\u4e94)")
help_matches = list(help_pattern.finditer(app))
if len(help_matches) != 1:
    raise RuntimeError(f'v7 help block: expected one match, got {len(help_matches)}')
help_html = '<h3>四、四条修行路</h3><p>怒潮：蓄怒 → 怒技 → 回气与雷劫余震。<br>焚劫：叠燃烧 → 炼化层数 → 爆燃。<br>玄甲：造盾 → 承伤 → 炼盾反击。<br>破阵：叠破甲 → 炼化破甲 → 回怒追击。<br>带“资源炼化”的能力会主动消耗积累，换取更高的即时收益。</p>'
m = help_matches[0]
app = app[:m.start()] + help_html + app[m.end():]

app_path.write_text(app, encoding='utf-8')


css = css_path.read_text(encoding='utf-8')
css += r'''

/* Gameplay v7 — resource engines */
.converter-note{margin:9px 0 0;padding:8px 10px;border:1px solid color-mix(in srgb,var(--gold) 36%,transparent);background:color-mix(in srgb,var(--ink) 70%,transparent);display:flex;gap:8px;align-items:center;justify-content:center;font-size:9px;letter-spacing:.5px}
.converter-note b{color:var(--gold);font-weight:800;white-space:nowrap}.converter-note span{color:var(--muted);line-height:1.45}
.battle-log-row.kind-convert .battle-log-main strong{color:var(--gold)}
@media(max-width:760px){.converter-note{font-size:8px;padding:7px 8px;gap:6px}}
'''
css_path.write_text(css, encoding='utf-8')


tests = test_path.read_text(encoding='utf-8')
tests = tests.replace("'2.3.0'", "'2.4.0'")

v7_tests = r'''

test('v7 burn engine harvests burn into rage and burst damage',()=>{const g=fresh('V7-BURN'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:999,attack:1,defense:0,speed:1,dodge:0};g.s.slots=[{id:'basic.fire',rank:0},{id:'rage.fire',rank:0},{id:'aux.fire',rank:0},{id:'aux.ash',rank:0},{id:'art.lamp',rank:0},{id:'art.pearl',rank:0},null,{id:'strategy.fire',rank:0}];const b=simulateBattle(c,g.s,enemy);assert(b.summary.playerConversions>0);assert(b.frames.some(f=>f.kind==='convert'&&['aux.ash','strategy.fire'].includes(f.sourceId)));});

test('v7 guard engine spends shield to counterattack',()=>{const g=fresh('V7-GUARD'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:999,attack:4,defense:0,speed:1,dodge:0};g.s.slots=[{id:'basic.fist',rank:0},{id:'rage.guard',rank:0},{id:'aux.stone',rank:0},{id:'aux.counter',rank:0},{id:'art.mirror',rank:0},{id:'art.bracer',rank:0},null,{id:'strategy.guard',rank:0}];const b=simulateBattle(c,g.s,enemy);assert(b.summary.playerConversions>0);assert(b.frames.some(f=>f.kind==='convert'&&f.sourceId==='strategy.guard'&&f.detail.includes('护盾')));});

test('v7 break engine harvests armor break into rage and pursuit',()=>{const g=fresh('V7-BREAK'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:999,attack:1,defense:0,speed:1,dodge:0};g.s.slots=[{id:'basic.break',rank:0},{id:'rage.sky',rank:0},{id:'aux.sight',rank:0},{id:'aux.qi',rank:0},{id:'art.needle',rank:0},{id:'art.sword',rank:0},null,{id:'strategy.hunt',rank:0}];const b=simulateBattle(c,g.s,enemy);assert(b.summary.playerConversions>0);assert(b.frames.some(f=>f.kind==='convert'&&f.sourceId==='strategy.hunt'&&f.detail.includes('破甲')));});

test('v7 rage engine refunds rage and emits deterministic thunder echoes',()=>{const make=()=>{const g=fresh('V7-RAGE'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:999,attack:1,defense:0,speed:1,dodge:0};g.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},{id:'aux.qi',rank:0},{id:'aux.river',rank:0},{id:'art.flag',rank:0},{id:'art.feather',rank:0},null,{id:'strategy.rage',rank:0}];return simulateBattle(c,g.s,enemy);};const a=make(),b=make();assert.deepEqual(a,b);assert(a.summary.playerRageSkills>0);assert(a.frames.some(f=>f.kind==='damage'&&f.sourceId==='strategy.rage'));});

test('v7 resource engines advance content and deterministic rule versions together',()=>{assert.equal(c.version,'2.4.0');assert.equal(c.rulesVersion,'2.4.0');});
'''
if 'v7 burn engine harvests burn into rage and burst damage' in tests:
    raise RuntimeError('v7 tests already present')
tests += v7_tests
test_path.write_text(tests, encoding='utf-8')


doc_path.write_text('''# Gameplay V7 — Resource Engines

V7 converts the four build schools from mostly passive resonance bonuses into distinct battle engines while preserving the eight-slot, deterministic auto-battle rules.

## Engine loops

- **怒潮**: generate rage → cast rage skill → refund rage → thunder echo.
- **焚劫**: stack Burn → consume Burn stacks → gain rage / burst immediately → restack.
- **玄甲**: generate Shield → absorb damage → spend Shield → defense-scaled counterattack.
- **破阵**: stack Break → consume Break → gain rage / pursuit damage → restack.

## New deterministic effects

- `consume_status`: consumes a fixed number of status stacks after a trigger condition proves enough stacks exist.
- `consume_shield`: consumes a fixed amount of Shield after a trigger condition proves enough Shield exists.

Both effects emit typed `convert` replay frames and increment battle summary conversion counters. They use no extra randomness and do not change replay semantics.

## Reworked pieces

`纳气`, `焚心`, `聚灵幡`, `九天雷动`, and the four school strategies now expose generation/spend loops. Existing bridge artifacts such as `玄火珠` and `破魔针` remain cross-school glue.

## Compatibility

Content and rules versions are both `2.4.0`. V6 saves are intentionally rejected because combat resolution and reward outcomes can differ.
''', encoding='utf-8')

print('Gameplay V7 patch applied')
