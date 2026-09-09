from pathlib import Path
import re
import sys

root=Path(sys.argv[1] if len(sys.argv)>1 else '.')
engine_path=root/'src/engine.ts'
app_path=root/'src/app.ts'
style_path=root/'src/style.css'
gen_path=root/'scripts/create-content.py'
test_path=root/'tests/engine.test.mjs'
doc_path=root/'docs/GAMEPLAY_V11_EVENTS.md'


def once(text, old, new, label):
    n=text.count(old)
    if n!=1:
        raise RuntimeError(f'{label}: expected 1 match, got {n}')
    return text.replace(old,new,1)

# ---------------- engine ----------------
engine=engine_path.read_text(encoding='utf-8')
engine=once(engine,
"export interface Choice { id:string; label:string; text:string; preview?:string; effects:Effect[]; grant?:{id?:string;slot?:Slot}|null; conditions:Condition[]; next?:string; check?:EventCheck; }",
"export interface Choice { id:string; label:string; text:string; preview?:string; effects:Effect[]; grant?:{id?:string;slot?:Slot}|null; conditions:Condition[]; next?:string; check?:EventCheck; tone?:'safe'|'cost'|'check'|'fate'; consequence?:string; }",
'choice metadata')
engine=once(engine,
"export interface Story {id:string;act:number;major:boolean;name:string;npc:string;art:string;text:string;choices:Choice[];phases?:EventPhase[];startPhase?:string;profile?:'A'|'B';weight?:number;maxPerRun?:number;}",
"export interface Story {id:string;act:number;major:boolean;name:string;npc:string;art:string;text:string;choices:Choice[];phases?:EventPhase[];startPhase?:string;profile?:'A'|'B';weight?:number;maxPerRun?:number;category?:'encounter'|'bargain'|'trial'|'echo'|'secret'|'major';hiddenOnly?:boolean;relevance?:Condition[];}",
'story metadata')
engine=once(engine,
"export interface StoryLogItem {act:number;title:string;choice:string;phase?:string;result?:string;chance?:number;roll?:number;success?:boolean;}",
"export interface StoryLogItem {act:number;title:string;choice:string;phase?:string;result?:string;chance?:number;roll?:number;success?:boolean;eventId?:string;choiceId?:string;category?:string;consequence?:string;}",
'story log metadata')
engine=once(engine,
"for(const e of c.events){if((e.phases?.length??0)>5)throw new Error('Too many event phases');",
"for(const e of c.events){checkConditions(e.relevance??[]);if((e.phases?.length??0)>5)throw new Error('Too many event phases');",
'event relevance validation')

planned="  const planned:Record<string,number>={};const chooseStory=(act:number,streamName:string)=>{let pool=c.events.filter(e=>e.act===act&&!e.major).filter(e=>(planned[e.id]??0)<(e.maxPerRun??(e.profile==='B'?2:1)));if(!pool.length)pool=c.events.filter(e=>e.act===act&&!e.major);const chosen=weighted(s,streamName,pool,e=>e.weight??1);planned[chosen.id]=(planned[chosen.id]??0)+1;return chosen.id;};\n"
engine=once(engine,planned,"",'remove preplanned event selection')
engine=once(engine,
"if(type==='event'||type==='hidden')ref=chooseStory(act,type==='hidden'?'event.hidden':'event.route');",
"if(type==='event'||type==='hidden')ref=undefined;",
'lazy event route refs')

insert_marker="  enter(id:string){const n=this.available().find(x=>x.id===id);if(!n)throw new Error('Node not reachable');"
resolve_story="""  resolveStory(n:RouteNode):Story {\n   if(n.ref){const existing=this.c.events.find(e=>e.id===n.ref);if(!existing)throw new Error('Broken event reference');return existing;}\n   const hidden=n.type==='hidden',base=this.c.events.filter(e=>e.act===n.act&&!e.major&&!!e.hiddenOnly===hidden);if(!base.length)throw new Error(hidden?'No hidden event pool':'No visible event pool');\n   let pool=base.filter(e=>(this.s.seenEvents[e.id]??0)<(e.maxPerRun??(e.profile==='B'?2:1)));if(!pool.length)pool=base;\n   const chosen=weighted(this.s,`event.select.${n.id}`,pool,e=>{const relevant=(e.relevance?.length??0)>0&&(e.relevance??[]).every(q=>conditionOK(this.c,this.s,q)),fresh=(this.s.seenEvents[e.id]??0)===0;return Math.max(.1,(e.weight??1)*(relevant?4:1)*(fresh?1.25:.65));});\n   n.ref=chosen.id;return chosen;\n  }\n"""
engine=once(engine,insert_marker,resolve_story+insert_marker,'resolve story insertion')
engine=once(engine,
"s.phase='event';s.eventId=n.ref;const ev=this.c.events.find(e=>e.id===n.ref)!;s.eventPhase=ev.startPhase??ev.phases?.[0]?.id;",
"s.phase='event';const ev=n.type==='major'?this.c.events.find(e=>e.id===n.ref)!:this.resolveStory(n);s.eventId=ev.id;s.eventPhase=ev.startPhase??ev.phases?.[0]?.id;",
'event enter resolver')

