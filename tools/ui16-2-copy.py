from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[1]

def replace_once(text, old, new, label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    return text.replace(old,new,1)

app_path=ROOT/'src/app.ts'
app=app_path.read_text(encoding='utf-8')

repls=[
("rewards(){const s=this.game!.s;return `<section class=\"reward-page\">${this.heading('机缘')}",
 "rewards(){const s=this.game!.s,title=s.current?.type==='boss'?'劫首遗珍':s.current?.type==='elite'?'强敌遗珍':'机缘';return `<section class=\"reward-page\">${this.heading(title)}",'reward heading'),
("<span class=\"muted\">择一</span>","",'reward choose hint'),
("<div class=\"draft-lane\"><div class=\"draft-lane-head\"><span>${['精进','合流','新路'][i]??'机缘'}</span></div>","<div class=\"draft-lane\">",'draft lane meta labels'),
("${btn('inspect','细看','text-link',`data-id=\"${id}\"`)}","${btn('inspect','观诀','text-link',`data-id=\"${id}\"`)}",'reward inspect copy'),
("<span class=\"fighter-side-badge\">${side==='p'?'我方':'敌方'}</span>","",'fighter side badge'),
("b.won?'收取机缘 '+icon('arrow',16):'回望此生'","b.won?'收下所得 '+icon('arrow',16):'回望此生'",'battle reward action'),
("<div class=\"battle-log-head\"><span>战报</span>","<div class=\"battle-log-head\"><span>战痕</span>",'battle log heading'),
("this.heading('此后，你要往何处','五色神光散尽。你终于可以自己写下名字。','THE FINAL CHOICE')","this.heading('此后，你要往何处','五色神光散尽。你终于可以自己写下名字。')",'ending english kicker'),
("<span>音效</span>","<span>声息</span>",'settings sound'),
("<span>详细战报</span>","<span>战痕详录</span>",'settings log label'),
("<span>命途${this.storageOK?' · 已存':' · 保存失败'}</span>","<span>命书${this.storageOK?' · 已封存':' · 封存有误'}</span>",'settings save label'),
("${btn('export','导出','small',this.game?'':'disabled')}${btn('import','导入','small')}","${btn('export','留存','small',this.game?'':'disabled')}${btn('import','载入','small')}",'settings save actions'),
("<span>旧命途 · 3.0 留存</span>","<span>旧卷 · 3.0</span>",'legacy label'),
("${btn('exportLegacy','备份旧档','small')}","${btn('exportLegacy','留存旧卷','small')}",'legacy action'),
("<span>修行札记</span>","<span>修行札</span>",'help label'),
("<summary>命数与版本</summary>","<summary>卷尾</summary>",'version disclosure'),
("<p>内容 ${esc(this.content.version)} · 规则 ${esc(this.content.rulesVersion)}</p><p>界面修订 ${UI_REVISION}</p>","<p>卷本 ${esc(this.content.version)} · 法则 ${esc(this.content.rulesVersion)}</p><p>书页 ${UI_REVISION}</p>",'version copy'),
("<summary>根骨明细</summary>","<summary>根骨来处</summary>",'stat source label'),
("'替换此项'","'舍此'",'replacement foot'),
("${btn('cancelReplacement','放弃新得','quiet')}","${btn('cancelReplacement','不取','quiet')}",'replacement cancel'),
]
for old,new,label in repls:
    app=replace_once(app,old,new,label)
app_path.write_text(app,encoding='utf-8')

p=ROOT/'src/presentation.ts'
text=p.read_text(encoding='utf-8')
text=replace_once(text,"UI_REVISION='16.1'","UI_REVISION='16.2'",'presentation revision')
p.write_text(text,encoding='utf-8')

jp=ROOT/'data/presentation.json'
data=json.loads(jp.read_text(encoding='utf-8'))
if data.get('revision')!='16.1':
    raise SystemExit(f"presentation json revision expected 16.1, got {data.get('revision')}")
data['revision']='16.2'
jp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

for rel in ['tests/combat-feedback.test.mjs','tests/race-events.test.mjs']:
    p=ROOT/rel
    text=p.read_text(encoding='utf-8')
    if '16.1' not in text:
        raise SystemExit(f'{rel}: 16.1 contract not found')
    p.write_text(text.replace('16.1','16.2'),encoding='utf-8')

p=ROOT/'tests/immersion-copy.test.mjs'
text=p.read_text(encoding='utf-8')
text=text.replace("test('UI16.1 removes meta guidance from primary play surfaces'","test('UI16.2 keeps primary play surfaces in-world and trims draft meta copy'")
text=replace_once(text,"assert.match(presentation,/UI_REVISION='16\\.1'/);","for(const phrase of ['<span class=\"muted\">择一</span>',\"['精进','合流','新路']\",'draft-lane-head','fighter-side-badge','THE FINAL CHOICE','>详细战报<','>导出<','>导入<'])assert(!app.includes(phrase),phrase);\n assert(app.includes(\"s.current?.type==='boss'?'劫首遗珍'\"));\n assert(app.includes(\"s.current?.type==='elite'?'强敌遗珍'\"));\n assert.match(presentation,/UI_REVISION='16\\.2'/);",'immersion revision assertions')
text=replace_once(text,"assert(app.includes('详细战报'));","assert(app.includes('战痕详录'));",'critical log label')
text=replace_once(text,"assert(app.includes('根骨明细'));","assert(app.includes('根骨来处'));",'critical stat label')
p.write_text(text,encoding='utf-8')

print('UI 16.2 copy pass applied')
