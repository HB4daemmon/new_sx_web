from pathlib import Path
import re
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.')

def read(rel):
    return (root / rel).read_text(encoding='utf-8')

def write(rel, text):
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding='utf-8')

def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)

def replace_ability(text, aid, line):
    pat = re.compile(r"^ability\('" + re.escape(aid) + r"'.*$", re.M)
    matches = pat.findall(text)
    if len(matches) != 1:
        raise SystemExit(f'ability {aid}: expected one line, found {len(matches)}')
    return pat.sub(line, text, count=1)

# -----------------------------------------------------------------------------
# Content: mythic rewards and fate choices become true build pivots.
# -----------------------------------------------------------------------------
p = 'scripts/create-content.py'
s = read(p)

s = replace_ability(s, 'myth.ring', "ability('myth.ring','乾坤圈','artifact','rage break burst','ring','攻击 +5 / +7 / +9 / +12。命中额外获得 8 怒气；施放怒气技后再获得 10 怒气并施加 2 层破甲。',stats={'attack':[5,7,9,12]},triggers=[trig('on_hit',[rage(8)]),trig('on_rage_skill',[rage(10),status('break',2)])],rarity='mythic')")
s = replace_ability(s, 'myth.seal', "ability('myth.seal','番天印','artifact','shield counter break','seal','防御 +6 / +8 / +10 / +13。入战获得防御 80% 的护盾；施放怒气技后令敌方眩晕并施加 2 层破甲。',stats={'defense':[6,8,10,13]},triggers=[trig('battle_start',[shield(c=80)]),trig('on_rage_skill',[status('stun'),status('break',2)])],rarity='mythic')")
s = replace_ability(s, 'myth.orbs', "ability('myth.orbs','定海神珠','artifact','fire burn shield rage','orbs','攻击 +4 / +6 / +8 / +10，防御 +4。每轮获得 8 护盾并施加 1 层燃烧；施放怒气技后再获得 6 护盾并施加 2 层燃烧。',stats={'attack':[4,6,8,10],'defense':4},triggers=[trig('round_end',[shield(8),status('burn')]),trig('on_rage_skill',[shield(6),status('burn',2)])],rarity='mythic')")

old_fates = re.compile(r"^fates=\[.*\]$", re.M)
new_fates = "fates=[dict(id='luck',name='福缘深厚',description='气运 +4。命格偏向破阵；暴击后获得 8 怒气。',art='coin',stats={'luck':4},resonanceBias=['break'],triggers=[trig('on_crit',[rage(8)])]),dict(id='war',name='武曲入命',description='攻击 +8%。命格偏向破阵；怒气技施加 1 层破甲。',art='sword',percent={'attack':8},resonanceBias=['break'],triggers=[trig('on_rage_skill',[status('break')])]),dict(id='body',name='金刚道体',description='最大生命 +12%。命格偏向玄甲；入战获得防御 60% 的护盾。',art='shield',percent={'hp':12},resonanceBias=['guard'],triggers=[trig('battle_start',[shield(c=60)])]),dict(id='rage',name='灵台清明',description='命格偏向怒潮。每战初始怒气 +18，怒气技后返还 6 怒气。',art='lotus',resonanceBias=['rage'],triggers=[trig('battle_start',[rage(18)]),trig('on_rage_skill',[rage(6)])]),dict(id='kill',name='杀劫临身',description='攻击 +12%，防御 -10%。命格偏向破阵；暴击施加 1 层破甲。',art='swords',percent={'attack':12,'defense':-10},resonanceBias=['break'],triggers=[trig('on_crit',[status('break')])]),dict(id='late',name='厚积薄发',description='命格偏向怒潮。前 3 轮伤害 -10%，之后 +30%。',art='moon',resonanceBias=['rage'],damageByRound=[90,90,90,130]),dict(id='wind',name='风灵之体',description='速度 +3，闪避 +3。命格偏向怒潮；成功闪避后获得 12 怒气。',art='feather',stats={'speed':3,'dodge':3},resonanceBias=['rage'],triggers=[trig('on_evade',[rage(12)])]),dict(id='guard',name='玄武庇佑',description='命格偏向玄甲。每战获得 12 护盾；受击后获得 4 怒气。',art='mirror',resonanceBias=['guard'],triggers=[trig('battle_start',[shield(12)]),trig('on_damaged',[rage(4)])])]"
s, n = old_fates.subn(new_fates, s, count=1)
if n != 1:
    raise SystemExit('fates line not found')