old_choices="  eventChoices(){const event=this.currentEvent(),phase=this.eventPhase();return phase.choices.map(choice=>({choice,legal:(choice.conditions??[]).every(q=>conditionOK(this.c,this.s,q)),chance:this.checkChance(choice),stat:choice.check?.stat,eventId:event.id,phase:phase.id}));}"
new_choices="""  conditionLabel(q:Condition):string {switch(q.type){case 'currency_at_least':return `需要 ${q.value??0} 灵石`;case 'hp_above_absolute':return `需要生命高于 ${q.value??0}`;case 'has_fact':return `需要因果 · ${this.c.labels.facts?.[q.key??'']??'旧事未成'}`;case 'counter_at_least':return `需要 ${this.c.labels.counters?.[q.key??'']??q.key} ≥ ${q.value??0}`;case 'stat_at_least':return `需要 ${this.c.labels.stats?.[q.stat??'luck']??q.stat} ≥ ${q.value??0}`;case 'thread_is':return '需要另一条旧因';case 'event_seen':return `需要先经历 ${this.c.events.find(e=>e.id===q.key)?.name??'前缘'}`;case 'act_is':return `仅在第 ${(q.value??0)+1} 幕可选`;default:return '条件未达成';}}\n  eventChoices(){const event=this.currentEvent(),phase=this.eventPhase();return phase.choices.map(choice=>{const unmet=(choice.conditions??[]).filter(q=>!conditionOK(this.c,this.s,q)),legal=unmet.length===0;return {choice,legal,lockReason:legal?undefined:unmet.map(q=>this.conditionLabel(q)).join(' · '),chance:this.checkChance(choice),stat:choice.check?.stat,eventId:event.id,phase:phase.id};});}"""
engine=once(engine,old_choices,new_choices,'event choice explanations')
engine=once(engine,
"s.storyLog.push({act:s.act,title:event.name,choice:choice.label,phase:phase.id,result,chance,roll,success});",
"s.storyLog.push({act:s.act,title:event.name,choice:choice.label,phase:phase.id,result,chance,roll,success,eventId:event.id,choiceId:choice.id,category:event.category,consequence:choice.consequence});",
'story log audit')
engine_path.write_text(engine,encoding='utf-8')

# ---------------- app ----------------
app=app_path.read_text(encoding='utf-8')
event_pattern=re.compile(r"  event\(\)\{.*?\n  shop\(\)\{",re.S)
match=event_pattern.search(app)
if not match:
    raise RuntimeError('event UI method not found')
new_event=r'''  event(){const s=this.game!.s,event=this.content.events.find(e=>e.id===s.eventId)!,phase=this.game!.eventPhase(),options=this.game!.eventChoices(),check=s.lastCheck,catLabels:{[k:string]:string}={encounter:'相逢',bargain:'交易',trial:'试炼',echo:'回响',secret:'秘境',major:'命运'},toneLabels:{[k:string]:string}={safe:'稳妥',cost:'代价',check:'检定',fate:'因果'},category=catLabels[event.category??(event.major?'major':'encounter')]??'奇遇';return `<section class="event-page category-${event.category??'encounter'} ${event.hiddenOnly?'hidden-event':''}"><div class="event-portrait">${portrait(event.art)}</div><div class="eyebrow">${event.hiddenOnly?'THE UNKNOWN':event.major?'A TURN OF FATE':'AN ENCOUNTER'} / ${esc(event.npc)}</div><h2>${esc(event.name)}</h2><div class="event-meta-row"><span class="event-category">${esc(category)}</span><div class="event-phase-mark"><span>${event.phases?.length?'阶段 '+String((s.eventStep??0)+1).padStart(2,'0'):'因缘'}</span><strong>${esc(phase.id==='root'?'抉择':phase.id==='echo'?'旧因回响':phase.id==='decision'?'此刻抉择':phase.id)}</strong></div></div>${ornament()}${s.phase==='event'&&s.resultText?`<div class="event-outcome compact">${check?`<b class="${check.success?'success':'failure'}">${check.success?'检定成功':'检定失败'} · ${check.roll}/${check.chance}</b>`:''}<span>${esc(s.resultText)}</span></div>`:''}<p class="story-text">${esc(phase.text)}</p>${s.phase==='event'?`<div class="story-choices">${options.map(info=>{const ch=info.choice,tone=ch.tone??(ch.check?'check':'safe');return `<button class="story-choice tone-${tone} ${ch.check?'checked-choice':''}" data-action="event" data-id="${ch.id}" ${info.legal?'':'disabled'}><div><div class="choice-title-row"><strong>${esc(ch.label)}</strong><span class="risk-badge ${tone}">${toneLabels[tone]??'抉择'}</span></div><p>${esc(ch.preview??ch.text)}</p>${!info.legal?`<span class="lock-reason">${esc(info.lockReason??'条件未达成')}</span>`:''}${ch.grant?.id?`<span class="grant-badge ${this.game!.ability(ch.grant.id).rarity==='mythic'?'mythic':''}">${this.game!.ability(ch.grant.id).rarity==='mythic'?'神话转轴':'获得机缘'} · ${esc(this.game!.ability(ch.grant.id).name)}</span>`:''}${ch.check?`<div class="check-stakes"><span class="check-badge">${esc(this.content.labels.stats[ch.check.stat])}检定 · ${info.chance}%</span><small><b>成</b> ${esc(ch.check.success.text)}<br><b>败</b> ${esc(ch.check.failure.text)}</small></div>`:''}${ch.consequence?`<span class="consequence-badge">余波 · ${esc(ch.consequence)}</span>`:''}</div>${icon('arrow',22)}</button>`;}).join('')}</div>`:`<div class="event-result">${check?`<div class="check-result ${check.success?'success':'failure'}"><strong>${check.success?'检定成功':'检定失败'}</strong><span>${esc(this.content.labels.stats[check.stat])} · ${check.roll} / ${check.chance}</span></div>`:''}${esc(s.resultText??'')}</div><div class="actions">${btn('leaveEvent','记下此因，继续前行 '+icon('arrow',18),'primary')}</div>`}</section>`;}
  shop(){'''
