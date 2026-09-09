from pathlib import Path
import re
import sys

root=Path(sys.argv[1] if len(sys.argv)>1 else '.')
engine_path=root/'src/engine.ts'
app_path=root/'src/app.ts'
art_path=root/'src/art.ts'
style_path=root/'src/style.css'
gen_path=root/'scripts/create-content.py'
test_path=root/'tests/engine.test.mjs'
doc_path=root/'docs/GAMEPLAY_V12_CHARACTERS.md'


def once(text, old, new, label):
    n=text.count(old)
    if n!=1:
        raise RuntimeError(f'{label}: expected 1 match, got {n}')
    return text.replace(old,new,1)

# ---------- engine metadata ----------
engine=engine_path.read_text(encoding='utf-8')
engine=once(
    engine,
    "export interface Story {id:string;act:number;major:boolean;name:string;npc:string;art:string;text:string;choices:Choice[];phases?:EventPhase[];startPhase?:string;profile?:'A'|'B';weight?:number;maxPerRun?:number;category?:'encounter'|'bargain'|'trial'|'echo'|'secret'|'major';hiddenOnly?:boolean;relevance?:Condition[];}",
    "export interface Story {id:string;act:number;major:boolean;name:string;npc:string;art:string;text:string;choices:Choice[];phases?:EventPhase[];startPhase?:string;profile?:'A'|'B';weight?:number;maxPerRun?:number;category?:'encounter'|'bargain'|'trial'|'echo'|'secret'|'major';hiddenOnly?:boolean;relevance?:Condition[];character?:string;episode?:number;episodes?:number;relationKey?:string;}",
    'story character metadata'
)
engine_path.write_text(engine,encoding='utf-8')

# ---------- authored portraits ----------
art=art_path.read_text(encoding='utf-8')
art=once(
    art,
    "const robe=kind==='nezha'?'#aa4e42':kind==='guardian'?'#777157':kind==='sorcerer'?'#6a7771':evil?'#706259':'#416e69';",
    "const robe=kind==='nezha'?'#aa4e42':kind==='yangjian'?'#3f6571':kind==='shengongbao'?'#57485f':kind==='zhaogongming'?'#403b35':kind==='guardian'?'#777157':kind==='sorcerer'?'#6a7771':evil?'#706259':'#416e69';",
    'portrait robe palette'
)
portrait_insert="""  else if(kind==='yangjian')figure+=`<path d=\"m94 61 25-31 30 30-9 9-38-1Z\" fill=\"#506d76\" stroke=\"${trim}\"/><path d=\"M115 86h12m-9-7 4-5 4 5-4 5Z\" fill=\"#d7c37f\" stroke=\"#53625d\"/><path d=\"m178 88-27 151 8 2 27-151m-19 27 29 5\" stroke=\"#d2c9a0\" stroke-width=\"4\" fill=\"none\"/><path d=\"m61 159 35 25-9 13-39-20\" fill=\"${skin}\" stroke=\"#31433e\"/><path d=\"M82 131q38 22 77 0\" stroke=\"#9db5b3\" fill=\"none\"/>`;
  else if(kind==='shengongbao')figure+=`<path d=\"M96 61q6-38 27-39 22 2 29 39l-16-9-27 1Z\" fill=\"#2b3135\" stroke=\"${trim}\"/><path d=\"m109 111 12 11 13-10-4 44-10 17-12-25Z\" fill=\"#292d2e\"/><path d=\"m174 78-6 166m6-166q34 17 29 48m-30-42 19 4\" stroke=\"#c9b991\" stroke-width=\"3\" fill=\"none\"/><path d=\"m57 170 34 13-7 13-40-12\" fill=\"${skin}\"/><path d=\"M83 136q36 18 76 0\" stroke=\"#8f7592\" fill=\"none\"/>`;
  else if(kind==='zhaogongming')figure+=`<path d=\"M94 62q12-34 28-35 20 2 30 34l-13-5-34 1Z\" fill=\"#272b2b\" stroke=\"#d2b665\"/><path d=\"m105 108 16 14 17-13-6 51-11 18-13-30Z\" fill=\"#252827\"/><path d=\"m55 156 43 22-8 15-47-22\" fill=\"${skin}\"/><path d=\"M181 74q-25 49-9 101t-17 66\" stroke=\"#d2b665\" stroke-width=\"5\" fill=\"none\"/><g fill=\"#c8aa53\" stroke=\"#f0d98a\">${[0,1,2,3].map(i=>`<circle cx=\"${160+i*13}\" cy=\"${176+(i%2)*13}\" r=\"6\"/>`).join('')}</g><path d=\"M82 135q40 22 81 0\" stroke=\"#b39a55\" fill=\"none\"/>`;
"""
art,n=re.subn(r"(  else if\(kind==='nezha'\)figure\+=.*?;\n)",lambda m:m.group(1)+portrait_insert,art,count=1)
if n!=1:
    raise RuntimeError(f'portrait branch insertion: expected 1 match, got {n}')
