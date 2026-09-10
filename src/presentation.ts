
import {Ability,Choice,Condition,Content,Effect,EventPhase,RunState,Story,StoryLogItem,conditionOK,value} from './engine.js';

export interface ChoiceCopy {label?:string; preview?:string; outcome?:string; success?:string; failure?:string; hint?:string;}
export interface EventCopy {intro?:string; variants?:{when:Condition[];text:string}[]; phases?:Record<string,string>; choices?:Record<string,ChoiceCopy>;}
export interface Presentation {revision:string;events:Record<string,EventCopy>;threadValues?:Record<string,string>;}
export const UI_REVISION='14.1';
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
 return (ch.conditions??[]).filter(q=>['has_fact','thread_is','event_seen'].includes(q.type)).every(q=>conditionOK(c,s,q));
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
const triggers:Record<string,string>={battle_start:'入战',round_start:'回合开始',round_end:'回合结束',after_action:'行动后',on_hit:'命中后',on_damaged:'受击后',on_rage_skill:'怒技后',on_crit:'暴击后',on_evade:'闪避后',on_heal:'实际治疗后',hp_threshold:'',battle_end:'胜利后',before_action:'行动前'};
export function abilityLines(c:Content,a:Ability,rank:number):string[]{
 const result:string[]=[];
 const stats=Object.entries(a.stats).map(([k,v])=>`${c.labels.stats[k]} ${signed(value(v,rank))}`).join(' · ');if(stats)result.push(stats);
 if(a.effects.length)result.push(a.effects.map(e=>effectText(c,e,rank)).filter(Boolean).join('；'));
 for(const t of a.triggers){
  const when=[triggers[t.on]??'触发时',...(t.conditions??[]).map(q=>conditionText(c,q))].filter(Boolean).join('，');
  result.push(`${t.once?'每战一次 · ':''}${when}${t.chance!==undefined?`（${t.chance}%概率）`:''}：${t.effects.map(e=>effectText(c,e,rank)).filter(Boolean).join('；')}`);
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