app=app[:match.start()]+new_event+app[match.end():]
app=app.replace("${esc(k.replaceAll('_',' '))}","${esc(this.content.labels.threads?.[k]??k.replaceAll('_',' '))}")
app=app.replace("${l.result?`<small>${esc(l.result)}</small>`:''}","${l.result?`<small>${esc(l.result)}</small>`:''}${l.consequence?`<em class=\"timeline-consequence\">余波 · ${esc(l.consequence)}</em>`:''}")
app=app.replace("V9 增加暴击与闪避触发轴，并把部分纯属性件升级为转轴能力。静态机制定位与当前命盘动态角色仍分开计算。","八槽共鸣、桥接与终局法相均由当前装备实时推导。")
app_path.write_text(app,encoding='utf-8')

style=style_path.read_text(encoding='utf-8')
style += r'''

/* Gameplay V11 — events communicate stakes, delayed consequences and hidden identity. */
.event-meta-row{display:flex;justify-content:center;align-items:center;gap:8px;margin:2px 0 10px}.event-category{padding:4px 9px;border:1px solid #7c9d8644;background:#10241d;color:#9db7a3;font-size:8px;letter-spacing:2px}.hidden-event .event-category{border-color:#a784b455;color:#c4a7cc;background:#241b29}.choice-title-row{display:flex;align-items:center;gap:9px;justify-content:space-between}.choice-title-row strong{margin-bottom:0}.risk-badge{flex:0 0 auto;padding:2px 6px;border:1px solid #82978a55;font:8px var(--sans);letter-spacing:1px;color:#aab9ad}.risk-badge.cost{border-color:#b277675c;color:#d69c8e;background:#321d1a}.risk-badge.check{border-color:#b29a5b66;color:#e0c77f;background:#302919}.risk-badge.fate{border-color:#9b79a866;color:#cbb0d4;background:#251b29}.lock-reason{display:inline-block;margin-top:7px;padding:3px 7px;border-left:2px solid #a2675d;background:#2a1918;color:#c98d83;font-size:8px;letter-spacing:.5px}.check-stakes{display:flex;align-items:flex-start;gap:9px;margin-top:7px}.check-stakes .check-badge{margin-top:0;flex:0 0 auto}.check-stakes small{font-size:8px;line-height:1.65;color:#8fa096}.check-stakes small b{color:#cdbd90;font-weight:600}.consequence-badge{display:inline-block;margin-top:7px;padding:3px 7px;border:1px dashed #8f7e604f;color:#aa9c7f;background:#191d19;font-size:8px;letter-spacing:.5px}.story-choice.tone-fate{border-left:2px solid #9b79a8}.story-choice.tone-cost{border-left:2px solid #ad6f60}.story-choice.tone-check{border-left:2px solid #a98f4f}.hidden-event{background:radial-gradient(ellipse at 50% 0,#33283a,#121a1a)}.timeline-consequence{display:block;margin-top:4px;color:#ad9a74;font-size:9px;font-style:normal;line-height:1.55}
'''
style_path.write_text(style,encoding='utf-8')

# ---------------- content ----------------
gen=gen_path.read_text(encoding='utf-8')
gen=once(gen,"C['version']='2.7.0'","C['version']='2.8.0'",'content version')
gen=once(gen,"C['rulesVersion']='2.7.0'","C['rulesVersion']='2.8.0'",'rules version')
marker="assert len(A)==43 and len(E)==20 and len(C['events'])==24"
if gen.count(marker)!=1:
    raise RuntimeError('content assertion marker not unique')
