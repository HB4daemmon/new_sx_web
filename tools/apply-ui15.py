from pathlib import Path
import base64,re

root=Path('.')
app_path=root/'src/app.ts'
css_path=root/'src/style.css'
build_path=root/'scripts/build.mjs'
pres_path=root/'src/presentation.ts'
pres_json_path=root/'data/presentation.json'
readme_path=root/'README.md'
test_path=root/'tests/combat-feedback.test.mjs'
asset_path=root/'assets/generated/combat-vfx-atlas.webp'


def replace_between(text,start,end,new,label):
    a=text.find(start)
    if a<0: raise RuntimeError(f'{label}: start not found')
    b=text.find(end,a+len(start))
    if b<0: raise RuntimeError(f'{label}: end not found')
    return text[:a]+new+text[b:]

# Decode the compressed 6x8, 32px-per-frame atlas. Source sheets were generated as pixel-style VFX and downsampled for web.
asset_path.parent.mkdir(parents=True,exist_ok=True)
asset_path.write_bytes(base64.b64decode((root/'tools/ui15-vfx.webp.b64').read_text().strip(),validate=True))
for old in ['combat-damage.webp','combat-heal.webp','combat-shield.webp','combat-dispel.webp']:
    (asset_path.parent/old).unlink(missing_ok=True)

app=app_path.read_text()
app=replace_between(app,'const GENERATED_FX:Record<string,string>={','const bi=',"const VFX_ATLAS='./assets/generated/combat-vfx-atlas.webp';\n",'generated asset registry')

fighter=r'''  fighterFrame(frame:Frame,side:'p'|'e'){const f=frame[side],s=this.game!.s,enemy=this.content.enemies.find(e=>e.id===s.battle!.enemyId)!,art=side==='p'?s.portrait:enemy.art;return `<article class="combatant side-${side} ${side==='e'?'enemy':''} ${frame.actor===side?'acting':''}"><div class="fighter-art"><span class="fighter-aura" aria-hidden="true"></span>${portrait(art)}<span class="fighter-side-badge">${side==='p'?'我方':'敌方'}</span></div><div class="fighter-identity"><h2>${esc(f.name)}</h2>${frame.actor===side?`<span class="turn-mark">${frame.kind==='rage'?'怒技':'出手'}</span>`:''}</div><div class="fighter-bars"><div class="fighter-numbers"><span>生命 <b>${f.hp}</b> / ${f.stats.hp}</span>${f.shield?`<span class="shield-count">${icon('shield',12)} ${f.shield}</span>`:''}</div><div class="bar hp"><span style="width:${percent(f.hp,f.stats.hp)}%"></span></div><div class="fighter-numbers"><span>怒气</span><span>${f.rage} / ${this.content.rules.rageMax}</span></div><div class="bar rage"><span style="width:${percent(f.rage,this.content.rules.rageMax)}%"></span></div></div><div class="fighter-core-stats"><span>攻 <b>${f.stats.attack}</b></span><span>防 <b>${f.stats.defense}</b></span><span>速 <b>${f.stats.speed}</b></span></div><div class="combat-statuses">${Object.entries(f.status).filter(([,v])=>v>0).map(([k,v])=>`<span class="status ${k}">${esc(this.content.labels.statuses[k]??k)} <b>${v}</b></span>`).join('')}</div></article>`;}\n'''
app=replace_between(app,' fighterFrame(', '  statusChanges(',fighter+'  statusChanges(','fighter frame')