art_path.write_text(art,encoding='utf-8')

# ---------- event UI + character ledger ----------
app=app_path.read_text(encoding='utf-8')
old="category=catLabels[event.category??(event.major?'major':'encounter')]??'奇遇';return"
new="category=catLabels[event.category??(event.major?'major':'encounter')]??'奇遇',stateLabels:{[k:string]:string}={deal:'初结旧债',met:'只曾相识',deeper:'债入二重',watching:'彼此试探',scheme:'局中同谋',exposed:'密札已明',burned:'当面焚信',collected:'收下终礼',cleared:'旧债见光',ashes:'灰烬归还',settled:'以财断缘',witnessed:'有人见证'},relation=event.relationKey?s.threads[event.relationKey]:undefined,relationText=relation?(stateLabels[relation]??relation):undefined;return"
app=once(app,old,new,'event relation state')
app=once(app,"${event.hiddenOnly?'THE UNKNOWN':event.major?'A TURN OF FATE':'AN ENCOUNTER'}","${event.hiddenOnly?'THE UNKNOWN':event.major?'A TURN OF FATE':event.character?'CHARACTER ENCOUNTER':'AN ENCOUNTER'}",'event eyebrow')
app=once(app,"<span class=\"event-category\">${esc(category)}</span><div class=\"event-phase-mark\">","<span class=\"event-category\">${esc(category)}</span>${event.character?`<span class=\"character-chip\">${esc(event.character)} · 第 ${event.episode??1}/${event.episodes??1} 遇</span>`:''}${relationText?`<span class=\"relation-chip\">${esc(relationText)}</span>`:''}<div class=\"event-phase-mark\">",'event character chips')
app=once(app,"karma(){const s=this.game!.s;return","karma(){const s=this.game!.s,stateLabels:{[k:string]:string}={deal:'初结旧债',met:'只曾相识',deeper:'债入二重',watching:'彼此试探',scheme:'局中同谋',exposed:'密札已明',burned:'当面焚信',collected:'收下终礼',cleared:'旧债见光',ashes:'灰烬归还',settled:'以财断缘',witnessed:'有人见证'},arcs=[...new Map(this.content.events.filter(e=>e.character&&e.relationKey).map(e=>[e.relationKey!,{key:e.relationKey!,name:e.character!,total:e.episodes??1}])).values()];return",'karma character data')
thread_marker="${Object.keys(s.threads).length?`<div class=\"thread-grid\">"
character_panel="${arcs.length?`<div class=\"character-ledger-title\">人物缘分</div><div class=\"character-ledger\">${arcs.map(a=>{const seen=this.content.events.filter(e=>e.relationKey===a.key&&(s.seenEvents[e.id]??0)>0).length,raw=s.threads[a.key],state=raw?(stateLabels[raw]??raw):'尚未结缘';return `<div class=\"character-relation\"><div><strong>${esc(a.name)}</strong><span>${seen}/${a.total} 遇</span></div><p>${esc(state)}</p></div>`;}).join('')}</div>`:''}"
app=once(app,thread_marker,character_panel+thread_marker,'karma character ledger')
app_path.write_text(app,encoding='utf-8')