block=r'''

# Gameplay V11 event pass: state-aware lazy selection, hidden-only pool, delayed echoes and authored stakes.
def v11_meta(ch,tone='safe',consequence=None):
 ch['tone']=tone
 if consequence: ch['consequence']=consequence
 return ch

def v11_pc(id,label,preview,effects=None,conditions=None,next=None,check=None,tone='safe',consequence=None,grant=None):
 ch=phase_choice(id,label,preview,effects,conditions,next,check)
 if grant is not None: ch['grant']=grant
 return v11_meta(ch,tone,consequence)

def v11_check(stat,base,difficulty,success_text,success_effects,failure_text,failure_effects):
 return dict(stat=stat,base=base,difficulty=difficulty,success=branch(success_text,success_effects),failure=branch(failure_text,failure_effects))

C['labels']['threads']={
 'shen_gongbao':'申公豹旧债','echo_0':'第一幕余音','echo_1':'第二幕余音','echo_2':'第三幕余音','echo_3':'第四幕余音',
 'hidden_0':'荒祠夜签','hidden_1':'海眼残碑','hidden_2':'岐山断阵','hidden_3':'万仙余烬',
 'echo_major_1':'陈塘旧因','echo_major_2':'西岐旧因','echo_major_3':'榜前旧因',
 'act_0_fate':'朝歌抉择','act_1_fate':'陈塘抉择','act_2_fate':'西岐抉择','act_3_fate':'榜前抉择'
}

for ev in C['events']:
 if ev['major']:
  ev['category']='major';ev['hiddenOnly']=False
 elif ev['id'].endswith('.omen'):
  ev['category']='secret';ev['hiddenOnly']=True;ev['weight']=1
 elif ev['id'].endswith('.deal'):
  ev['category']='bargain';ev['hiddenOnly']=False
  if ev['act']>0: ev['relevance']=[cond('has_fact',key='met_shen_gongbao')]
 elif ev['id'].endswith('.ruins'):
  ev['category']='trial';ev['hiddenOnly']=False;ev['weight']=2
 elif ev['id'].endswith('.echo'):
  ev['category']='echo';ev['hiddenOnly']=False;ev['weight']=2
  if ev['act']>0: ev['relevance']=[cond('event_seen',key=f"major.{ev['act']-1}",value=1)]
 else:
  ev['category']='encounter';ev['hiddenOnly']=False

# Base event choice stakes.
for ev in C['events']:
 if ev['id'].endswith('.hermit'):
  for ch in ev['choices']:
   v11_meta(ch,'cost' if ch['id']=='mercy' else 'safe','此选择只改变当前旅程，不强制后续路线。')
 if ev['id'].endswith('.ruins'):
  for ch in ev['choices']:
   v11_meta(ch,'fate' if ch['id'] in ('take','bury') else 'safe','遗迹中的取舍会写入本局性格与因果。')
 if ev['major']:
  for ch in ev['choices']:
   v11_meta(ch,'cost' if ch['id']=='power' else 'fate','此选择会被下一幕回响，并影响最终因果。' if ev['act']<3 else '此选择将直接影响最终可选结局。')

# Contextual callbacks for otherwise simple hermit / ruin events.
hermit1=next(e for e in C['events'] if e['id']=='event.1.hermit')
hermit1['choices'].append(v11_meta(option('nezha_echo','问起红绫少年','若你曾与哪吒并肩，太乙会为你调息并点明一段旧因。',[eff('gain_xp',value=20),eff('heal',value=8),eff('advance_thread',key='echo_1',value='nezha_remembered')],conditions=[cond('has_fact',key='helped_nezha')]),'fate','哪吒的善缘被再次确认。'))
hermit3=next(e for e in C['events'] if e['id']=='event.3.hermit')
hermit3['choices'].append(v11_meta(option('beyond','问榜外之路','逆命足够深时，可向散仙追问榜外之路：修为 +25，气运 +2。',[eff('gain_xp',value=25),eff('modify_stat',stat='luck',value=2)],conditions=[cond('counter_at_least',key='defiance',value=3)]),'fate','为榜外结局补上一段见证。'))
ruin1=next(e for e in C['events'] if e['id']=='event.1.ruins')
ruin1['choices'].append(v11_meta(option('dragon_mark','唤醒龙纹','若曾与龙族结缘，可唤醒残卷龙纹：防御 +1，灵石 +25。',[eff('modify_stat',stat='defense',value=1),eff('gain_currency',value=25)],conditions=[cond('has_fact',key='helped_dragon')]),'fate','龙族旧缘在此兑现。'))
ruin2=next(e for e in C['events'] if e['id']=='event.2.ruins')
ruin2['choices'].append(v11_meta(option('demon_fire','以妖火照剑','若妖力仍在体内，可照出旧剑真形：失去 5 生命，攻击 +2，逆命 +1。',[eff('damage',value=5),eff('modify_stat',stat='attack',value=2),eff('add_counter',key='defiance',value=1)],conditions=[cond('has_fact',key='accepted_demon_power'),cond('hp_above_absolute',value=5)]),'cost','妖力更深地留在经脉中。'))
ruin3=next(e for e in C['events'] if e['id']=='event.3.ruins')
ruin3['choices'].append(v11_meta(option('return_scroll','将遗简归于众生','善念足够时，不取遗简而将其传回人间：修为 +30，善念 +1。',[eff('gain_xp',value=30),eff('add_counter',key='mercy',value=1)],conditions=[cond('counter_at_least',key='mercy',value=3)]),'fate','人间会记得这卷无名遗简。'))

# Shen Gongbao becomes an actual cross-act debt line.
deal0=next(e for e in C['events'] if e['id']=='event.0.deal')
for ch in deal0['choices']:
 v11_meta(ch,'cost' if ch['id']=='deal' else 'safe','申公豹会记住这次回答。')

deal1=next(e for e in C['events'] if e['id']=='event.1.deal')
deal1['name']='旧债来门';deal1['text']='陈塘风雷未歇，申公豹却先一步坐在桥头。他笑着把第一次相遇称作“缘”，把第二次称作“债”。'
deal1['choices']=[
 v11_meta(option('deeper','再借一程','若曾以血换宝：失去 8 生命，灵石 +50，逆命 +1；债线继续加深。',[eff('damage',value=8),eff('gain_currency',value=50),eff('add_counter',key='defiance',value=1),eff('advance_thread',key='shen_gongbao',value='deeper')],conditions=[cond('thread_is',key='shen_gongbao',text='deal'),cond('hp_above_absolute',value=8)]),'cost','申公豹旧债进入第二层。'),
 v11_meta(option('watch','只听不取','若上次只是相识：修为 +20，气运 +2；你开始看懂他的试探。',[eff('gain_xp',value=20),eff('modify_stat',stat='luck',value=2),eff('advance_thread',key='shen_gongbao',value='watching')],conditions=[cond('thread_is',key='shen_gongbao',text='met')]),'safe','你没有欠债，但已被他记住。'),
 v11_meta(option('newdeal','今日再结缘','失去 10 生命，逆命 +1，获得一件法宝。',[eff('damage',value=10),eff('add_counter',key='defiance',value=1),eff('set_fact',key='met_shen_gongbao',value=True),eff('advance_thread',key='shen_gongbao',value='deal')],grant={'slot':'artifact'},conditions=[cond('hp_above_absolute',value=10)]),'cost','重新开启申公豹债线。'),
 v11_meta(option('leave','不听他说完','修为 +8，离开桥头。',[eff('gain_xp',value=8)]),'safe','不新增债务。')]

deal2=next(e for e in C['events'] if e['id']=='event.2.deal')
deal2['name']='两教密札';deal2['text']='申公豹没有再谈宝物，只递来一封没有署名的密札。“送、烧、还是交给别人——这一次，贫道只看你怎么选。”'
deal2['choices']=[
 v11_meta(option('scheme','替他送信','需要曾与申公豹结缘：灵石 +45，截教 +1，逆命 +1。',[eff('gain_currency',value=45),eff('add_counter',key='jie_relation',value=1),eff('add_counter',key='defiance',value=1),eff('advance_thread',key='shen_gongbao',value='scheme')],conditions=[cond('has_fact',key='met_shen_gongbao')]),'fate','你正式卷入申公豹的布局。'),
 v11_meta(option('expose','把密札交给杨戬','需要曾与申公豹结缘：修为 +30，阐教 +1。',[eff('gain_xp',value=30),eff('add_counter',key='chan_relation',value=1),eff('advance_thread',key='shen_gongbao',value='exposed')],conditions=[cond('has_fact',key='met_shen_gongbao')]),'fate','申公豹知道你把信交给了谁。'),
 v11_meta(option('burn','当面焚信','需要曾与申公豹结缘：失去 6 生命，善念 +1，气运 +2。',[eff('damage',value=6),eff('add_counter',key='mercy',value=1),eff('modify_stat',stat='luck',value=2),eff('advance_thread',key='shen_gongbao',value='burned')],conditions=[cond('has_fact',key='met_shen_gongbao'),cond('hp_above_absolute',value=6)]),'cost','你主动截断一段阴谋。'),
 v11_meta(option('ignore','与我无关','修为 +10，密札仍留在石上。',[eff('gain_xp',value=10)]),'safe','债线保持原状。')]

deal3=next(e for e in C['events'] if e['id']=='event.3.deal')
deal3['name']='最后一诺';deal3['text']='万仙杀劫之前，申公豹终于不笑了。“道友，债也好，缘也罢，总该在今天结清。”'
deal3['choices']=[
 v11_meta(option('collect','收最后一件礼','若曾替他送信：失去 12 生命，逆命 +2，获得一件法宝。',[eff('damage',value=12),eff('add_counter',key='defiance',value=2),eff('advance_thread',key='shen_gongbao',value='collected')],grant={'slot':'artifact'},conditions=[cond('thread_is',key='shen_gongbao',text='scheme'),cond('hp_above_absolute',value=12)]),'cost','以更深的逆命换取最后一件礼。'),
 v11_meta(option('clear','让旧债见光','若曾揭露密札：恢复 20 生命，阐教 +1，修为 +20。',[eff('heal',value=20),eff('add_counter',key='chan_relation',value=1),eff('gain_xp',value=20),eff('advance_thread',key='shen_gongbao',value='cleared')],conditions=[cond('thread_is',key='shen_gongbao',text='exposed')]),'fate','旧债在众目之下结清。'),
 v11_meta(option('ashes','把灰烬还给他','若曾当面焚信：善念 +1，气运 +3，修为 +20。',[eff('add_counter',key='mercy',value=1),eff('modify_stat',stat='luck',value=3),eff('gain_xp',value=20),eff('advance_thread',key='shen_gongbao',value='ashes')],conditions=[cond('thread_is',key='shen_gongbao',text='burned')]),'fate','你把这段因果留在灰烬里。'),
 v11_meta(option('settle','以灵石断缘','若曾与他结缘且有 20 灵石：灵石 -20，修为 +30，旧债记为已结。',[eff('gain_currency',value=-20),eff('gain_xp',value=30),eff('advance_thread',key='shen_gongbao',value='settled')],conditions=[cond('has_fact',key='met_shen_gongbao'),cond('currency_at_least',value=20)]),'cost','主动支付代价，结束债线。'),
 v11_meta(option('walk','不再回头','修为 +12，继续入劫。',[eff('gain_xp',value=12)]),'safe','不再追加这条因果。')]

# Four hidden nodes now have four different authored identities instead of one copied template.
hidden_specs={
 0:dict(text='荒祠无风，签筒却自行轻响。庙祝没有脸，只把两支签推到你面前。',entry=[v11_pc('enter','伸手取签','进入签筒真正留下的考验。',next='core',tone='check',consequence='结果会写入荒祠夜签。'),v11_pc('leave','留香而退','恢复 8 生命，不追问签意。',[eff('heal',value=8)],tone='safe')],core=[v11_pc('draw','揭开红签','公开气运检定。',check=v11_check('luck',50,11,'红签化光：灵石 +20，气运 +2。',[eff('gain_currency',value=20),eff('modify_stat',stat='luck',value=2),eff('advance_thread',key='hidden_0',value='吉签')],'签文倒写：失去 6 生命，逆命 +1。',[eff('damage',value=6),eff('add_counter',key='defiance',value=1),eff('advance_thread',key='hidden_0',value='凶签')]),tone='check',consequence='吉凶都会被因果簿记住。'),v11_pc('break','折断黑签','公开攻击检定。',check=v11_check('attack',46,20,'你先一步斩断签上的劫线：修为 +24，攻击 +1。',[eff('gain_xp',value=24),eff('modify_stat',stat='attack',value=1),eff('advance_thread',key='hidden_0',value='断签')],'黑签化作火星钻入掌心：失去 9 生命。',[eff('damage',value=9),eff('advance_thread',key='hidden_0',value='烙印')]),tone='check',consequence='这是一次主动与凶兆对赌。')]),
 1:dict(text='海眼下传来沉闷龙吟，残碑被潮水一寸寸推向深处。',entry=[v11_pc('enter','潜入海眼','先失去 5 生命，再深入残碑。',[eff('damage',value=5)],conditions=[cond('hp_above_absolute',value=5)],next='core',tone='cost',consequence='以生命换取更深的海眼机缘。'),v11_pc('leave','听潮而退','善念 +1，恢复 7 生命。',[eff('add_counter',key='mercy',value=1),eff('heal',value=7)],tone='safe')],core=[v11_pc('anchor','定住残碑','公开防御检定。',check=v11_check('defense',50,14,'碑文复明：防御 +2，修为 +18。',[eff('modify_stat',stat='defense',value=2),eff('gain_xp',value=18),eff('advance_thread',key='hidden_1',value='定碑')],'海压贯体：失去 10 生命。',[eff('damage',value=10),eff('advance_thread',key='hidden_1',value='海压')]),tone='check'),v11_pc('chase','追逐游光','公开速度检定。',check=v11_check('speed',48,13,'你在潮缝中抓住游光：灵石 +35，气运 +1。',[eff('gain_currency',value=35),eff('modify_stat',stat='luck',value=1),eff('advance_thread',key='hidden_1',value='游光')],'游光熄灭，只留下 5 点伤势。',[eff('damage',value=5),eff('advance_thread',key='hidden_1',value='失光')]),tone='check')]),
 2:dict(text='岐山旧阵只剩一角，阐截两家的阵纹却仍在彼此吞噬。',entry=[v11_pc('enter','踏入残阵','进入阵眼，选择如何处置两教残纹。',next='core',tone='fate',consequence='可能改变阐截两教关系。'),v11_pc('leave','绕阵而行','恢复 10 生命。',[eff('heal',value=10)],tone='safe')],core=[v11_pc('read','顺纹解阵','公开命中检定。',check=v11_check('hit',50,15,'你解开阐教阵纹：修为 +25，阐教 +1。',[eff('gain_xp',value=25),eff('add_counter',key='chan_relation',value=1),eff('advance_thread',key='hidden_2',value='解阵')],'阵纹错位：失去 8 生命。',[eff('damage',value=8),eff('advance_thread',key='hidden_2',value='错阵')]),tone='check',consequence='成功会让阐教因果更深。'),v11_pc('reverse','逆转阵眼','公开攻击检定。',check=v11_check('attack',44,28,'你以力逆转残阵：攻击 +2，截教 +1，逆命 +1。',[eff('modify_stat',stat='attack',value=2),eff('add_counter',key='jie_relation',value=1),eff('add_counter',key='defiance',value=1),eff('advance_thread',key='hidden_2',value='逆阵')],'阵眼反冲：失去 12 生命。',[eff('damage',value=12),eff('advance_thread',key='hidden_2',value='反冲')]),tone='check',consequence='成功更强，但会把你推向逆命。')]),
 3:dict(text='万仙阵散去后，地上只剩不肯熄灭的余烬。每一粒火星都像一个未写完的名字。',entry=[v11_pc('enter','拾起余烬','进入最后一重隐秘。',next='core',tone='fate',consequence='这是终幕前最后一笔隐秘因果。'),v11_pc('leave','替亡者覆土','善念 +1，恢复 12 生命。',[eff('add_counter',key='mercy',value=1),eff('heal',value=12)],tone='safe')],core=[v11_pc('borrow','借劫火照路','公开气运检定。',check=v11_check('luck',46,18,'余烬认主：攻击 +2，气运 +2，逆命 +1。',[eff('modify_stat',stat='attack',value=2),eff('modify_stat',stat='luck',value=2),eff('add_counter',key='defiance',value=1),eff('advance_thread',key='hidden_3',value='借火')],'余烬灼魂：失去 14 生命。',[eff('damage',value=14),eff('advance_thread',key='hidden_3',value='灼魂')]),tone='check'),v11_pc('seal','封存余烬','公开防御检定。',check=v11_check('defense',50,20,'你将余烬封入玉匣：防御 +2，修为 +28。',[eff('modify_stat',stat='defense',value=2),eff('gain_xp',value=28),eff('advance_thread',key='hidden_3',value='封烬')],'玉匣碎裂：失去 9 生命。',[eff('damage',value=9),eff('advance_thread',key='hidden_3',value='碎匣')]),tone='check')])}
for act,spec in hidden_specs.items():
 ev=next(e for e in C['events'] if e['id']==f'event.{act}.omen')
 ev['text']=spec['text'];ev['startPhase']='threshold';ev['phases']=[dict(id='threshold',text=spec['text'],choices=spec['entry']),dict(id='core',text=['签筒深处没有签文，只有两种处理凶兆的方法。','海眼深处只剩两道可追的痕迹。','阵心的两条残纹正在彼此撕扯。','余烬中浮出两种截然不同的光。'][act],choices=spec['core'])]

# Echo events respond to every possible previous major choice, not only one authored "correct" route.
echo0=next(e for e in C['events'] if e['id']=='event.0.echo')
echo0['choices']=[v11_meta(option('remember','记住这阵回声','修为 +18，气运 +1。',[eff('gain_xp',value=18),eff('modify_stat',stat='luck',value=1),eff('advance_thread',key='echo_0',value='记住')]),'safe','第一幕余音被保留下来。'),v11_meta(option('vow','对无名者立誓','失去 5 生命，善念 +1，修为 +25。',[eff('damage',value=5),eff('add_counter',key='mercy',value=1),eff('gain_xp',value=25),eff('advance_thread',key='echo_0',value='立誓')],conditions=[cond('hp_above_absolute',value=5)]),'cost','誓言会留在因果簿。'),v11_meta(option('sever','不替往事命名','灵石 +18，余音记为已断。',[eff('gain_currency',value=18),eff('advance_thread',key='echo_0',value='已断')]),'fate','主动结束这一段余音。')]

echo_variants={
 1:[('save','循灯火回望','朝歌百姓的灯火仍在：恢复 14 生命，善念 +1。',[eff('heal',value=14),eff('add_counter',key='mercy',value=1)]),('power','压住血中妖火','妖火仍在经脉里：失去 6 生命，攻击 +2，逆命 +1。',[eff('damage',value=6),eff('modify_stat',stat='attack',value=2),eff('add_counter',key='defiance',value=1)]),('away','承认那次旁观','空巷无声：气运 +2，灵石 +18。',[eff('modify_stat',stat='luck',value=2),eff('gain_currency',value=18)])],
 2:[('nezha','红绫旧约','哪吒的红绫掠过梦境：修为 +25，善念 +1。',[eff('gain_xp',value=25),eff('add_counter',key='mercy',value=1)]),('dragon','龙宫回礼','潮声送来一枚旧鳞：防御 +2，灵石 +18。',[eff('modify_stat',stat='defense',value=2),eff('gain_currency',value=18)]),('neutral','百姓来信','陈塘百姓托人捎来平安信：恢复 15 生命，善念 +1。',[eff('heal',value=15),eff('add_counter',key='mercy',value=1)])],
 3:[('chan','玉虚来书','旧日破阵之举有了回信：阐教 +1，修为 +20。',[eff('add_counter',key='chan_relation',value=1),eff('gain_xp',value=20)]),('jie','金鳌残符','一枚残符落在脚边：截教 +1，攻击 +2。',[eff('add_counter',key='jie_relation',value=1),eff('modify_stat',stat='attack',value=2)]),('free','无门无派','无人召你归队：气运 +3，恢复 10 生命。',[eff('modify_stat',stat='luck',value=3),eff('heal',value=10)])]}
for act,variants in echo_variants.items():
 ev=next(e for e in C['events'] if e['id']==f'event.{act}.echo')
 choices=[]
 for prev,label,text,effects in variants:
  effects=list(effects)+[eff('advance_thread',key=f'echo_{act}',value=prev)]
  choices.append(v11_meta(option(f'echo_{prev}',label,text,effects,conditions=[cond('thread_is',key=f'act_{act-1}_fate',text=prev)]),'fate','上一幕的选择在此兑现。'))
 choices.append(v11_meta(option('sever','斩断回响','修为 +18；不再从上一幕索取额外收益。',[eff('gain_xp',value=18),eff('advance_thread',key=f'echo_{act}',value='已断')]),'safe','主动结束这一次旧因回响。'))
 ev['choices']=choices

# Major nodes from Act II onward begin with a guaranteed response to the previous major choice.
major_echo={
 1:[('save','接过万家灯火','朝歌救下的人仍记得你：恢复 10 生命，善念 +1。',[eff('heal',value=10),eff('add_counter',key='mercy',value=1)]),('power','压住妖力反噬','血中妖火在陈塘海潮前躁动：失去 5 生命，攻击 +2。',[eff('damage',value=5),eff('modify_stat',stat='attack',value=2)]),('away','不替昨日辩解','你承认自己曾转身离开：气运 +2。',[eff('modify_stat',stat='luck',value=2)])],
 2:[('nezha','应下红绫旧约','哪吒替你挡下一缕杀气：修为 +22，善念 +1。',[eff('gain_xp',value=22),eff('add_counter',key='mercy',value=1)]),('dragon','收下龙宫回礼','龙族送来护身鳞片：防御 +2。',[eff('modify_stat',stat='defense',value=2)]),('neutral','读完百姓来信','你确认陈塘仍有灯火：恢复 14 生命。',[eff('heal',value=14)])],
 3:[('chan','拆开玉虚来书','阐教因你此前的选择再添一笔：阐教 +1。',[eff('add_counter',key='chan_relation',value=1)]),('jie','收起金鳌残符','截教仍记得你留下的一线：截教 +1，攻击 +1。',[eff('add_counter',key='jie_relation',value=1),eff('modify_stat',stat='attack',value=1)]),('free','仍走自己的路','两教都没有你的名字：气运 +2，逆命 +1。',[eff('modify_stat',stat='luck',value=2),eff('add_counter',key='defiance',value=1)])]}
for act,variants in major_echo.items():
 ev=next(e for e in C['events'] if e['id']==f'major.{act}')
 echo_choices=[]
 for prev,label,text,effects in variants:
  echo_choices.append(v11_pc(f'echo_{prev}',label,text,list(effects)+[eff('advance_thread',key=f'echo_major_{act}',value=prev)],conditions=[cond('thread_is',key=f'act_{act-1}_fate',text=prev)],next='decision',tone='fate',consequence='接受上一幕留下的具体后果。'))
 echo_choices.append(v11_pc('sever','斩断上一幕回响','修为 +12，然后只面对眼前之事。',[eff('gain_xp',value=12),eff('advance_thread',key=f'echo_major_{act}',value='已断')],next='decision',tone='safe',consequence='放弃上一幕的额外回响收益。'))
 ev['startPhase']='echo';ev['phases']=[dict(id='echo',text='真正的命运选择出现之前，上一幕留下的因果先一步追上了你。',choices=echo_choices),dict(id='decision',text=ev['text'],choices=ev['choices'])]

'''
gen=gen.replace(marker,block+marker,1)
gen_path.write_text(gen,encoding='utf-8')

