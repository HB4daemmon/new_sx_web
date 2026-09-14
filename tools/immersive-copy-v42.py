from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[1]
app_path=ROOT/'src/app.ts'
app=app_path.read_text()


def one(old:str,new:str):
    global app
    count=app.count(old)
    assert count==1, f'expected exactly one match ({count}): {old[:100]}'
    app=app.replace(old,new,1)


def many(old:str,new:str,min_count:int=1):
    global app
    count=app.count(old)
    assert count>=min_count, f'expected at least {min_count} matches ({count}): {old[:100]}'
    app=app.replace(old,new)

# Character creation: names, emblems and numbers lead; prose no longer explains the UI.
one('''<p class="race-trait"><b>${esc(race.trait)}</b> · ${esc(race.description)}</p>''','''<p class="race-trait"><b>${esc(race.trait)}</b></p>''')
many('''<span class="small muted">择一，伴此生</span>''','''''')
many('''<p>${esc(f.description)}</p>''','''''',2)
one('''<p class="origin-detail">${esc(o.description)}</p>''','''''')
one('''<p class="replace-save-warning">入劫将替换当前命途。</p>''','''<p class="replace-save-warning">旧途将断。</p>''')

# Character rail: keep the readable numbers, remove the second layer of explanation.
one('''<button class="text-link" data-action="character">属性来源 ${icon('arrow',12)}</button>''','''''')
many('''命格共鸣：''','''所应：''')

# Build disclosure: inactive recipes no longer narrate themselves; active effects can still be inspected.
one('''<p class="pool-note">此途：${this.game!.s.contentPool.schools.map(id=>this.content.schools.find(d=>d.id===id)!.name).join(" · ")}</p><p class="pool-note">合流：${this.game!.s.contentPool.hybrids.map(id=>this.content.hybrids.find(d=>d.id===id)!.name).join(" · ")}</p>''','''<div class="build-tags">${this.game!.s.contentPool.schools.map(id=>`<span>${esc(this.content.schools.find(d=>d.id===id)!.name)}</span>`).join('')}${this.game!.s.contentPool.hybrids.map(id=>`<span>${esc(this.content.hybrids.find(d=>d.id===id)!.name)}</span>`).join('')}</div>''')
one('''<p>${esc(r.description)}</p>''','''${r.tier?`<p>${esc(r.description)}</p>`:''}''')
one('''<p>${esc(b.bridge.description)}</p>''','''${b.bridge.tier?`<p>${esc(b.bridge.description)}</p>`:''}''')
one('''<p>${esc(b.strategy.description)}</p>''','''${b.strategy.tier?`<p>${esc(b.strategy.description)}</p>`:''}''')
one('''<p>${esc(b.finisher.description)}</p>${!b.finisher.active?`<p>${esc(b.finisher.requirement)}</p>`:''}''','''${b.finisher.active?`<p>${esc(b.finisher.description)}</p>`:''}''')

# Events: consequences stay visible; meta intent hints disappear.
one('''${cp.hint?`<details class="choice-intent disclosure" data-panel="choice-${ch.id}"><summary>此举的牵连</summary><p>${esc(cp.hint)}</p></details>`:''}''',''' ''')

# Shop and rest: replace tutorial-like prose with terse in-world wording.
one('''<div class="card-top"><span>调息 / 即时</span><span class="card-rank">+</span></div>''','''<div class="card-top"><span>灵药</span></div>''')
one('''<div class="card-foot"><span>恢复生命</span><span class="gain">${icon('coin',14)} ${o.price}</span></div>''','''<div class="card-foot"><span class="gain">${icon('coin',14)} ${o.price}</span></div>''')
one('''<div class="card-top"><span>淬炼 / 即时</span><span class="card-rank">+</span></div>''','''<div class="card-top"><span>淬炼</span></div>''')
one('''<p class="card-description">本局 ${esc(this.content.labels.stats[o.stat])} +${o.value}。</p>''','''<p class="card-description">${esc(this.content.labels.stats[o.stat])} +${o.value}</p>''')
one('''<div class="card-foot"><span>即时生效</span><span class="gain">${icon('coin',14)} ${o.price}</span></div>''','''<div class="card-foot"><span class="gain">${icon('coin',14)} ${o.price}</span></div>''')
one('''本幕刷新 ${count} / 3''','''换货 ${count} / 3''')
one("''本幕刷新已尽''","''缘尽''")
one("''免费刷新''","''换货''")
one("''刷新  '+price+' 灵石''","''换货  '+price+' 灵石''")
one('''<div class="sold-label">已售出</div>''','''<div class="sold-label">售罄</div>''')
one("this.heading('山中一息','择一整备')","this.heading('山中一息')")
one("'恢复 30% 最大生命'","'气血 +30%'")
one("'功法或战策升一阶'","'所习升阶'")
one("'法宝升一阶'","'法宝升阶'")
one("'选择一项属性淬炼'","'炼骨锻身'")
one("btn('restMode','返回修整'","btn('restMode','回到火前'")