feedback=r'''  combatFeedback(frame:Frame,index:number,frames:Frame[]){if(index<=0)return '';const prev=frames[index-1],items:{side:'p'|'e';kind:string;text:string;crit?:boolean}[]=[];for(const side of ['p','e'] as const){const before=prev[side],after=frame[side],hp=after.hp-before.hp,shield=after.shield-before.shield;if(hp<0)items.push({side,kind:'damage',text:`-${Math.abs(hp)}`,crit:!!frame.crit&&frame.actor!==side});else if(hp>0)items.push({side,kind:'heal',text:`+${hp} 生命`});if(shield>0)items.push({side,kind:'shield',text:`+${shield} 护盾`});else if(shield<0)items.push({side,kind:'shield-loss',text:`-${Math.abs(shield)} 护盾`});for(const key of new Set([...Object.keys(before.status),...Object.keys(after.status)])){const delta=(after.status[key]??0)-(before.status[key]??0);if(delta>0)items.push({side,kind:'status-add',text:`${esc(this.content.labels.statuses[key]??key)} +${delta}`});else if(delta<0)items.push({side,kind:'status-use',text:`${esc(this.content.labels.statuses[key]??key)} -${Math.abs(delta)}`});}}const count={p:0,e:0};return `<div class="combat-feedback-layer" aria-hidden="true">${items.slice(0,10).map(item=>{const stack=count[item.side]++;return `<span class="combat-float side-${item.side} ${item.kind} ${item.crit?'crit':''}" style="--stack:${stack}"><b>${item.text}</b></span>`;}).join('')}</div>`;}
  combatVfx(frame:Frame,index:number,frames:Frame[]){if(index<=0)return '';const prev=frames[index-1],statusDown:{side:'p'|'e';yes:boolean}[]=[{side:'p',yes:false},{side:'e',yes:false}],hpDelta={p:frame.p.hp-prev.p.hp,e:frame.e.hp-prev.e.hp},shieldDelta={p:frame.p.shield-prev.p.shield,e:frame.e.shield-prev.e.shield};for(const item of statusDown){const before=prev[item.side].status,after=frame[item.side].status;item.yes=[...new Set([...Object.keys(before),...Object.keys(after)])].some(k=>(after[k]??0)<(before[k]??0));}let target:'p'|'e'|'center'='center',kind='';if(frame.kind==='convert'){const hit=statusDown.find(x=>x.yes);if(hit){kind='dispel';target=hit.side;}}if(!kind){for(const side of ['p','e'] as const)if(hpDelta[side]<0){kind='attack';target=side;break;}}if(!kind){for(const side of ['p','e'] as const)if(hpDelta[side]>0){kind='heal';target=side;break;}}if(!kind){for(const side of ['p','e'] as const)if(shieldDelta[side]>0){kind='shield';target=side;break;}}if(!kind){const hit=statusDown.find(x=>x.yes);if(hit){kind='dispel';target=hit.side;}}if(!kind&&frame.kind==='rage'){kind='aura';target=frame.actor==='p'||frame.actor==='e'?frame.actor:'center';}if(!kind)return '';const rows:{[k:string]:number}={attack:0,heal:1,shield:2,dispel:3,aura:6},accent=frame.crit?4:kind==='attack'?5:kind==='heal'?6:kind==='shield'?4:7,points=[[-27,-10],[-18,-28],[1,-36],[22,-26],[34,-3],[24,22],[-3,31],[-28,18]],duration=Math.max(170,620/this.speed);return `<div class="combat-vfx target-${target} kind-${kind} ${frame.crit?'critical':''}" style="--fx-duration:${duration}ms" aria-hidden="true"><span class="vfx-sprite main" style="--row:${rows[kind]};background-image:url('${VFX_ATLAS}')"></span><span class="vfx-sprite accent" style="--row:${accent};background-image:url('${VFX_ATLAS}')"></span><span class="vfx-particles">${points.map(([x,y],i)=>`<i style="--tx:${x}px;--ty:${y}px;--delay:${i*18}ms"></i>`).join('')}</span></div>`;}
'''
app=replace_between(app,'  combatFeedback(', '  battleLogRow(',feedback+'  battleLogRow(','combat feedback and vfx')