# ---------------- tests ----------------
tests=test_path.read_text(encoding='utf-8')
preview_pattern=re.compile(r"(?m)^test\('event check preview never consumes RNG and exposes public probability'.*$")
ms=list(preview_pattern.finditer(tests))
if len(ms)!=1: raise RuntimeError(f'preview test matches {len(ms)}')
preview="test('event check preview never consumes RNG and exposes public probability',()=>{const g=fresh('CHECK-PREVIEW'),ev=c.events.find(e=>e.id==='event.0.omen');g.s.phase='event';g.s.eventId=ev.id;g.s.eventPhase=ev.startPhase;g.s.seenEvents[ev.id]=1;g.chooseEvent('enter');const before=clone(g.s.rng),a=g.eventChoices().find(x=>x.choice.check),b=g.eventChoices().find(x=>x.choice.id===a.choice.id);assert.equal(a.chance,b.chance);assert(a.chance>=10&&a.chance<=95);assert.deepEqual(g.s.rng,before);});"
m=ms[0];tests=tests[:m.start()]+preview+tests[m.end():]
occ_pattern=re.compile(r"(?m)^test\('event occurrence contracts and hidden limit are enforced while planning route'.*$")
ms=list(occ_pattern.finditer(tests))
if len(ms)!=1: raise RuntimeError(f'occurrence test matches {len(ms)}')
occ="test('v11 event nodes resolve lazily with separate visible and hidden pools',()=>{const a=fresh('EVENT-LAZY'),b=fresh('EVENT-LAZY');for(const g of [a,b])for(let act=0;act<4;act++)assert(g.s.route.filter(n=>n.act===act&&n.type==='hidden').length<=1);const va=a.s.route.find(n=>n.type==='event'),vb=b.s.route.find(n=>n.id===va.id),ha=a.s.route.find(n=>n.type==='hidden'),hb=b.s.route.find(n=>n.id===ha.id);assert.equal(va.ref,undefined);assert.equal(ha.ref,undefined);const ve1=a.resolveStory(va),ve2=b.resolveStory(vb),he1=a.resolveStory(ha),he2=b.resolveStory(hb);assert.equal(ve1.id,ve2.id);assert.equal(he1.id,he2.id);assert.equal(!!ve1.hiddenOnly,false);assert.equal(!!he1.hiddenOnly,true);});"
m=ms[0];tests=tests[:m.start()]+occ+tests[m.end():]
append=r'''

test('v11 major nodes answer the previous act before presenting the new fate choice',()=>{const g=fresh('V11-MAJOR-ECHO');g.s.phase='event';g.s.eventId='major.1';g.s.eventPhase='echo';g.s.threads.act_0_fate='power';const options=g.eventChoices(),legal=options.filter(x=>x.legal).map(x=>x.choice.id);assert.deepEqual(legal.sort(),['echo_power','sever']);const locked=options.find(x=>x.choice.id==='echo_save');assert(locked.lockReason);g.chooseEvent('echo_power');assert.equal(g.s.eventPhase,'decision');assert.equal(g.s.phase,'event');assert.equal(g.s.threads.echo_major_1,'power');});

test('v11 all hidden events are authored per act and remain in the secret pool',()=>{for(let act=0;act<4;act++){const ev=c.events.find(e=>e.id===`event.${act}.omen`);assert.equal(ev.hiddenOnly,true);assert.equal(ev.category,'secret');assert.equal(ev.phases.length,2);assert(ev.phases[1].choices.every(ch=>ch.check));}assert.equal(new Set(c.events.filter(e=>e.hiddenOnly).map(e=>e.name)).size,4);});

test('v11 echo events can answer every previous major branch',()=>{const expected={1:['save','power','away'],2:['nezha','dragon','neutral'],3:['chan','jie','free']};for(const [actText,ids] of Object.entries(expected)){const act=Number(actText),ev=c.events.find(e=>e.id===`event.${act}.echo`);for(const id of ids)assert(ev.choices.some(ch=>ch.id===`echo_${id}`&&ch.conditions.some(q=>q.type==='thread_is'&&q.text===id)));assert(ev.choices.some(ch=>ch.id==='sever'));}});

test('v11 Shen Gongbao debt line has authored continuation and settlement states',()=>{const a1=c.events.find(e=>e.id==='event.1.deal'),a2=c.events.find(e=>e.id==='event.2.deal'),a3=c.events.find(e=>e.id==='event.3.deal');assert(a1.relevance.some(q=>q.key==='met_shen_gongbao'));assert(a2.choices.some(ch=>ch.effects.some(e=>e.type==='advance_thread'&&e.value==='scheme')));assert(a3.choices.some(ch=>ch.effects.some(e=>e.type==='advance_thread'&&e.value==='settled')));});

test('v11 event log records event identity category and declared consequence',()=>{const g=fresh('V11-STORY-AUDIT');g.s.phase='event';g.s.eventId='major.0';const ch=c.events.find(e=>e.id==='major.0').choices[0];g.chooseEvent(ch.id);const log=g.s.storyLog.at(-1);assert.equal(log.eventId,'major.0');assert.equal(log.choiceId,ch.id);assert.equal(log.category,'major');assert(log.consequence);});

test('v11 event rules and content advance together',()=>{assert.equal(c.version,'2.8.0');assert.equal(c.rulesVersion,'2.8.0');assert.equal(c.events.length,24);assert(c.events.every(e=>e.category));});
'''
if "v11 major nodes answer" in tests: raise RuntimeError('v11 tests already exist')
tests+=append
test_path.write_text(tests,encoding='utf-8')

