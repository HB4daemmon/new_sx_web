from pathlib import Path
import hashlib, json, re, sys
root=Path(sys.argv[1] if len(sys.argv)>1 else '.')
engine=root/'src/engine.ts'; app=root/'src/app.ts'; tests=root/'tests/engine.test.mjs'; fixture=root/'tests/fixtures/v12-contract.json'

def one(text,old,new,label):
    n=text.count(old)
    if n!=1: raise RuntimeError(f'{label}: expected 1 match, got {n}')
    return text.replace(old,new,1)

e=engine.read_text(encoding='utf-8')
e=one(e,"if(objective.type==='survive')return round>=(objective.rounds??1);","if(objective.type==='survive')return e.hp<=0||round>=(objective.rounds??1);",'survive objective')
engine.write_text(e,encoding='utf-8')

a=app.read_text(encoding='utf-8')
a=one(a,"<span>${f.round?'第 '+f.round+' 回合':'蓄势'}</span>${obj.type==='survive'?","<span>${done?'历 '+b.rounds+' 回合':f.round?'第 '+f.round+' 回合':'蓄势'}</span>${!done&&obj.type==='survive'?",'battle completed round label')
a=one(a,":obj.type==='break'?`<strong>破阵 ${Math.min(broken,obj.value??0)} / ${obj.value}</strong>`:enemy.kind==='boss'?'<strong>天劫</strong>':''}",":!done&&obj.type==='break'?`<strong>破阵 ${Math.min(broken,obj.value??0)} / ${obj.value}</strong>`:!done&&enemy.kind==='boss'?'<strong>天劫</strong>':''}",'battle completed objective label')
app.write_text(a,encoding='utf-8')

t=tests.read_text(encoding='utf-8')
marker="test('survive objective succeeds when the enemy is defeated before the required round'"
if marker in t: raise RuntimeError('regression test already present')
t += "\n\ntest('survive objective succeeds when the enemy is defeated before the required round',()=>{const g=fresh('SURVIVE-EARLY-KILL');g.s.bonus.attack=1000;g.s.bonus.hit=1000;const base=c.enemies.find(e=>e.objective?.type==='survive');const enemy=structuredClone(base);enemy.stats.hp=1;enemy.stats.defense=0;enemy.stats.dodge=0;enemy.objective={...enemy.objective,rounds:6,label:'守至第 6 回合'};const b=simulateBattle(c,g.s,enemy);assert.equal(b.won,true);assert(b.rounds<6);assert.equal(b.frames.at(-1).kind,'win');assert.equal(b.frames.at(-1).label,'斗法告捷');assert.equal(b.frames.some(f=>f.kind==='timeout'),false);});\n"
tests.write_text(t,encoding='utf-8')

d=json.loads(fixture.read_text(encoding='utf-8'))
d['engineSha256']=hashlib.sha256(engine.read_bytes()).hexdigest()
fixture.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('survive hotfix applied',d['engineSha256'])
