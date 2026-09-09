from pathlib import Path
import re
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
app_path = root / 'src/app.ts'
css_path = root / 'src/style.css'
app = app_path.read_text(encoding='utf-8')
css = css_path.read_text(encoding='utf-8')


def sub_once(pattern: str, replacement: str, text: str, label: str) -> str:
    out, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f'{label}: expected 1 replacement, got {count}')
    return out


stat_anchor = "const STAT_ICONS:Record<string,string>={hp:'heart',attack:'sword',defense:'shield',speed:'feather',hit:'eye',dodge:'cloud',luck:'star'};"
if 'const SLOT_SIGNS' not in app:
    if stat_anchor not in app:
        raise RuntimeError('STAT_ICONS anchor not found')
    app = app.replace(
        stat_anchor,
        stat_anchor
        + "\nconst SLOT_SIGNS:Record<Slot,string>={basic:'基',rage:'怒',aux:'辅',artifact:'宝',strategy:'策'};"
        + "\nconst RARITY_LABELS:Record<string,string>={common:'凡品',rare:'稀有',mythic:'神话'};",
    )

# Remove technical/marketing guidance from the main experience while preserving rules where needed.
app = app.replace(
    '<p class="start-note">单人·离线可玩·自动存档·无永久数值成长</p>',
    '<p class="start-note">天命未定 · 八槽成局</p>',
)
app = app.replace('离线游玩请打开 PLAY.html，或使用 npm run dev。', '请刷新页面，或稍后重试。')
app = app.replace('同名升阶，最高 R3。<br>满槽时必须替换或放弃，没有背包。', '同名升阶 · 最高 R3')
app = app.replace('${list.length} 项&nbsp;·&nbsp;图鉴不是背包，不可从此处自由更换', '${list.length} 项')
app = app.replace(
    '存档保存在当前浏览器中，不会上传。清除浏览器数据前请先导出。音效不影响战斗结果。',
    '清除浏览器数据前请先导出存档。',
)

new_mobile = r''' mobileHUD(){const s=this.game!.s,st=this.game!.stats();return `<div class="mobile-hud"><div class="mobile-hp"><div class="vital-title"><span>${esc(s.name)}</span><span>${s.hp} / ${st.hp}</span></div><div class="bar"><span style="width:${percent(s.hp,st.hp)}%"></span></div></div><div class="mobile-combat-metrics"><span>攻 <b>${st.attack}</b></span><span>防 <b>${st.defense}</b></span><span>速 <b>${st.speed}</b></span></div><span class="realm">${icon('lotus',17)}${esc(this.content.realms[s.level])}</span><span class="mobile-gold">${icon('coin',18)} ${s.gold}</span></div>`;}'''
app = sub_once(r"\n mobileHUD\(\)\{.*?\n playerPanel\(\)", "\n" + new_mobile + "\n playerPanel()", app, 'mobileHUD')

new_player = r''' playerPanel(){const s=this.game!.s,st=this.game!.stats(),o=this.content.origins.find(x=>x.id===s.origin)!,f=this.content.fates.find(x=>x.id===s.fate)!,next=this.content.rules.xpThresholds[s.level+1],hpRate=percent(s.hp,st.hp),slotCount=s.slots.filter(Boolean).length;return `<aside class="sidebar left-sidebar"><section class="panel"><div class="player-portrait">${portrait(s.portrait)}<div class="portrait-label"><div><span class="origin-label">${esc(o.name)}</span><h2>${esc(s.name)}</h2></div><span class="badge">${esc(this.content.realms[s.level])}</span></div></div><div class="panel-body"><div class="vital-title"><span>${icon('heart',12)} 生命</span><span class="mono">${s.hp} <span class="muted">/ ${st.hp}</span></span></div><div class="bar"><span style="width:${hpRate}%"></span></div><div class="vital-title" style="margin-top:11px;color:var(--muted)"><span>修为</span><span class="mono">${s.xp}${next?' / '+next:' / MAX'}</span></div><div class="bar xp"><span style="width:${next?percent(s.xp-this.content.rules.xpThresholds[s.level],next-this.content.rules.xpThresholds[s.level]):100}%"></span></div><div class="stat-section"><div class="stat-section-title"><span>属性刻度</span><span>当前总值</span></div><div class="stats-grid detailed">${STAT_KEYS.filter(x=>x!=='hp').map(k=>`<div class="stat detailed-stat stat-${k}"><span>${icon(STAT_ICONS[k],15)}${esc(this.content.labels.stats[k])}</span><b>${st[k]}</b></div>`).join('')}</div><div class="run-metrics"><div><span>生命率</span><b>${hpRate}%</b></div><div><span>槽位</span><b>${slotCount}/8</b></div><div><span>行程</span><b>${s.visited.length}/24</b></div><div><span>境界阶</span><b>${s.level+1}</b></div></div></div><div class="resource-box"><span class="small muted">${icon('coin',18)} 灵石</span><strong>${s.gold}</strong></div></div></section><div class="panel fate-panel">${icon(f.art,29)}<div><div class="eyebrow" style="font-size:8px;letter-spacing:2px">DESTINY</div><strong>${esc(f.name)}</strong><p>${esc(f.description)}</p></div></div></aside>`;}'''
app = sub_once(r"\n playerPanel\(\)\{.*?\n mini\(", "\n" + new_player + "\n mini(", app, 'playerPanel')