# Make all three major mythic rewards announce their strategic pivot explicitly.
s = s.replace('哪吒暂借乾坤圈助你渡劫。', '哪吒暂借乾坤圈助你渡劫：怒潮 / 破阵转轴。')
s = s.replace('广成子暂借番天印。', '广成子暂借番天印：玄甲 / 破阵转轴。')
s = s.replace('获得定海神珠的暂借。', '获得定海神珠的暂借：焚劫 / 玄甲转轴。')

# Static mechanic grammar: all mythic relics are authored as keystones in V10.
s = replace_once(s, " 'bridge':['basic.tide','myth.orbs'],", " 'bridge':['basic.tide'],", 'bridge mechanic group')
s = replace_once(s, " 'keystone':['rage.thunder','aux.wind','art.sword','art.feather','art.coin','myth.ring','myth.seal','strategy.rage'],", " 'keystone':['rage.thunder','aux.wind','art.sword','art.feather','art.coin','myth.ring','myth.seal','myth.orbs','strategy.rage'],", 'keystone mechanic group')
s = s.replace("'2.6.0'", "'2.7.0'")
write(p, s)

# -----------------------------------------------------------------------------
# Engine: fate bias is JSON-driven and contributes one virtual resonance count.
# -----------------------------------------------------------------------------
p = 'src/engine.ts'
s = read(p)

s, n = re.subn(r"export interface Fate \{", "export interface Fate {resonanceBias?:('rage'|'burn'|'guard'|'break')[];", s, count=1)
if n != 1:
    raise SystemExit('Fate interface not found')

s = replace_once(s,
    "for(const f of c.fates)for(const t of f.triggers??[]){checkEffects(t.effects);checkConditions(t.conditions??[]);}",
    "for(const f of c.fates){for(const id of f.resonanceBias??[])if(!['rage','burn','guard','break'].includes(id))throw new Error('Unknown fate resonance '+id);for(const t of f.triggers??[]){checkEffects(t.effects);checkConditions(t.conditions??[]);}}",
    'fate validation')

old_school = "const school=(id:BuildResonance['id'],name:string,match:string[],tier1:string,tier2:string):BuildResonance=>{const count=equipped.filter(({a})=>match.some(t=>a.tags.includes(t))).length;const tier=(count>=4?2:count>=2?1:0) as 0|1|2;return {id,name,tier,count,next:tier===0?2:4,description:tier===2?tier2:tier===1?tier1:`再有 ${Math.max(0,2-count)} 项同源能力可激活`};};"
new_school = "const fate=c.fates.find(x=>x.id===s.fate)!,fateBias=fate.resonanceBias??[];const school=(id:BuildResonance['id'],name:string,match:string[],tier1:string,tier2:string):BuildResonance=>{const biased=fateBias.includes(id),count=equipped.filter(({a})=>match.some(t=>a.tags.includes(t))).length+(biased?1:0);const tier=(count>=4?2:count>=2?1:0) as 0|1|2,hint=biased?' · 命格引路 +1':'';return {id,name,tier,count,next:tier===0?2:4,description:(tier===2?tier2:tier===1?tier1:`再有 ${Math.max(0,2-count)} 项同源能力可激活`)+hint};};"
s = replace_once(s, old_school, new_school, 'fate resonance bias in build profile')

s = replace_once(s,
    "const BUILD_SCHOOL_TAGS:Record<BuildResonance['id'],string[]>={rage:['rage','burst'],burn:['fire','burn'],guard:['shield','counter'],break:['break','sword']};",
    "const BUILD_SCHOOL_TAGS:Record<BuildResonance['id'],string[]>={rage:['rage','burst'],burn:['fire','burn'],guard:['shield','counter'],break:['break','sword']};\nconst BUILD_SCHOOL_NAMES:Record<BuildResonance['id'],string>={rage:'怒潮',burn:'焚劫',guard:'玄甲',break:'破阵'};",
    'build school names')

