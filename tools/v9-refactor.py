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

# --- Content: turn passive stat sticks into route-changing pieces. ---
p = 'scripts/create-content.py'
s = read(p)

s = replace_ability(s, 'aux.wind', "ability('aux.wind','御风','aux','rage counter','cloud','速度 +2 / +3 / +4 / +5，闪避 +4。成功闪避后获得 18 / 22 / 26 / 32 怒气。',stats={'speed':[2,3,4,5],'dodge':4},triggers=[trig('on_evade',[rage([18,22,26,32])])])")
s = replace_ability(s, 'art.jade', "ability('art.jade','清心玉','artifact','shield','jade','最大生命 +8 / +12 / +16 / +20。入战清除虚弱；胜利时若仍有至少 12 护盾，炼化 12 护盾并恢复 6 / 8 / 10 / 13 生命。',stats={'hp':[8,12,16,20]},triggers=[trig('battle_start',[dict(type='remove_status',target='self',status='weak')]),trig('battle_end',[dict(type='consume_shield',target='self',value=12),dict(type='heal',target='self',value=[6,8,10,13])],conditions=[cond('status_stack_at_least',status='shield',target='self',value=12)])])")
s = replace_ability(s, 'art.sword', "ability('art.sword','七星剑','artifact','break sword burst','sword','攻击 +3 / +4 / +5 / +6，气运 +3。暴击时施加 2 层破甲，并追加 60% / 80% / 100% / 130% 攻击伤害。',stats={'attack':[3,4,5,6],'luck':3},triggers=[trig('on_crit',[status('break',2),dmg([60,80,100,130])])],rarity='rare')")
s = replace_ability(s, 'art.feather', "ability('art.feather','追风羽','artifact','rage counter','feather','速度 +3 / +4 / +5 / +6，闪避 +2。成功闪避后以速度 110% / 135% / 160% / 200% 反击，并获得 8 怒气。',stats={'speed':[3,4,5,6],'dodge':2},triggers=[trig('on_evade',[dmg([110,135,160,200],stat='speed'),rage(8)])],rarity='rare')")
s = replace_ability(s, 'art.coin', "ability('art.coin','通宝钱','artifact','rage shield burst','coin','气运 +4 / +6 / +8 / +10。暴击时获得 10 / 13 / 16 / 20 怒气，并获得 4 / 5 / 6 / 8 护盾。',stats={'luck':[4,6,8,10]},triggers=[trig('on_crit',[rage([10,13,16,20]),shield([4,5,6,8])])],rarity='rare')")

# Small origin-only correction: do not nerf shared guard skills or enemy kits.
warrior_old = "dict(id='warrior',name='\\u4eba\\u95f4\\u6b66\\u8005',subtitle='\\u8089\\u8eab\\u4e3a\\u76fe\\uff0c\\u51e1\\u9aa8\\u64bc\\u5929',art='guardian',description='\\u751f\\u547d +15\\uff0c\\u653b\\u51fb +3\\uff0c\\u9632\\u5fa1 +2\\uff0c\\u6c14\\u8fd0 -3\\u3002\\u62a4\\u76fe\\u53cd\\u51fb\\u3002',stats={**base,'hp':115,'attack':23,'defense':12,'luck':7},affinity='shield',starting=['basic.fist','rage.guard','aux.counter'])"
warrior_new = "dict(id='warrior',name='\\u4eba\\u95f4\\u6b66\\u8005',subtitle='\\u8089\\u8eab\\u4e3a\\u76fe\\uff0c\\u51e1\\u9aa8\\u64bc\\u5929',art='guardian',description='生命 +12，攻击 +2，防御 +2，气运 -3。护盾反击。',stats={**base,'hp':112,'attack':22,'defense':12,'luck':7},affinity='shield',starting=['basic.fist','rage.guard','aux.counter'])"
s = replace_once(s, warrior_old, warrior_new, 'warrior origin calibration')

