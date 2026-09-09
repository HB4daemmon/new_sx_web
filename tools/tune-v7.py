from pathlib import Path
import re
import sys

root=Path(sys.argv[1] if len(sys.argv)>1 else '.')
gen_path=root/'scripts/create-content.py'
policy_path=root/'tests/policy.mjs'
sim_path=root/'tests/simulate.mjs'
doc_path=root/'docs/GAMEPLAY_V7.md'


def replace_line(text,key,new_line):
    pattern=re.compile(rf"(?m)^ability\('{re.escape(key)}'.*$")
    ms=list(pattern.finditer(text))
    if len(ms)!=1: raise RuntimeError(f'{key}: expected one line, got {len(ms)}')
    m=ms[0]
    return text[:m.start()]+new_line.rstrip()+text[m.end():]


gen=gen_path.read_text(encoding='utf-8')
# Undo the global sword buff: improving Wanderer should not also increase one third of early enemy basic attacks.
gen=replace_line(gen,'basic.sword',"ability('basic.sword','青锋诀','basic','burst sword','sword','造成 {0}% 攻击伤害。',[dmg([110,125,140,160])])")
# Burn harvesting should leave a live DoT engine behind rather than repeatedly stripping it to the floor.
gen=replace_line(gen,'aux.ash',"ability('aux.ash','焚心','aux','fire burn rage','flame','回合结束，敌方燃烧≥5：炼化 1 层燃烧，获得 12 / 16 / 20 / 25 怒气，并造成 35% / 45% / 55% / 70% 攻击纯伤害。',triggers=[trig('round_end',[dict(type='consume_status',target='enemy',status='burn',value=1),rage([12,16,20,25]),dmg([35,45,55,70],pure=True)],conditions=[cond('status_stack_at_least',status='burn',target='enemy',value=5)])])")
gen=replace_line(gen,'strategy.fire',"ability('strategy.fire','燎原','strategy','fire burn','flame','命中且敌方燃烧≥6：炼化 2 层燃烧，追加 100% / 125% / 150% / 185% 攻击纯伤害；保留余火继续结算。',triggers=[trig('on_hit',[dict(type='consume_status',target='enemy',status='burn',value=2),dmg([100,125,150,185],pure=True)],conditions=[cond('status_stack_at_least',status='burn',target='enemy',value=6)])],rarity='rare')")
old="starting=['basic.sword','rage.thunder','aux.qi']"
new="starting=['basic.thunder','rage.thunder','aux.qi']"
if gen.count(old)!=1: raise RuntimeError(f'wanderer starting kit marker: {gen.count(old)}')
gen=gen.replace(old,new,1)
gen_path.write_text(gen,encoding='utf-8')

policy=policy_path.read_text(encoding='utf-8')
score_pattern=re.compile(r"(?m)^export function score\(g,id,rank=0\)\{.*$")
ms=list(score_pattern.finditer(policy))
if len(ms)!=1: raise RuntimeError(f'policy score line: {len(ms)}')
new_score="export function score(g,id,rank=0){const a=g.ability(id),aff=g.c.origins.find(o=>o.id===g.s.origin).affinity,role=g.role(id),effects=[...(a.effects??[]),...(a.triggers??[]).flatMap(t=>t.effects??[])],converter=effects.some(e=>e.type==='consume_status'||e.type==='consume_shield'),roleScore=role?.role==='bridge'?8:role?.role==='core'?7:role?.role==='amplifier'?5:role?.role==='starter'?3:role?.role==='finisher'?4:0,coreTag=({rage:'rage',burn:'burn',guard:'shield',break:'break'}[g.build().core]??''),engineScore=converter&&a.tags.includes(coreTag)?5:converter?2:0;return (a.tags.includes(aff)?10:0)+(a.rarity==='mythic'?18:a.rarity==='rare'?3:0)+roleScore+engineScore+rank*4+Object.values(a.stats).reduce((sum,v)=>sum+(Array.isArray(v)?v[rank]:v)*.35,0); }"
m=ms[0]
policy=policy[:m.start()]+new_score+policy[m.end():]
policy_path.write_text(policy,encoding='utf-8')
sim=sim_path.read_text(encoding='utf-8')
sim=sim.replace("policy:'Greedy build synergy and HP-aware route; no stat cheats or resets'","policy:'Contextual build roles, resource-engine synergy and HP-aware route; no stat cheats or resets'")
sim_path.write_text(sim,encoding='utf-8')

with doc_path.open('a',encoding='utf-8') as f:
    f.write('''\n## Balance calibration\n\n- Wanderer now starts with `引雷咒` rather than `青锋诀`, so its opening kit forms a coherent Rage generator → Rage skill loop without buffing generic sword enemies.\n- Burn harvesters consume fewer stacks and deliberately leave residual Burn for DoT ticks.\n- The automated simulation policy now understands contextual roles and converter pieces instead of judging rewards only by tags/rarity/stats.\n''')

print('Gameplay V7 balance calibration applied')