style=style_path.read_text(encoding='utf-8')
style += r'''

/* Gameplay V12 — named character arcs and relationship ledger. */
.character-chip,.relation-chip{display:inline-flex;padding:4px 8px;border:1px solid #9e85584a;background:#241f16;color:#d5bd7f;font-size:8px;letter-spacing:1px}.relation-chip{border-color:#6f927c4f;background:#14241d;color:#9fb7a7}.character-ledger-title{margin:20px 0 8px;font:12px var(--serif);letter-spacing:3px;color:#c9b77f}.character-ledger{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:14px}.character-relation{padding:10px 12px;border:1px solid #85795b35;background:linear-gradient(120deg,#1b241e,#111a17)}.character-relation>div{display:flex;align-items:center;justify-content:space-between;gap:10px}.character-relation strong{font:15px var(--serif);letter-spacing:2px;color:#d8ccb0}.character-relation span{font:8px ui-monospace,monospace;color:#7f9188}.character-relation p{margin-top:5px;font-size:9px;color:#a9b3a8}.event-page:has(.character-chip) .event-portrait{filter:drop-shadow(0 12px 26px #0008)}
@media(max-width:760px){.event-meta-row{flex-wrap:wrap}.character-chip,.relation-chip{font-size:7px;padding:3px 6px}.character-ledger{grid-template-columns:1fr}.character-relation{padding:9px 10px}}
'''
style_path.write_text(style,encoding='utf-8')

# ---------- content: reuse the existing 24-event budget ----------
gen=gen_path.read_text(encoding='utf-8')
gen=once(gen,"C['version']='2.8.0'","C['version']='2.9.0'",'content version')
gen=once(gen,"C['rulesVersion']='2.8.0'","C['rulesVersion']='2.9.0'",'rules version')
marker="assert len(A)==43 and len(E)==20 and len(C['events'])==24"
if gen.count(marker)!=1:
    raise RuntimeError('V12 insertion marker not unique')
