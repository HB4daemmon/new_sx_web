import {Game,Content,RunState,LoadoutSlot,Stat,Equipped,Frame,Battle,SLOT_ORDER,STAT_KEYS,MECHANIC_TAG_LABELS,fateOptions,conditionOK,value,validateContent,inRunPool,routeLength,abilityLoadoutSlot,abilityMechanicTags,slotLabel,characterRouteClues} from './engine.js';
import {esc,icon,sigil,portrait,landscape} from './art.js';
import {BuildDependency,BuildResource,BuildSourceRef,analyzeAbilityFit,compareLoadouts} from './build-analysis.js';
import {UI_REVISION,rankName,threadText,conditionText,narrativeAvailable,choiceCopy,storyText,resultText,abilityLines,abilityBehaviorLines,abilityBehaviorSummary,choiceEffects,phaseText,creationSummary,creationHint,creationLoadout,conversionText} from './presentation.js';
declare global {interface Window{__GAME_CONTENT__?:Content;}}
const SAVE_KEY='fengshen-run-v44';
const PREVIOUS_SAVE_KEY='fengshen-run-v43';
const LEGACY_SAVE_KEY='fengshen-run-v42';
const LEGACY_OLD_SAVE_KEY='fengshen-run-v4';
const LEGACY_ANCIENT_SAVE_KEY='fengshen-run-v1';
const TAGS:Record<string,string>={...MECHANIC_TAG_LABELS};
const NODE_ICONS:Record<string,string>={combat:'swords',elite:'skull',event:'cloud',shop:'coin',rest:'camp',major:'eye',hidden:'eye',treasure:'seal',boss:'gate'};
const STAT_ICONS:Record<string,string>={hp:'heart',attack:'sword',defense:'shield',speed:'feather',hit:'eye',dodge:'cloud',luck:'star'};
const SLOT_SIGNS:Record<LoadoutSlot,string>={basic:'基',rage:'怒',component:'构',relic:'命',strategy:'策'};
const RARITY_LABELS:Record<string,string>={common:'凡品',rare:'稀有',mythic:'神话'};
const VFX_ATLAS='./assets/generated/combat-vfx-atlas.webp';
const bi=(n:number,min=0,max=100)=>Math.max(min,Math.min(max,n));
const percent=(n:number,total:number)=>bi(Math.floor(n/Math.max(1,total)*100));
const ornament=()=>`<div class="ornament">${icon('diamond',11)}</div>`;
const btn=(action:string,text:string,cls='',attrs='')=>`<button class="button ${cls}" data-action="${action}" ${attrs}>${text}</button>`;
const tone=(a:{tags:string[];rarity:string})=>a.rarity==='mythic'?'mythic':a.tags.includes('burn')?'burn':a.tags.includes('shield')?'shield':'jade';
type OptionalGame=Game&{trackCharacter?:(relationKey:string|null)=>void;followCharacter?:(relationKey:string)=>void;clearCharacterFollow?:()=>void;bypassCombat?:(nodeId:string)=>void;canBypassCombat?:(nodeId:string)=>boolean;knownCharacters?:()=>unknown[];};
type CharacterEntry={key:string;name:string;art:string};
function newSeed(){return 'FS-'+crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase().slice(0,7);}
export class FengshenGame extends HTMLElement {
 content!:Content;game?:Game;home=true;view='journey';modal='';modalAbility='';toastText='';timer=0;toastTimer=0;speed=2;paused=false;muted=true;detailedLog=false;audio?:AudioContext;
 renderKey='';logKey='';logTop=0;logFollow=true;focusReturn='';keyHandler?: (e:KeyboardEvent)=>void;
 selectedTalent='';selectedRace='human';legacySave='';selectedOrigin='';selectedFate='';playerName='无名';selectedPortrait='';seed='FENGSHEN-2026';setupStep=0;codexFilter='equipped';restMode='';storageOK=true;
 async connectedCallback(){
  this.innerHTML=`<div class="loading">${icon('seal',60)}<p>山河卷将启…</p></div>`;
  try{this.content=window.__GAME_CONTENT__??await fetch('./data/game.json').then(r=>{if(!r.ok)throw new Error('Content request failed');return r.json();});validateContent(this.content);this.selectedOrigin=this.content.origins[0].id;this.selectedPortrait=this.content.origins[0].art;
   try{this.legacySave=localStorage.getItem(PREVIOUS_SAVE_KEY)??localStorage.getItem(LEGACY_SAVE_KEY)??localStorage.getItem(LEGACY_OLD_SAVE_KEY)??localStorage.getItem(LEGACY_ANCIENT_SAVE_KEY)??'';const text=localStorage.getItem(SAVE_KEY);if(text)this.game=Game.load(this.content,text);this.muted=localStorage.getItem('fengshen-muted')!=='false';this.detailedLog=localStorage.getItem('fengshen-detailed-log')==='true';}catch{this.toastText='存档不可读取，可重新入劫或导入存档。';}
   this.addEventListener('click',e=>this.onClick(e));this.addEventListener('input',e=>this.onInput(e));this.addEventListener('change',e=>this.onChange(e));
   document.addEventListener('keydown',this.keyHandler=e=>{const dialog=this.querySelector<HTMLElement>('.modal');if(e.key==='Tab'&&dialog){const items=Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),summary,input:not([hidden])')).filter(x=>x.getClientRects().length>0),first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}if(e.key==='Escape'&&this.modal){this.modal='';this.render();}if(e.code==='Space'&&!this.home&&!this.modal&&!this.game?.s.talentDraft&&this.game?.s.phase==='battle'&&!(e.target instanceof HTMLInputElement)&&!(e.target as Element).closest('button,summary,select,textarea')){e.preventDefault();this.paused=!this.paused;this.render();}});
   this.render();
  }catch(e){this.innerHTML=`<div class="loading"><h2>山河卷加载失败</h2><p>${esc((e as Error).message)}</p><p>请刷新后重试。</p></div>`;}
 }
 disconnectedCallback(){window.clearTimeout(this.timer);window.clearTimeout(this.toastTimer);if(this.keyHandler)document.removeEventListener('keydown',this.keyHandler);}
 save(){if(!this.game)return;try{localStorage.setItem(SAVE_KEY,JSON.stringify(this.game.s));this.storageOK=true;}catch{this.storageOK=false;}}
 notify(text:string){this.toastText=text;window.clearTimeout(this.toastTimer);this.toastTimer=window.setTimeout(()=>{this.toastText='';this.render();},3300);}
 playTone(rage=false){if(this.muted)return;try{this.audio??=new AudioContext();const t=this.audio.currentTime;for(const [i,f] of (rage?[220,330,440]:[440]).entries()){const o=this.audio.createOscillator(),g=this.audio.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(.018,t+i*.045);g.gain.exponentialRampToValueAtTime(.001,t+.18+i*.045);o.connect(g);g.connect(this.audio.destination);o.start(t+i*.045);o.stop(t+.22+i*.045);}}catch{this.muted=true;}}
 onInput(e:Event){const el=e.target as HTMLInputElement;if(el.name==='player-name')this.playerName=el.value.slice(0,14);if(el.name==='seed'){this.seed=el.value.slice(0,32)||'FENGSHEN-2026';this.selectedFate='';}}
 async onChange(e:Event){const el=e.target as HTMLInputElement;if(el.type==='file'&&el.files?.[0]){try{if(el.files[0].size>4000000)throw new Error('Save too large');const g=Game.load(this.content,await el.files[0].text());this.game=g;this.home=false;this.view='journey';this.modal='';this.save();this.notify('存档已导入');}catch{this.notify('存档无效或版本不匹配，原存档未更改。');}this.render();}}
 appGame():OptionalGame|undefined{return this.game as OptionalGame|undefined;}
 supportsAction(action:string):boolean{const g=this.appGame();return !!g&&typeof (g as unknown as Record<string,unknown>)[action]==='function';}
 invokeOptionalCommand(command:string,...args:unknown[]):void{
  const g=this.appGame();if(!g)throw new Error('No game');
  const direct=(g as unknown as Record<string,unknown>)[command];
  if(typeof direct==='function'){(direct as (...items:unknown[])=>void).apply(g,args);return;}
  const runner=(g as unknown as {command?:(name:string,values:any[])=>void}).command;
  if(typeof runner==='function'){runner.call(g,command,args);return;}
  throw new Error('此版本引擎尚未提供该操作');
 }
 knownCharacterEntries():CharacterEntry[]{
  const g=this.appGame(),s=this.game!.s,registry=new Map<string,CharacterEntry>();
  const fromEngine=typeof g?.knownCharacters==='function'?g.knownCharacters.call(g):undefined;
  const raw=Array.isArray(fromEngine)?fromEngine:
   fromEngine&&typeof fromEngine==='object'?Object.entries(fromEngine as Record<string,unknown>).map(([key,value])=>typeof value==='object'&&value?{key,...value as Record<string,unknown>}:{key,known:value}):[];
  for(const item of raw){
   const data=typeof item==='string'?{key:item}:item as Record<string,unknown>;
   if(data.known===false||data.isKnown===false)continue;
   const key=String(data.key??data.relationKey??data.id??'');if(!key)continue;
   const event=this.content.events.find(x=>x.relationKey===key&&x.character);
   if(!event)continue;
   registry.set(key,{key,name:String(data.name??event.character),art:String(data.art??event.art)});
  }
  if(fromEngine===undefined){
   for(const event of this.content.events){
    if(!event.character||!event.relationKey||(s.seenEvents[event.id]??0)<=0)continue;
    registry.set(event.relationKey,{key:event.relationKey,name:event.character,art:event.art});
   }
  }
  return [...registry.values()];
 }
 characterClue(character:CharacterEntry):string{
  const s=this.game!.s,clues=characterRouteClues(this.content,s,character.key);
  if(s.phase==='map'){
   const messages:string[]=[];
   if(clues.elite.length)messages.push(`前方有精英战方向，可能推进${character.name}的约定；路线仍需自行选择。`);
   if(clues.bypass.length)messages.push(`前方普通战可使用${character.name}的借道资格，但会放弃该战全部收益。`);
   if(clues.story.length)messages.push(`本幕前方的普通奇遇，可能传来${character.name}的消息；路线仍需自行选择。`);
   return messages.length?messages.join(' '):`本幕暂未发现${character.name}的明确机会，追踪会等候后续未解析的路线。`;
  }
  return `已追踪${character.name}；下一处尚未解析的普通奇遇可能传来消息。`;
 }
 canBypassCombatNode(nodeId:string):boolean{
  const g=this.appGame();
  return !!g&&typeof g.canBypassCombat==='function'&&g.canBypassCombat(nodeId);
 }
 bypassControls():string{
  if(!this.game||this.game.s.phase!=='map'||!this.supportsAction('bypassCombat'))return '';
  const nodes=this.game.available().filter(n=>this.canBypassCombatNode(n.id));if(!nodes.length)return '';
  return `<section class="map-bypass" aria-label="借道">${nodes.map(n=>`<div><span><strong>借道</strong>绕过一场普通战斗，放弃该战斗的全部收益。</span>${btn('bypassCombat','借道 '+icon('arrow',15),'small',`data-id="${esc(n.id)}"`)}</div>`).join('')}</section>`;
 }
 onClick(e:Event){const target=(e.target as Element).closest<HTMLElement>('[data-action]');if(!target||target.hasAttribute('disabled'))return;if(this.querySelector('.modal')&&!target.closest('.modal'))return;const action=target.dataset.action!,id=target.dataset.id??'',index=Number(target.dataset.index??-1),g=this.game;
  try{
   this.playTone();
   switch(action){
    case 'selectTalent':if(g?.s.talentDraft?.level===index&&g.s.talentDraft.offers.includes(id))this.selectedTalent=id;break;
    case 'chooseTalent':if(g?.s.talentDraft?.level===index){g.chooseTalent(id);this.selectedTalent='';}break;
    case 'race':if(this.content.races.some(r=>r.id===id))this.selectedRace=id;break;
    case 'exportLegacy':if(this.legacySave){const url=URL.createObjectURL(new Blob([this.legacySave],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='fengshen-legacy-save.json';a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}break;
    case 'origin':this.selectedOrigin=id;this.selectedPortrait=this.content.origins.find(o=>o.id===id)!.art;break;
    case 'portrait':this.selectedPortrait=id;break;
    case 'fates':this.setupStep=1;this.selectedFate='';break;
    case 'fate':this.selectedFate=id;break;
    case 'setupBack':this.setupStep=0;break;
    case 'start':if(!this.selectedFate)break;this.game=Game.create(this.content,this.seed,this.selectedOrigin,this.selectedFate,this.playerName,this.selectedPortrait,this.selectedRace);this.home=false;this.view='journey';this.restMode='';this.save();break;
    case 'resume':this.home=false;this.view='journey';break;
    case 'home':this.home=true;break;
    case 'new':this.modal='new';break;
    case 'confirmNew':this.home=true;this.setupStep=0;this.seed=newSeed();this.selectedFate='';this.modal='';break;
    case 'tab':this.view=id;this.restMode='';break;
    case 'help':this.modal='help';break;
    case 'settings':this.modal='settings';break;
    case 'close':this.modal='';break;
    case 'character':this.modal='character';break;
    case 'followLog':{const log=this.querySelector<HTMLElement>('.battle-log');if(log)log.scrollTop=log.scrollHeight;this.logFollow=true;return;}
    case 'shuffleSeed':this.seed=newSeed();this.selectedFate='';break;
    case 'inspect':this.modal='ability';this.modalAbility=id;break;
    case 'sound':this.muted=!this.muted;try{localStorage.setItem('fengshen-muted',String(this.muted));}catch{}break;
     case 'detailedLog':this.detailedLog=!this.detailedLog;try{localStorage.setItem('fengshen-detailed-log',String(this.detailedLog));}catch{}break;
    case 'export':if(g){const blob=new Blob([JSON.stringify(g.s,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='fengshen-save-'+g.s.seed.replace(/[^a-zA-Z0-9_-]/g,'')+'.json';a.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}break;
    case 'import':this.querySelector<HTMLInputElement>('#save-file')?.click();return;
    case 'enter':g!.enter(id);this.restMode='';this.paused=false;break;
    case 'bypassCombat':this.invokeOptionalCommand('bypassCombat',id);this.restMode='';this.paused=false;break;
    case 'trackCharacter':this.invokeOptionalCommand('trackCharacter',target.dataset.track==='clear'?null:id);break;
    case 'followCharacter':this.invokeOptionalCommand('followCharacter',id);break;
    case 'clearCharacterFollow':this.invokeOptionalCommand('clearCharacterFollow');break;
    case 'speed':this.speed=index;break;
    case 'pause':this.paused=!this.paused;break;
    case 'skip':if(g!.s.battle)g!.s.battle.cursor=g!.s.battle.frames.length-1;break;
    case 'finishBattle':g!.finishBattle();this.paused=false;break;
    case 'reward':g!.reward(index);break;
    case 'skipReward':g!.skipReward();break;
    case 'replace':g!.replace(index);break;
    case 'cancelReplacement':g!.cancelReplacement();break;
    case 'buy':g!.buy(index);break;
    case 'refresh':g!.refresh();break;
    case 'leaveShop':g!.leaveShop();break;
    case 'restMode':this.restMode=id;break;
    case 'rest':g!.rest(id,index);this.restMode='';break;
    case 'event':g!.chooseEvent(id);break;
    case 'leaveEvent':g!.leaveEvent();break;
    case 'ending':g!.chooseEnding(id);break;
    case 'filter':this.codexFilter=id;break;
    default:return;
   }
   this.save();this.render();
  }catch(error){console.error(error);this.notify('操作未生效：'+(error as Error).message);this.render();}
 }

 header(){return `<header class="topbar"><button class="brand" data-action="home" aria-label="返回封面"><span class="brand-mark">劫</span><strong>封神<span class="gold">·</span>劫中人</strong></button>${!this.home?`<nav class="desktop-nav" aria-label="主导航">${[['journey','mountain','山河'],['build','book','命盘'],['karma','lotus','因缘']].map(([id,i,n])=>`<button class="nav-button ${this.view===id?'active':''}" data-action="tab" data-id="${id}" ${this.view===id?'aria-current="page"':''}>${icon(i,19)}${n}</button>`).join('')}</nav>`:''}<div class="top-tools">${!this.storageOK?'<span class="save-warning" role="status">存档失败，请导出</span>':''}<button class="icon-button" data-action="settings" aria-label="设置">${icon('gear',21)}</button></div></header>`;}

 racePicker(){const race=this.content.races.find(r=>r.id===this.selectedRace)!;return `<section class="race-picker"><h3>族裔</h3><div class="race-options">${this.content.races.map(r=>`<button data-action="race" data-id="${r.id}" class="race-option ${r.id===race.id?'selected':''}" aria-pressed="${r.id===race.id}">${icon(r.art,24)}<strong>${esc(r.name)}</strong></button>`).join('')}</div><p class="race-trait"><b>${esc(race.trait)}</b></p></section>`;}
 creationInsight(kind:'race'|'origin'|'fate',id:string){
  if(!id)return '';
  const item=kind==='race'?this.content.races.find(x=>x.id===id):kind==='origin'?this.content.origins.find(x=>x.id===id):this.content.fates.find(x=>x.id===id);
  if(!item)return '';
  const summary=creationSummary(this.content,kind,id),hint=creationHint(this.content,kind,id);
  if(!summary&&!hint)return '';
  const loadout=kind==='origin'?creationLoadout(this.content,id):[];
  return `<section class="creation-insight creation-${kind}" aria-label="${kind==='race'?'族裔说明':kind==='origin'?'出身说明':'命格说明'}"><div><span class="eyebrow">${kind==='race'?'族裔禀赋':kind==='origin'?'出身取舍':'命格方向'}</span><h3>${esc(item.name)}</h3>${summary?`<p>${esc(summary)}</p>`:''}${hint?`<small>${esc(hint)}</small>`:''}</div>${loadout.length?`<div class="creation-starting"><strong>起手能力</strong><div>${loadout.map(x=>`<span>${icon(x.art,17)}<b>${esc(x.name)}</b><em>${esc(x.slotLabel)}</em></span>`).join('')}</div></div>`:''}</section>`;
 }
 landing(){const o=this.content.origins.find(o=>o.id===this.selectedOrigin)!,ongoing=this.game&&!['dead','finished'].includes(this.game.s.phase);return `<main class="landing immersion-cover">${landscape()}<div class="landing-inner"><section class="landing-copy"><div class="landing-title-art">劫</div><h1>封神<span>劫中人</span></h1><p class="landing-desc">榜上无我名，劫中有我身。</p>${ongoing?`<div class="resume-card"><span>${esc(this.game!.s.name)} · ${esc(this.content.acts[this.game!.s.act].name)}</span>${btn('resume','续此命途 '+icon('arrow',18),'primary')}</div>`:''}</section><div class="hero-card-stage"><div class="hero-back"></div><div class="hero-card">${portrait(this.selectedPortrait,true)}<div class="hero-card-label">${esc(this.content.races.find(r=>r.id===this.selectedRace)!.name)} · ${esc(o.name)}</div></div></div><section class="setup"><div class="setup-top"><h2 class="setup-title">${this.setupStep===0?'前尘':'命格'}</h2>${this.setupStep===0?`<label class="name-input">道号<input name="player-name" maxlength="14" value="${esc(this.playerName)}" aria-label="道号"></label>`:''}</div>${this.setupStep===0?this.racePicker():''}<div class="origin-options">${this.setupStep===0?this.content.origins.map((x,i)=>`<button class="origin-option ${this.selectedOrigin===x.id?'selected':''}" data-action="origin" data-id="${x.id}" aria-pressed="${this.selectedOrigin===x.id}">${icon(['sword','shield','flame','gourd','eye'][i],30)}<div><strong>${esc(x.name)}</strong><p>${esc(x.subtitle)}</p></div></button>`).join(''):fateOptions(this.content,this.seed).map(f=>`<button class="origin-option fate-choice ${this.selectedFate===f.id?'selected':''}" data-action="fate" data-id="${f.id}" aria-pressed="${this.selectedFate===f.id}">${icon(f.art,28)}<strong>${esc(f.name)}</strong></button>`).join('')}</div>${this.setupStep===0?this.creationInsight('race',this.selectedRace)+this.creationInsight('origin',this.selectedOrigin):this.creationInsight('fate',this.selectedFate)}${this.setupStep===0?`<details class="disclosure cover-options" data-panel="cover-options"><summary>形貌与命数</summary><div class="input-line"><div class="portrait-options">${['swordsman','sorcerer'].map(id=>`<button class="${this.selectedPortrait===id?'selected':''}" data-action="portrait" data-id="${id}" aria-label="${id==='swordsman'?'青衫形貌':'方士形貌'}">${portrait(id)}</button>`).join('')}</div><label>命数<input class="seed-input" name="seed" maxlength="32" value="${esc(this.seed)}" aria-label="命数种子"></label>${btn('shuffleSeed','另择命数','small')}</div></details>`:''}<div class="actions">${this.setupStep===0?btn('fates','叩问命格 '+icon('arrow',18),'primary'):btn('setupBack','返回','quiet')+btn('start','入劫 '+icon('arrow',18),'primary',this.selectedFate?'':'disabled')}</div>${ongoing&&this.setupStep===1?'<p class="replace-save-warning">旧途将断。</p>':''}</section></div></main>`;}

 chapters(){const s=this.game!.s;return `<div class="chapter-strip">${this.content.acts.map((a,i)=>`<span class="chapter ${s.act===i?'active':s.act>i?'done':''}" ${s.act===i?'aria-current="step"':''}>${['一','二','三','四'][i]}<span class="chapter-name"> · ${esc(a.name)}</span></span>`).join('<span class="chapter-separator">—</span>')}</div>`;}

 mobileHUD(){if(this.view==='journey'&&this.game?.s.phase==='battle')return '';const s=this.game!.s,st=this.game!.stats();return `<div class="mobile-hud"><button class="hud-character" data-action="character" aria-label="查看人物全部属性"><span>${esc(s.name)}<small>${esc(this.content.realms[s.level])}</small></span><strong>${s.hp}<small> / ${st.hp}</small></strong><div class="bar"><span style="width:${percent(s.hp,st.hp)}%"></span></div></button><button class="hud-stats" data-action="character" aria-label="攻击防御速度及更多属性"><span>攻 <b>${st.attack}</b></span><span>防 <b>${st.defense}</b></span><span>速 <b>${st.speed}</b></span></button><span class="mobile-gold">${icon('coin',17)} ${s.gold}</span></div>`;}

 playerPanel(){if(this.view==='journey'&&this.game?.s.phase==='battle')return '';const s=this.game!.s,st=this.game!.stats(),o=this.content.origins.find(x=>x.id===s.origin)!,f=this.content.fates.find(x=>x.id===s.fate)!,next=this.content.rules.xpThresholds[s.level+1];return `<aside class="sidebar player-rail"><section class="panel player-compact"><button class="player-identity" data-action="character" aria-label="查看人物属性">${portrait(s.portrait)}<span><small>${esc(o.name)}</small><strong>${esc(s.name)}</strong><em>${esc(this.content.realms[s.level])}</em></span></button><div class="panel-body"><div class="vital-title"><span>生命</span><strong>${s.hp} / ${st.hp}</strong></div><div class="bar"><span style="width:${percent(s.hp,st.hp)}%"></span></div><div class="vital-title xp-label"><span>修为</span><span>${s.xp}${next?' / '+next:''}</span></div><div class="bar xp"><span style="width:${next?percent(s.xp-this.content.rules.xpThresholds[s.level],next-this.content.rules.xpThresholds[s.level]):100}%"></span></div><div class="stats-grid detailed">${STAT_KEYS.filter(x=>x!=='hp').map(k=>`<div class="stat detailed-stat"><span>${icon(STAT_ICONS[k],13)}${esc(this.content.labels.stats[k])}</span><b>${st[k]}</b></div>`).join('')}</div><div class="resource-box"><span>灵石</span><strong>${s.gold}</strong></div><details class="disclosure fate-detail" data-panel="fate"><summary>${icon(f.art,18)}${esc(f.name)}</summary><p>${esc(f.description)}</p></details></div></section>${this.view==='journey'?this.buildPanel():''}</aside>`;}

 mini(eq:Equipped|null,index:number){const slot=SLOT_ORDER[index],a=eq?this.game!.ability(eq.id):null;return `<button class="mini-card slot-${slot} rarity-${a?.rarity??'empty'} ${a?'':'empty'}" ${a?`data-action="inspect" data-id="${a.id}"`:'disabled'} aria-label="${esc(slotLabel(slot))} ${a?esc(a.name)+' '+rankName(eq!.rank):'空位'}"><span class="slot-glyph">${SLOT_SIGNS[slot]}</span><span class="name">${a?esc(a.name):'空位'}</span>${eq?`<span class="rank">${rankName(eq.rank)}</span>`:''}</button>`;}

 buildResonances(_compact=false){const b=this.game!.build(),tags=Object.entries(b.tags).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]);return `<section class="build-focus"><div class="build-focus-title"><strong>${b.dominant.length?`当前结构 · ${b.dominant.map(t=>MECHANIC_TAG_LABELS[t]).join(' / ')}`:'机制尚未成形'}</strong>${b.links[0]?`<span>${esc(b.links[0].name)}</span>`:''}<span class="gold">${esc(b.relic.name)}</span></div><details class="disclosure" data-panel="mechanics"><summary>机制与连接</summary><div class="build-tags">${tags.map(([tag,n])=>`<span>${esc(TAGS[tag]??tag)} ×${n}</span>`).join('')||'<span>暂无机制 Tag</span>'}</div><div class="resonance-grid">${b.links.map(link=>`<div class="resonance-row active"><div><strong>${esc(link.name)}</strong><span>${link.count} 条连接</span></div><p>${esc(link.description)}</p></div>`).join('')||'<p class="empty-note">当前组件各自工作，尚未形成明显的跨机制连接。</p>'}</div><div class="build-rule"><strong>命器 · ${esc(b.relic.name)}</strong><p>${esc(b.relic.description)}</p></div><div class="build-rule"><strong>战策 · ${esc(b.strategy.name)}</strong><p>${esc(b.strategy.description)}</p></div></details></section>`;}
 buildPanel(){const s=this.game!.s;return `<section class="rail-board"><button class="side-section-title" data-action="tab" data-id="build">命盘 <span>${s.slots.filter(Boolean).length}/8 ${icon('arrow',13)}</span></button><div class="mini-build">${s.slots.map((eq,i)=>this.mini(eq,i)).join('')}</div></section>`;}

 heading(title:string,sub='',kicker=''){return `<div class="scene-heading"><h1>${esc(title)}</h1>${sub?`<p>${esc(sub)}</p>`:''}</div>`;}
 map(){const s=this.game!.s,a=this.content.acts[s.act],nodes=s.route.filter(n=>n.act===s.act),avail=this.game!.available().map(n=>n.id),trackedClues=s.trackedCharacter?characterRouteClues(this.content,s,s.trackedCharacter):undefined,x=(lane:number)=>[155,400,645][lane],height=1160,y=(row:number)=>90+(routeLength(this.content)-1-row)*108;let paths='';for(const n of nodes)for(const m of nodes.filter(m=>m.row===n.row+1&&Math.abs(m.lane-n.lane)<=1)){const done=s.visited.includes(n.id)&&s.visited.includes(m.id);paths+=`<path d="M${x(n.lane)} ${y(n.row)}C${x(n.lane)} ${y(n.row)-65} ${x(m.lane)} ${y(m.row)+65} ${x(m.lane)} ${y(m.row)}" fill="none" stroke="${done?'#d7bd7a':'#9b9e75'}" stroke-width="${done?2.3:1.3}" stroke-dasharray="${done?'none':'5 8'}" opacity="${done?.7:.32}"/>`;}const clueFor=(n:any)=>trackedClues?.elite.some(x=>x.id===n.id)?'elite':trackedClues?.bypass.some(x=>x.id===n.id)?'bypass':trackedClues?.story.some(x=>x.id===n.id)?'story':'';const clueLabel=(kind:string)=>kind==='elite'?'追踪线索：可能推进精英约定':kind==='bypass'?'追踪线索：可借道普通战斗':'追踪线索：可能传来人物消息';const nodeLabel=(n:any)=>n.type==='hidden'?'未明':n.type==='boss'?this.content.enemies.find(e=>e.id===n.ref)!.name:(this.content.labels.nodes[n.type]??n.type);return `${this.heading(a.name)}<div class="map-scroll" tabindex="0" aria-label="本幕路线，可上下滚动"><div class="map-wrap">${landscape()}<svg class="map-lines" viewBox="0 0 800 ${height}" preserveAspectRatio="none">${paths}</svg>${nodes.map(n=>{const clue=clueFor(n),label=nodeLabel(n),aria=clue?`${label}，${clueLabel(clue)}`:label;return `<button class="map-node ${n.type} ${clue?'has-tracking-clue clue-'+clue:''} ${avail.includes(n.id)?'available':''} ${s.visited.includes(n.id)?'done':''}" style="left:${x(n.lane)/8}%;top:${y(n.row)/height*100}%" data-action="enter" data-id="${n.id}" ${avail.includes(n.id)?'':'disabled'} aria-label="${esc(aria)}" title="${clue?esc(clueLabel(clue)):esc(label)}"><span class="node-disc">${icon(s.visited.includes(n.id)?'check':NODE_ICONS[n.type]??'eye')}</span><span class="node-label">${esc(label)}</span>${clue?`<span class="node-clue" aria-hidden="true">${icon(clue==='elite'?'skull':clue==='bypass'?'arrow':'eye',12)}</span>`:''}</button>`;}).join('')}<div class="map-note"><span>${esc(a.chapter)}</span><span class="node-count">${s.visited.filter(id=>id.startsWith(s.act+'.')).length} / ${routeLength(this.content)}</span></div></div></div><details class="disclosure map-key" data-panel="map-key"><summary>山河图记</summary><div class="map-legend">${['combat','elite','event','hidden','shop','rest','treasure','major'].map(k=>`<span>${icon(NODE_ICONS[k]??'eye',14)}${esc(this.content.labels.nodes[k]??(k==='hidden'?'未明':k))}</span>`).join('')}</div></details>${this.bypassControls()}`;}

 card(id:string,rank=0,action='inspect',attrs='',foot=''){
  const a=this.content.abilities.find(x=>x.id===id)!,role=abilityLoadoutSlot(a),mechanics=abilityMechanicTags(a),tag=action==='display'?'article':'button',effects=abilityLines(this.content,a,Math.min(3,rank)),behavior=abilityBehaviorLines(this.content,a,Math.min(3,rank)),behaviorSummary=abilityBehaviorSummary(this.content,a,Math.min(3,rank));
  const behaviorLines=behavior.length?behavior:['按效果中的触发条件生效。'];
  return `<${tag} class="ability-card ${tone(a)} slot-${role} rarity-${a.rarity}" ${action==='display'?'':`data-action="${action}" data-id="${a.id}"`} ${attrs}><div class="card-top"><span class="slot-pill slot-${role}"><i>${SLOT_SIGNS[role]}</i>${esc(slotLabel(role))}</span><span class="rarity-label rarity-${a.rarity}">${RARITY_LABELS[a.rarity]??a.rarity}</span><span class="card-rank">${rankName(rank)}</span></div><div class="card-heading">${sigil(a.art,a.rarity==='mythic'?'mythic':a.tags.includes('burn')?'fire':a.tags.includes('shield')?'shield':'jade')}<h3 class="card-title rarity-${a.rarity}">${esc(a.name)}</h3></div>${mechanics.length?`<div class="ability-tags compact">${mechanics.map(x=>`<span>${esc(TAGS[x])}</span>`).join('')}</div>`:''}${a.cost||a.cooldown?`<div class="ability-cost">${a.cost?'耗怒 '+a.cost:''}${a.cooldown?' · 冷却 '+a.cooldown+' 回合':''}</div>`:''}<div class="ability-sections" aria-label="${behaviorSummary?`行为：${esc(behaviorSummary)}`:'效果与行为'}"><section class="ability-section ability-effect-section"><h4>效果</h4><div class="ability-effects">${effects.map(x=>`<p>${esc(x)}</p>`).join('')}</div></section><section class="ability-section ability-behavior-section"><h4>行为</h4><div class="ability-behavior">${behaviorLines.map(x=>`<p>${esc(x)}</p>`).join('')}</div></section></div>${foot?`<div class="card-foot"><span class="gain">${foot}</span>${icon('arrow',14)}</div>`:''}</${tag}>`;
 }
 resourceLabel(resource:BuildResource):string{
  const key=resource.status??resource.resource??resource.key,labels=this.content.labels.statuses??{},name=labels[key]??({rage:'怒气',shield:'护盾',hp:'生命',damage:'伤害',heal:'回复',currency:'灵石'} as Record<string,string>)[key]??key,target=resource.target==='enemy'?'敌方':resource.target==='self'?'自身':'目标';
  return `${target}${name}`;
 }
 sourceNames(refs:BuildSourceRef[],limit=4):string{
  const names=[...new Set(refs.map(x=>x.name).filter(Boolean))].slice(0,limit);
  return names.length?names.join('、'):'暂无具体来源';
 }
 dependencyText(dependency:BuildDependency):string{
  const threshold=dependency.threshold??dependency.resource.threshold;
  return `${this.resourceLabel(dependency.resource)}${threshold!==undefined?`（需达到 ${threshold}）`:''}`;
 }
 candidateSlotIndex(id:string):number|undefined{
  const s=this.game!.s,a=this.game!.ability(id),duplicate=s.slots.findIndex(eq=>eq?.id===id);
  if(duplicate>=0)return duplicate;
  const empty=SLOT_ORDER.findIndex((role,index)=>role===abilityLoadoutSlot(a)&&!s.slots[index]);
  return empty>=0?empty:undefined;
 }
 fitNote(id:string,targetSlotIndex?:number){
  const a=this.game!.ability(id),placement=targetSlotIndex??this.candidateSlotIndex(id),fit=analyzeAbilityFit(this.content,this.game!.s,id,placement),tags=abilityMechanicTags(a);
  const dependencySources=fit.dependencies.flatMap(x=>x.reachableProducers.length?x.reachableProducers:x.unknownProducers.length?x.unknownProducers:x.producers);
  const missing=fit.missing.map(x=>this.dependencyText(x)),threshold=fit.threshold.map(x=>`${this.dependencyText(x)}，当前可见来源约 ${x.knownAmount??0}`),uncertain=fit.unknown.map(x=>this.dependencyText(x));
  return `<div class="fit-note" data-fit-status="${esc(fit.status)}"><strong>${esc(fit.statusLabel)}</strong><span>${esc(fit.reasons[0]??fit.statusLabel)}</span>${dependencySources.length?`<small>来源：${esc(this.sourceNames(dependencySources))}</small>`:''}${missing.length?`<small>缺失输入：${esc(missing.join('；'))}</small>`:''}${threshold.length?`<small>阈值：${esc(threshold.join('；'))}</small>`:''}${uncertain.length?`<small>待确认：${esc(uncertain.join('；'))}</small>`:''}${tags.length?`<small>机制：${tags.map(t=>esc(TAGS[t])).join(' · ')}</small>`:''}</div>`;
 }
 replacementImpact(incomingId:string,outgoingId:string,targetSlotIndex:number){
  const comparison=compareLoadouts(this.content,this.game!.s,incomingId,targetSlotIndex),resourceRows=comparison.resourceChanges.slice(0,4).map(change=>{
   const resource=this.resourceLabel(change.resource),lost=this.sourceNames(change.lostSources),gained=this.sourceNames(change.gainedSources),remaining=change.remainingSources.length?this.sourceNames(change.remainingSources):'无';
   return `<span>${esc(resource)}：${change.lostSources.length?`失去 ${esc(lost)}`:''}${change.gainedSources.length?`${change.lostSources.length?'；':''}新增 ${esc(gained)}`:''}${change.remainingSources.length?`；仍由 ${esc(remaining)} 保留`:''}</span>`;
  }).join('');
  const gained=this.sourceNames(comparison.addedSources),lost=this.sourceNames(comparison.removedSources),kept=this.sourceNames(comparison.keptSources);
  return `<div class="replacement-impact" data-target-slot="${targetSlotIndex}">${comparison.addedSources.length?`<span class="gain">新增来源：${esc(gained)}</span>`:''}${comparison.removedSources.length?`<span class="cost">失去来源：${esc(lost)}</span>`:''}${comparison.keptSources.length?`<span>保留来源：${esc(kept)}</span>`:''}${resourceRows}${comparison.reasons.length?`<span>${esc(comparison.reasons[0])}</span>`:''}${comparison.uncertainty.length?`<span>${esc(comparison.uncertainty[0])}</span>`:''}${!comparison.addedSources.length&&!comparison.removedSources.length&&!resourceRows?'<span>来源未改变，主要变化在阶位或行动条件。</span>':''}</div>`;
 }
 rewards(){const s=this.game!.s,title=s.current?.type==='boss'?'劫首遗珍':s.current?.type==='elite'?'强敌遗珍':'机缘';return `<section class="reward-page">${this.heading(title)}<div class="reward-tally"><span>${icon('coin',18)}+${s.rewardInfo?.gold??0}</span><span>${icon('lotus',18)}修为 +${s.rewardInfo?.xp??0}</span></div><div class="reward-cards directed-draft">${s.reward.map((id,i)=>{const eq=s.slots.find(x=>x?.id===id);return `<div class="draft-lane">${this.card(id,eq?Math.min(3,eq.rank+1):0,'reward',`data-index="${i}"`,eq?rankName(eq.rank)+' → '+rankName(Math.min(3,eq.rank+1)):'收下')}${this.fitNote(id)}${btn('inspect','观诀','text-link',`data-id="${id}"`)}</div>`;}).join('')}</div><div class="actions">${btn('skipReward','舍下，继续前行 '+icon('arrow',17),'quiet')}</div></section>`;}

  fighterFrame(frame:Frame,side:'p'|'e'){const f=frame[side],s=this.game!.s,enemy=this.content.enemies.find(e=>e.id===s.battle!.enemyId)!,art=side==='p'?s.portrait:enemy.art;return `<article class="combatant side-${side} ${side==='e'?'enemy':''} ${frame.actor===side?'acting':''}"><div class="fighter-art"><span class="fighter-aura" aria-hidden="true"></span>${portrait(art)}</div><div class="fighter-identity"><h2>${esc(f.name)}</h2>${frame.actor===side?`<span class="turn-mark">${frame.kind==='rage'?'怒技':'出手'}</span>`:''}</div><div class="fighter-bars"><div class="fighter-numbers"><span>生命 <b>${f.hp}</b> / ${f.stats.hp}</span>${f.shield?`<span class="shield-count">${icon('shield',12)} ${f.shield}</span>`:''}</div><div class="bar hp"><span style="width:${percent(f.hp,f.stats.hp)}%"></span></div><div class="fighter-numbers"><span>怒气</span><span>${f.rage} / ${this.content.rules.rageMax}</span></div><div class="bar rage"><span style="width:${percent(f.rage,this.content.rules.rageMax)}%"></span></div></div><div class="fighter-core-stats"><span>攻 <b>${f.stats.attack}</b></span><span>防 <b>${f.stats.defense}</b></span><span>速 <b>${f.stats.speed}</b></span></div><div class="combat-statuses">${Object.entries(f.status).filter(([,v])=>v>0).map(([k,v])=>`<span class="status ${k}">${esc(this.content.labels.statuses[k]??k)} <b>${v}</b></span>`).join('')}</div></article>`;}
  statusChanges(frame:Frame,index:number,frames:Frame[]){if(index<=0)return [] as {side:'p'|'e';name:string;status:string;before:number;after:number}[];const prev=frames[index-1],enemy=this.content.enemies.find(e=>e.id===this.game!.s.battle!.enemyId)!,out:{side:'p'|'e';name:string;status:string;before:number;after:number}[]=[];for(const side of ['p','e'] as const){const before=prev[side],after=frame[side],name=side==='p'?this.game!.s.name:enemy.name;for(const k of new Set([...Object.keys(before.status),...Object.keys(after.status)])){const a=before.status[k]??0,b=after.status[k]??0;if(a!==b)out.push({side,name,status:k,before:a,after:b});}}return out;}
  combatFeedback(frame:Frame,index:number,frames:Frame[]){if(index<=0)return '';const prev=frames[index-1],items:{side:'p'|'e';kind:string;text:string;crit?:boolean}[]=[];for(const side of ['p','e'] as const){const before=prev[side],after=frame[side],hp=after.hp-before.hp,shield=after.shield-before.shield;if(hp<0)items.push({side,kind:'damage',text:`-${Math.abs(hp)}`,crit:!!frame.crit&&frame.actor!==side});else if(hp>0)items.push({side,kind:'heal',text:`+${hp} 生命`});if(shield>0)items.push({side,kind:'shield',text:`+${shield} 护盾`});else if(shield<0)items.push({side,kind:'shield-loss',text:`-${Math.abs(shield)} 护盾`});for(const key of new Set([...Object.keys(before.status),...Object.keys(after.status)])){const delta=(after.status[key]??0)-(before.status[key]??0);if(delta>0)items.push({side,kind:'status-add',text:`${esc(this.content.labels.statuses[key]??key)} +${delta}`});else if(delta<0)items.push({side,kind:'status-use',text:`${esc(this.content.labels.statuses[key]??key)} -${Math.abs(delta)}`});}}const count={p:0,e:0};return `<div class="combat-feedback-layer" aria-hidden="true">${items.slice(0,10).map(item=>{const stack=count[item.side]++;return `<span class="combat-float side-${item.side} ${item.kind} ${item.crit?'crit':''}" style="--stack:${stack}"><b>${item.text}</b></span>`;}).join('')}</div>`;}
  combatVfx(frame:Frame,index:number,frames:Frame[]){if(index<=0)return '';const prev=frames[index-1],statusDown:{side:'p'|'e';yes:boolean}[]=[{side:'p',yes:false},{side:'e',yes:false}],hpDelta={p:frame.p.hp-prev.p.hp,e:frame.e.hp-prev.e.hp},shieldDelta={p:frame.p.shield-prev.p.shield,e:frame.e.shield-prev.e.shield};for(const item of statusDown){const before=prev[item.side].status,after=frame[item.side].status;item.yes=[...new Set([...Object.keys(before),...Object.keys(after)])].some(k=>(after[k]??0)<(before[k]??0));}let target:'p'|'e'|'center'='center',kind='';if(frame.kind==='convert'){const hit=statusDown.find(x=>x.yes);if(hit){kind='dispel';target=hit.side;}}if(!kind){for(const side of ['p','e'] as const)if(hpDelta[side]<0){kind='attack';target=side;break;}}if(!kind){for(const side of ['p','e'] as const)if(hpDelta[side]>0){kind='heal';target=side;break;}}if(!kind){for(const side of ['p','e'] as const)if(shieldDelta[side]>0){kind='shield';target=side;break;}}if(!kind){const hit=statusDown.find(x=>x.yes);if(hit){kind='dispel';target=hit.side;}}if(!kind&&frame.kind==='rage'){kind='aura';target=frame.actor==='p'||frame.actor==='e'?frame.actor:'center';}if(!kind)return '';const rows:{[k:string]:number}={attack:0,heal:1,shield:2,dispel:3,aura:6},accent=frame.crit?4:kind==='attack'?5:kind==='heal'?6:kind==='shield'?4:7,points=[[-27,-10],[-18,-28],[1,-36],[22,-26],[34,-3],[24,22],[-3,31],[-28,18]],duration=Math.max(170,620/this.speed);return `<div class="combat-vfx target-${target} kind-${kind} ${frame.crit?'critical':''}" style="--fx-duration:${duration}ms" aria-hidden="true"><span class="vfx-sprite main" style="--row:${rows[kind]};background-image:url('${VFX_ATLAS}')"></span><span class="vfx-sprite accent" style="--row:${accent};background-image:url('${VFX_ATLAS}')"></span><span class="vfx-particles">${points.map(([x,y],i)=>`<i style="--tx:${x}px;--ty:${y}px;--delay:${i*18}ms"></i>`).join('')}</span></div>`;}
  battleLogRow(frame:Frame,index:number,frames:Frame[],enemyName:string,detailed=this.detailedLog){const prev=frames[Math.max(0,index-1)],actor=frame.actor==='p'?this.game!.s.name:frame.actor==='e'?enemyName:'天道',actorClass=frame.actor==='p'?'player':frame.actor==='e'?'enemy':'system',actorBadge=frame.actor==='p'?'我方':frame.actor==='e'?'敌方':'天道',statusChanges=this.statusChanges(frame,index,frames);if(!detailed){const damage=frame.kind==='damage'?`<div class="simple-damage"><span class="log-actor-badge ${actorClass}">${actorBadge}</span><strong>${esc(actor)}</strong><span>${esc(frame.label)}</span><b>${frame.crit?'暴击 · ':''}${frame.amount} 伤害</b>${frame.breakdown?.absorbed?`<em>护盾吸收 ${frame.breakdown.absorbed}</em>`:''}</div>`:'';const statuses=statusChanges.length?`<div class="simple-status-list">${statusChanges.map(x=>`<div class="simple-status ${x.side==='p'?'player':'enemy'}"><span>${x.side==='p'?'我方':'敌方'}</span><strong>${esc(x.name)}</strong><em>${esc(this.content.labels.statuses[x.status]??x.status)}</em><b>${x.before} → ${x.after} ${x.after-x.before>0?'+':''}${x.after-x.before}</b></div>`).join('')}</div>`:'';return `<article class="battle-log-row simple actor-${actorClass} ${frame.crit?'critical':''}">${damage}${statuses}</article>`;}const details:string[]=[];const delta=(label:string,before:number,after:number,cls:string)=>before===after?'':`<span class="log-delta ${cls}">${label} ${before}→${after} <b>${after-before>0?'+':''}${after-before}</b></span>`;for(const side of ['p','e'] as const){const before=prev[side],after=frame[side],who=side==='p'?this.game!.s.name:enemyName,changes:string[]=[];for(const x of [delta('生命',before.hp,after.hp,'hp'),delta('护盾',before.shield,after.shield,'shield'),delta('怒气',before.rage,after.rage,'rage')])if(x)changes.push(x);for(const k of new Set([...Object.keys(before.status),...Object.keys(after.status)])){const a=before.status[k]??0,b=after.status[k]??0;if(a!==b)changes.push(`<span class="log-delta status">${esc(this.content.labels.statuses[k]??k)} ${a}→${b} <b>${b-a>0?'+':''}${b-a}</b></span>`);}if(changes.length)details.push(`<div class="log-side ${side==='p'?'player':'enemy'}"><em>${side==='p'?'我方':'敌方'} · ${esc(who)}</em>${changes.join('')}</div>`);}const outcome=frame.kind==='damage'?`<span class="log-amount">${frame.crit?'暴击 · ':''}${frame.amount} 伤害</span>`:frame.kind==='miss'?'<span class="log-outcome">闪避</span>':frame.kind==='rage'?'<span class="log-outcome rage">怒气技</span>':frame.kind==='phase'?'<span class="log-outcome phase">阶段转换</span>':'';const b=frame.breakdown,formula=b?`<div class="combat-formula"><span>原始 ${b.base}</span><span>倍率后 ${b.scaled}</span><span>防御后 ${b.afterDefense}</span><span>易伤后 ${b.afterVulnerable}</span><span>构筑后 ${b.afterBuild}</span><span>暴击后 ${b.afterCrit}</span>${b.absorbed?`<span>护盾吸收 ${b.absorbed}</span>`:''}<b>生命损失 ${b.hpLoss}</b></div>`:'';return `<article class="battle-log-row detailed actor-${actorClass} kind-${frame.kind.replace(/[^a-z_-]/g,'')} ${frame.crit?'critical':''}"><div class="battle-log-main"><span class="round">${String(frame.round).padStart(2,'0')}</span><span class="log-actor-badge ${actorClass}">${actorBadge}</span><span class="log-actor">${esc(actor)}</span><strong>${esc(frame.label)}</strong>${outcome}</div>${frame.detail?`<div class="log-note">${esc(frame.detail)}</div>`:''}${formula}${details.length?`<div class="battle-log-detail">${details.join('')}</div>`:''}</article>`;}

 contributionName(id:string){return this.content.abilities.find(a=>a.id===id)?.name??this.content.talents.find(t=>t.id===id)?.name??(id.startsWith('race.')?this.content.races.find(r=>r.id===id.slice(5))?.trait:undefined)??(id==='fate'?this.content.fates.find(f=>f.id===this.game!.s.fate)?.name:undefined)??(id==='status.burn'?'燃烧':id);}
 battleContributions(sum:any){const rows=Object.entries(sum.contributions??{}).map(([id,v]:[string,any])=>({id,v,score:v.damage+v.heal*.8+v.shield*.5+v.rage*.25+v.conversions*6+v.triggers*4})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,5);if(!rows.length)return '';return `<div class="battle-contributions"><strong>本场核心贡献</strong>${rows.map(({id,v})=>`<div class="contribution-row"><span>${esc(this.contributionName(id))}</span><em>${[v.damage?`伤害 ${v.damage}`:'',v.heal?`回复 ${v.heal}`:'',v.shield?`护盾 ${v.shield}`:'',v.rage?`怒气 ${v.rage}`:'',v.conversions?`转化 ${v.conversions}`:'',v.triggers?`触发 ${v.triggers}`:''].filter(Boolean).join(' · ')}</em></div>`).join('')}</div>`;}
 diagnosticEventLabel(on:string):string{
  const labels:Record<string,string>={
   battle_start:'战斗开始',
   before_action:'行动前',
   after_action:'行动完成',
   on_hit:'命中',
   on_damage:'造成实际伤害',
   on_crit:'暴击',
   on_evade:'闪避',
   on_heal:'实际回复生命',
   on_shield_gain:'新增护盾',
   on_status_apply:'新增状态',
   on_status_tick:'持续状态结算',
   on_consume:'实际消耗状态或护盾',
   on_rage_spend:'消耗怒气',
   on_damaged:'承受命中伤害',
   on_rage_skill:'施展怒技',
   hp_threshold:'生命阈值检查',
   round_end:'回合结束',
   battle_end:'胜利结算'
  };
  return labels[on]??on;
 }
 diagnosticResourceLabel(key:string):string{
  const labels:Record<string,string>={hp:'生命',burn:'燃烧',weak:'虚弱',break:'破甲',stun:'眩晕',vulnerable:'易伤',shield:'护盾',rage:'怒气',currency:'灵石',status:'状态',act:'幕次',race:'族裔'};
  if(key.startsWith('counter:'))return `计数 · ${key.slice(8)||'未命名'}`;
  if(key.startsWith('stat:'))return `属性 · ${this.content.labels.stats[key.slice(5)]??key.slice(5)}`;
  if(key.startsWith('event:'))return `事件 · ${this.content.events.find(e=>e.id===key.slice(6))?.name??key.slice(6)}`;
  if(key.startsWith('tag:'))return `机制 · ${key.slice(4)}`;
  if(key.startsWith('talent:'))return `天赋 · ${this.content.talents.find(t=>t.id===key.slice(7))?.name??key.slice(7)}`;
  if(key.startsWith('fact:'))return `因果 · ${this.content.labels.facts?.[key.slice(5)]??key.slice(5)}`;
  if(key.startsWith('thread:'))return `旧因 · ${key.slice(7)}`;
  return labels[key]??key;
 }
 diagnosticObservationText(trigger:any):string{
  return Object.entries(trigger.observations??{}).map(([key,value]:[string,any])=>`观测${this.diagnosticResourceLabel(key)}最高 ${value.actual} / 需要 ${value.required}`).join('；');
 }
 diagnosticSourceName(d:any,actor:'p'|'e'|'system',id:string):string{
  if(actor==='system'){
   const labels:Record<string,string>={'system.battle_start':'战斗开始','system.before_action':'行动检查','system.round_end':'回合结束','system.battle_end':'胜利结算'};
   return labels[id]??'系统结算';
  }
  return d.sources?.find((source:any)=>source.actor===actor&&source.id===id)?.name??this.contributionName(id);
 }
 diagnosticConversionEventLabel(from:string):string{
  const labels:Record<string,string>={damage:'造成伤害',damage_taken:'承受伤害',heal:'实际回复生命',shield_gain:'获得护盾',rage_spend:'消耗怒气',status_tick:'持续结算',status_consume:'状态消耗'};
  return labels[from]??from;
 }
 diagnosticConversionTargetLabel(to:string):string{
  const labels:Record<string,string>={damage:'伤害',heal:'回复',shield:'护盾',rage:'怒气'};
  return labels[to]??to;
 }
 diagnosticBlockReason(reason:string|undefined,on=''):string{
  if(reason==='missing_status')return '所需状态未出现';
  if(reason==='below_threshold')return '检查时尚未达到门槛';
  if(reason==='missing_tag')return '触发来源不具备所需机制';
  if(reason==='chance_failed')return '已进行概率判定但本场未中';
  if(reason==='quota')return '本场已达到触发次数限制';
  if(reason==='visited')return '同一触发链已处理过';
  if(reason==='condition_failed')return '触发条件未成立';
  if(reason==='zero_output')return '已发动，但结算后没有新增收益';
  if(reason==='converted_chain')return '转换链已处理过，系统阻止递归';
  if(reason==='depth_limit')return '转换链达到深度限制';
  if(reason==='no_input')return '输入事件没有可转换的实际数量';
  if(reason==='unattempted')return '本场没有出现可用输入事件';
  if(reason==='cooldown')return '行动时仍在冷却';
  if(reason==='rage')return '行动时怒气不足';
  if(reason==='system_failure')return '战斗因回合上限结束';
  if(on==='battle_start')return '本场未进入战斗开始事件';
  if(on==='before_action')return '本场未到该来源的行动检查时点';
  if(on==='after_action')return '本场没有完成可用行动';
  if(on==='on_hit')return '本场没有出现命中事件';
  if(on==='on_damage')return '本场没有造成实际伤害';
  if(on==='on_crit')return '本场没有出现暴击事件';
  if(on==='on_evade')return '本场没有出现可用的闪避事件';
  if(on==='on_heal')return '本场没有实际回复生命';
  if(on==='on_shield_gain')return '本场没有新增护盾';
  if(on==='on_status_apply')return '本场没有新增状态';
  if(on==='on_status_tick')return '本场没有持续状态结算';
  if(on==='on_consume')return '本场没有实际消耗状态或护盾';
  if(on==='on_rage_spend')return '本场没有实际怒气消耗';
  if(on==='on_damaged')return '本场没有承受命中伤害';
  if(on==='on_rage_skill')return '本场没有施展怒技';
  if(on==='hp_threshold')return '本场未到达生命阈值检查时点';
  if(on==='round_end')return '战斗未走到对应回合结束';
  if(on==='battle_end')return '战斗未走到胜利结算';
  return '本场未满足触发条件';
 }
 battleSettlement(b:Battle){
  const d=b.diagnostics;
  if(!d)return `<section class="battle-settlement" aria-label="战斗结算"><article><h3>本场关键</h3><p>旧战报记录到的核心贡献如下；未记录的来源无法补全。</p>${this.battleContributions(b.summary)||'<p class="muted">暂无可归因的额外贡献。</p>'}</article><article><h3>未生效</h3><p>旧战报未记录触发尝试，无法区分未触发与未出现事件。</p></article><article><h3>主要损耗</h3><p>实际承受伤害 ${b.summary.enemyDamage}；旧战报未记录更细的损耗分类。</p></article></section>`;
  const sourceName=(id:string,actor:'p'|'e'='p')=>this.diagnosticSourceName(d,actor,id);
  const contributions=Object.entries(b.summary.contributions).map(([id,v])=>({id,v})).filter(x=>x.v.damage>0||x.v.heal>0||x.v.shield>0||x.v.rage>0||x.v.conversions>0||x.v.triggers>0).sort((a,b)=>b.v.damage-a.v.damage||b.v.heal-a.v.heal||b.v.shield-a.v.shield||b.v.conversions-a.v.conversions||b.v.rage-a.v.rage).slice(0,3);
  const keyText=contributions.length?contributions.map(x=>`<div class="settlement-row"><strong>${esc(sourceName(x.id))}</strong><span>${[x.v.damage?`实际伤害 ${x.v.damage}`:'',x.v.heal?`实际回复 ${x.v.heal}`:'',x.v.shield?`提供护盾 ${x.v.shield}`:'',x.v.rage?`获得怒气 ${x.v.rage}`:'',x.v.conversions?`转化 ${x.v.conversions}`:''].filter(Boolean).join(' · ')}</span></div>`).join(''):'<p class="muted">本场没有记录到额外来源贡献。</p>';
  const playerActions=d.actions?.p??{attempts:0,selected:0,waits:0,blocked:{},bySource:{},strategy:{decisions:0,byReason:{}}};
  const actionSources=Object.entries(playerActions.bySource??{}).filter(([,action]:[string,any])=>action.selected>0).sort((a,b)=>b[1].selected-a[1].selected);
  const strategyEq=this.game!.s.slots.find((eq,i)=>eq&&SLOT_ORDER[i]==='strategy'),strategyName=strategyEq?this.content.abilities.find(a=>a.id===strategyEq.id)?.name:'';
  const strategyReason=Object.entries(playerActions.strategy?.byReason??{}).slice(0,2).map(([reason,count])=>`${reason} ×${count}`).join('；');
  const actionText=playerActions.attempts?`<div class="settlement-row"><strong>主行动</strong><span>选择 ${playerActions.selected} 次${actionSources.length?` · ${actionSources.map(([id,action]:[string,any])=>`${sourceName(id)} ${action.selected} 次`).join(' · ')}`:''}${playerActions.waits?` · 等待 ${playerActions.waits} 次`:''}</span></div>`:'';
  const strategyText=strategyName?`<div class="settlement-row"><strong>战策 · ${esc(strategyName)}</strong><span>参与 ${playerActions.strategy?.decisions??0} 次行动决定${strategyReason?` · ${esc(strategyReason)}`:''}</span></div>`:'';
  const triggerMap=new Map<string,any[]>();for(const trigger of Object.values(d.triggers??{}))if(trigger.actor==='p'){const list=triggerMap.get(trigger.sourceId)??[];list.push(trigger);triggerMap.set(trigger.sourceId,list);}
  const linksByTarget=new Map<string,any[]>();for(const link of d.links??[])if(link.targetActor==='p'){const list=linksByTarget.get(link.targetId)??[];list.push(link);linksByTarget.set(link.targetId,list);}
  const untriggered:string[]=[];const zeroNet:string[]=[];const conversionIssues:string[]=[];
  for(const source of d.sources.filter(x=>x.actor==='p')){
   const triggers=triggerMap.get(source.id)??[],ability=this.content.abilities.find(x=>x.id===source.id);
   if(!triggers.length||ability&&!ability.triggers.length)continue;
   if(triggers.every(x=>x.fired===0&&x.zeroNet===0)){
    const first=triggers.find(x=>x.firstBlocked)??triggers[0],observation=this.diagnosticObservationText(first);
    untriggered.push(`${sourceName(source.id)}：${this.diagnosticBlockReason(first.firstBlocked,first.on)}${observation?`；${observation}`:''}`);
   }
   for(const trigger of triggers)if(trigger.zeroNet>0&&trigger.fired>0){
    const observation=this.diagnosticObservationText(trigger);
    zeroNet.push(`${sourceName(source.id)}：已发动 ${trigger.fired} 次，其中 ${trigger.zeroNet} 次净收益为零${observation?`；${observation}`:''}`);
   }
  }
  for(const conversion of Object.values(d.conversions?.bySource??{})){
   if(conversion.attempts===0||conversion.unattempted>0){
    conversionIssues.push(`命器 · ${sourceName(conversion.sourceId)}：未尝试，${this.diagnosticConversionEventLabel(conversion.from)}未发生`);
   }else if(conversion.zeroOutput>0){
    conversionIssues.push(`命器 · ${sourceName(conversion.sourceId)}：已尝试 ${conversion.attempts} 次，其中 ${conversion.zeroOutput} 次没有新增${this.diagnosticConversionTargetLabel(conversion.to)}`);
   }else if(Object.keys(conversion.blocked??{}).length&&conversion.converted===0){
    const reason=Object.keys(conversion.blocked??{}).find(key=>key!=='unattempted');
    conversionIssues.push(`命器 · ${sourceName(conversion.sourceId)}：${this.diagnosticBlockReason(reason)}`);
   }
  }
  const untriggeredText=untriggered.length||zeroNet.length||conversionIssues.length?[...untriggered.slice(0,3),...zeroNet.slice(0,2),...conversionIssues.slice(0,2)].map(x=>`<div class="settlement-row"><span>${esc(x)}</span></div>`).join(''):'<p class="muted">未发现确认未生效的来源。</p>';
  const categoryLabels:Record<string,string>={enemy_attack:'敌方攻击',persistent:'持续伤害',self:'自身代价'},lossEntries=Object.entries(d.losses.player.byCategory).filter(([category])=>category!=='system_failure').sort((a,b)=>b[1]-a[1]),roundEntries=Object.entries(d.losses.player.byRound).sort((a,b)=>b[1]-a[1]),normalLossTotal=lossEntries.reduce((n,[,amount])=>n+Number(amount),0),lossText=lossEntries.length?lossEntries.slice(0,3).map(([category,amount])=>`${categoryLabels[category]??category} ${amount}`).join(' · '):'未记录敌方或持续伤害造成的实际生命损失',roundText=normalLossTotal&&roundEntries.length?`主要集中在第 ${roundEntries.slice(0,2).map(([round])=>round).join('、')} 回合`:'未记录集中回合',systemFailure=Number(d.losses.player.byCategory.system_failure??0);
  const linkText=(targetId:string,index:number)=>[...(linksByTarget.get(targetId)??[])].filter(link=>link.triggerIndex===index).map(link=>`${this.diagnosticSourceName(d,link.sourceActor,link.sourceId)} → ${this.diagnosticEventLabel(link.event)} → ${sourceName(targetId)}：${link.attempts} 次，触发 ${link.fired} 次`).join('；');
  const allDetails=d.sources.filter(x=>x.actor==='p').map(source=>{
   const triggers=triggerMap.get(source.id)??[],triggerDetails=triggers.map(x=>`${this.diagnosticEventLabel(x.on)}：尝试 ${x.attempts}，触发 ${x.fired}${x.firstBlocked?`，首要原因 ${this.diagnosticBlockReason(x.firstBlocked,x.on)}`:''}${this.diagnosticObservationText(x)?`，${this.diagnosticObservationText(x)}`:''}${linkText(source.id,x.triggerIndex)?`，${linkText(source.id,x.triggerIndex)}`:''}`).join('；');
   const conversions=Object.values(d.conversions?.bySource??{}).filter(conversion=>conversion.sourceId===source.id).map(conversion=>`命器转换 ${this.diagnosticConversionEventLabel(conversion.from)} → ${this.diagnosticConversionTargetLabel(conversion.to)}：未尝试 ${conversion.unattempted??0}，尝试 ${conversion.attempts}，成功 ${conversion.converted}，输入 ${conversion.input}，输出 ${conversion.output}${conversion.zeroOutput?`，零输出 ${conversion.zeroOutput}`:''}${Object.keys(conversion.blocked??{}).length?`，阻塞 ${Object.entries(conversion.blocked).map(([reason,count])=>`${this.diagnosticBlockReason(reason)} ×${count}`).join('、')}`:''}`).join('；');
   const detail=[triggerDetails,conversions].filter(Boolean).join('；')||'属性或主动效果已计入';
   return `<div class="settlement-row"><strong>${esc(sourceName(source.id))}</strong><span>${esc(detail)}</span></div>`;
  }).join('');
  const actionDetail=actionText||strategyText?`<div class="settlement-row"><strong>战策行动</strong><span>${esc(`主行动选择 ${playerActions.selected} 次${strategyName?`；${strategyName}参与 ${playerActions.strategy?.decisions??0} 次决定`:''}`)}${strategyReason?`；${esc(strategyReason)}`:''}</span></div>`:'';
  return `<section class="battle-settlement" aria-label="战斗结算"><article><h3>本场关键</h3>${keyText}${actionText}${strategyText}</article><article><h3>未生效</h3>${untriggeredText}</article><article><h3>主要损耗</h3><p>${esc(lossText)}；${esc(roundText)}。</p></article>${systemFailure?`<article><h3>系统失败</h3><p>回合上限耗尽，系统结算 ${systemFailure} 点生命；这部分不计入敌方主要损耗。</p></article>`:''}${allDetails||actionDetail?`<details class="disclosure" data-panel="battle-diagnostic-detail"><summary>查看全部来源诊断</summary><div class="settlement-details">${actionDetail}${allDetails}</div></details>`:''}</section>`;
 }

  battle(){const b=this.game!.s.battle!,cursor=bi(b.cursor,0,b.frames.length-1),f=b.frames[cursor],done=cursor>=b.frames.length-1,enemy=this.content.enemies.find(e=>e.id===b.enemyId)!,sum=b.summary,obj=b.objective,all=b.frames.slice(0,cursor+1).map((row,index)=>({row,index})),visible=this.detailedLog?all:all.filter(x=>x.row.kind==='damage'||this.statusChanges(x.row,x.index,b.frames).length>0),broken=all.reduce((n,x)=>n+(x.row.actor==='p'?(x.row.breakdown?.absorbed??0):0),0),objective=!done&&obj.type==='survive'?`守至第 ${obj.rounds} 回合`:!done&&obj.type==='break'?`破阵 ${Math.min(broken,obj.value??0)} / ${obj.value}`:!done&&enemy.kind==='boss'?'天劫':'';return `${this.heading(done?(b.won?'此战告捷':'此身入劫'):'斗法')}<section class="battle-shell"><div class="battle-context"><span>${done?'历 '+b.rounds+' 回合':f.round?'第 '+f.round+' 回合':'蓄势'}</span>${objective?`<strong>${objective}</strong>`:''}</div><div class="combat-arena">${landscape()}<span class="arena-vignette" aria-hidden="true"></span>${this.fighterFrame(f,'p')}<div class="battle-stage-core"><span class="round-seal">${done?(b.won?'胜':'劫'):f.round||'·'}</span><strong>${esc(done?(b.won?'尘埃落定':'劫数已定'):(f.kind==='ready'?'气机交锋':f.label))}</strong>${!done&&f.detail?`<small>${esc(f.detail)}</small>`:''}</div>${this.fighterFrame(f,'e')}${this.combatVfx(f,cursor,b.frames)}${this.combatFeedback(f,cursor,b.frames)}</div><div class="battle-controls"><div class="speeds" aria-label="战斗速度">${[1,2,4].map(n=>`<button class="${this.speed===n?'active':''}" data-action="speed" data-index="${n}" aria-pressed="${this.speed===n}" aria-label="${n}倍速">${n}×</button>`).join('')}<button data-action="pause" ${done?'disabled':''}>${this.paused?'继续':'暂停'}</button></div>${done?btn('finishBattle',b.won?'收下所得 '+icon('arrow',16):'回望此生','primary small'):btn('skip','略过','small')}</div>${done?this.battleSettlement(b):''}<details class="disclosure battle-data" data-panel="combat-stats"><summary>战局</summary><div class="battle-extra"><div>${['p','e'].map(side=>{const x=f[side as 'p'|'e'];return `<section><strong>${esc(x.name)}</strong><div class="stats-grid">${STAT_KEYS.filter(k=>k!=='hp').map(k=>`<span>${this.content.labels.stats[k]} <b>${x.stats[k]}</b></span>`).join('')}</div></section>`;}).join('')}</div>${done?`<div class="battle-summary"><div><span>造成伤害</span><b>${sum.playerDamage}</b></div><div><span>承受伤害</span><b>${sum.enemyDamage}</b></div><div><span>护盾承伤</span><b>${sum.playerShieldAbsorbed}</b></div><div><span>暴击 / 闪避</span><b>${sum.playerCrits} / ${sum.enemyMisses}</b></div><div><span>怒气技</span><b>${sum.playerRageSkills}</b></div><div><span>资源炼化</span><b>${sum.playerConversions}</b></div></div>`:''}${done?this.battleContributions(sum):''}</div></details><div class="battle-log-head"><span>战痕</span><button class="text-link log-follow" data-action="followLog" hidden>回到最新 ↓</button><span class="log-mode">${this.detailedLog?'详录':'简录'}</span></div><div class="battle-log ${this.detailedLog?'detailed-mode':'simple-mode'}" tabindex="0" role="region" aria-label="可滚动战报">${visible.map(({row,index})=>this.battleLogRow(row,index,b.frames,enemy.name,this.detailedLog)).join('')||'<p class="simple-log-empty">双方蓄势。</p>'}</div></section>`;}
 event(){const g=this.game!,s=g.s,event=g.currentEvent(),phase=g.eventPhase(),check=s.lastCheck,options=g.eventChoices().filter(x=>narrativeAvailable(this.content,s,x.choice)),relation=event.relationKey?s.threads[event.relationKey]:undefined,last=s.storyLog.at(-1),outcome=resultText(this.content,last,s.resultText??''),effectChips=(items:string[])=>items.length?`<div class="effect-chips">${items.map(x=>`<span class="${/ -|失去|消耗/.test(x)?'cost':''}">${esc(x)}</span>`).join('')}</div>`:'';return `<section class="event-page ${event.hiddenOnly?'hidden-event':''}"><div class="event-scene-head"><div class="event-portrait">${portrait(event.art)}</div><div><div class="event-speaker">${esc(event.npc)}${relation?`<span>${esc(threadText(this.content,event.relationKey!,relation))}</span>`:''}</div><h2>${esc(event.name)}</h2>${event.phases?.length?`<small class="event-phase-caption">${phaseText(phase.id)}</small>`:''}</div></div>${s.phase==='event'?`${s.resultText?`<p class="previous-outcome">${esc(outcome)}</p>`:''}<p class="story-text">${esc(storyText(this.content,s,event,phase))}</p><div class="story-choices">${options.map(info=>{const ch=info.choice,cp=choiceCopy(this.content,event.id,phase.id,ch.id);return `<div class="story-choice-wrap"><button class="story-choice ${ch.check?'checked-choice':''}" data-action="event" data-id="${ch.id}" ${info.legal?'':'disabled'}><div><strong>${esc(cp.label??ch.label)}</strong>${ch.check?`<div class="check-stakes"><b class="check-badge">${esc(this.content.labels.stats[ch.check.stat])} · ${info.chance}%</b><div><p><em>成</em> ${esc(choiceEffects(this.content,ch,'success').join(' · '))}</p><p><em>败</em> ${esc(choiceEffects(this.content,ch,'failure').join(' · '))}</p></div></div>`:effectChips(choiceEffects(this.content,ch))}${!info.legal?`<span class="lock-reason">${esc(ch.conditions.filter(q=>!conditionOK(this.content,s,q)).map(q=>conditionText(this.content,q)).join('；'))}</span>`:''}</div>${icon('arrow',20)}</button> </div>`;}).join('')}</div>`:`<div class="event-result">${check?`<div class="check-result ${check.success?'success':'failure'}"><strong>${check.success?'事成':'未成'}</strong><span>${esc(this.content.labels.stats[check.stat])} · ${check.roll} / ${check.chance}</span></div>`:''}<p>${esc(outcome)}</p></div><div class="actions">${btn('leaveEvent','继续前行 '+icon('arrow',18),'primary')}</div>`}</section>`;}
  shop(){const s=this.game!.s,count=s.refreshes[s.act],price=this.content.rules.refreshPrices[count];const offer=(o:any,i:number)=>o.kind==='ability'?`${this.card(o.id!,s.slots.some(e=>e?.id===o.id)?Math.min(3,s.slots.find(e=>e?.id===o.id)!.rank+1):0,'buy',`data-index="${i}" ${o.sold||s.gold<o.price?'disabled':''}`,icon('coin',14)+` ${o.price}`)}${this.fitNote(o.id!)}`:o.kind==='heal'?`<button class="ability-card shield" data-action="buy" data-index="${i}" ${o.sold||s.gold<o.price?'disabled':''}><div class="card-top"><span>灵药</span></div>${sigil('gourd','shield')}<h3 class="card-title">玉露琼浆</h3><p class="card-description">恢复 30% 最大生命。</p><div class="card-foot"><span class="gain">${icon('coin',14)} ${o.price}</span></div></button>`:`<button class="ability-card jade" data-action="buy" data-index="${i}" ${o.sold||s.gold<o.price?'disabled':''}><div class="card-top"><span>淬炼</span></div>${sigil(STAT_ICONS[o.stat]??'star','jade')}<h3 class="card-title">${esc(this.content.labels.stats[o.stat])}淬炼</h3><p class="card-description">${esc(this.content.labels.stats[o.stat])} +${o.value}</p><div class="card-foot"><span class="gain">${icon('coin',14)} ${o.price}</span></div></button>`;return `${this.heading('云游坊市')}<div class="shop-balance"><span>${icon('coin',18)} 灵石 <strong class="gold">${s.gold}</strong></span><span class="muted">换货 ${count} / 3</span></div><div class="shop-grid">${s.stock.map((o,i)=>`<div style="position:relative">${offer(o,i)}${o.sold?'<div class="sold-label">售罄</div>':''}</div>`).join('')}</div><div class="actions">${btn('refresh',price===undefined?'缘尽':price===0?'换货':'换货  '+price+' 灵石','',price===undefined||s.gold<price?'disabled':'')}${btn('leaveShop','离开坊市 '+icon('arrow',18),'primary')}</div>`;}
 rest(){const s=this.game!.s,isGear=(eq:Equipped)=>{const role=abilityLoadoutSlot(this.game!.ability(eq.id));return role==='component'||role==='relic';};return `${this.heading('山中一息')}<div class="rest-art">${landscape()}${icon('camp',92)}</div>${!this.restMode?`<div class="rest-grid">${[['heal','gourd','调息','气血 +30%'],['skill','book','升功','普攻/怒技/战策升阶'],['artifact','seal','炼器','组件/命器升阶'],['temper','fist','淬体','炼骨锻身']].map(([id,art,title,text])=>`<button class="rest-option" data-action="${id==='heal'?'rest':'restMode'}" data-id="${id}" ${id==='skill'&&!s.slots.some(eq=>eq&&eq.rank<3&&!isGear(eq))||id==='artifact'&&!s.slots.some(eq=>eq&&eq.rank<3&&isGear(eq))?'disabled':''}>${icon(art,36)}<strong>${title}</strong><p>${text}</p></button>`).join('')}</div>`:`<div class="subchoices">${this.restMode==='temper'?s.temper.map((stat,i)=>btn('rest',icon(STAT_ICONS[stat],22)+this.content.labels.stats[stat]+' +'+(stat==='hp'?12:stat==='attack'?3:2),'full',`data-id="temper" data-index="${i}"`)).join(''):s.slots.map((eq,i)=>{if(!eq||eq.rank>=3||isGear(eq)!==(this.restMode==='artifact'))return '';return btn('rest',esc(this.game!.ability(eq.id).name)+`  ${rankName(eq.rank)} → ${rankName(eq.rank+1)}`,'full',`data-id="${this.restMode}" data-index="${i}"`);}).join('')}</div><div class="actions">${btn('restMode','回到火前','quiet','data-id=""')}</div>`}`;}


 talentModal(){const s=this.game?.s,d=s?.talentDraft;if(this.home||!s||!d||['dead','finished'].includes(s.phase))return '';const race=this.content.races.find(r=>r.id===s.race)!,chosen=d.offers.includes(this.selectedTalent)?this.selectedTalent:'';return `<div class="modal-backdrop"><section class="modal talent-modal" data-talent-level="${d.level}" role="dialog" aria-modal="true" aria-labelledby="talent-title"><div class="talent-heading"><div><small>${esc(this.content.realms[d.level])}</small><h2 id="talent-title">一念悟道</h2></div><button data-action="settings" class="icon-button" aria-label="设置">${icon('gear',21)}</button></div><div class="talent-offers">${d.offers.map(id=>{const t=this.content.talents.find(t=>t.id===id)!;return `<button data-action="selectTalent" data-id="${id}" data-index="${d.level}" aria-pressed="${id===chosen}" class="talent-offer ${id===chosen?'selected':''} ${t.race==='common'?'common':'racial'}"><div class="talent-symbol">${icon(t.art,30)}</div><div><div class="talent-kicker">${t.race==='common'?'通悟':esc(race.name)}${t.path?' · '+esc(t.path):''}</div><h3>${esc(t.name)}</h3><p>${esc(t.description)}</p></div></button>`;}).join('')}</div><div class="actions">${btn('chooseTalent','悟得此法','primary',`data-id="${chosen}" data-index="${d.level}" ${chosen?'':'disabled'}`)}</div>${s.talentQueue.length>1?`<p class="talent-queue">尚有 ${s.talentQueue.length-1} 重境界待悟</p>`:''}</section></div>`;}
 talentLedger(){const s=this.game!.s;if(!s.talents.length)return '';return `<details class="disclosure talent-ledger" data-panel="talents"><summary>此身天赋 <span>${s.talents.length} / ${this.content.realms.length-1}</span></summary>${s.talentHistory.map(h=>{const t=this.content.talents.find(t=>t.id===h.id)!;return `<article><strong>${icon(t.art,18)} ${esc(t.name)}<small>${esc(this.content.realms[h.level])} · ${t.race==='common'?'通悟':'族裔'}</small></strong><p>${esc(t.description)}</p></article>`;}).join('')}</details>`;}
 codex(){const s=this.game!.s,equipped=this.codexFilter==='equipped',list=this.content.abilities.filter(a=>inRunPool(this.content,s,a)&&(a.rarity!=='mythic'||s.slots.some(eq=>eq?.id===a.id))&&(this.codexFilter==='all'||abilityLoadoutSlot(a)===this.codexFilter));const filters:[string,string][]=[['equipped','此身所习'],['all','此途道藏'],['basic','普攻'],['rage','怒技'],['component','组件'],['relic','命器'],['strategy','战策']];return `${this.heading('命盘')}${equipped?this.buildResonances(true)+this.talentLedger():''}<div class="filters">${filters.map(([id,label])=>`<button class="${this.codexFilter===id?'active':''}" data-action="filter" data-id="${id}" aria-pressed="${this.codexFilter===id}">${esc(label)}</button>`).join('')}</div><div class="deck-grid">${equipped?s.slots.map((eq,i)=>eq?this.card(eq.id,eq.rank):`<div class="empty-slot slot-${SLOT_ORDER[i]}"><span class="slot-glyph">${SLOT_SIGNS[SLOT_ORDER[i]]}</span><strong>${slotLabel(SLOT_ORDER[i])}</strong><span>空位</span></div>`).join(''):list.map(a=>this.card(a.id,s.slots.find(eq=>eq?.id===a.id)?.rank??0)).join('')}</div>`;}

 karma(){
  const s=this.game!.s,arcs=this.knownCharacterEntries(),tracked=s.trackedCharacter,canTrack=this.supportsAction('trackCharacter'),canFollow=!canTrack&&this.supportsAction('followCharacter'),canClear=!canTrack&&this.supportsAction('clearCharacterFollow'),groups:{act:number;title:string;items:typeof s.storyLog}[]=[];
  for(const item of s.storyLog){const prev=groups.at(-1);if(prev?.act===item.act&&prev.title===item.title)prev.items.push(item);else groups.push({act:item.act,title:item.title,items:[item]});}
  const characterCards=arcs.map(a=>{
   const relation=s.threads[a.key],action=tracked===a.key
    ?canTrack?btn('trackCharacter','取消追踪','text-link',`data-track="clear" aria-label="取消追踪${esc(a.name)}"`):canClear?btn('clearCharacterFollow','取消追踪','text-link',`aria-label="取消追踪${esc(a.name)}"`):''
    :canTrack?btn('trackCharacter','主动追踪','text-link',`data-id="${esc(a.key)}" aria-label="追踪${esc(a.name)}"`):canFollow?btn('followCharacter','主动追踪','text-link',`data-id="${esc(a.key)}" aria-label="追踪${esc(a.name)}"`):'';
   return `<article class="character-relation ${tracked===a.key?'is-tracked':''}">${portrait(a.art)}<div><div><strong>${esc(a.name)}</strong>${tracked===a.key?'<span class="relation-chip">正在追踪</span>':''}</div><p>${esc(relation?threadText(this.content,a.key,relation):'曾经照面')}</p>${tracked===a.key?`<p class="character-clue">${esc(this.characterClue(a))}</p>`:''}${action?`<div class="character-actions">${action}</div>`:''}</div></article>`;
  }).join('');
  return `${this.heading('因缘')}<div class="karma-grid">${Object.entries(this.content.labels.counters).map(([k,n])=>`<div class="karma-counter"><strong>${s.counters[k]??0}</strong><p>${esc(n)}</p></div>`).join('')}</div>${arcs.length?`<section class="character-ledger" aria-label="已相识人物">${characterCards}</section>`:'<p class="empty-note">山河初展，尚待相逢。</p>'}${groups.length?`<div class="timeline">${groups.slice().reverse().map((group,i)=>`<details class="timeline-item disclosure" data-panel="story-${groups.length-i}"><summary><small>${esc(this.content.acts[group.act].chapter)}</small><strong>${esc(group.title)}</strong><span>${esc(choiceCopy(this.content,group.items.at(-1)!.eventId??'',group.items.at(-1)!.phase??'root',group.items.at(-1)!.choiceId??'').label??group.items.at(-1)!.choice)}</span></summary>${group.items.map(l=>`<div class="story-memory"><p class="memory-choice">${esc(choiceCopy(this.content,l.eventId??'',l.phase??'root',l.choiceId??'').label??l.choice)}</p><p>${esc(resultText(this.content,l))}</p>${l.chance?`<small>${l.success?'事成':'未成'} · ${l.roll} / ${l.chance}</small>`:''}</div>`).join('')}</details>`).join('')}</div>`:''}<details class="disclosure fate-records" data-panel="fate-records"><summary>因果印记</summary><div class="build-tags">${Object.keys(s.facts).filter(k=>s.facts[k]&&this.content.labels.facts[k]).map(k=>`<span>${esc(this.content.labels.facts[k])}</span>`).join('')||'<span>尚无印记</span>'}</div></details>`;
 }
 endings(){return `${this.heading('此后，你要往何处','五色神光散尽。你终于可以自己写下名字。')}<div class="rest-art" style="height:185px">${landscape()}${icon('gate',100)}</div><div class="ending-grid">${this.game!.legalEndings().map(e=>`<button class="ending-card" data-action="ending" data-id="${e.id}">${icon(e.art,44)}<h3>${esc(e.name)}</h3><p>${esc(e.description)}</p></button>`).join('')}</div>`;}

 final(){const s=this.game!.s,ending=this.content.endings.find(e=>e.id===s.endingId),dead=s.phase==='dead',echoes=Object.entries(s.threads).filter(([k])=>k.startsWith('act_'));return `<section class="final-page"><div class="final-seal">${icon(dead?'moon':ending?.art??'seal',68)}</div><h1>${dead?'劫中归寂':esc(ending!.name)}</h1><p>${dead?'此身虽散，道心未灭。':esc(ending!.description)}</p>${echoes.length?`<details class="disclosure" data-panel="life-echoes"><summary>回望此生</summary><div class="final-echoes">${echoes.map(([k,v])=>`<b>${esc(this.content.labels.threads?.[k]??'旧事')} · ${esc(threadText(this.content,k,v))}</b>`).join('')}</div></details>`:''}<div class="final-stats"><div><strong>${s.visited.length}</strong>行程</div><div><strong>${this.content.realms[s.level]}</strong>境界</div><div><strong>${s.hp}</strong>余命</div></div><div class="actions">${btn('new','再入此劫','primary')}${btn('export','留存命途','quiet')}</div></section>`;}
 stage(){if(this.view==='build')return this.codex();if(this.view==='karma')return this.karma();switch(this.game!.s.phase){case 'map':return this.map();case 'battle':return this.battle();case 'reward':return this.rewards();case 'shop':return this.shop();case 'rest':return this.rest();case 'event':case 'event_result':return this.event();case 'ending':return this.endings();default:return this.final();}}

 bottom(){return `<nav class="bottom-nav" aria-label="主导航">${[['journey','mountain','山河'],['build','book','命盘'],['karma','lotus','因缘']].map(([id,art,label])=>`<button class="${this.view===id?'active':''}" data-action="tab" data-id="${id}" ${this.view===id?'aria-current="page"':''}>${icon(art,22)}${label}</button>`).join('')}</nav>`;}

 pendingModal(){const p=this.game!.s.pending!,incoming=abilityLoadoutSlot(this.game!.ability(p.id));return `<div class="modal-backdrop"><section class="modal replacement-modal" role="dialog" aria-modal="true" aria-label="选择替换"><h2>一得，一舍</h2><p>${slotLabel(incoming)}已满。${p.source==='shop'?`舍此得彼 · ${p.price} 灵石。`:'舍此得彼。'}</p><div class="replacement-incoming">${this.card(p.id,0,'display','','新得')}${this.fitNote(p.id)}</div><div class="replacement-candidates">${this.game!.s.slots.map((eq,i)=>eq&&abilityLoadoutSlot(this.game!.ability(eq.id))===incoming?`<div class="replacement-option">${this.card(eq.id,eq.rank,'replace',`data-index="${i}"`,'舍此')}${this.replacementImpact(p.id,eq.id,i)}</div>`:'').join('')}</div><div class="actions">${btn('cancelReplacement','不取','quiet')}</div></section></div>`;}

 dialog(){if(!this.modal)return '';let body='';
 if(this.modal==='new')body=`<h2 id="dialog-title">再入此劫</h2><p>旧途将封。</p><div class="actions">${btn('export','留存此生','',this.game?'':'disabled')}${btn('confirmNew','另择前尘','primary')}</div>`;
 else if(this.modal==='settings')body=`<h2 id="dialog-title">静室</h2><div class="setting-row"><span>声息</span>${btn('sound',this.muted?'关':'开','small',`role="switch" aria-label="音效" aria-checked="${!this.muted}"`)}</div><div class="setting-row"><span>战痕详录</span>${btn('detailedLog',this.detailedLog?'开':'关','small',`role="switch" aria-label="详细战报" aria-checked="${this.detailedLog}"`)}</div><div class="setting-row"><span>命书${this.storageOK?' · 已封存':' · 封存有误'}</span><div class="row">${btn('export','留存','small',this.game?'':'disabled')}${btn('import','载入','small')}</div></div>${this.legacySave?`<div class="setting-row"><span>旧卷 · 4.3及更早</span>${btn('exportLegacy','留存旧卷','small')}</div>`:''}<div class="setting-row"><span>修行札</span>${btn('help','翻阅','small')}</div>${this.game?`<div class="setting-row"><span>另起命途</span>${btn('new','再入此劫','small')}</div>`:''}<details class="disclosure" data-panel="version"><summary>卷尾</summary>${this.game?`<p>命数 ${esc(this.game.s.seed)}</p>`:''}<p>卷本 ${esc(this.content.version)} · 法则 ${esc(this.content.rulesVersion)}</p><p>书页 ${UI_REVISION}</p></details>`;
 else if(this.modal==='character'){const g=this.game!,s=g.s,st=g.stats(),o=this.content.origins.find(x=>x.id===s.origin)!,f=this.content.fates.find(x=>x.id===s.fate)!;body=`<h2 id="dialog-title">${esc(s.name)}</h2><p>${esc(this.content.races.find(r=>r.id===s.race)!.name)} · ${esc(o.name)} · ${esc(this.content.realms[s.level])}</p><div class="character-stats">${STAT_KEYS.map(k=>`<div><span>${this.content.labels.stats[k]}</span><strong>${k==='hp'?s.hp+' / ':''}${st[k]}</strong></div>`).join('')}</div><details class="disclosure" data-panel="origin-fate"><summary>${esc(o.name)} · ${esc(f.name)}</summary><p>${esc(f.description)}</p></details><details class="disclosure" data-panel="stat-sources"><summary>根骨来处</summary><div class="stat-source-list">${STAT_KEYS.map(k=>{const gear=s.slots.reduce((n,eq)=>n+(eq?value(g.ability(eq.id).stats[k],eq.rank):0),0),fate=value(f.stats?.[k]),realm=value(this.content.rules.levelStats[k])*s.level,bonus=value(s.bonus[k]),racial=value(this.content.races.find(r=>r.id===s.race)!.stats[k]),talent=this.content.talents.filter(t=>s.talents.includes(t.id)).reduce((n,t)=>n+value(t.stats[k]),0);return `<div><strong>${this.content.labels.stats[k]}</strong><p>出身 ${o.stats[k]} · 族裔 ${racial>=0?'+':''}${racial} · 天赋 ${talent>=0?'+':''}${talent} · 境界 ${realm>=0?'+':''}${realm} · 命格 ${fate>=0?'+':''}${fate} · 所习 ${gear>=0?'+':''}${gear} · 历练 ${bonus>=0?'+':''}${bonus}${f.percent?.[k]?' · 命格修正 '+f.percent[k]+'%':''}</p></div>`;}).join('')}</div></details>`;}
 else if(this.modal==='ability'){const a=this.content.abilities.find(x=>x.id===this.modalAbility)!,eq=this.game?.s.slots.find(x=>x?.id===a.id),rank=eq?.rank??0,mechanics=abilityMechanicTags(a);body=`<h2 id="dialog-title">功法详录</h2>${this.card(a.id,rank,'display')}<div class="ability-tags">${mechanics.map(x=>`<span>${esc(TAGS[x])}</span>`).join('')||'<span>无机制 Tag</span>'}</div>${a.relicConversions?.length?`<div class="build-rule"><strong>命器转换</strong>${a.relicConversions.map(x=>`<p>${esc(x.label??a.name)}：${esc(conversionText(this.content,x,rank))}</p>`).join('')}</div>`:''}<details class="disclosure" data-panel="rank-effects"><summary>各阶变化</summary><div class="rank-effects">${[0,1,2,3].map(n=>`<section class="${n===rank?'current':''}"><strong>${rankName(n)}</strong>${abilityLines(this.content,a,n).map(x=>`<p>${esc(x)}</p>`).join('')}</section>`).join('')}</div></details>`;}
 else body=`<h2 id="dialog-title">修行札记</h2><div class="help-text"><h3>山河</h3><p>择路而行，伤势随幕。</p><h3>悟道</h3><p>破境择一念。</p><h3>命盘</h3><p>唯一普攻、唯一怒技、四个自由组件、一件命器与一项战策。机制 Tag 描述“怎么运作”，不会要求你凑预设流派。</p><h3>命器</h3><p>命器负责把伤害、回复、护盾、怒气或状态结算互相转换，是构筑的核心桥梁。</p><h3>斗法</h3><p>怒满则发；法宝触发不占用普攻或怒技行动。</p><h3>因缘</h3><p>一念留痕。</p></div>`;
 return `<div class="modal-backdrop"><section class="modal narrow" role="dialog" aria-modal="true" aria-labelledby="dialog-title"><button class="icon-button modal-close" data-action="close" aria-label="关闭">${icon('close',21)}</button>${body}</section></div>`;
 }

 render(){window.clearTimeout(this.timer);if(!this.content)return;
 const key=this.home?`home.${this.setupStep}`:`${this.game?.s.seed}.${this.view}.${this.game?.s.phase}.${this.game?.s.current?.id??''}.${this.game?.s.act}.${this.game?.s.row}.${this.game?.s.eventPhase??''}`;
 const same=key===this.renderKey,oldY=window.scrollY,oldMapTop=this.querySelector<HTMLElement>('.map-scroll')?.scrollTop;
 const open=same?Array.from(this.querySelectorAll<HTMLDetailsElement>('details[data-panel][open]')).map(x=>x.dataset.panel!):[];
 const oldLog=this.querySelector<HTMLElement>('.battle-log'),battleKey=`${this.game?.s.seed}.${this.game?.s.current?.id}`;
 if(oldLog&&this.logKey===battleKey){this.logTop=oldLog.scrollTop;this.logFollow=oldLog.scrollHeight-oldLog.clientHeight-oldLog.scrollTop<32;}
 if(this.logKey!==battleKey){this.logTop=0;this.logFollow=true;this.logKey=battleKey;}
 const active=document.activeElement as HTMLElement|null;
 const focus=active&&this.contains(active)?{action:active.dataset.action,id:active.dataset.id,index:active.dataset.index,panel:active.closest<HTMLElement>('details[data-panel]')?.dataset.panel}:undefined;
 const wasDialog=!!this.querySelector('.modal'),oldTalentLevel=this.querySelector<HTMLElement>('[data-talent-level]')?.dataset.talentLevel;
 this.innerHTML=this.header()+(this.home?this.landing():this.chapters()+this.mobileHUD()+`<div class="game-layout ${this.view==='journey'&&this.game?.s.phase==='battle'?'in-combat':''} ${this.view==='build'?'view-build':''}">${this.playerPanel()}<main class="main-stage">${this.stage()}</main></div>`+this.bottom())+`<input id="save-file" type="file" accept="application/json,.json" hidden>`+(this.modal?this.dialog():(this.talentModal()||(this.game?.s.pending&&!this.home?this.pendingModal():'')))+(this.toastText?`<div class="toast" role="status">${esc(this.toastText)}</div>`:'');
 this.renderKey=key;
 for(const panel of open){const d=this.querySelector<HTMLDetailsElement>(`details[data-panel="${CSS.escape(panel)}"]`);if(d)d.open=true;}
 const log=this.querySelector<HTMLElement>('.battle-log');if(log){log.scrollTop=this.logFollow?log.scrollHeight:this.logTop;const update=()=>{this.logTop=log.scrollTop;this.logFollow=log.scrollHeight-log.clientHeight-log.scrollTop<32;const follow=this.querySelector<HTMLElement>('.log-follow');if(follow)follow.hidden=this.logFollow;};update();log.addEventListener('scroll',update,{passive:true});}
 const dialog=this.querySelector<HTMLElement>('.modal');
 if(dialog&&(!wasDialog||oldTalentLevel!==this.querySelector<HTMLElement>('[data-talent-level]')?.dataset.talentLevel)){if(focus?.action)this.focusReturn=`[data-action="${CSS.escape(focus.action)}"]${focus.id?`[data-id="${CSS.escape(focus.id)}"]`:''}`;dialog.querySelector<HTMLElement>('button:not([disabled]),summary')?.focus({preventScroll:true});}
 else if(!dialog&&wasDialog&&this.focusReturn){this.querySelector<HTMLElement>(this.focusReturn)?.focus({preventScroll:true});}
 else if(focus?.action&&same){this.querySelector<HTMLElement>(`[data-action="${CSS.escape(focus.action)}"]${focus.id?`[data-id="${CSS.escape(focus.id)}"]`:''}${focus.index?`[data-index="${CSS.escape(focus.index)}"]`:''}`)?.focus({preventScroll:true});}
 if(focus?.panel&&!focus.action&&same)this.querySelector<HTMLElement>(`details[data-panel="${CSS.escape(focus.panel)}"]>summary`)?.focus({preventScroll:true});
 const mapScroll=this.querySelector<HTMLElement>('.map-scroll'),mapNode=this.querySelector<HTMLElement>('.map-node.available');if(mapScroll&&mapNode)mapScroll.scrollTop=same&&oldMapTop!==undefined?oldMapTop:Math.max(0,mapNode.offsetTop-mapScroll.clientHeight*.6);
 window.scrollTo(0,same?oldY:0);
 if(!this.home&&this.view==='journey'&&this.game?.s.phase==='battle'&&!this.paused&&!this.modal&&!this.game.s.pending&&!this.game.s.talentDraft){const b=this.game.s.battle!;if(b.cursor<b.frames.length-1)this.timer=window.setTimeout(()=>{b.cursor++;const f=b.frames[b.cursor];if(f.kind==='rage')this.playTone(true);this.save();this.render();},Math.max(90,850/this.speed));}
 }
}
customElements.define('fengshen-game',FengshenGame);