new_mini = r''' mini(eq:Equipped|null,index:number){const slot=SLOT_ORDER[index],a=eq?this.game!.ability(eq.id):null;return `<button class="mini-card ${a?tone(a):'empty'} slot-${slot} rarity-${a?.rarity??'empty'}" ${a?`data-action="inspect" data-id="${a.id}"`:'disabled'}><div class="slot-identity"><span class="slot-glyph">${SLOT_SIGNS[slot]}</span><span class="slot">${esc(this.content.labels.slots[slot])}</span></div><span class="rank">${eq?'R'+eq.rank:String(index+1).padStart(2,'0')}</span><div class="name">${a?esc(a.name):'静待机缘'}</div>${a?`<span class="mini-rarity rarity-${a.rarity}">${RARITY_LABELS[a.rarity]??a.rarity}</span>`:''}${icon(a?.art??'star',24)}</button>`;}'''
app = sub_once(r"\n mini\(.*?\n buildPanel\(", "\n" + new_mini + "\n buildPanel(", app, 'mini')

new_card = r''' card(id:string,rank=0,action='inspect',attrs='',foot=''){const a=this.content.abilities.find(x=>x.id===id)!;const coefficient=a.effects.find(e=>e.type==='damage')?.coefficient;const text=a.description.replace('{0}',String(value(coefficient,rank)));return `<button class="ability-card ${tone(a)} slot-${a.slot} rarity-${a.rarity}" data-action="${action}" data-id="${a.id}" ${attrs}><div class="card-top"><span class="slot-pill slot-${a.slot}"><i>${SLOT_SIGNS[a.slot]}</i>${esc(this.content.labels.slots[a.slot])}</span><span class="rarity-label rarity-${a.rarity}">${RARITY_LABELS[a.rarity]??a.rarity}</span><span class="card-rank">R${rank}</span></div>${sigil(a.art,a.rarity==='mythic'?'mythic':a.tags.includes('burn')?'fire':a.tags.includes('shield')?'shield':'jade')}<h3 class="card-title rarity-title rarity-${a.rarity}">${esc(a.name)}</h3><p class="card-description">${esc(text)}</p><div class="card-foot"><span>${a.tags.slice(0,2).map(t=>TAGS[t]??esc(t)).join(' / ')}</span><span class="gain">${foot||'RANK '+rank+' '+icon('diamond',13)}</span></div></button>`;}'''
app = sub_once(r"\n card\(.*?\n rewards\(", "\n" + new_card + "\n rewards(", app, 'card')

