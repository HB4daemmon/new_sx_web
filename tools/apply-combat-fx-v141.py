from pathlib import Path

root=Path('.')
app_path=root/'src/app.ts'
css_path=root/'src/style.css'
build_path=root/'scripts/build.mjs'
presentation_path=root/'src/presentation.ts'
presentation_json=root/'data/presentation.json'
package_path=root/'package.json'
test_path=root/'tests/combat-feedback.test.mjs'

app=app_path.read_text(encoding='utf-8')
marker="const RARITY_LABELS:Record<string,string>={common:'凡品',rare:'稀有',mythic:'神话'};"
insert=marker+"\nconst GENERATED_ASSET_ROOT='./assets/generated/';\nconst generatedFx=(name:string)=>`<img class=\"combat-fx-icon\" src=\"${GENERATED_ASSET_ROOT}${name}.webp\" alt=\"\" decoding=\"async\">`;"
assert app.count(marker)==1
app=app.replace(marker,insert,1)

status_method="  statusChanges(frame:Frame,index:number,frames:Frame[]){if(index<=0)return [] as {side:'p'|'e';name:string;status:string;before:number;after:number}[];const prev=frames[index-1],enemy=this.content.enemies.find(e=>e.id===this.game!.s.battle!.enemyId)!,out:{side:'p'|'e';name:string;status:string;before:number;after:number}[]=[];for(const side of ['p','e'] as const){const before=prev[side],after=frame[side],name=side==='p'?this.game!.s.name:enemy.name;for(const k of new Set([...Object.keys(before.status),...Object.keys(after.status)])){const a=before.status[k]??0,b=after.status[k]??0;if(a!==b)out.push({side,name,status:k,before:a,after:b});}}return out;}"
assert app.count(status_method)==1
feedback="""
  combatFeedback(frame:Frame,index:number,frames:Frame[]){if(index<=0)return '';const prev=frames[index-1],items:{side:'p'|'e';kind:string;text:string;crit?:boolean}[]=[];for(const side of ['p','e'] as const){const before=prev[side],after=frame[side],hp=after.hp-before.hp,shield=after.shield-before.shield;if(hp<0)items.push({side,kind:'damage',text:`-${Math.abs(hp)}`,crit:!!frame.crit&&frame.actor!==side});else if(hp>0)items.push({side,kind:'heal',text:`+${hp} 生命`});if(shield>0)items.push({side,kind:'shield',text:`+${shield} 护盾`});else if(shield<0)items.push({side,kind:'shield-loss',text:`-${Math.abs(shield)} 护盾`});for(const key of new Set([...Object.keys(before.status),...Object.keys(after.status)])){const delta=(after.status[key]??0)-(before.status[key]??0);if(delta<0)items.push({side,kind:'dispel',text:`${esc(this.content.labels.statuses[key]??key)} -${Math.abs(delta)}`});}}const count={p:0,e:0};return `<div class=\"combat-feedback-layer\" aria-hidden=\"true\">${items.slice(0,8).map(item=>{const stack=count[item.side]++,asset=item.kind==='damage'?'combat-damage':item.kind==='heal'?'combat-heal':item.kind.startsWith('shield')?'combat-shield':'combat-dispel';return `<span class=\"combat-float side-${item.side} ${item.kind} ${item.crit?'crit':''}\" style=\"--stack:${stack}\">${generatedFx(asset)}<b>${item.text}</b></span>`;}).join('')}</div>`;}
"""
app=app.replace(status_method,status_method+feedback,1)
old="<div class=\"combat-arena\">${landscape()}${this.fighterFrame(f,'p')}<div class=\"versus\">斗</div>${this.fighterFrame(f,'e')}</div>"
new="<div class=\"combat-arena\">${landscape()}${this.fighterFrame(f,'p')}<div class=\"versus\">斗</div>${this.fighterFrame(f,'e')}${this.combatFeedback(f,cursor,b.frames)}</div>"
assert app.count(old)==1
app=app.replace(old,new,1)
app_path.write_text(app,encoding='utf-8')

