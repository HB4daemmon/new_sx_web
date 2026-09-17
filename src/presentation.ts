
import {Ability,Choice,Condition,Content,Effect,EventPhase,LoadoutSlot,RunState,Story,StoryLogItem,MECHANIC_TAG_LABELS,abilityLoadoutSlot,conditionOK,slotLabel,value} from './engine.js';

export interface ChoiceCopy {label?:string; preview?:string; outcome?:string; success?:string; failure?:string; hint?:string;}
export interface EventCopy {intro?:string; variants?:{when:Condition[];text:string}[]; phases?:Record<string,string>; choices?:Record<string,ChoiceCopy>;}
export interface CreationCopy {summary?:string;hint?:string;}
export interface CreationPresentation {races?:Record<string,CreationCopy|string>;origins?:Record<string,CreationCopy|string>;fates?:Record<string,CreationCopy|string>;}
export interface AbilityBehaviorCopy {summary?:string;lines?:string[];}
export type CreationKind='race'|'races'|'origin'|'origins'|'fate'|'fates';
export interface Presentation {revision:string;events:Record<string,EventCopy>;threadValues?:Record<string,string>;creation?:CreationPresentation;abilityBehaviors?:Record<string,AbilityBehaviorCopy|string>;abilityBehavior?:Record<string,AbilityBehaviorCopy|string>;}
export const UI_REVISION='17.1';
export const rankName=(rank:number)=>['初阶','一阶','二阶','三阶'][Math.max(0,Math.min(3,rank))];
export function presentation(c:Content):Presentation {return (c as Content&{presentation?:Presentation}).presentation??{revision:UI_REVISION,events:{}};}
export function threadText(c:Content,key:string,raw:string):string {
 const translated=presentation(c).threadValues?.[raw];if(translated)return translated;
 const act=key.match(/(?:act_|echo_major_|echo_)(\d+)/);
 if(act){const source=key.startsWith('act_')?Number(act[1]):Math.max(0,Number(act[1])-1);const ev=c.events.find(e=>e.id===`major.${source}`),choice=ev?.choices.find(x=>x.id===raw);if(choice)return choice.label;}
 if(/^[a-z0-9_]+$/i.test(raw))return '旧事已记';return raw;
}
export function conditionText(c:Content,q:Condition):string {
 switch(q.type){
 case 'has_talent':return `需悟得${c.talents.find(t=>t.id===q.key)?.name??'另一门天赋'}`;
 case 'race_is':return `需为${c.races.find(r=>r.id===q.key)?.name??'另一族裔'}`;
 case 'currency_at_least':return `灵石至少 ${q.value}`;
 case 'hp_above_absolute':return `生命高于 ${q.value}`;
 case 'hp_below':return `生命低于 ${q.value}%`;
 case 'hp_above':return `生命高于 ${q.value}%`;
 case 'stat_at_least':return `${c.labels.stats[q.stat??'luck']}至少 ${q.value}`;
 case 'counter_at_least':return `${c.labels.counters[q.key??'']??'因缘'}至少 ${q.value}`;
 case 'thread_is':return `${c.labels.threads?.[q.key??'']??'前缘'} · ${threadText(c,q.key??'',q.text??'')}`;
 case 'has_fact':return c.labels.facts[q.key??'']??'已有旧缘';
 case 'event_seen':return `曾经历「${c.events.find(e=>e.id===q.key)?.name??'前缘'}」`;
 case 'status_stack_at_least':return `${q.target==='enemy'?'敌方':'自身'}${c.labels.statuses[q.status??'']??q.status}≥${q.value}`;
 case 'rage_at_least':return `怒气≥${q.value}`;
 case 'has_status':return `${q.target==='enemy'?'敌方':'自身'}有${c.labels.statuses[q.status??'']??q.status}`;
 case 'enemy_tag':return `敌方属${c.labels.tags?.[q.tag??'']??'特定类型'}`;
 case 'player_tag':return '所习功法相合';
 default:return '因缘未至';
 }
}
export function narrativeAvailable(c:Content,s:RunState,ch:Choice):boolean {
 return (ch.conditions??[]).filter(q=>['has_fact','thread_is','event_seen','race_is','has_talent'].includes(q.type)).every(q=>conditionOK(c,s,q));
}
export function choiceCopy(c:Content,eventId:string,phase:string,id:string):ChoiceCopy {
 const p=presentation(c).events[eventId]?.choices;return p?.[`${phase}.${id}`]??p?.[id]??{};
}
export function storyText(c:Content,s:RunState,event:Story,phase:EventPhase):string {
 const p=presentation(c).events[event.id];if(p?.phases?.[phase.id])return p.phases[phase.id];
 if(phase.id==='root'||phase.id==='decision'){
  const variant=p?.variants?.find(x=>x.when.every(q=>conditionOK(c,s,q)));
  return variant?.text??p?.intro??phase.text;
 }
 return phase.text;
}
export function resultText(c:Content,item:StoryLogItem|undefined,fallback=''):string {
 if(!item)return fallback;
 const cp=choiceCopy(c,item.eventId??'',item.phase??'root',item.choiceId??'');
 return (item.success===true?cp.success:item.success===false?cp.failure:cp.outcome)??item.result??fallback;
}
const signed=(n:number)=>`${n>=0?'+':''}${n}`;
export function effectText(c:Content,e:Effect,rank=0):string {
 const n=value(e.value,rank),k=e.stat??'attack',stat=c.labels.stats[k],status=c.labels.statuses[e.status??'']??e.status,coeff=value(e.coefficient,rank),pct=value(e.percent,rank);
 const amount=[n?String(n):'',coeff?`${c.labels.stats[e.stat??'defense']}×${coeff}%`:'',e.maxHpPercent?`最大生命×${e.maxHpPercent}%`:''].filter(Boolean).join(' + ')||'0';
 switch(e.type){
 case 'damage':return `${e.target==='self'?'自身承受 ':''}${[n?String(n):'',coeff?`${stat}×${coeff}%`:'',e.maxHpPercent?`最大生命×${e.maxHpPercent}%`:''].filter(Boolean).join(' + ')||'0'}伤害${e.pure?'（无视防御）':''}`;
 case 'resource_damage':return `${e.resourceTarget==='self'?'自身':'敌方'}每${['burn','break','weak','vulnerable'].includes(e.resource??'')?'层':'点'}${c.labels.statuses[e.resource??'']??(e.resource==='rage'?'怒气':e.resource)}追加${stat}×${coeff}%伤害（上限${e.cap??9999}${['burn','break','weak','vulnerable'].includes(e.resource??'')?'层':'点'}）`;
 case 'heal':return `恢复 ${e.maxHpPercent?`${e.maxHpPercent}% 最大生命`:n+' 生命'}`;
 case 'gain_shield':return `获得 ${amount} 护盾`;
 case 'gain_rage':return `怒气 +${n}`;
 case 'lose_rage':return `怒气 -${n}`;
 case 'consume_status':return `消耗${e.target==='enemy'?'敌方':''}${n}层${status}`;
 case 'consume_shield':return `消耗 ${n} 护盾`;
 case 'apply_status':return `${e.target==='self'?'自身':'敌方'}${status} +${n}层`;
 case 'remove_status':return `清除${status}`;
 case 'modify_stat':return `${stat}${n?' '+signed(n):''}${pct?' '+signed(pct)+'%':''}`;
 case 'gain_currency':return `灵石 ${signed(n)}`;
 case 'gain_xp':return `修为 ${signed(n)}`;
 case 'add_counter':return `${c.labels.counters[e.key??'']??e.key} ${signed(n)}`;
 case 'rank_up':return `${c.abilities.find(a=>a.id===e.key)?.name??'功法'}升阶`;
 default:return '';
 }
}
const triggers:Record<string,string>={battle_start:'入战',round_start:'回合开始',round_end:'回合结束',after_action:'行动后',on_hit:'命中后',on_damage:'造成伤害后',on_damaged:'受击后',on_rage_skill:'怒技后',on_rage_spend:'消耗怒气后',on_crit:'暴击后',on_evade:'闪避后',on_heal:'实际治疗后',on_shield_gain:'获得护盾后',on_status_apply:'施加状态后',on_status_tick:'持续效果结算后',on_consume:'发生消耗后',hp_threshold:'',battle_end:'胜利后',before_action:'行动前'};
export function abilityLines(c:Content,a:Ability,rank:number):string[]{
 const result:string[]=[];
 const stats=Object.entries(a.stats).map(([k,v])=>`${c.labels.stats[k]} ${signed(value(v,rank))}`).join(' · ');if(stats)result.push(stats);
 if(a.effects.length)result.push(a.effects.map(e=>effectText(c,e,rank)).filter(Boolean).join('；'));
 for(const t of a.triggers){
  const tagRule=t.requiresTags?.length?`来源含${t.requiresTags.map(x=>'【'+MECHANIC_TAG_LABELS[x]+'】').join('、')}`:t.anyTags?.length?`来源含任一${t.anyTags.map(x=>'【'+MECHANIC_TAG_LABELS[x]+'】').join('、')}`:'';
  const when=[triggers[t.on]??'触发时',tagRule,...(t.conditions??[]).map(q=>conditionText(c,q))].filter(Boolean).join('，');
  result.push(`${t.once?'每战一次 · ':''}${t.maxPerRound?'每轮至多 '+t.maxPerRound+' 次 · ':''}${when}${t.chance!==undefined?`（${t.chance}%概率）`:''}：${t.effects.map(e=>effectText(c,e,rank)).filter(Boolean).join('；')}`);
 }
 return result;
}
export function choiceEffects(c:Content,ch:Choice,branch?:'success'|'failure'):string[]{
 const b=branch?ch.check?.[branch]:ch;
 const effects=(b?.effects??[]).map(e=>e.type==='damage'?`生命 -${value(e.value)}${e.maxHpPercent?' -'+e.maxHpPercent+'% 最大生命':''}`:effectText(c,e)).filter(Boolean);
 const grant=b?.grant;if(grant)effects.push(grant.id?`获得 ${c.abilities.find(a=>a.id===grant.id)?.name??'机缘'}`:`获得一项${c.labels.slots[grant.slot??'artifact']}`);
 return effects;
}
export function phaseText(id:string):string {return ({root:'抉择',echo:'旧因回响',decision:'此刻抉择',threshold:'入境',core:'探幽'} as Record<string,string>)[id]??'抉择';}