# Build catalog: recipes remain readable without guidebook narration.
one('''<p>${esc(p.description)}</p>''',''' ''')
one("${!x.available&&!x.owned?'（本局不产出）':''}","${!x.available&&!x.owned?' · 缘外':''}")
one('''<p class="path-talents">天赋配合：${p.supports.map(x=>`${x.owned?'◆ ':''}${esc(x.name)}`).join(' / ')}</p>''','''<p class="path-talents">${p.supports.map(x=>`${x.owned?'◆ ':''}${esc(x.name)}`).join(' / ')}</p>''')
one('''<details class="path-tradeoff"><summary>取舍</summary><p>${esc(p.tradeoff)}</p></details>''',''' ''')

# Replacement/new-run dialogs keep the consequence but drop system copy.
one('''<p>此类槽位已满。替换后，原能力不再保留。${p.source==='shop'?`确认时扣除 ${p.price} 灵石。`:''}</p>''','''<p>命盘无隙。${p.source==='shop'?`舍此得彼 · ${p.price} 灵石。`:'舍此得彼。'}</p>''')
one('''<p>开始新命途时，现有进度将被替换。</p>''','''<p>旧途将封。</p>''')

# Character sheet: identity stays, duplicated descriptive paragraphs go away.
one('''<p>${esc(o.description)}</p>''',''' ''')
one('''<p>${esc(this.content.races.find(r=>r.id===s.race)!.description)}</p>''',''' ''')
many('''属性来源''','''根骨明细''')

# Help becomes a handful of aphorisms rather than a rules manual.
one('''<p>由下向上行进，亮起的节点可进入。每幕十站，进入下一幕时生命回满；本幕内的伤势持续保留。</p>''','''<p>择路而行，伤势随幕。</p>''')
one('''<p>每次突破境界，从通悟与族裔天赋中手选一项。进阶天赋需要先前所悟；选择后伴随此局，不占命盘槽位。</p>''','''<p>破境择一念。</p>''')
one('''<p>基础技一项、怒气技一项、辅法两项、法宝三件、战策一项。同名升阶，最高三阶；槽满时替换或放弃。此途道藏只收录当局可得的功法与已获法宝。</p>''','''<p>八槽成局，同名升阶。</p>''')
one('''<p>基础技获得 ${this.content.rules.basicRage} 怒气，受击获得 ${this.content.rules.hitRage} 怒气。怒气达到 ${this.content.rules.rageMax} 且冷却结束时，优先施放怒气技。空格暂停；略过不改变结果。</p>''','''<p>怒满则发。</p>''')
one('''<p>选项旁列出直接得失，检定同时列出成败代价。未曾经历的因果不会预先展开。共鸣与法相可在命盘中查看。</p>''','''<p>一念留痕。</p>''')

app_path.write_text(app)

presentation=ROOT/'src/presentation.ts'
p= presentation.read_text()
assert "export const UI_REVISION='16.0';" in p
presentation.write_text(p.replace("export const UI_REVISION='16.0';","export const UI_REVISION='16.1';",1))

pkg_path=ROOT/'package.json'
pkg=json.loads(pkg_path.read_text())
needle='tests/immersion-copy.test.mjs'
if needle not in pkg['scripts']['test']:
    pkg['scripts']['test'] += ' '+needle
pkg_path.write_text(json.dumps(pkg,ensure_ascii=False,indent=2)+'\n')

readme=ROOT/'README.md'
r=readme.read_text()
r=r.replace('界面修订 **16.0**','界面修订 **16.1**',1)
r=r.replace('## UI 16.0','## UI 16.1',1)
marker='延续 UI15 双角色斗法舞台和逐帧像素特效；新增族裔选择、境界突破时的天赋手选、天赋前置关系与流派方向展示。技能与法宝继续使用原 SVG 视觉。'
if marker in r:
    r=r.replace(marker,marker+'\n\n16.1 收紧主界面文案：创建、命盘、事件、坊市、休整与帮助页减少规则式说明，保留关键数值与直接得失，以人物、命格、因缘和场景本身承担叙事。',1)
readme.write_text(r)

print('Immersion-first copy pass applied')
