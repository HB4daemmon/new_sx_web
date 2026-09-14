from __future__ import annotations
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
GAME=ROOT/'data/game.json'
TARGET='4.1.0'


def load_json(path:Path):
    return json.loads(path.read_text(encoding='utf-8'))

def dump_json(path:Path,obj):
    path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def by_id(items,id_):
    for x in items:
        if x.get('id')==id_:
            return x
    raise SystemExit(f'missing id: {id_}')

def set_trigger_value(entity,on,effect_type,value,status=None):
    for trigger in entity.get('triggers',[]):
        if trigger.get('on')!=on:
            continue
        for effect in trigger.get('effects',[]):
            if effect.get('type')!=effect_type:
                continue
            if status is not None and effect.get('status')!=status:
                continue
            effect['value']=value
            return
    raise SystemExit(f"missing trigger {entity.get('id')} {on} {effect_type} {status or ''}")

def set_or_add_trigger_effect(entity,on,effect):
    triggers=entity.setdefault('triggers',[])
    trigger=next((t for t in triggers if t.get('on')==on),None)
    if trigger is None:
        trigger={'on':on,'effects':[]}
        triggers.append(trigger)
    effects=trigger.setdefault('effects',[])
    match=next((e for e in effects if e.get('type')==effect.get('type') and e.get('status')==effect.get('status')),None)
    if match is None:
        effects.append(effect)
    else:
        match.clear();match.update(effect)

c=load_json(GAME)
c['version']=TARGET
c['rulesVersion']=TARGET

# 4.1 calibration: keep each origin's authored identity, but prevent a starting kit
# from arriving with a complete late-game loop while other origins still need pieces.
w=by_id(c['origins'],'wanderer')
w['stats']['hp']=110
w['battleStartEffects']=[{'type':'gain_rage','target':'self','value':60}]
w['description']='均衡出身。生命略厚，引雷回气；入战额外吐纳 60 怒气，更快接上第一轮雷法。'

war=by_id(c['origins'],'warrior')
war['stats'].update({'hp':104,'attack':19,'defense':11,'luck':7})
# Keep fist + guard as the identity. The third piece is neutral rage support, so
# both persistent shield amplification and the counter payoff must be assembled.
war['starting']=['basic.fist','rage.guard','aux.qi']
war['description']='生命 +4，攻击 -1，防御 +1，气运 -3。拳与玄甲仍是根骨，但护盾增幅和反震收益都需在旅途中补齐。'

phys=by_id(c['origins'],'physician')
phys['stats'].update({'hp':112,'attack':20,'dodge':13})
phys['battleStartEffects']=[{'type':'gain_shield','target':'self','value':8,'stat':'defense','coefficient':0}]
phys['description']='以疗愈养战。生命 112、攻击 20、闪避 13；入战先得 8 护盾，让回春循环有时间启动。'

hexer=by_id(c['origins'],'hexer')
hexer['stats'].update({'hp':104,'attack':21})
hexer['battleStartEffects']=[{'type':'apply_status','status':'weak','target':'enemy','value':2}]
hexer['description']='以咒厄削敌。生命 104、攻击 21；开战先落 2 层虚弱，再由缚魂诀与厄印扩大破绽。'

# Race pass: dragon loses unconditional floor. Ling gets a small battle-start guard
# because the first matrix showed its evade engine could die before triggering.
dragon=by_id(c['races'],'dragon')
dragon['stats'].update({'hp':2,'speed':-1})
set_trigger_value(dragon,'battle_start','gain_shield',2)
dragon['description']='鳞甲未褪，潮声在血。生命 +2，速度 -1；入战获得 2 护盾，强处更多留给潮汐构筑本身。'

spirit=by_id(c['races'],'spirit')
spirit['stats'].update({'hp':0,'dodge':4})
set_trigger_value(spirit,'battle_start','apply_status',2,'burn')
spirit['description']='草木禽兽得道。闪避 +4；入战为敌人施加 2 层燃烧。'

ling=by_id(c['races'],'ling')
ling['stats'].update({'hp':0,'dodge':9})
set_trigger_value(ling,'on_evade','gain_rage',20)
set_or_add_trigger_effect(ling,'battle_start',{'type':'gain_shield','target':'self','value':4})
ling['description']='一缕灵气凝身。闪避 +9；入战获得 4 护盾，每战首次闪避后获得 20 怒气。'