battle=r''' battle(){const b=this.game!.s.battle!,cursor=bi(b.cursor,0,b.frames.length-1),f=b.frames[cursor],done=cursor>=b.frames.length-1,enemy=this.content.enemies.find(e=>e.id===b.enemyId)!,sum=b.summary,obj=b.objective,all=b.frames.slice(0,cursor+1).map((row,index)=>({row,index})),visible=this.detailedLog?all:all.filter(x=>x.row.kind==='damage'||this.statusChanges(x.row,x.index,b.frames).length>0),broken=all.reduce((n,x)=>n+(x.row.actor==='p'?(x.row.breakdown?.absorbed??0):0),0),objective=!done&&obj.type==='survive'?`守至第 ${obj.rounds} 回合`:!done&&obj.type==='break'?`破阵 ${Math.min(broken,obj.value??0)} / ${obj.value}`:!done&&enemy.kind==='boss'?'天劫':'';return `${this.heading(done?(b.won?'此战告捷':'此身入劫'):'斗法')}<section class="battle-shell"><div class="battle-context"><span>${done?'历 '+b.rounds+' 回合':f.round?'第 '+f.round+' 回合':'蓄势'}</span>${objective?`<strong>${objective}</strong>`:''}</div><div class="combat-arena">${landscape()}<span class="arena-vignette" aria-hidden="true"></span>${this.fighterFrame(f,'p')}<div class="battle-stage-core"><span class="round-seal">${done?(b.won?'胜':'劫'):f.round||'·'}</span><strong>${esc(done?(b.won?'尘埃落定':'劫数已定'):(f.kind==='ready'?'气机交锋':f.label))}</strong>${!done&&f.detail?`<small>${esc(f.detail)}</small>`:''}</div>${this.fighterFrame(f,'e')}${this.combatVfx(f,cursor,b.frames)}${this.combatFeedback(f,cursor,b.frames)}</div><div class="battle-controls"><div class="speeds" aria-label="战斗速度">${[1,2,4].map(n=>`<button class="${this.speed===n?'active':''}" data-action="speed" data-index="${n}" aria-pressed="${this.speed===n}" aria-label="${n}倍速">${n}×</button>`).join('')}<button data-action="pause" ${done?'disabled':''}>${this.paused?'继续':'暂停'}</button></div>${done?btn('finishBattle',b.won?'收取机缘 '+icon('arrow',16):'回望此生','primary small'):btn('skip','略过','small')}</div><details class="disclosure battle-data" data-panel="combat-stats"><summary>战局</summary><div class="battle-extra"><div>${['p','e'].map(side=>{const x=f[side as 'p'|'e'];return `<section><strong>${esc(x.name)}</strong><div class="stats-grid">${STAT_KEYS.filter(k=>k!=='hp').map(k=>`<span>${this.content.labels.stats[k]} <b>${x.stats[k]}</b></span>`).join('')}</div></section>`;}).join('')}</div>${done?`<div class="battle-summary"><div><span>造成伤害</span><b>${sum.playerDamage}</b></div><div><span>承受伤害</span><b>${sum.enemyDamage}</b></div><div><span>护盾承伤</span><b>${sum.playerShieldAbsorbed}</b></div><div><span>暴击 / 闪避</span><b>${sum.playerCrits} / ${sum.enemyMisses}</b></div><div><span>怒气技</span><b>${sum.playerRageSkills}</b></div><div><span>资源炼化</span><b>${sum.playerConversions}</b></div></div>`:''}</div></details><div class="battle-log-head"><span>战报</span><button class="text-link log-follow" data-action="followLog" hidden>回到最新 ↓</button><span class="log-mode">${this.detailedLog?'详录':'简录'}</span></div><div class="battle-log ${this.detailedLog?'detailed-mode':'simple-mode'}" tabindex="0" role="region" aria-label="可滚动战报">${visible.map(({row,index})=>this.battleLogRow(row,index,b.frames,enemy.name,this.detailedLog)).join('')||'<p class="simple-log-empty">双方蓄势。</p>'}</div></section>`;}
'''
app=replace_between(app,' battle(){',' event(){',battle+' event(){','battle surface')
app_path.write_text(app)