block=r'''

# Gameplay V12 character pass: four persistent people, no event-count inflation.
C['labels']['threads'].update({'char_nezha':'哪吒缘分','char_yangjian':'杨戬缘分','char_zhaogongming':'赵公明缘分'})
C['labels']['facts'].update({'met_nezha':'红绫初见','met_yangjian':'天眼相识','met_zhaogongming':'峨眉散财客'})

def v12_story(eid,name,npc,art,character,episode,episodes,relation_key,text,choices,category='encounter',relevance=None,weight=2):
 ev=next(e for e in C['events'] if e['id']==eid)
 ev.update(name=name,npc=npc,art=art,character=character,episode=episode,episodes=episodes,relationKey=relation_key,text=text,choices=choices,category=category,hiddenOnly=False,profile='A',maxPerRun=1,weight=weight,relevance=relevance or [])
 ev.pop('phases',None);ev.pop('startPhase',None)
 return ev

# 哪吒：红绫初见 -> 风雷前夜 -> 陈塘问心 -> 莲火余温
v12_story('event.0.hermit','红绫初见','哪吒','nezha','哪吒',1,4,'char_nezha','朝歌城外，一个红绫少年把两个孩子推到墙后，自己提枪拦在追兵前。他没有问你是哪一边，只问：“帮不帮？”',[
 v11_meta(option('cover','替他挡下追兵','失去 5 生命，善念 +1；哪吒会记住你替他挡过这一回。',[eff('damage',value=5),eff('add_counter',key='mercy',value=1),eff('set_fact',key='met_nezha',value=True),eff('advance_thread',key='char_nezha',value='信你一回')],conditions=[cond('hp_above_absolute',value=5)]),'cost','陈塘再会时，他会记得你没有退。'),
 v11_pc('duel','与他过一招','公开速度检定；不论胜负，你们都会记住这一招。',check=v11_check('speed',50,10,'你先半步收招：速度 +1，修为 +20。',[eff('modify_stat',stat='speed',value=1),eff('gain_xp',value=20),eff('set_fact',key='met_nezha',value=True),eff('advance_thread',key='char_nezha',value='棋逢对手')],'火尖枪擦肩而过：失去 6 生命。',[eff('damage',value=6),eff('set_fact',key='met_nezha',value=True),eff('advance_thread',key='char_nezha',value='一招之缘')]),tone='check',consequence='他会用“那一招”认出你。'),
 v11_meta(option('warn','劝他先保自己','气运 +1，修为 +10；哪吒嘴上不服，却记住了这句话。',[eff('modify_stat',stat='luck',value=1),eff('gain_xp',value=10),eff('set_fact',key='met_nezha',value=True),eff('advance_thread',key='char_nezha',value='话不投机')]),'fate','你们第一次见面并不投缘。')
])

v12_story('event.1.hermit','风雷前夜','哪吒','nezha','哪吒',2,4,'char_nezha','陈塘关外雷云压得很低。哪吒坐在城墙上晃着腿，认出你后只往旁边挪了半尺。',[
 v11_meta(option('back','城外交给我','只有他曾信过你时可选：恢复 10 生命，防御 +1，善念 +1。',[eff('heal',value=10),eff('modify_stat',stat='defense',value=1),eff('add_counter',key='mercy',value=1),eff('advance_thread',key='char_nezha',value='互托后路')],conditions=[cond('thread_is',key='char_nezha',text='信你一回')]),'fate','你们开始把后背交给彼此。'),
 v11_pc('again','再比最后一招','若初见以武相识，可再接一招。',conditions=[cond('thread_is',key='char_nezha',text='棋逢对手')],check=v11_check('attack',48,20,'两枪一触即分：攻击 +1，速度 +1。',[eff('modify_stat',stat='attack',value=1),eff('modify_stat',stat='speed',value=1),eff('advance_thread',key='char_nezha',value='惺惺相惜')],'你慢了半拍：失去 8 生命。',[eff('damage',value=8),eff('advance_thread',key='char_nezha',value='仍欠一招')]),tone='check',consequence='这一战会改变他对你的称呼。'),
 v11_meta(option('listen','这次我不劝，只听你说','若第一次话不投机：修为 +18，气运 +1，关系改为重新相看。',[eff('gain_xp',value=18),eff('modify_stat',stat='luck',value=1),eff('advance_thread',key='char_nezha',value='重新相看')],conditions=[cond('thread_is',key='char_nezha',text='话不投机')]),'fate','你把第一次没说完的话听完。'),
 v11_meta(option('people','先把百姓送出城','善念 +1，恢复 6 生命；即使此前不熟，也能与他共同护一次陈塘。',[eff('add_counter',key='mercy',value=1),eff('heal',value=6),eff('set_fact',key='met_nezha',value=True),eff('advance_thread',key='char_nezha',value='共护陈塘')]),'safe','你们的关系落在同一城百姓身上。')
],relevance=[cond('has_fact',key='met_nezha')])

major1=next(e for e in C['events'] if e['id']=='major.1')
major1.update(character='哪吒',episode=3,episodes=4,relationKey='char_nezha')
for ch,state in zip(major1['choices'],['生死并肩','殊途仍记','各护人间']):
 ch['effects'] += [eff('set_fact',key='met_nezha',value=True),eff('advance_thread',key='char_nezha',value=state)]

v12_story('event.2.hermit','莲火余温','哪吒','nezha','哪吒',4,4,'char_nezha','西岐夜里，一点莲火落在你掌心。哪吒没有现身，只把陈塘之后没说完的话留在火里。',[
 v11_meta(option('ribbon','接住红绫旧约','若陈塘与哪吒并肩：修为 +30，恢复 12 生命，善念 +1。',[eff('gain_xp',value=30),eff('heal',value=12),eff('add_counter',key='mercy',value=1),eff('advance_thread',key='char_nezha',value='同道')],conditions=[cond('thread_is',key='act_1_fate',text='nezha')]),'fate','哪吒线收束为“同道”。'),
 v11_meta(option('scale','把龙鳞放回海边','若当时选择调停龙族：防御 +1，气运 +2；你们殊途，却不再彼此误解。',[eff('modify_stat',stat='defense',value=1),eff('modify_stat',stat='luck',value=2),eff('advance_thread',key='char_nezha',value='殊途')],conditions=[cond('thread_is',key='act_1_fate',text='dragon')]),'fate','哪吒线收束为“殊途”。'),
 v11_meta(option('letter','念完百姓来信','若当时护送百姓：恢复 18 生命，善念 +1。',[eff('heal',value=18),eff('add_counter',key='mercy',value=1),eff('advance_thread',key='char_nezha',value='人间故人')],conditions=[cond('thread_is',key='act_1_fate',text='neutral')]),'fate','哪吒线收束为“人间故人”。'),
 v11_meta(option('quiet','不替莲火命名','修为 +12，让这段关系停在原处。',[eff('gain_xp',value=12)]),'safe','不强行改变你们已经形成的关系。')
],relevance=[cond('has_fact',key='met_nezha')])

# 杨戬：天眼试心 -> 刀下问路 -> 西岐选道 -> 天眼照榜
v12_story('event.1.ruins','天眼试心','杨戬','yangjian','杨戬',1,4,'char_yangjian','山道上，一个持三尖两刃刀的青年挡住去路。他没有报姓名，额间却有一道极淡的金线。',[
 v11_pc('open','让他照见因果','公开命中检定；成功意味着你没有在他的天眼前躲闪。',check=v11_check('hit',50,12,'天眼一照即收：命中 +2，修为 +18。',[eff('modify_stat',stat='hit',value=2),eff('gain_xp',value=18),eff('set_fact',key='met_yangjian',value=True),eff('advance_thread',key='char_yangjian',value='坦荡相识')],'你下意识避开那道目光：失去 5 生命。',[eff('damage',value=5),eff('set_fact',key='met_yangjian',value=True),eff('advance_thread',key='char_yangjian',value='被他看穿')]),tone='check',consequence='杨戬会记得你是否敢直视天眼。'),
 v11_pc('blade','以兵刃回答','公开攻击检定。',check=v11_check('attack',47,19,'三尖刀压到半途便收：攻击 +1，修为 +20。',[eff('modify_stat',stat='attack',value=1),eff('gain_xp',value=20),eff('set_fact',key='met_yangjian',value=True),eff('advance_thread',key='char_yangjian',value='以武相识')],'刀风逼退三步：失去 7 生命。',[eff('damage',value=7),eff('set_fact',key='met_yangjian',value=True),eff('advance_thread',key='char_yangjian',value='刃下留名')]),tone='check',consequence='以后他会先看你的刀，再听你的话。'),
 v11_meta(option('fire','让他看体内妖火','只有曾接受妖力时可选：失去 5 生命，修为 +25；杨戬记下这团火。',[eff('damage',value=5),eff('gain_xp',value=25),eff('set_fact',key='met_yangjian',value=True),eff('advance_thread',key='char_yangjian',value='见过妖火')],conditions=[cond('has_fact',key='accepted_demon_power'),cond('hp_above_absolute',value=5)]),'cost','他知道你体内藏着什么。'),
 v11_meta(option('road','只问西岐怎么走','气运 +1，修为 +10，只留一个点头之交。',[eff('modify_stat',stat='luck',value=1),eff('gain_xp',value=10),eff('set_fact',key='met_yangjian',value=True),eff('advance_thread',key='char_yangjian',value='点头之交')]),'safe','不欠试炼，也不求认可。')
])

v12_story('event.2.ruins','刀下问路','杨戬','yangjian','杨戬',2,4,'char_yangjian','西岐阵前，杨戬这次没有挡路，只把三尖刀横在膝上：“上一次我看你。今天你自己说，要往哪边走。”',[
 v11_meta(option('letter','问那封密札','若你曾把申公豹密札交给杨戬：阐教 +1，修为 +25；你们开始共同追查这条线。',[eff('add_counter',key='chan_relation',value=1),eff('gain_xp',value=25),eff('set_fact',key='met_yangjian',value=True),eff('advance_thread',key='char_yangjian',value='共查密札')],conditions=[cond('thread_is',key='shen_gongbao',text='exposed')]),'fate','申公豹线第一次真正碰到杨戬线。'),
 v11_pc('three','再接三招','若曾以武相识，可再接他的三招。',conditions=[cond('thread_is',key='char_yangjian',text='以武相识')],check=v11_check('defense',50,17,'三招之后你仍站在原地：防御 +2，修为 +18。',[eff('modify_stat',stat='defense',value=2),eff('gain_xp',value=18),eff('advance_thread',key='char_yangjian',value='刃下知己')],'第三刀震得虎口发麻：失去 10 生命。',[eff('damage',value=10),eff('advance_thread',key='char_yangjian',value='还差半步')]),tone='check',consequence='成功后，杨戬会把你当成能托付战场的人。'),
 v11_meta(option('seal_fire','请他封住妖火','若妖力仍在体内：失去 8 生命，妖力因果清除，防御 +2，善念 +1。',[eff('damage',value=8),eff('set_fact',key='accepted_demon_power',value=False),eff('modify_stat',stat='defense',value=2),eff('add_counter',key='mercy',value=1),eff('advance_thread',key='char_yangjian',value='替你封火')],conditions=[cond('has_fact',key='accepted_demon_power'),cond('hp_above_absolute',value=8)]),'cost','这是少数可以主动清掉“妖力加身”的人物选择。'),
 v11_meta(option('walk','同行一段','恢复 8 生命，修为 +18，把关系留在并肩一程。',[eff('heal',value=8),eff('gain_xp',value=18),eff('set_fact',key='met_yangjian',value=True),eff('advance_thread',key='char_yangjian',value='并肩一程')]),'safe','没有阵营承诺，只同行这一段。')
],category='trial',relevance=[cond('has_fact',key='met_yangjian')])

major2=next(e for e in C['events'] if e['id']=='major.2')
major2.update(character='杨戬',episode=3,episodes=4,relationKey='char_yangjian',art='yangjian')
for ch,state in zip(major2['choices'],['同道','分道','敬而远之']):
 ch['effects'] += [eff('set_fact',key='met_yangjian',value=True),eff('advance_thread',key='char_yangjian',value=state)]

v12_story('event.3.ruins','天眼照榜','杨戬','yangjian','杨戬',4,4,'char_yangjian','万仙阵外，杨戬收刀站在云下。他最后一次睁开天眼，却没有替你说“该”或“不该”。',[
 v11_meta(option('guard','请他替你守一刻','若西岐助阐教：恢复 15 生命，阐教 +1；关系收束为生死可托。',[eff('heal',value=15),eff('add_counter',key='chan_relation',value=1),eff('advance_thread',key='char_yangjian',value='生死可托')],conditions=[cond('thread_is',key='act_2_fate',text='chan')]),'fate','杨戬线收束为“生死可托”。'),
 v11_meta(option('enemy','让他把刀收回去','若西岐为截教留一线：攻击 +2，逆命 +1；他承认你是可敬之敌。',[eff('modify_stat',stat='attack',value=2),eff('add_counter',key='defiance',value=1),eff('advance_thread',key='char_yangjian',value='可敬之敌')],conditions=[cond('thread_is',key='act_2_fate',text='jie')]),'fate','杨戬线收束为“可敬之敌”。'),
 v11_meta(option('own','请他只看，不劝','若西岐不入两教：气运 +3，修为 +20；你们各走其道。',[eff('modify_stat',stat='luck',value=3),eff('gain_xp',value=20),eff('advance_thread',key='char_yangjian',value='各走其道')],conditions=[cond('thread_is',key='act_2_fate',text='free')]),'fate','杨戬线收束为“各走其道”。'),
 v11_meta(option('gossip','问申公豹最后去了哪里','若曾共同查过密札：修为 +20，善念 +1。',[eff('gain_xp',value=20),eff('add_counter',key='mercy',value=1)],conditions=[cond('thread_is',key='char_yangjian',text='共查密札')]),'safe','这是杨戬线与申公豹线的尾声回扣。')
],category='trial',relevance=[cond('has_fact',key='met_yangjian')])

# 申公豹沿用 V11 的四幕债线，但明确成为人物弧并与杨戬/赵公明相交。
for i in range(4):
 ev=next(e for e in C['events'] if e['id']==f'event.{i}.deal')
 ev.update(character='申公豹',episode=i+1,episodes=4,relationKey='shen_gongbao',art='shengongbao',category='bargain',weight=2,profile='A',maxPerRun=1)
# 交给杨戬的密札直接建立杨戬人物关系，即便此前没碰到他的普通事件。
deal2=next(e for e in C['events'] if e['id']=='event.2.deal')
expose=next(ch for ch in deal2['choices'] if ch['id']=='expose')
expose['effects'] += [eff('set_fact',key='met_yangjian',value=True),eff('advance_thread',key='char_yangjian',value='密札相识')]

# 赵公明：峨眉散财客 -> 金鞭已折 -> 榜前一念
v12_story('event.0.ruins','峨眉散财客','赵公明','zhaogongming','赵公明',1,3,'char_zhaogongming','官道旁粮仓刚烧过，一个黑袍道人把金珠一颗颗换成米袋。别人叫他散财，他却说：“财不救人时，只是石头。”',[
 v11_meta(option('pay','添二十灵石','需要 20 灵石：灵石 -20，善念 +1；赵公明记你一个“肯舍”。',[eff('gain_currency',value=-20),eff('add_counter',key='mercy',value=1),eff('set_fact',key='met_zhaogongming',value=True),eff('advance_thread',key='char_zhaogongming',value='重义')],conditions=[cond('currency_at_least',value=20)]),'cost','终幕再见时，他会记得你肯不肯舍财。'),
 v11_pc('coin','与他赌一枚铜钱','需要至少 10 灵石，公开气运检定。',conditions=[cond('currency_at_least',value=10)],check=v11_check('luck',50,8,'铜钱立在桌沿：灵石 +30，气运 +1。',[eff('gain_currency',value=30),eff('modify_stat',stat='luck',value=1),eff('set_fact',key='met_zhaogongming',value=True),eff('advance_thread',key='char_zhaogongming',value='赌友')],'铜钱落背：灵石 -10。',[eff('gain_currency',value=-10),eff('set_fact',key='met_zhaogongming',value=True),eff('advance_thread',key='char_zhaogongming',value='欠他一笑')]),tone='check',consequence='赵公明会记住这一局输赢。'),
 v11_meta(option('ask','问财究竟能买什么','修为 +15，气运 +1；你们谈财，却没有做买卖。',[eff('gain_xp',value=15),eff('modify_stat',stat='luck',value=1),eff('set_fact',key='met_zhaogongming',value=True),eff('advance_thread',key='char_zhaogongming',value='谈财论道')]),'safe','关系停在一场谈道。')
],category='encounter')

v12_story('event.3.hermit','金鞭已折','赵公明','zhaogongming','赵公明',2,3,'char_zhaogongming','万仙阵前，赵公明把折断的金鞭放在膝上。珠还在，人却像已经看见榜上自己的名字。',[
 v11_meta(option('emei','替他把散珠送回峨眉','若第一次愿意舍财：修为 +28，善念 +1；他把后事托给你。',[eff('gain_xp',value=28),eff('add_counter',key='mercy',value=1),eff('advance_thread',key='char_zhaogongming',value='托付峨眉')],conditions=[cond('thread_is',key='char_zhaogongming',text='重义')]),'fate','赵公明开始把你当作可以托付后事的人。'),
 v11_pc('last_coin','再赌最后一次','若曾与他赌过：最后一局仍看气运。',conditions=[cond('thread_is',key='char_zhaogongming',text='赌友')],check=v11_check('luck',48,16,'他笑着把整袋灵石推来：灵石 +45，气运 +2。',[eff('gain_currency',value=45),eff('modify_stat',stat='luck',value=2),eff('advance_thread',key='char_zhaogongming',value='一局终了')],'这次你输得干净：失去 8 生命。',[eff('damage',value=8),eff('advance_thread',key='char_zhaogongming',value='愿赌服输')]),tone='check',consequence='不再有下一局。'),
 v11_meta(option('witness','请他看申公豹的最后一诺','若你已卷入申公豹布局：修为 +25，截教 +1；赵公明替你见证这笔旧债。',[eff('gain_xp',value=25),eff('add_counter',key='jie_relation',value=1),eff('advance_thread',key='shen_gongbao',value='witnessed'),eff('advance_thread',key='char_zhaogongming',value='见证旧债')],conditions=[cond('thread_is',key='shen_gongbao',text='scheme'),cond('has_fact',key='met_zhaogongming')]),'fate','申公豹线与赵公明线在终幕交汇。'),
 v11_meta(option('whip','替他收起金鞭','恢复 8 生命，攻击 +1；不问前缘，只替他收起兵器。',[eff('heal',value=8),eff('modify_stat',stat='attack',value=1),eff('set_fact',key='met_zhaogongming',value=True),eff('advance_thread',key='char_zhaogongming',value='收鞭之交')]),'safe','即使此前不熟，也能在榜前留下第二次相遇。')
],category='encounter',relevance=[cond('has_fact',key='met_zhaogongming')])

major3=next(e for e in C['events'] if e['id']=='major.3')
major3.update(character='赵公明',episode=3,episodes=3,relationKey='char_zhaogongming',art='zhaogongming')
for ch,state in zip(major3['choices'],['榜上送别','榜外相约','人间托付']):
 ch['effects'] += [eff('set_fact',key='met_zhaogongming',value=True),eff('advance_thread',key='char_zhaogongming',value=state)]

# Keep all four arcs favored after the player has actually formed a prior relationship.
next(e for e in C['events'] if e['id']=='event.1.hermit')['relevance']=[cond('has_fact',key='met_nezha')]
next(e for e in C['events'] if e['id']=='event.2.hermit')['relevance']=[cond('has_fact',key='met_nezha')]
next(e for e in C['events'] if e['id']=='event.2.ruins')['relevance']=[cond('has_fact',key='met_yangjian')]
next(e for e in C['events'] if e['id']=='event.3.ruins')['relevance']=[cond('has_fact',key='met_yangjian')]
next(e for e in C['events'] if e['id']=='event.3.hermit')['relevance']=[cond('has_fact',key='met_zhaogongming')]
'''
gen=gen.replace(marker,block+'\n'+marker,1)
gen_path.write_text(gen,encoding='utf-8')