dump_json(GAME,c)

# Package metadata.
for name in ['package.json','package-lock.json']:
    path=ROOT/name
    if not path.exists():
        continue
    obj=load_json(path)
    obj['version']=TARGET
    if name=='package-lock.json' and isinstance(obj.get('packages'),dict) and '' in obj['packages']:
        obj['packages']['']['version']=TARGET
    dump_json(path,obj)

# Save-key isolation: keep 4.0 and older data exportable instead of repeatedly
# attempting to auto-load it into the new deterministic rules.
app_path=ROOT/'src/app.ts'
app=app_path.read_text(encoding='utf-8')
app=app.replace("const SAVE_KEY='fengshen-run-v4';\nconst LEGACY_SAVE_KEY='fengshen-run-v1';",
                "const SAVE_KEY='fengshen-run-v41';\nconst LEGACY_SAVE_KEY='fengshen-run-v4';\nconst LEGACY_OLD_SAVE_KEY='fengshen-run-v1';")
app=app.replace("this.legacySave=localStorage.getItem(LEGACY_SAVE_KEY)??'';",
                "this.legacySave=localStorage.getItem(LEGACY_SAVE_KEY)??localStorage.getItem(LEGACY_OLD_SAVE_KEY)??'';")
app=app.replace("a.download='fengshen-legacy-3.0-save.json';","a.download='fengshen-legacy-save.json';")
app_path.write_text(app,encoding='utf-8')

# Keep compatibility assertions aligned with the intentionally new save namespace
# and the calibrated ancestry baseline. Handle both 4.0 and first-pass 4.1 inputs.
test_path=ROOT/'tests/ancestry.test.mjs'
t=test_path.read_text(encoding='utf-8')
t=t.replace("assert(app.includes(\"SAVE_KEY='fengshen-run-v4'\"));assert(app.includes(\"LEGACY_SAVE_KEY='fengshen-run-v1'\"));",
            "assert(app.includes(\"SAVE_KEY='fengshen-run-v41'\"));assert(app.includes(\"LEGACY_SAVE_KEY='fengshen-run-v4'\"));assert(app.includes(\"LEGACY_OLD_SAVE_KEY='fengshen-run-v1'\"));")
t=t.replace("assert.equal(dragon.stats().hp-human.stats().hp,8);","assert.equal(dragon.stats().hp-human.stats().hp,2);")
t=t.replace("assert.equal(dragon.stats().hp-human.stats().hp,4);","assert.equal(dragon.stats().hp-human.stats().hp,2);")
test_path.write_text(t,encoding='utf-8')

# Engine regression contracts that intentionally pin the tuned 4.1 origin values.
engine_test=ROOT/'tests/engine.test.mjs'
et=engine_test.read_text(encoding='utf-8')
et=et.replace("assert.equal(w.battleStartEffects[0].value,25);","assert.equal(w.battleStartEffects[0].value,60);")
et=et.replace("assert.equal(w.battleStartEffects[0].value,32);","assert.equal(w.battleStartEffects[0].value,60);")
et=et.replace("assert.equal(w.stats.hp,112);assert.equal(w.stats.attack,22);assert.equal(w.stats.defense,12);",
              "assert.equal(w.stats.hp,104);assert.equal(w.stats.attack,19);assert.equal(w.stats.defense,11);")
et=et.replace("assert.equal(w.stats.hp,106);assert.equal(w.stats.attack,20);assert.equal(w.stats.defense,11);",
              "assert.equal(w.stats.hp,104);assert.equal(w.stats.attack,19);assert.equal(w.stats.defense,11);")
et=et.replace("assert(w.starting.includes('aux.stone'));assert(!w.starting.includes('aux.counter'));",
              "assert(w.starting.includes('aux.qi'));assert(!w.starting.includes('aux.stone'));assert(!w.starting.includes('aux.counter'));")
