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

c=load_json(GAME)
c['version']=TARGET
c['rulesVersion']=TARGET

# Origin pass: reduce the near-universal guard/counter dominance while giving the
# three fragile starts enough runway to reach their authored loops.
w=by_id(c['origins'],'wanderer')
w['stats']['hp']=104
for effect in w.get('battleStartEffects',[]):
    if effect.get('type')=='gain_rage':
        effect['value']=32
w['description']='均衡出身。生命略厚，引雷回气；入战额外吐纳 32 怒气。'

war=by_id(c['origins'],'warrior')
war['stats'].update({'hp':106,'attack':20,'defense':11,'luck':8})
war['description']='生命 +6，防御 +1，气运 -2。以护盾与反击换取稳定推进。'

phys=by_id(c['origins'],'physician')
phys['stats'].update({'hp':108,'attack':19,'dodge':13})
phys['description']='以疗愈养战。生命 108、攻击 19、闪避 13；回春与胎息维持气血，青莲渡厄积蓄反攻。'

hexer=by_id(c['origins'],'hexer')
hexer['stats'].update({'hp':100,'attack':20})
hexer['description']='以咒厄削敌。生命 100、攻击 20；缚魂诀与厄印积累虚弱，百厄缠身打开破绽。'

# Ancestry pass: dragon loses some unconditional floor; spirit/ling gain early
# survivability so their conditional engines have time to come online.
dragon=by_id(c['races'],'dragon')
dragon['stats'].update({'hp':4,'speed':-1})
set_trigger_value(dragon,'battle_start','gain_shield',4)
dragon['description']='鳞甲未褪，潮声在血。生命 +4，速度 -1；入战获得 4 护盾。'

spirit=by_id(c['races'],'spirit')
spirit['stats'].update({'hp':0,'dodge':4})
set_trigger_value(spirit,'battle_start','apply_status',2,'burn')
spirit['description']='草木禽兽得道。闪避 +4；入战为敌人施加 2 层燃烧。'

ling=by_id(c['races'],'ling')
ling['stats'].update({'hp':-2,'dodge':8})
set_trigger_value(ling,'on_evade','gain_rage',18)
ling['description']='一缕灵气凝身。生命 -2，闪避 +8；每战首次闪避后获得 18 怒气。'

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

# Keep compatibility assertions aligned with the intentionally new save namespace.
test_path=ROOT/'tests/ancestry.test.mjs'
t=test_path.read_text(encoding='utf-8')
t=t.replace("assert(app.includes(\"SAVE_KEY='fengshen-run-v4'\"));assert(app.includes(\"LEGACY_SAVE_KEY='fengshen-run-v1'\"));",
            "assert(app.includes(\"SAVE_KEY='fengshen-run-v41'\"));assert(app.includes(\"LEGACY_SAVE_KEY='fengshen-run-v4'\"));assert(app.includes(\"LEGACY_OLD_SAVE_KEY='fengshen-run-v1'\"));")
test_path.write_text(t,encoding='utf-8')

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
    text += '\n## 4.1 平衡校准\n\n基于四族 × 五出身的 500 局确定性矩阵做首轮校准：削弱行伍武者与龙裔的无条件生存底盘，补强山野散修、行脚药师、旧观咒徒以及精怪/灵族的前期容错。天赋、事件、八槽与敌人共享技能不改结构。\n'
readme.write_text(text,encoding='utf-8')

doc=ROOT/'docs/ANCESTRY_TALENTS.md'
text=doc.read_text(encoding='utf-8')
text=text.replace('本轮规则 4.0.0，界面 16.0。','本轮规则 4.1.0，界面 16.0。')
if '## 阶段六：4.1 平衡校准' not in text:
    text += '\n## 阶段六：4.1 平衡校准\n- 先跑四族 × 五出身 × 25 种子的 500 局矩阵，不再只验证默认人族。\n- 初始基线暴露行伍武者 94% 胜率、山野散修 23%，以及龙裔 68% 对灵族 43.2% 的明显落差。\n- 本轮只调整出身/族裔底盘与被动数值，不改敌人、技能池、事件奖励、路线结构和天赋树形状。\n- 4.1 使用独立存档键，4.0 与更早存档保留为可导出备份，避免旧行动日志在新数值下失去确定性。\n'
doc.write_text(text,encoding='utf-8')

print('Applied semantic 4.1 balance tuning')
print(json.dumps({
    'wanderer':w['stats'],
    'warrior':war['stats'],
    'physician':phys['stats'],
    'hexer':hexer['stats'],
    'dragon':dragon['stats'],
    'spirit':spirit['stats'],
    'ling':ling['stats'],
},ensure_ascii=False,indent=2))