new_fighter = r''' fighterFrame(frame:Frame,side:'p'|'e'){const f=frame[side],s=this.game!.s,enemy=this.content.enemies.find(e=>e.id===s.battle!.enemyId)!;return `<div class="combatant ${side==='e'?'enemy':''} ${frame.actor===side?'acting':''}"><div class="fighter-art">${portrait(side==='p'?s.portrait:enemy.art)}</div><h2 class="combatant-name">${esc(f.name)}</h2><div class="fighter-bars"><div class="fighter-numbers"><span>HP ${f.hp} / ${f.stats.hp}</span><span>${icon('shield',11)} ${f.shield}</span></div><div class="bar"><span style="width:${percent(f.hp,f.stats.hp)}%"></span></div><div class="fighter-numbers"><span>怒气</span><span>${f.rage} / 100</span></div><div class="bar rage"><span style="width:${f.rage}%"></span></div></div><div class="fighter-stat-grid">${(['attack','defense','speed','hit','dodge','luck'] as Stat[]).map(k=>`<span><em>${esc(this.content.labels.stats[k])}</em><b>${f.stats[k]}</b></span>`).join('')}</div><div class="combat-statuses">${Object.entries(f.status).filter(([,v])=>v>0).map(([k,v])=>`<span class="status ${k}">${this.content.labels.statuses[k]??esc(k)} ${v}</span>`).join('')}${f.shield>0?`<span class="status shield">护盾 ${f.shield}</span>`:''}</div></div>`;}'''
app = sub_once(r"\n fighterFrame\(.*?\n battle\(", "\n" + new_fighter + "\n battle(", app, 'fighterFrame')

battle_helpers = r''' battleLogRow(frame:Frame,index:number,frames:Frame[],enemyName:string){const prev=frames[Math.max(0,index-1)],actor=frame.actor==='p'?this.game!.s.name:frame.actor==='e'?enemyName:'天道',details:string[]=[];const delta=(label:string,before:number,after:number,cls:string)=>before===after?'':`<span class="log-delta ${cls}">${label} ${before}→${after} <b>${after-before>0?'+':''}${after-before}</b></span>`;for(const side of ['p','e'] as const){const before=prev[side],after=frame[side],who=side==='p'?this.game!.s.name:enemyName,changes:string[]=[];for(const x of [delta('生命',before.hp,after.hp,'hp'),delta('护盾',before.shield,after.shield,'shield'),delta('怒气',before.rage,after.rage,'rage')])if(x)changes.push(x);for(const k of new Set([...Object.keys(before.status),...Object.keys(after.status)])){const a=before.status[k]??0,b=after.status[k]??0;if(a!==b)changes.push(`<span class="log-delta status">${esc(this.content.labels.statuses[k]??k)} ${a}→${b} <b>${b-a>0?'+':''}${b-a}</b></span>`);}if(changes.length)details.push(`<div class="log-side"><em>${esc(who)}</em>${changes.join('')}</div>`);}const outcome=frame.kind==='damage'||frame.kind==='burn'?`<span class="log-amount">${frame.crit?'暴击 · ':''}${frame.amount} 伤害</span>`:frame.kind==='miss'?'<span class="log-outcome">闪避</span>':frame.kind==='rage'?'<span class="log-outcome rage">怒气技</span>':'';return `<article class="battle-log-row kind-${frame.kind.replace(/[^a-z_-]/g,'')} ${frame.crit?'critical':''}"><div class="battle-log-main"><span class="round">${String(frame.round).padStart(2,'0')}</span><span class="log-actor">${esc(actor)}</span><strong>${esc(frame.label)}</strong>${outcome}</div>${details.length?`<div class="battle-log-detail">${details.join('')}</div>`:''}</article>`;}
 battle(){const b=this.game!.s.battle!,cursor=bi(b.cursor,0,b.frames.length-1),f=b.frames[cursor],done=cursor>=b.frames.length-1,enemy=this.content.enemies.find(e=>e.id===b.enemyId)!;return `${this.heading(done?(b.won?'此战告捷':'此身入劫'):'斗法','',enemy.kind==='boss'?'BOSS / HEAVENLY TRIAL':'ROUND '+String(f.round).padStart(2,'0'))}<div class="combat-arena">${landscape()}${this.fighterFrame(f,'p')}<div class="versus"><small>斗法</small>VS</div>${this.fighterFrame(f,'e')}${f.amount>0?`<div class="damage-number" key="${cursor}">${f.crit?'<small>暴击</small>':''}${f.amount}</div>`:''}</div><div class="battle-controls"><div class="speeds">${[1,2,4].map(n=>`<button class="${this.speed===n?'active':''}" data-action="speed" data-index="${n}" aria-label="${n}倍速">${n}×</button>`).join('')}<button data-action="pause" ${done?'disabled':''}>${this.paused?'继续':'暂停'}</button></div>${done?btn('finishBattle',b.won?'领取机缘 '+icon('arrow',16):'查看命途','primary small'):btn('skip','略过回放 '+icon('arrow',16),'small')}</div><div class="battle-log-head"><span>斗法战报</span><small>${cursor+1} / ${b.frames.length} · 最新在上</small></div><div class="battle-log" aria-live="polite" tabindex="0">${b.frames.slice(0,cursor+1).map((row,i)=>this.battleLogRow(row,i,b.frames,enemy.name)).reverse().join('')}</div><p class="battle-caption">${esc(enemy.intent)}</p>`;}'''