needle="const w=c.origins.find(o=>o.id==='warrior'),guard=c.abilities.find(a=>a.id==='rage.guard');assert.equal(w.stats.hp,104);assert.equal(w.stats.attack,19);assert.equal(w.stats.defense,11);"
if needle in et and "assert(w.starting.includes('aux.qi'))" not in et:
    et=et.replace(needle,needle+"assert(w.starting.includes('aux.qi'));assert(!w.starting.includes('aux.stone'));assert(!w.starting.includes('aux.counter'));")
engine_test.write_text(et,encoding='utf-8')

# Version literals in deterministic rule tests represent the current pack unless
# explicitly checking the old 3.0 rejection path.
for path in (ROOT/'tests').glob('*.mjs'):
    text=path.read_text(encoding='utf-8')
    text=text.replace("'4.0.0'","'4.1.0'").replace('"4.0.0"','"4.1.0"')
    path.write_text(text,encoding='utf-8')

readme=ROOT/'README.md'
text=readme.read_text(encoding='utf-8')
text=text.replace('玩法与内容 **4.0.0**，界面修订 **16.0**。','玩法与内容 **4.1.0**，界面修订 **16.0**。')
text=text.replace('**3.0.0 存档无法导入 4.0.0，需重新开局**','**4.0.0 及更早存档无法直接导入 4.1.0，需重新开局；旧档仍可从静室导出备份**')
if '## 4.1 平衡校准' not in text:
    text += '\n## 4.1 平衡校准\n\n基于四族 × 五出身的 500 局确定性矩阵做校准。天赋、事件、八槽与敌人共享技能不改结构。\n'
if '武者不再开局直接拥有完整的反震闭环' not in text:
    text += '\n第二次校准针对开局循环：武者不再开局直接拥有完整的反震闭环；散修更快启动怒气技；药师与咒徒获得各自主题的开战缓冲；龙裔降低无条件底盘，灵族获得最低限度的起手容错。\n'
if '武者第三件起手改为吐纳' not in text:
    text += '\n最终收口继续只削武者的无条件优势：武者第三件起手改为吐纳，保留拳与玄甲，但磐石增幅和反震终结都必须在本局中主动补齐。\n'
readme.write_text(text,encoding='utf-8')

doc=ROOT/'docs/ANCESTRY_TALENTS.md'
text=doc.read_text(encoding='utf-8')
text=text.replace('本轮规则 4.0.0，界面 16.0。','本轮规则 4.1.0，界面 16.0。')
if '## 阶段六：4.1 平衡校准' not in text:
    text += '\n## 阶段六：4.1 平衡校准\n- 先跑四族 × 五出身 × 25 种子的 500 局矩阵，不再只验证默认人族。\n- 初始基线暴露行伍武者 94% 胜率、山野散修 23%，以及龙裔 68% 对灵族 43.2% 的明显落差。\n- 4.1 使用独立存档键，4.0 与更早存档保留为可导出备份，避免旧行动日志在新数值下失去确定性。\n'
if '第二次矩阵校准' not in text:
    text += '- 第二次矩阵校准不改共享技能：武者先去除反震起手；散修提高起始怒气；药师获得起手护盾；咒徒起手施加虚弱；龙裔削减无条件生命/护盾；灵族增加起手护盾与闪避。\n'
text=text.replace('武者改为玄甲起手、反震需后续补齐','武者先去除反震起手')
if '最终收口' not in text:
    text += '- 最终收口：武者辅位从磐石改为吐纳，同时轻降生命/攻击；拳与玄甲身份保留，但完整盾辅/反震循环必须由本局奖励构筑出来。\n'
doc.write_text(text,encoding='utf-8')

print('Applied semantic 4.1 balance tuning final pass')
print(json.dumps({
    'wanderer':{'stats':w['stats'],'starting':w['starting'],'battleStartEffects':w.get('battleStartEffects',[])},
    'warrior':{'stats':war['stats'],'starting':war['starting']},
    'physician':{'stats':phys['stats'],'battleStartEffects':phys.get('battleStartEffects',[])},
    'hexer':{'stats':hexer['stats'],'battleStartEffects':hexer.get('battleStartEffects',[])},
    'dragon':dragon['stats'],
    'spirit':spirit['stats'],
    'ling':ling['stats'],
},ensure_ascii=False,indent=2))