css=css_path.read_text()
marker='/* UI 15.0 combat stage */'
if marker in css: raise RuntimeError('UI15 CSS already applied')
css += r'''

/* UI 15.0 combat stage */
.battle-shell{position:relative}.combat-arena{display:grid;grid-template-columns:minmax(150px,1fr) minmax(88px,.58fr) minmax(150px,1fr);align-items:end;gap:12px;min-height:430px;padding:28px 24px 18px;background:radial-gradient(circle at 50% 34%,#33514566 0,#142620cc 38%,#081310 76%);isolation:isolate}.combat-arena>.landscape{opacity:.38;filter:saturate(.75) contrast(1.05)}.arena-vignette{position:absolute;inset:0;z-index:1;pointer-events:none;background:linear-gradient(90deg,#06110fd9 0,transparent 25%,transparent 75%,#06110fd9 100%),linear-gradient(0deg,#07120f 0,transparent 38%)}.combatant{width:auto;max-width:230px;justify-self:center;z-index:3;display:grid;align-content:end;transition:filter .2s,transform .2s}.combatant.side-p{justify-self:start}.combatant.side-e{justify-self:end}.fighter-art{position:relative;overflow:hidden;aspect-ratio:4/5;border:1px solid #bfa76b55;background:linear-gradient(180deg,#1d352d,#0a1714);box-shadow:0 18px 36px #000a,inset 0 0 0 1px #dfca8b0c;transform:none!important}.fighter-art:after{content:"";position:absolute;inset:auto 0 0;height:40%;background:linear-gradient(transparent,#091510d9);pointer-events:none}.fighter-art .portrait{width:100%;height:100%;object-fit:cover;position:relative;z-index:1}.fighter-aura{position:absolute;width:82%;aspect-ratio:1;left:9%;bottom:7%;border-radius:50%;background:radial-gradient(circle,#d7c27724 0,#6ab4a52a 28%,transparent 68%);filter:blur(8px);z-index:0}.fighter-side-badge{position:absolute;z-index:4;top:8px;left:8px;padding:3px 7px;border:1px solid #d8c07855;background:#07120fe8;color:#d8c078;font:9px var(--sans);letter-spacing:2px}.combatant.side-e .fighter-side-badge{left:auto;right:8px;color:#df9a87;border-color:#c9766655}.fighter-identity{display:flex;align-items:center;justify-content:center;gap:7px;margin:9px 0 8px}.fighter-identity h2{font:18px var(--serif);letter-spacing:2px;margin:0;text-align:center}.turn-mark{font:9px var(--sans);color:#f0d48d;border:1px solid #c7a85e55;padding:2px 5px;background:#c7a85e12}.fighter-bars{display:grid;gap:5px}.fighter-numbers{font:10px ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;justify-content:space-between;gap:8px;color:#aeb6a8}.fighter-numbers b{color:#e3e0c7}.shield-count{color:#a9d8df}.fighter-bars .bar{height:8px;background:#020807aa;border:1px solid #ffffff0c}.fighter-bars .bar>span{display:block;height:100%;background:linear-gradient(90deg,#934b43,#d7765f);box-shadow:0 0 12px #cc675344}.fighter-bars .bar.rage{height:4px}.fighter-bars .bar.rage>span{background:linear-gradient(90deg,#8d6f37,#e3c06c);box-shadow:none}.fighter-core-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:7px}.fighter-core-stats span{text-align:center;font:9px var(--sans);color:#86968c}.fighter-core-stats b{color:#cfd2bd}.combat-statuses{min-height:25px;margin-top:7px;gap:4px}.combat-statuses .status{background:#07120fc7;border-radius:10px;padding:2px 6px}.battle-stage-core{position:relative;z-index:3;align-self:center;text-align:center;display:grid;justify-items:center;gap:7px;margin-bottom:82px}.round-seal{width:46px;height:46px;border:1px solid #d7bd7866;border-radius:50%;display:grid;place-items:center;font:18px Georgia,serif;color:#e5cd8b;background:#091510cc;box-shadow:0 0 34px #d0b46518}.battle-stage-core strong{max-width:150px;font:15px var(--serif);letter-spacing:2px;color:#e7dfbd;text-shadow:0 2px 8px #000}.battle-stage-core small{max-width:170px;color:#899b90;font:9px/1.6 var(--sans)}.combatant.acting{filter:brightness(1.12)}.combatant.side-p.acting{animation:ui15-lunge-p .34s ease-out}.combatant.side-e.acting{animation:ui15-lunge-e .34s ease-out}.combat-vfx{position:absolute;z-index:9;top:36%;left:50%;width:32px;height:32px;pointer-events:none;transform:translate(-50%,-50%) scale(3.15);transform-origin:center;filter:drop-shadow(0 0 8px #ffe59c88);image-rendering:pixelated}.combat-vfx.target-p{left:26%}.combat-vfx.target-e{left:74%}.combat-vfx .vfx-sprite{position:absolute;inset:0;width:32px;height:32px;background-size:192px 256px;background-position-y:calc(var(--row) * -32px);background-repeat:no-repeat;animation:ui15-vfx-strip var(--fx-duration) steps(5,end) both;image-rendering:pixelated}.combat-vfx .vfx-sprite.accent{opacity:.78;animation-delay:45ms;mix-blend-mode:screen}.combat-vfx.critical{transform:translate(-50%,-50%) scale(3.55);filter:drop-shadow(0 0 11px #ffd97acc)}.vfx-particles{position:absolute;inset:0}.vfx-particles i{position:absolute;left:15px;top:15px;width:2px;height:2px;border-radius:50%;background:#f4dda0;box-shadow:0 0 3px #f4dda0;animation:ui15-particle .55s ease-out var(--delay) both}.kind-heal .vfx-particles i{background:#8de1ba;box-shadow:0 0 3px #8de1ba}.kind-dispel .vfx-particles i{background:#bb92d8;box-shadow:0 0 3px #bb92d8}.combat-feedback-layer{z-index:10}.combat-float{top:calc(14% + var(--stack)*31px);background:none;border:0;box-shadow:none;padding:0;font:800 20px/1 var(--sans);letter-spacing:.4px;animation:ui15-number .76s ease-out both}.combat-float.side-p{left:25%}.combat-float.side-e{right:25%}.combat-float b{-webkit-text-stroke:.5px #07100e;text-shadow:0 2px 2px #000,0 0 12px currentColor}.combat-float.damage{color:#ff9b75}.combat-float.damage.crit{font-size:26px;color:#ffd477}.combat-float.heal{color:#8be1b8}.combat-float.shield{color:#9cddea}.combat-float.shield-loss{color:#82aeb9}.combat-float.status-add{font-size:13px;color:#d0a4e6}.combat-float.status-use{font-size:13px;color:#e0c187}.battle-controls{margin:12px 0 10px}.battle-data{margin-top:7px}.battle-log-head{display:flex;align-items:center;gap:10px;margin-top:14px;padding:0 2px 7px;color:#c9c6ac;font:12px var(--serif);letter-spacing:2px}.battle-log-head .log-mode{margin-left:auto;color:#75877d;font:9px var(--sans);letter-spacing:1px}.battle-log{max-height:270px;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable;background:linear-gradient(180deg,#091612,#07110f);border-color:#a18a5330}.battle-log-row.simple{padding:7px 6px;border-bottom:1px solid #ffffff08}.simple-damage{display:grid;grid-template-columns:auto auto 1fr auto;align-items:center;gap:7px}.simple-status-list{display:grid;gap:4px}.simple-status{display:grid;grid-template-columns:36px minmax(0,1fr) auto auto;gap:6px;align-items:center}.ability-card .ability-cost{display:inline-flex;align-self:flex-start;padding:3px 7px;border:1px solid #b99d5c44;background:#c0a45e10;color:#d3bc79;font-size:9px;letter-spacing:.5px}.ability-card .ability-effects p:first-child{color:#d6d9c5;font-size:12px}.ability-card .card-title{line-height:1.15}.ability-card .card-heading{gap:8px}
@keyframes ui15-vfx-strip{from{background-position-x:0}to{background-position-x:-160px}}
@keyframes ui15-particle{0%{opacity:0;transform:translate(0,0) scale(.4)}18%{opacity:1}100%{opacity:0;transform:translate(var(--tx),var(--ty)) scale(.2)}}
@keyframes ui15-number{0%{opacity:0;translate:0 12px;scale:.8}18%{opacity:1;scale:1.08}72%{opacity:1}100%{opacity:0;translate:0 -26px;scale:.96}}
@keyframes ui15-lunge-p{0%{transform:translateX(0)}42%{transform:translateX(11px)}100%{transform:translateX(0)}}
@keyframes ui15-lunge-e{0%{transform:translateX(0)}42%{transform:translateX(-11px)}100%{transform:translateX(0)}}
@media(max-width:760px){.combat-arena{grid-template-columns:minmax(112px,1fr) 54px minmax(112px,1fr);min-height:360px;padding:18px 10px 13px;gap:5px}.combatant{max-width:145px}.fighter-art{aspect-ratio:4/5}.fighter-identity{margin:6px 0}.fighter-identity h2{font-size:14px;letter-spacing:1px}.turn-mark{display:none}.fighter-numbers{font-size:8px}.fighter-core-stats span{font-size:8px}.battle-stage-core{margin-bottom:64px;gap:5px}.round-seal{width:36px;height:36px;font-size:14px}.battle-stage-core strong{font-size:11px;max-width:90px;letter-spacing:1px}.battle-stage-core small{display:none}.combat-vfx{top:31%;transform:translate(-50%,-50%) scale(2.6)}.combat-vfx.critical{transform:translate(-50%,-50%) scale(2.9)}.combat-vfx.target-p{left:24%}.combat-vfx.target-e{left:76%}.combat-float{top:calc(10% + var(--stack)*26px);font-size:16px}.combat-float.damage.crit{font-size:20px}.combat-float.side-p{left:23%}.combat-float.side-e{right:23%}.combat-float.status-add,.combat-float.status-use{font-size:11px}.simple-damage{grid-template-columns:auto 1fr auto}.simple-damage strong{display:none}.battle-log{max-height:220px}.ability-card .ability-effects p:first-child{font-size:11px}}
@media(prefers-reduced-motion:reduce){.combat-vfx .vfx-sprite,.vfx-particles i,.combat-float,.combatant.acting{animation:none!important}.combat-vfx{opacity:.82}}
'''
css_path.write_text(css)