roles = """MECHANIC_GROUPS={
 'starter':['basic.sword'],
 'generator':['basic.fist','basic.fire','basic.thunder','basic.break','rage.fire','rage.guard','aux.qi','aux.river','aux.stone','art.mirror','art.flag','art.bracer','art.lamp','art.needle','strategy.mountain'],
 'converter':['aux.ash','art.jade','strategy.guard','strategy.fire','strategy.hunt'],
 'amplifier':['aux.fire','aux.guard','aux.counter','aux.sight','art.pearl','art.bell','art.gourd'],
 'bridge':['basic.tide','myth.orbs'],
 'keystone':['rage.thunder','aux.wind','art.sword','art.feather','art.coin','myth.ring','myth.seal','strategy.rage'],
 'risk':['rage.army','aux.last','strategy.last'],
 'payoff':['rage.lotus','rage.sky'],
}"""
s, n = re.subn(r"MECHANIC_GROUPS=\{.*?\n\}", roles, s, count=1, flags=re.S)
if n != 1:
    raise SystemExit('MECHANIC_GROUPS block not found')

s = s.replace("'2.5.0'", "'2.6.0'")
write(p, s)

# --- Engine: two reusable typed trigger points for crit and evade builds. ---
p = 'src/engine.ts'
s = read(p)
s = replace_once(s,
    "export const TRIGGER_TYPES=['battle_start','before_action','after_action','on_hit','on_damaged','on_rage_skill','hp_threshold','round_end','battle_end'];",
    "export const TRIGGER_TYPES=['battle_start','before_action','after_action','on_hit','on_crit','on_evade','on_damaged','on_rage_skill','hp_threshold','round_end','battle_end'];",
    'trigger types')
s = replace_once(s,
    "frame(a,'miss',label,0,false,{sourceId,detail:`命中率 ${(hit/100).toFixed(1)}%`});return false;",
    "frame(a,'miss',label,0,false,{sourceId,detail:`命中率 ${(hit/100).toFixed(1)}%`});if(t.hp>0)trigger(t,a,'on_evade');return false;",
    'evade trigger point')
s = replace_once(s,
    "hurt(a,t,afterCrit,label,crit,breakdown,sourceId);return true;",
    "hurt(a,t,afterCrit,label,crit,breakdown,sourceId);if(crit&&a.hp>0)trigger(a,t,'on_crit');return true;",
    'crit trigger point')
write(p, s)

# --- UI: make build-changing pieces visually explicit without adding tutorial noise. ---
p = 'src/app.ts'
s = read(p)
s = replace_once(s,
    "ability-card ${tone(a)} slot-${a.slot} rarity-${a.rarity}",
    "ability-card ${tone(a)} slot-${a.slot} rarity-${a.rarity} mechanic-${a.mechanicRole??'amplifier'}",
    'ability card mechanic class')
s = replace_once(s,
    "<p class=\"card-description\">${esc(text)}</p>${converter?`<div class=\"converter-note\"><b>资源炼化</b><span>主动消耗积累，换取即时收益</span></div>`:''}",
    "<p class=\"card-description\">${esc(text)}</p>${a.mechanicRole==='keystone'?`<div class=\"keystone-note\"><b>转轴件</b><span>可围绕它重组本局的资源循环</span></div>`:''}${converter?`<div class=\"converter-note\"><b>资源炼化</b><span>主动消耗积累，换取即时收益</span></div>`:''}",
    'keystone card note')
s = s.replace('V8 为 43 项能力补齐机制定位：产能、炼化、放大、桥接、核心、险招与终结。卡牌底部显示静态定位，上方仍显示当前命盘中的动态角色。',
              'V9 增加暴击与闪避触发轴，并把部分纯属性件升级为转轴能力。静态机制定位与当前命盘动态角色仍分开计算。')
write(p, s)

p = 'src/style.css'
s = read(p)
if '/* Gameplay V9 keystone identity */' not in s:
    s += r'''

/* Gameplay V9 keystone identity */
.ability-card.mechanic-keystone{position:relative;box-shadow:0 0 0 1px rgba(205,173,96,.55),0 10px 28px rgba(41,31,18,.16)}
.ability-card.mechanic-keystone:before{content:'KEYSTONE';position:absolute;right:12px;top:44px;font-size:7px;letter-spacing:1.8px;font-weight:800;opacity:.66}
.keystone-note{margin:8px 0 2px;padding:7px 9px;border:1px solid rgba(194,151,67,.38);background:linear-gradient(90deg,rgba(208,174,93,.12),rgba(255,255,255,.03));display:flex;gap:8px;align-items:baseline;text-align:left}
.keystone-note b{font-size:9px;letter-spacing:1px;white-space:nowrap}
.keystone-note span{font-size:9px;line-height:1.55;opacity:.76}
.ability-card.mechanic-converter .converter-note{border-style:dashed}
'''
write(p, s)