# ---------- tests ----------
test=test_path.read_text(encoding='utf-8')
test=test.replace("'2.8.0'","'2.9.0'")
test += r'''

test('v12 four named character arcs reuse the existing event budget',()=>{const grouped=new Map();for(const e of c.events.filter(e=>e.character)){grouped.set(e.character,(grouped.get(e.character)??0)+1);}assert.equal(c.events.length,24);assert.equal(grouped.get('哪吒'),4);assert.equal(grouped.get('杨戬'),4);assert.equal(grouped.get('申公豹'),4);assert.equal(grouped.get('赵公明'),3);});

test('v12 follow-up character encounters carry state-aware relevance',()=>{const checks=[['event.1.hermit','met_nezha'],['event.2.hermit','met_nezha'],['event.2.ruins','met_yangjian'],['event.3.ruins','met_yangjian'],['event.3.hermit','met_zhaogongming']];for(const [id,key] of checks){const e=c.events.find(x=>x.id===id);assert(e.relevance.some(q=>q.type==='has_fact'&&q.key===key));}});

test('v12 major fate choices also advance their named relationship',()=>{for(const [id,key] of [['major.1','char_nezha'],['major.2','char_yangjian'],['major.3','char_zhaogongming']]){const e=c.events.find(x=>x.id===id);assert(e.character);assert(e.choices.every(ch=>ch.effects.some(f=>f.type==='advance_thread'&&f.key===key)));}});

test('v12 character arcs cross-link Shen Gongbao with Yang Jian and Zhao Gongming',()=>{const expose=c.events.find(e=>e.id==='event.2.deal').choices.find(ch=>ch.id==='expose'),zhao=c.events.find(e=>e.id==='event.3.hermit').choices.find(ch=>ch.id==='witness');assert(expose.effects.some(e=>e.type==='advance_thread'&&e.key==='char_yangjian'));assert(zhao.conditions.some(q=>q.type==='thread_is'&&q.key==='shen_gongbao'&&q.text==='scheme'));assert(zhao.effects.some(e=>e.type==='advance_thread'&&e.key==='shen_gongbao'&&e.value==='witnessed'));});

test('v12 character content and deterministic rules advance together',()=>{assert.equal(c.version,'2.9.0');assert.equal(c.rulesVersion,'2.9.0');for(const e of c.events.filter(e=>e.character)){assert(e.episode>=1);assert(e.episodes>=e.episode);assert(e.relationKey);}});
'''
test_path.write_text(test,encoding='utf-8')