build=build_path.read_text()
build_new=re.sub(r"const generatedNames=\[[^;]+;","const generatedNames=['combat-vfx-atlas'];",build,count=1)
if build_new==build: raise RuntimeError('build generatedNames not replaced')
build_path.write_text(build_new)

pres=pres_path.read_text()
if "export const UI_REVISION='14.1';" not in pres: raise RuntimeError('UI revision baseline mismatch')
pres_path.write_text(pres.replace("export const UI_REVISION='14.1';","export const UI_REVISION='15.0';",1))

pj=pres_json_path.read_text()
if '"revision": "14.1"' not in pj: raise RuntimeError('presentation revision baseline mismatch')
pres_json_path.write_text(pj.replace('"revision": "14.1"','"revision": "15.0"',1))

readme=readme_path.read_text()
readme=readme.replace('界面修订 **14.0**','界面修订 **15.0**').replace('界面修订 **14.1**','界面修订 **15.0**')
if 'UI 15.0' not in readme:
    readme += '\n## UI 15.0\n\n战斗界面改为双角色舞台；攻击、暴击、恢复、护盾、状态施加与状态消耗使用单张压缩像素特效图集逐帧播放，并叠加纯 CSS 粒子。技能与法宝继续使用原 SVG 视觉。\n'
readme_path.write_text(readme)