const creationKinds:Record<CreationKind,'races'|'origins'|'fates'>={race:'races',races:'races',origin:'origins',origins:'origins',fate:'fates',fates:'fates'};
function creationEntry(c:Content,kind:CreationKind,id:string):CreationCopy|undefined {
 const raw=presentation(c).creation?.[creationKinds[kind]]?.[id];
 return typeof raw==='string'?{summary:raw}:raw;
}
export const creationCopy=creationEntry;
export function creationSummary(c:Content,kind:CreationKind,id:string):string {return creationEntry(c,kind,id)?.summary??'';}
export function creationHint(c:Content,kind:CreationKind,id:string):string {return creationEntry(c,kind,id)?.hint??'';}
export function hasCreationCopy(c:Content,kind:CreationKind,id:string):boolean {return !!creationEntry(c,kind,id)?.summary?.trim();}

export interface CreationLoadoutItem {id:string;name:string;art:string;slot:LoadoutSlot;slotLabel:string;}
export function creationLoadout(c:Content,originId:string):CreationLoadoutItem[] {
 const origin=c.origins.find(x=>x.id===originId);
 if(!origin)return [];
 return origin.starting.map(id=>{
  const a=c.abilities.find(x=>x.id===id);
  if(!a)return undefined;
  const slot=abilityLoadoutSlot(a);
  return {id:a.id,name:a.name,art:a.art,slot,slotLabel:slotLabel(slot)};
 }).filter((x):x is CreationLoadoutItem=>!!x);
}