old_active = "const active=build.resonances.filter(x=>x.tier>0).map(x=>`${x.name}·${x.tier===2?'二重':'一重'}`);if(build.strategy.tier)active.push(`战策统摄 +${build.strategy.bonusPercent}%`);if(build.bridge.tier)active.push(`${build.bridge.name}·${build.bridge.tier===2?'二重':'一重'}`);if(build.finisher.active)active.push(`终局法相·${build.finisher.name}`);if(active.length)frame(undefined,'build','构筑共鸣',0,false,{detail:active.join(' / ')});"
new_active = "const active=build.resonances.filter(x=>x.tier>0).map(x=>`${x.name}·${x.tier===2?'二重':'一重'}`),fateBias=p.fate?.resonanceBias??[];if(fateBias.length)active.push(`命格引路·${fateBias.map(x=>BUILD_SCHOOL_NAMES[x]).join('/')}`);if(build.strategy.tier)active.push(`战策统摄 +${build.strategy.bonusPercent}%`);if(build.bridge.tier)active.push(`${build.bridge.name}·${build.bridge.tier===2?'二重':'一重'}`);if(build.finisher.active)active.push(`终局法相·${build.finisher.name}`);if(active.length)frame(undefined,'build','构筑共鸣',0,false,{detail:active.join(' / ')});"
s = replace_once(s, old_active, new_active, 'combat build fate marker')
write(p, s)

# -----------------------------------------------------------------------------
# UI: surface the fate route and mythic event reward before the user commits.
# -----------------------------------------------------------------------------
p = 'src/app.ts'
s = read(p)

s = replace_once(s,
    "<strong>${esc(f.name)}</strong><p>${esc(f.description)}</p></div></div></aside>",
    "<strong>${esc(f.name)}</strong><p>${esc(f.description)}</p>${f.resonanceBias?.length?`<span class=\"fate-route\">命格引路 · ${f.resonanceBias.map(x=>x==='rage'?'怒潮':x==='burn'?'焚劫':x==='guard'?'玄甲':'破阵').join(' / ')}</span>`:''}</div></div></aside>",
    'fate route badge')

old_choice = "<p>${esc(ch.preview??ch.text)}${info.legal?'':' （条件未达成）'}</p>${ch.check?`<span class=\"check-badge\">${esc(this.content.labels.stats[ch.check.stat])}检定 · ${info.chance}%</span>`:''}"
new_choice = "<p>${esc(ch.preview??ch.text)}${info.legal?'':' （条件未达成）'}</p>${ch.grant?.id?`<span class=\"grant-badge ${this.game!.ability(ch.grant.id).rarity==='mythic'?'mythic':''}\">${this.game!.ability(ch.grant.id).rarity==='mythic'?'神话转轴':'获得机缘'} · ${esc(this.game!.ability(ch.grant.id).name)}</span>`:''}${ch.check?`<span class=\"check-badge\">${esc(this.content.labels.stats[ch.check.stat])}检定 · ${info.chance}%</span>`:''}"
s = replace_once(s, old_choice, new_choice, 'event grant preview')

s = s.replace('V9 增加暴击与闪避触发轴，并把部分纯属性件升级为转轴能力。静态机制定位与当前命盘动态角色仍分开计算。',
              'V10 将命格与神话法宝接入转轴体系：命格提供 1 点虚拟共鸣，重大事件会直接展示神话转轴奖励。')
write(p, s)

p = 'src/style.css'
s = read(p)
if '/* Gameplay V10 destiny pivots */' not in s:
    s += r'''

/* Gameplay V10 destiny pivots */
.fate-route{display:inline-flex;margin-top:7px;padding:4px 7px;border:1px solid rgba(184,145,72,.34);background:rgba(187,151,77,.08);font-size:8px;letter-spacing:.7px;line-height:1.4;color:var(--gold,#9c7a38)}
.grant-badge{display:inline-flex;margin-top:7px;padding:5px 8px;border:1px solid rgba(95,126,109,.32);background:rgba(80,118,99,.08);font-size:9px;letter-spacing:.4px;font-weight:700}
.grant-badge.mythic{border-color:rgba(180,137,63,.52);background:linear-gradient(90deg,rgba(193,151,70,.14),rgba(105,73,135,.08));box-shadow:inset 0 0 0 1px rgba(255,244,202,.16)}
.fate-panel:has(.fate-route){box-shadow:inset 0 0 0 1px rgba(182,145,72,.16)}
'''
write(p, s)

