from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[1]
game=ROOT/'data/game.json'
c=json.loads(game.read_text(encoding='utf-8'))
war=next(x for x in c['origins'] if x['id']=='warrior')
war['stats'].update({'hp':104,'attack':19,'defense':11,'luck':7})
war['starting']=['basic.fist','rage.guard']
war['description']='生命 +4，攻击 -1，防御 +1，气运 -3。拳与玄甲是根骨；辅助位从空槽起步，需要在旅途中亲手补成护盾、反震或混合循环。'
game.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

p=ROOT/'tests/engine.test.mjs'
t=p.read_text(encoding='utf-8')
t=t.replace("assert(w.starting.includes('aux.qi'));assert(!w.starting.includes('aux.stone'));assert(!w.starting.includes('aux.counter'));",
            "assert.equal(w.starting.length,2);assert(!w.starting.includes('aux.qi'));assert(!w.starting.includes('aux.stone'));assert(!w.starting.includes('aux.counter'));")
p.write_text(t,encoding='utf-8')
print('Warrior now starts with fist + guard only; aux slot must be built during the run.')