css=css_path.read_text(encoding='utf-8')
assert '.combat-feedback-layer{' not in css
css += """

/* Generated raster art is intentionally limited to combat feedback. Skill, slot and ability artwork stays SVG. */
.combat-feedback-layer{position:absolute;inset:0;z-index:8;pointer-events:none;overflow:hidden}
.combat-float{position:absolute;top:calc(10% + var(--stack)*34px);display:flex;align-items:center;gap:5px;padding:3px 8px 3px 4px;border-radius:18px;background:#07110fe8;border:1px solid #ffffff22;box-shadow:0 5px 18px #0009;font:700 15px/1.1 var(--sans);letter-spacing:.5px;animation:combat-float-pop .86s ease-out both;white-space:nowrap}
.combat-float.side-p{left:21%;transform:translateX(-50%)}.combat-float.side-e{right:21%;transform:translateX(50%)}
.combat-fx-icon{width:23px;height:23px;object-fit:contain;flex:0 0 23px;filter:drop-shadow(0 1px 5px #0008)}
.combat-float.damage{color:#ffd0a4;border-color:#d77b5555}.combat-float.damage.crit{font-size:18px;color:#ffe0a1;box-shadow:0 0 24px #dd744855}
.combat-float.heal{color:#a9e4c3;border-color:#75bd9866}.combat-float.shield{color:#a8dfe3;border-color:#7ac2c866}.combat-float.shield-loss{color:#8fb9bd;border-color:#6d9ca055}.combat-float.dispel{color:#d8b7e8;border-color:#aa81be66}
@keyframes combat-float-pop{0%{opacity:0;translate:0 14px;scale:.78}18%{opacity:1;scale:1.08}70%{opacity:1}100%{opacity:0;translate:0 -24px;scale:1}}
@media(max-width:760px){.combat-float{top:calc(7% + var(--stack)*29px);font-size:12px;padding:2px 6px 2px 3px}.combat-float.damage.crit{font-size:14px}.combat-float.side-p{left:20%}.combat-float.side-e{right:20%}.combat-fx-icon{width:19px;height:19px;flex-basis:19px}}
@media(prefers-reduced-motion:reduce){.combat-float{animation:none;opacity:1}}
"""
css_path.write_text(css,encoding='utf-8')

build=build_path.read_text(encoding='utf-8')
build=build.replace("import {readFileSync,writeFileSync,mkdirSync,copyFileSync,cpSync,rmSync} from 'node:fs';","import {readFileSync,writeFileSync,mkdirSync,copyFileSync,cpSync,rmSync,existsSync} from 'node:fs';")
needle="copyFileSync('data/presentation.json',join(OUT,'data/presentation.json'));"
assert build.count(needle)==1
build=build.replace(needle,needle+"\nif(existsSync('assets'))cpSync('assets',join(OUT,'assets'),{recursive:true});",1)
needle="const html=`<!doctype html>"
assert build.count(needle)==1
inline="const generatedNames=['combat-damage','combat-heal','combat-shield','combat-dispel'];\nlet offlineScript=script;\nfor(const name of generatedNames){const rel=`assets/generated/${name}.webp`;if(existsSync(rel)){const uri=`data:image/webp;base64,${readFileSync(rel).toString('base64')}`;offlineScript=offlineScript.replaceAll(`./${rel}`,uri);}}\n"
build=build.replace(needle,inline+needle,1)
assert "<script>${script}\ncustomElements.define" in build
build=build.replace("<script>${script}\ncustomElements.define","<script>${offlineScript}\ncustomElements.define",1)
build_path.write_text(build,encoding='utf-8')

p=presentation_path.read_text(encoding='utf-8')
assert "export const UI_REVISION='14.0';" in p
presentation_path.write_text(p.replace("export const UI_REVISION='14.0';","export const UI_REVISION='14.1';",1),encoding='utf-8')
p= presentation_json.read_text(encoding='utf-8')
assert '"revision": "14.0"' in p
presentation_json.write_text(p.replace('"revision": "14.0"','"revision": "14.1"',1),encoding='utf-8')

package=package_path.read_text(encoding='utf-8')
old='node --test tests/engine.test.mjs tests/presentation.test.mjs tests/content-pool.test.mjs'
new='node --test tests/engine.test.mjs tests/presentation.test.mjs tests/content-pool.test.mjs tests/combat-feedback.test.mjs'
assert old in package
package_path.write_text(package.replace(old,new,1),encoding='utf-8')

test_path.write_text("""import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {readFileSync,statSync} from 'node:fs';\n\ntest('generated combat art stays small and isolated from ability SVGs',()=>{\n const app=readFileSync('src/app.ts','utf8'),css=readFileSync('src/style.css','utf8');\n for(const name of ['combat-damage','combat-heal','combat-shield','combat-dispel']){\n  assert(app.includes(name));\n  assert(statSync(`assets/generated/${name}.webp`).size<4096);\n }\n const card=app.slice(app.indexOf(' card('),app.indexOf(' rewards()'));\n assert(card.includes('sigil(a.art'));\n assert(!card.includes('generatedFx('));\n assert(css.includes('.combat-feedback-layer'));\n});\n\ntest('combat overlay covers hp, shield and debuff consumption without changing rules',()=>{\n const app=readFileSync('src/app.ts','utf8');\n assert(app.includes("kind:'damage'"));\n assert(app.includes("kind:'heal'"));\n assert(app.includes("kind:'shield'"));\n assert(app.includes("kind:'shield-loss'"));\n assert(app.includes("kind:'dispel'"));\n assert.equal(readFileSync('src/engine.ts','utf8').includes('combatFeedback'),false);\n});\n""",encoding='utf-8')
print('combat feedback UI 14.1 applied')