# ---------- design note ----------
doc_path.write_text('''# Gameplay V12 — Character Arcs\n\nV12 keeps the 24-event budget and turns the ordinary-event layer into recurring named relationships. Build mechanics remain unchanged.\n\n## Four arcs\n\n- 哪吒: 红绫初见 → 风雷前夜 → 陈塘问心 → 莲火余温. The relationship can end as 同道、殊途 or 人间故人.\n- 杨戬: 天眼试心 → 刀下问路 → 西岐选道 → 天眼照榜. He can become a trusted ally, a respected enemy, or someone who lets the player walk their own road.\n- 申公豹: V11's four-act debt line is promoted to a full character arc and now intersects Yang Jian and Zhao Gongming.\n- 赵公明: 峨眉散财客 → 金鞭已折 → 榜前一念. His axis is money, obligation and what the player is willing to give away.\n\n## Rules\n\n1. No new event count: 24 remains the hard budget.\n2. Follow-up episodes receive deterministic relevance weight when prior relationship facts exist.\n3. Major fate nodes are part of the same relationship arcs, rather than separate plot-only scenes.\n4. Relationship state is written into Thread and shown in the Fate ledger.\n5. Cross-character callbacks are explicit: Shen Gongbao's letter can establish Yang Jian, and Zhao Gongming can witness Shen's final debt.\n6. Same seed + same action sequence remains deterministic.\n''',encoding='utf-8')

print('Gameplay V12 character arcs applied')