test_path.write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,statSync,existsSync} from 'node:fs';

test('UI15 uses one compressed sprite atlas and keeps ability SVG art',()=>{
 const app=readFileSync('src/app.ts','utf8'),css=readFileSync('src/style.css','utf8'),build=readFileSync('scripts/build.mjs','utf8');
 assert(app.includes("const VFX_ATLAS='./assets/generated/combat-vfx-atlas.webp'"));
 assert(statSync('assets/generated/combat-vfx-atlas.webp').size<100000);
 for(const old of ['combat-damage.webp','combat-heal.webp','combat-shield.webp','combat-dispel.webp'])assert.equal(existsSync('assets/generated/'+old),false);
 const card=app.slice(app.indexOf(' card('),app.indexOf(' rewards()'));
 assert(card.includes('sigil(a.art'));
 assert(!card.includes('VFX_ATLAS'));
 assert(css.includes('@keyframes ui15-vfx-strip'));
 assert(build.includes("const generatedNames=['combat-vfx-atlas']"));
});

test('combat overlay exposes damage healing shields and status changes without touching engine rules',()=>{
 const app=readFileSync('src/app.ts','utf8');
 for(const kind of ["kind:'damage'","kind:'heal'","kind:'shield'","kind:'shield-loss'","kind:'status-add'","kind:'status-use'"])assert(app.includes(kind));
 assert(app.includes('combatVfx(frame:Frame'));
 assert(app.includes("kind='attack'"));
 assert(app.includes("kind='dispel'"));
 assert(app.includes('vfx-particles'));
 assert.equal(readFileSync('src/engine.ts','utf8').includes('combatVfx'),false);
});

test('UI15 keeps presentation-only compatibility',()=>{
 assert(readFileSync('src/presentation.ts','utf8').includes("UI_REVISION='15.0'"));
 assert.equal(JSON.parse(readFileSync('data/presentation.json','utf8')).revision,'15.0');
 assert.equal(JSON.parse(readFileSync('package.json','utf8')).version,'3.0.0');
});
''')

package=Path('package.json').read_text()
if 'tests/combat-feedback.test.mjs' not in package: raise RuntimeError('test script baseline mismatch')
Path('package.json').write_text(package)

print('UI15 patch applied; atlas bytes',asset_path.stat().st_size)