const behaviorTriggers:Record<string,string>={
 battle_start:'入战时',
 round_start:'回合开始时',
 round_end:'每轮结束时',
 before_action:'行动前',
 after_action:'行动后',
 on_hit:'命中后',
 on_damage:'造成伤害后',
 on_damaged:'受击后',
 on_rage_skill:'施展怒技后',
 on_rage_spend:'消耗怒气后',
 on_crit:'暴击后',
 on_evade:'闪避后',
 on_heal:'实际回复生命后',
 on_shield_gain:'获得护盾后',
 on_status_apply:'施加状态后',
 on_status_tick:'持续状态结算后',
 on_consume:'发生消耗后',
 hp_threshold:'生命进入危险区时',
 battle_end:'胜利后'
};
const behaviorResources:Record<string,string>={rage:'怒气',shield:'护盾',burn:'燃烧',weak:'虚弱',break:'破甲',stun:'眩晕',vulnerable:'易伤'};
const behaviorConversions:Record<string,string>={damage:'造成实际伤害',damage_taken:'承受实际生命伤害',heal:'实际回复生命',shield_gain:'获得护盾',rage_spend:'消耗怒气',status_tick:'持续状态结算',status_consume:'消耗状态'};
const behaviorTargets:Record<string,string>={self:'自身',enemy:'敌方'};
const behaviorActions:Record<string,string>={basic:'普攻',rage:'怒技'};
const behaviorStats:Record<string,string>={hp:'生命',attack:'攻击',defense:'防御',speed:'速度',hit:'命中',dodge:'闪避',luck:'气运'};
function behaviorStatus(c:Content,key:string|undefined):string {return key?c.labels.statuses[key]??behaviorResources[key]??'相关状态':'相关状态';}
function behaviorTarget(target:string|undefined):string {return behaviorTargets[target??'']??'目标';}
function behaviorTagList(tags:string[]|undefined):string {
 return (tags??[]).map(tag=>MECHANIC_TAG_LABELS[tag as keyof typeof MECHANIC_TAG_LABELS]).filter(Boolean).join('、');
}
function behaviorCondition(c:Content,q:Condition):string {
 const target=q.target==='enemy'?'敌方':'自身';
 switch(q.type){
 case 'hp_below':return target==='自身'?'生命承压':'敌方受创';
 case 'hp_above':return target==='自身'?'生命尚有余裕':'敌方状态较稳';
 case 'hp_above_absolute':return target==='自身'?'生命尚有余裕':'目标生命尚有余裕';
 case 'rage_at_least':return target==='自身'?'怒气充盈':'目标怒气充盈';
 case 'has_status':return `${target}已有${behaviorStatus(c,q.status)}`;
 case 'status_stack_at_least':return q.status==='shield'?`${target}护盾充足`:`${target}${behaviorStatus(c,q.status)}堆起`;
 case 'stat_at_least':return `${target}${behaviorStats[q.stat??'']??'相关属性'}充足`;
 case 'counter_at_least':return `${target}因缘积累到位`;
 case 'currency_at_least':return '灵石充足';
 case 'enemy_tag':return '敌方呈现相应类型';
 case 'player_tag':return '自身行动与来源相合';
 case 'has_fact':return '已有相关前因';
 case 'event_seen':return '相关经历已经发生';
 case 'thread_is':return '前缘相合';
 case 'act_is':return '进入相应幕次';
 case 'has_talent':return '已悟得相应天赋';
 default:return '条件成立';
 }
}
function behaviorEffect(c:Content,e:Effect,on=''):string {
 const target=e.target==='self'?'自身':'敌方';
 switch(e.type){
 case 'damage':return target==='自身'?'承受伤害':e.pure?'追加纯伤害':'追加伤害';
 case 'resource_damage':{
  const holder=e.resourceTarget==='self'?'自身':'敌方';
  return `按${holder}${behaviorStatus(c,e.resource)}追加伤害`;
 }
 case 'heal':return `${target}回复生命`;
 case 'gain_shield':return `${target}获得护盾`;
 case 'gain_rage':return `${target}${on==='on_rage_skill'?'返还':'获得'}怒气`;
 case 'lose_rage':return `${target}消耗怒气`;
 case 'consume_status':return `消耗${target}${behaviorStatus(c,e.status)}`;
 case 'consume_shield':return `消耗${target}护盾`;
 case 'apply_status':return `使${target}${behaviorStatus(c,e.status)}增加`;
 case 'remove_status':return `清除${target}${behaviorStatus(c,e.status)}`;
 case 'modify_stat':{
  const stat=behaviorStats[e.stat??'']??'相关属性';
  const values=[e.value,e.percent].flat().filter((x):x is number=>typeof x==='number'&&Number.isFinite(x));
  const direction=values.length&&values.every(x=>x<0)?'削弱':values.some(x=>x>0)?'强化':'调整';
  return `${direction}${target}${stat}`;
 }
 case 'gain_currency':return `${target}获得灵石`;
 case 'gain_xp':return `${target}获得修为`;
 case 'rank_up':return '提升功法阶位';
 case 'set_fact':return '留下因果记录';
 case 'add_counter':return '推进因缘';
 case 'advance_thread':return '推进前缘';
 default:return '';
 }
}
function behaviorTrigger(c:Content,t:{on:string;effects:Effect[];once?:boolean;chance?:number;maxPerRound?:number;conditions?:Condition[];requiresTags?:string[];anyTags?:string[]}):string {
 const restrictions=[t.once?'受每场触发限制':'',t.maxPerRound!==undefined?'受每轮次数限制':'',t.chance!==undefined&&t.chance<100?'有概率':''].filter(Boolean);
 const tags=t.requiresTags?.length?`来源含${behaviorTagList(t.requiresTags)}`:t.anyTags?.length?`来源含任一${behaviorTagList(t.anyTags)}`:'';
 const conditions=(t.conditions??[]).map(q=>behaviorCondition(c,q));
 const gates=[tags,...conditions].filter(Boolean);
 const when=[behaviorTriggers[t.on]??'触发时',...gates].join('，');
 const effects=t.effects.map(e=>behaviorEffect(c,e,t.on)).filter(Boolean);
 return `${when}${restrictions.length?`（${restrictions.join('、')}）`:''}${effects.length?`：${effects.join('并')}`:''}`;
}
function behaviorConversion(c:Content,from:string,to:string,status?:string,cap?:number):string {
 const source=behaviorConversions[from]??'战斗结果';
 const detail=status?`${source}中的${behaviorStatus(c,status)}`:source;
 const target=behaviorResources[to]??({damage:'伤害',heal:'回复生命',shield:'护盾',rage:'怒气'} as Record<string,string>)[to]??'额外效果';
 return `${detail}后，部分收益转为${target}${cap!==undefined?'（受转换上限约束）':''}`;
}
function authoredBehaviorLines(c:Content,id:string):string[] {
 const p=presentation(c);
 for(const source of [p.abilityBehaviors,p.abilityBehavior]){
  const raw=source?.[id];
  if(typeof raw==='string')return raw.trim()?[raw.trim()]:[];
  if(raw){
   if(raw.summary?.trim())return [raw.summary.trim()];
   const lines=(raw.lines??[]).map(line=>line.trim()).filter(Boolean);
   if(lines.length)return lines;
  }
 }
 return [];
}
export function abilityBehaviorLines(c:Content,a:Ability|string,rank=0):string[] {
 void rank;
 const ability=typeof a==='string'?c.abilities.find(x=>x.id===a):a;
 if(!ability)return [];
 const authored=authoredBehaviorLines(c,ability.id);
 if(authored.length)return authored;
 if(ability.slot!=='strategy'&&!(ability.relicConversions?.length))return [];
 const lines:string[]=[];
 for(const rule of ability.strategyRules??[]){
  const conditions=(rule.conditions??[]).map(q=>behaviorCondition(c,q));
  const action=behaviorActions[rule.action]??'可用行动';
  lines.push(`${conditions.length?conditions.join('且')+'时':'条件满足时'}优先使用${action}`);
 }
 if(ability.defaultAction){
  const action=behaviorActions[ability.defaultAction]??'可用行动';
  if(ability.strategyRules?.length&&ability.defaultAction==='basic')lines.push(`平时以${action}推进；怒技可用而条件未成时，会短暂保留怒气后再择机施展`);
  else if(ability.defaultAction==='rage')lines.push(`${action}可用时优先施展；暂不可用时按当前可用行动推进`);
  else lines.push(`通常以${action}推进；其他行动仍按可用条件择机施展`);
 }
 for(const trigger of ability.triggers??[])lines.push(behaviorTrigger(c,trigger));
 for(const conversion of ability.relicConversions??[])lines.push(behaviorConversion(c,conversion.from,conversion.to,conversion.status,conversion.cap));
 const unique=[...new Set(lines.filter(Boolean))];
 return unique;
}
export function abilityBehaviorSummary(c:Content,a:Ability|string,rank=0):string {return abilityBehaviorLines(c,a,rank).join('；');}