# -----------------------------------------------------------------------------
# Tests + design notes.
# -----------------------------------------------------------------------------
p = 'tests/engine.test.mjs'
s = read(p).replace("'2.6.0'", "'2.7.0'")
s += r'''

test('v10 every fate declares a JSON-driven resonance bias',()=>{
 const allowed=new Set(['rage','burn','guard','break']);assert.equal(c.fates.length,8);for(const f of c.fates){assert.equal(f.resonanceBias.length,1);assert(allowed.has(f.resonanceBias[0]));}
});

test('v10 fate bias contributes one virtual resonance count and can change the core route',()=>{
 const g=fresh('V10-FATE-BIAS');g.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},null,null,null,null,null,null];g.s.fate='fate.guard';const guard=buildProfile(c,g.s),guardCount=guard.resonances.find(x=>x.id==='guard').count;g.s.fate='fate.rage';const rage=buildProfile(c,g.s),rageCount=rage.resonances.find(x=>x.id==='rage').count;assert.equal(guardCount,1);assert(rageCount>=3);assert.equal(rage.core,'rage');
});

test('v10 qiankun ring turns rage casts into rage-break momentum',()=>{
 const g=fresh('V10-RING'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:3200,attack:1,defense:0,speed:1,dodge:0};g.s.fate='fate.rage';g.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},null,null,{id:'myth.ring',rank:0},null,null,null];const b=simulateBattle(c,g.s,enemy);assert(b.summary.playerRageSkills>0);assert(b.frames.some(f=>f.e.status.break>=2));assert(b.frames.some(f=>f.p.rage>=10));
});

test('v10 fantian seal opens with guard and converts rage casts into control-break',()=>{
 const g=fresh('V10-SEAL'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:3200,attack:1,defense:0,speed:1,dodge:0};g.s.fate='fate.rage';g.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},null,null,{id:'myth.seal',rank:0},null,null,null];const b=simulateBattle(c,g.s,enemy);assert(b.frames.some(f=>f.p.shield>0));assert(b.summary.playerRageSkills>0);assert(b.frames.some(f=>f.e.status.break>=2));
});

test('v10 sea orbs remain a deterministic burn-guard pivot with rage acceleration',()=>{
 const make=()=>{const g=fresh('V10-ORBS'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:3600,attack:1,defense:0,speed:1,dodge:0};g.s.fate='fate.rage';g.s.slots=[{id:'basic.fire',rank:0},{id:'rage.fire',rank:0},{id:'aux.fire',rank:0},null,{id:'myth.orbs',rank:0},null,null,null];return simulateBattle(c,g.s,enemy);};const a=make(),b=make();assert.deepEqual(a,b);assert(a.frames.some(f=>f.p.shield>=8));assert(a.frames.some(f=>f.e.status.burn>=2));
});

test('v10 major fate choices expose all three mythic pivot rewards',()=>{
 const grants=c.events.filter(e=>e.major).flatMap(e=>e.choices.map(ch=>ch.grant?.id).filter(Boolean));for(const id of ['myth.ring','myth.seal','myth.orbs'])assert(grants.includes(id));for(const id of ['myth.ring','myth.seal','myth.orbs'])assert.equal(c.abilities.find(a=>a.id===id).mechanicRole,'keystone');assert.equal(c.version,'2.7.0');assert.equal(c.rulesVersion,'2.7.0');
});
'''
write(p, s)

write('docs/GAMEPLAY_V10.md', '''# Gameplay V10 — Destiny Pivots\n\nV10 makes fate and major mythic rewards part of the same build language as the eight-slot board.\n\n## Fate as a route signal\n\nEvery fate now declares `resonanceBias` in JSON. A fate contributes one virtual resonance count to exactly one of the four existing schools. It does not consume a slot, but it can make a two-piece route come online sooner and therefore changes reward-role classification from the beginning of a run.\n\nThe eight fates also gain small typed combat hooks so they are no longer passive stat cards only.\n\n## Mythic pivots\n\n- 乾坤圈: rage -> break momentum; hits and rage casts recycle rage while rage casts add break.\n- 番天印: guard -> break/control; opens with defense-scaled shield and rage casts apply stun + break.\n- 定海神珠: burn -> guard; round-end and rage-cast effects generate shield while adding burn.\n\nAll three are authored as `keystone` mechanic-role pieces.\n\n## Major-choice readability\n\nMajor event choices preview mythic rewards before commitment, and the fate panel shows the current destiny route.\n\nContent/rules version: 2.7.0.\n''')

print('Gameplay V10 destiny pivot refactor applied')
