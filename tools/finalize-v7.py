from pathlib import Path
import re
import sys

root=Path(sys.argv[1] if len(sys.argv)>1 else '.')
engine_path=root/'src/engine.ts'
gen_path=root/'scripts/create-content.py'
policy_path=root/'tests/policy.mjs'
sim_path=root/'tests/simulate.mjs'
test_path=root/'tests/engine.test.mjs'
doc_path=root/'docs/GAMEPLAY_V7.md'


def replace_once(text,old,new,label):
    n=text.count(old)
    if n!=1: raise RuntimeError(f'{label}: expected one match, got {n}')
    return text.replace(old,new,1)

engine=engine_path.read_text(encoding='utf-8')
engine=replace_once(
    engine,
    "export interface Origin { id:string; name:string; subtitle:string; description:string; art:string; stats:Stats; affinity:string; starting:string[]; }",
    "export interface Origin { id:string; name:string; subtitle:string; description:string; art:string; stats:Stats; affinity:string; starting:string[]; battleStartEffects?:Effect[]; }",
    'origin battle effects type',
)
engine=replace_once(
    engine,
    "trigger(p,e,'battle_start');trigger(e,p,'battle_start');frame(undefined,'ready','命格与法宝已生效');",
    "const origin=c.origins.find(o=>o.id===s.origin);if(origin?.battleStartEffects?.length){for(const ef of origin.battleStartEffects)apply(p,e,ef,0,origin.name,false,`origin.${origin.id}`);frame(undefined,'origin',`出身 · ${origin.name}`,0,false,{sourceId:`origin.${origin.id}`,detail:origin.description});}trigger(p,e,'battle_start');trigger(e,p,'battle_start');frame(undefined,'ready','命格与法宝已生效');",
    'origin battle start application',
)
engine_path.write_text(engine,encoding='utf-8')

gen=gen_path.read_text(encoding='utf-8')
# Restore the intended sword opener, but compensate only the player origin through JSON-configured origin effects.
gen=replace_once(gen,"description='\\u5747\\u8861\\u51fa\\u8eab\\u3002\\u6012\\u6c14\\u7206\\u53d1\\uff0c\\u63a8\\u8350\\u521d\\u5165\\u6b64\\u52ab\\u8005\\u3002',stats=base,affinity='rage',starting=['basic.thunder','rage.thunder','aux.qi'])","description='均衡出身。怒气爆发。入战额外吐纳 15 怒气。',stats=base,affinity='rage',starting=['basic.sword','rage.thunder','aux.qi'],battleStartEffects=[rage(15)])",'wanderer origin perk')
gen=replace_once(gen,"description='\\u751f\\u547d -10\\uff0c\\u901f\\u5ea6 +2\\uff0c\\u547d\\u4e2d +2\\uff0c\\u6c14\\u8fd0 +5\\u3002\\u71c3\\u70e7\\u53e0\\u5c42\\u3002',stats={**base,'hp':90,'speed':12,'hit':12,'luck':15},affinity='burn',starting=['basic.fire','rage.fire','aux.fire'])","description='生命 -10，速度 +2，命中 +2，气运 +5。燃烧叠层；入战获得 8 护盾。',stats={**base,'hp':90,'speed':12,'hit':12,'luck':15},affinity='burn',starting=['basic.fire','rage.fire','aux.fire'],battleStartEffects=[shield(8)])",'alchemist origin perk')
gen_path.write_text(gen,encoding='utf-8')

# Return the evaluator to the stable pre-calibration policy. Balance changes must come from production rules, not a new bot personality.
policy=policy_path.read_text(encoding='utf-8')
score_pattern=re.compile(r"(?m)^export function score\(g,id,rank=0\)\{.*$")
ms=list(score_pattern.finditer(policy))
if len(ms)!=1: raise RuntimeError(f'policy score line: {len(ms)}')
old_score="export function score(g,id,rank=0){const a=g.ability(id),aff=g.c.origins.find(o=>o.id===g.s.origin).affinity;return (a.tags.includes(aff)?10:0)+(a.rarity==='mythic'?18:a.rarity==='rare'?3:0)+rank*4+Object.values(a.stats).reduce((sum,v)=>sum+(Array.isArray(v)?v[rank]:v)*.35,0); }"
m=ms[0]
policy=policy[:m.start()]+old_score+policy[m.end():]
policy_path.write_text(policy,encoding='utf-8')
sim=sim_path.read_text(encoding='utf-8')
sim=sim.replace("policy:'Contextual build roles, resource-engine synergy and HP-aware route; no stat cheats or resets'","policy:'Greedy build synergy and HP-aware route; no stat cheats or resets'")
sim_path.write_text(sim,encoding='utf-8')

tests=test_path.read_text(encoding='utf-8')
marker="test('v7 origin battle perks are JSON configured and deterministic'"
if marker in tests: raise RuntimeError('origin perk test already present')
tests += r'''

test('v7 origin battle perks are JSON configured and deterministic',()=>{const w=c.origins.find(o=>o.id==='wanderer'),a=c.origins.find(o=>o.id==='alchemist');assert.equal(w.battleStartEffects[0].type,'gain_rage');assert.equal(w.battleStartEffects[0].value,15);assert.equal(a.battleStartEffects[0].type,'gain_shield');assert.equal(a.battleStartEffects[0].value,8);const g1=fresh('V7-ORIGIN-PERK'),g2=fresh('V7-ORIGIN-PERK'),b1=simulateBattle(c,g1.s,structuredClone(c.enemies[0])),b2=simulateBattle(c,g2.s,structuredClone(c.enemies[0])),f=b1.frames.find(x=>x.sourceId==='origin.wanderer');assert.deepEqual(b1,b2);assert(f);assert(f.p.rage>=15);});
'''
test_path.write_text(tests,encoding='utf-8')

with doc_path.open('a',encoding='utf-8') as f:
    f.write('''\n## Origin battle talents\n\nV7 keeps origin base stats unchanged, but adds optional JSON-configured `battleStartEffects` for targeted early-game identity and balance. Wanderer gains 15 Rage at battle start; Alchemist gains 8 Shield; Warrior receives no extra perk because its base stat package already has the strongest simulation margin. These effects apply only to the player origin and never modify enemies that happen to use the same named abilities.\n''')

print('Gameplay V7 origin calibration finalized')