# --- Tests and docs. ---
p = 'tests/engine.test.mjs'
s = read(p).replace("'2.5.0'", "'2.6.0'")
s += r'''

test('v9 selected stat sticks become authored build-changing pieces',()=>{
 const roles=Object.fromEntries(c.abilities.map(a=>[a.id,a.mechanicRole]));
 for(const id of ['aux.wind','art.sword','art.feather','art.coin'])assert.equal(roles[id],'keystone');
 assert.equal(roles['art.jade'],'converter');
 assert(c.abilities.filter(a=>a.mechanicRole==='keystone').length>=8);
});

test('v9 crit trigger drives seven-star sword without recursive critical chains',()=>{
 let found=false;
 for(let i=0;i<12&&!found;i++){
  const g=fresh('V9-CRIT-'+i),enemy=structuredClone(c.enemies[0]);
  enemy.stats={...enemy.stats,hp:2600,attack:1,defense:0,speed:1,dodge:0};
  g.s.bonus.luck=10000;
  g.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},{id:'aux.qi',rank:0},null,{id:'art.sword',rank:0},null,null,null];
  const b=simulateBattle(c,g.s,enemy),hits=b.frames.filter(f=>f.kind==='damage'&&f.sourceId==='art.sword');
  if(hits.length){found=true;assert(hits.every(f=>!f.crit));assert(b.frames.some(f=>f.e.status.break>0));}
 }
 assert(found);
});

test('v9 evade trigger makes wind pieces a deterministic counter engine',()=>{
 const make=()=>{const g=fresh('V9-EVADE'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:4200,attack:2,defense:0,speed:30,hit:0,dodge:0};g.s.bonus.dodge=10000;g.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},{id:'aux.wind',rank:0},null,{id:'art.feather',rank:0},null,null,null];return simulateBattle(c,g.s,enemy);};
 const a=make(),b=make();assert.deepEqual(a,b);assert(a.frames.some(f=>f.kind==='miss'&&f.actor==='e'));assert(a.frames.some(f=>f.kind==='damage'&&f.sourceId==='art.feather'));assert(a.frames.some(f=>f.p.rage>0));
});

test('v9 clear-heart jade converts leftover guard into persistent healing',()=>{
 const g=fresh('V9-JADE'),enemy=structuredClone(c.enemies[0]);enemy.stats={...enemy.stats,hp:1,attack:0,defense:0,speed:1,dodge:0};g.s.hp=35;g.s.slots=[{id:'basic.sword',rank:0},{id:'rage.thunder',rank:0},{id:'aux.stone',rank:0},null,{id:'art.jade',rank:0},{id:'art.mirror',rank:0},null,null];const b=simulateBattle(c,g.s,enemy);assert(b.won);assert(b.hp>35);assert(b.frames.some(f=>f.kind==='convert'&&f.sourceId==='art.jade'));
});

test('v9 warrior correction is origin-only and keeps shared guard skills intact',()=>{
 const w=c.origins.find(o=>o.id==='warrior'),guard=c.abilities.find(a=>a.id==='rage.guard');assert.equal(w.stats.hp,112);assert.equal(w.stats.attack,22);assert.equal(w.stats.defense,12);assert(guard.effects.some(e=>e.type==='gain_shield'&&e.coefficient));assert.equal(c.version,'2.6.0');assert.equal(c.rulesVersion,'2.6.0');
});
'''
write(p, s)

write('docs/GAMEPLAY_V9.md', '''# Gameplay V9 — Keystone Routes\n\nV9 turns several passive stat pieces into build-changing choices without adding a fifth primary school.\n\n- `on_crit` and `on_evade` are deterministic typed trigger points shared by player and enemies.\n- 七星剑 turns critical hits into break pressure and a deterministic follow-up.\n- 通宝钱 turns critical hits into rage + shield, bridging offensive luck into resource engines.\n- 御风 and 追风羽 create an evasive counter route: evade -> rage / speed counter.\n- 清心玉 converts leftover shield after a victory into persistent healing, connecting guard combat power to run attrition.\n- Warrior correction is isolated to origin stats; shared guard abilities and enemy kits are unchanged.\n- Content/rules version: 2.6.0.\n''')

print('Gameplay V9 keystone refactor applied')