app = sub_once(r"\n battle\(\)\{.*?\n event\(", "\n" + battle_helpers + "\n event(", app, 'battle')

marker = '/* UI refinement v2 */'
if marker not in css:
    css += r'''

/* UI refinement v2 */
.stat-section{margin-top:18px;padding-top:13px;border-top:1px solid var(--line)}
.stat-section-title{display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;color:#889b90;font-size:9px;letter-spacing:1.5px;text-transform:uppercase}
.stats-grid.detailed{grid-template-columns:1fr 1fr;gap:7px;margin:0}
.detailed-stat{min-height:39px;padding:7px 8px;border:1px solid #849b8430;background:linear-gradient(135deg,#14231f,#1b2d25);font-size:10px}
.detailed-stat b{font-size:19px;color:#e1dcc4;line-height:1}.detailed-stat .icon{opacity:.9}
.run-metrics{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}
.run-metrics>div{display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border:1px solid #8a9b7930;background:#0c1816;color:#82958a;font-size:9px}
.run-metrics b{font:13px Georgia,serif;color:var(--gold-bright)}
.mobile-combat-metrics{display:none}
.slot-basic{--slot-accent:#d1ad62}.slot-rage{--slot-accent:#cf6658}.slot-aux{--slot-accent:#65a9a5}.slot-artifact{--slot-accent:#9a80bf}.slot-strategy{--slot-accent:#7fa65c}
.mini-card{border-left:3px solid var(--slot-accent,var(--line));padding-left:9px}
.slot-identity{display:flex;align-items:center;gap:5px;max-width:80%}.slot-glyph{display:inline-grid;place-items:center;width:18px;height:18px;border:1px solid var(--slot-accent);background:#0c1714;color:var(--slot-accent);font:11px var(--serif);box-shadow:0 0 12px #0004}
.mini-card .slot{color:var(--slot-accent);font-weight:700;letter-spacing:1.4px}.mini-card .name{padding-right:24px}.mini-rarity{position:absolute;left:10px;bottom:8px;font-size:8px;letter-spacing:1.6px;opacity:.8}
.mini-card.rarity-rare .name{font-weight:700;letter-spacing:1.6px}.mini-card.rarity-mythic .name{font-weight:800;letter-spacing:2px;color:#f2d38b;text-shadow:0 0 12px #d8b25c55}
.ability-card{border-top:2px solid var(--slot-accent,var(--line))}.card-top{gap:6px;align-items:center}.slot-pill{display:inline-flex;align-items:center;gap:5px;color:var(--slot-accent);font-weight:700;letter-spacing:1.1px;white-space:nowrap}.slot-pill i{display:inline-grid;place-items:center;width:18px;height:18px;border:1px solid currentColor;font:10px var(--serif);font-style:normal;background:#07110f55}
.rarity-label{margin-left:auto;font-size:9px;letter-spacing:1.3px;font-weight:500;white-space:nowrap}.rarity-title.rarity-common{font-weight:500;letter-spacing:1.3px;color:#d7d5c3}.rarity-label.rarity-common{color:#a2aa9e}
.rarity-title.rarity-rare{font-weight:750;letter-spacing:2px;color:#c4ebe2;text-shadow:0 0 14px #7fc7bb45}.rarity-label.rarity-rare{font-weight:800;color:#aee0d5;border-bottom:1px solid #7bc5b7}
.rarity-title.rarity-mythic{font-weight:900;letter-spacing:2.8px;color:#f6da91;text-shadow:0 0 9px #dfb85488,0 0 22px #a87e3044}.rarity-label.rarity-mythic{font-weight:900;letter-spacing:2px;color:#f6d487;text-shadow:0 0 9px #d4a64b99}.ability-card.rarity-mythic{box-shadow:0 0 0 1px #d0a95755,0 10px 25px #0007,inset 0 0 25px #bd913214}
.fighter-stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:8px}.fighter-stat-grid span{display:flex;align-items:center;justify-content:space-between;gap:3px;padding:3px 5px;border:1px solid #87957d25;background:#0b1715aa;font-size:8px}.fighter-stat-grid em{font-style:normal;color:#819087}.fighter-stat-grid b{font:10px Georgia,serif;color:#d9d4bb}
.battle-log-head{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;border:1px solid var(--line);border-bottom:0;background:#14231f;color:#d1c7a7;font:13px var(--serif);letter-spacing:2px}.battle-log-head small{font:9px var(--sans);letter-spacing:1px;color:#7f9186}
.battle-log{max-height:265px;min-height:170px;overflow-y:auto;overscroll-behavior:contain;padding:0 14px;background:#081310;scrollbar-width:thin;scrollbar-color:#8e7a4f #0a1714}
.battle-log-row{padding:10px 0;border-bottom:1px solid #7c8a7622;color:#a4b0a7}.battle-log-row:last-child{border-bottom:0}.battle-log-main{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;line-height:1.55}.battle-log .round{width:auto;min-width:24px;color:#756f5e;font:9px monospace}.log-actor{min-width:54px;color:#b6b29c;font-weight:700}.battle-log-main strong{color:#ded8bf;font:12px var(--serif);letter-spacing:1px}.log-amount{margin-left:auto;color:#d98b70;font-weight:800;font-size:10px}.log-outcome{margin-left:auto;color:#98bcae;font-size:9px}.log-outcome.rage{color:#e2bd6e}.battle-log-row.critical{background:linear-gradient(90deg,#7d3c241f,transparent)}.battle-log-row.critical .battle-log-main strong,.battle-log-row.critical .log-amount{color:#ffc28c;text-shadow:0 0 10px #e8784355}
.battle-log-detail{display:grid;gap:4px;margin:6px 0 0 32px}.log-side{display:flex;align-items:center;gap:5px;flex-wrap:wrap}.log-side em{min-width:50px;color:#6f8277;font-size:8px;font-style:normal}.log-delta{padding:2px 5px;border:1px solid #81917c22;background:#13201d;color:#8fa197;font-size:8px}.log-delta b{font-family:monospace;color:#c0c5ae}.log-delta.hp b{color:#df8b7c}.log-delta.shield b{color:#91c6c4}.log-delta.rage b{color:#e0bd72}.log-delta.status b{color:#c6a8dc}
@media(max-width:760px){.mobile-hud{height:auto;min-height:50px;gap:9px;flex-wrap:wrap}.mobile-combat-metrics{display:flex;order:4;width:100%;justify-content:center;gap:14px;padding-top:5px;border-top:1px solid #7f927923;color:#81958b;font-size:8px}.mobile-combat-metrics b{font:10px Georgia,serif;color:#d8d2b7}.fighter-stat-grid{gap:2px}.fighter-stat-grid span{padding:2px 3px;font-size:7px}.fighter-stat-grid b{font-size:9px}.battle-log{max-height:230px;min-height:180px;padding:0 10px}.battle-log-main{gap:5px}.log-actor{min-width:42px}.battle-log-main strong{font-size:11px}.battle-log-detail{margin-left:0}.log-side{align-items:flex-start}.log-side em{width:100%;min-width:0;margin-top:2px}.battle-log-head{padding:8px 10px}.battle-log-head small{font-size:8px}.slot-pill{font-size:7px;letter-spacing:.4px}.slot-pill i{width:16px;height:16px}.rarity-label{font-size:7px;letter-spacing:.7px}.card-top{gap:3px}.card-rank{margin-left:0}}
'''

for needle, haystack in [
    ('run-metrics', app),
    ('slot-glyph', app),
    ('rarity-label', app),
    ('battleLogRow', app),
    ('battle-log-head', app),
    ('UI refinement v2', css),
]:
    if needle not in haystack:
        raise RuntimeError(f'missing expected marker: {needle}')
if '单人·离线可玩' in app:
    raise RuntimeError('old landing guidance still present')

app_path.write_text(app, encoding='utf-8')
css_path.write_text(css, encoding='utf-8')
print('UI refinement patch applied')