# ---------------- documentation ----------------
doc_path.write_text('''# Gameplay V11 — Event & Causality Pass\n\nV11 freezes the current Build model and moves development focus to events.\n\n## Problems addressed\n\n- Future event identities were selected at run creation, so they could not react to choices made later.\n- Hidden nodes reused the ordinary event pool.\n- Three base event templates were repeated across all four acts and often behaved like stat vending machines.\n- Major decisions wrote facts, but later scenes rarely forced the player to confront those facts.\n- Locked choices exposed only a generic “condition unmet” message.\n\n## V11 rules\n\n1. Ordinary/hidden event identity is resolved lazily when the node is entered, using an event-specific deterministic RNG stream.\n2. Hidden events use a separate `hiddenOnly` pool. Each act has one authored hidden trial.\n3. Events carry category, relevance, risk tone and delayed-consequence metadata. Relevant callbacks receive higher selection weight without breaking determinism.\n4. Acts II–IV major nodes begin with a mandatory previous-act echo phase. The player may accept the tailored consequence or deliberately sever the echo before making the new major choice.\n5. Shen Gongbao now forms a cross-act debt thread with deepen/watch/scheme/expose/burn/settlement states.\n6. Echo events respond to every branch of the previous major decision, not one preferred branch.\n7. Choice UI exposes risk type, explicit lock reason, public check probability, success/failure stakes and declared delayed consequence.\n8. Story log records event ID, choice ID, category and declared consequence for audit/replay.\n\nThe event count remains 24; V11 improves identity and causality rather than inflating the pool.\n''',encoding='utf-8')

print('Gameplay V11 event redesign applied')
