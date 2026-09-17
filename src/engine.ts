/** Pure deterministic rules. No DOM, clock, storage, or content IDs outside the supplied pack. */
export type Stat = 'hp'|'attack'|'defense'|'speed'|'hit'|'dodge'|'luck';
export type Slot = 'basic'|'rage'|'aux'|'artifact'|'component'|'relic'|'strategy';
export type LoadoutSlot = 'basic'|'rage'|'component'|'relic'|'strategy';
export type MechanicTag = 'burst'|'multi'|'duration'|'counter'|'charge'|'chain'|'convert'|'consume'|'evade'|'control';
export type ConversionEvent = 'damage'|'damage_taken'|'heal'|'shield_gain'|'rage_spend'|'status_tick'|'status_consume';
export type ConversionTarget = 'damage'|'heal'|'shield'|'rage';
export type Stats = Record<Stat,number>;
export type Num = number | number[];
export interface Condition { type:string; target?:string; value?:number; key?:string; status?:string; tag?:string; stat?:Stat; text?:string; }
export interface Effect { type:string; target?:string; value?:any; coefficient?:Num; stat?:Stat; maxHpPercent?:number; percent?:Num; status?:string; pure?:boolean; key?:string; resource?:string; resourceTarget?:string; cap?:number; }
export interface Trigger { on:string; effects:Effect[]; once?:boolean; chance?:number; maxPerRound?:number; conditions?:Condition[]; requiresTags?:MechanicTag[]; anyTags?:MechanicTag[]; excludeTags?:MechanicTag[]; }
export interface StrategyRule {action:'basic'|'rage';conditions?:Condition[];label?:string;}
export type SchoolId = 'rage'|'burn'|'guard'|'break'|'crit'|'evade'|'vitality'|'curse';
export interface School {id:SchoolId;name:string;tags:string[];one:string;two:string;finisher:{name:string;effect:string};}
export interface Hybrid {id:string;name:string;schools:[SchoolId,SchoolId];one:string;two:string;}
export interface RunPool {schools:SchoolId[];hybrids:string[];}
export interface RelicConversion {from:ConversionEvent;to:ConversionTarget;percent:Num;cap?:number;status?:string;label?:string;}
export interface Ability { schools?:SchoolId[];hybrid?:string; id:string; name:string; slot:Slot; equipRole?:LoadoutSlot; tags:string[]; mechanicTags?:MechanicTag[]; flavorTags?:string[]; relicConversions?:RelicConversion[]; strategyRules?:StrategyRule[]; defaultAction?:'basic'|'rage'; art:string; description:string; effects:Effect[]; triggers:Trigger[]; stats:Partial<Record<Stat,Num>>; rarity:string; cost:number; cooldown?:number; priority?:number; mechanicRole?:'starter'|'generator'|'converter'|'amplifier'|'bridge'|'keystone'|'risk'|'payoff'; }
export interface Talent {id:string;name:string;race:string;minLevel:number;schools:SchoolId[];description:string;art:string;path?:string;stats:Partial<Stats>;triggers:Trigger[];requires:string[];exclusiveGroup?:string;world?:{checkBonus?:number;draftChoices?:number};}
export interface TalentDraft {level:number;offers:string[];}
export interface Race {id:string;name:string;art:string;trait:string;description:string;stats:Partial<Stats>;triggers:Trigger[];paths:string[];}
export interface Origin { id:string; name:string; subtitle:string; description:string; art:string; stats:Stats; affinity:string; starting:string[]; battleStartEffects?:Effect[]; }
export interface Fate {resonanceBias?:SchoolId[]; id:string; name:string; art:string; description:string; stats?:Partial<Stats>; percent?:Partial<Stats>; triggers?:Trigger[]; damageByRound?:number[]; }
export interface BattleObjective { type:'kill'|'survive'|'break'; rounds?:number; value?:number; label?:string; }
export interface BossPhase { hpPercent:number; label:string; effects?:Effect[]; }
export interface Enemy { id:string; name:string; act:number; kind:string; art:string; stats:Stats; abilities:string[]; tags:string[]; intent:string; ai?:'greedy'|'weighted'; objective?:BattleObjective; phases?:BossPhase[]; }
export interface EventBranch { text:string; effects:Effect[]; grant?:{id?:string;slot?:Slot}|null; next?:string; }
export interface EventCheck { stat:Stat; base:number; difficulty:number; success:EventBranch; failure:EventBranch; }
export interface ChoiceAuthored {role?:string;promiseId?:string;action?:string;evidence?:string;amount?:number;settleAfterPayment?:boolean;allowedNodeTypes?:string[];deadline?:{act:number;row:number;boundary?:string};sourceFact?:string;crossLineFact?:string;targetLine?:string;specialRoute?:string;[key:string]:any;}
export interface Choice { id:string; label:string; text:string; preview?:string; effects:Effect[]; grant?:{id?:string;slot?:Slot}|null; conditions:Condition[]; next?:string; check?:EventCheck; tone?:'safe'|'cost'|'check'|'fate'; consequence?:string; authored?:ChoiceAuthored; }
export interface EventPhase { id:string; text:string; choices:Choice[]; authored?:ChoiceAuthored; }
export interface Story {requirements?:Condition[];starts?:{phase:string;weight:number;conditions?:Condition[]}[];id:string;act:number;major:boolean;name:string;npc:string;art:string;text:string;choices:Choice[];phases?:EventPhase[];startPhase?:string;profile?:'A'|'B';weight?:number;maxPerRun?:number;category?:'encounter'|'bargain'|'trial'|'echo'|'secret'|'major';hiddenOnly?:boolean;relevance?:Condition[];character?:string;episode?:number;episodes?:number;relationKey?:string;authored?:Record<string,any>;}
export type PromiseStatus='active'|'fulfilled'|'broken'|'expired'|'declined';
export interface CharacterPromiseState {definitionId:string;status:PromiseStatus;acceptedAt?:{act:number;row:number;nodeId:string};bypassPermit?:{state:'available'|'consumed'|'expired';issuedAtNodeId:string;usedAtNodeId?:string};evidenceNodeId?:string;finalRewardOffered?:boolean;settlementClaimed?:boolean;reason?:string;}
export interface CharacterPromiseDefinition {id:string;relationKey:string;character?:string;type:string;amount?:number;deadline?:{act:number;row:number;boundary?:string};acceptance?:{eventId:string;phase?:string;choiceId?:string;choiceIds?:string[]};fulfillment?:{eventId?:string;phase?:string;choiceId?:string;evidence?:string;nodeType?:string;nodeTypes?:string[];fact?:string;sameAction?:boolean};facts:{accepted?:string;task?:string;fulfilled?:string;declined?:string;abandoned?:string;available?:string;saved?:string};rewardId?:string;}
export interface CharacterRouteClues {story:RouteNode[];elite:RouteNode[];bypass:RouteNode[];}
interface LegacyMigrationPayload {trackedCharacter?:string|null;promises:Record<string,CharacterPromiseState>;facts:Record<string,boolean>;}
export interface Ending { id:string; name:string; art:string; description:string; conditions:Condition[]; }
export interface BuildPath {id:string;school:SchoolId;hybrid?:string;name:string;abilities:string[];talents:string[];description:string;tradeoff:string;}
export interface Content {buildPaths:BuildPath[];talents:Talent[];races:Race[];schools:School[];hybrids:Hybrid[]; version:string;rulesVersion:string;title:string;subtitle:string;abilities:Ability[];origins:Origin[];fates:Fate[];enemies:Enemy[];events:Story[];characterPromises?:CharacterPromiseDefinition[];acts:{name:string;subtitle:string;chapter:string;boss:string;major:string;tint:string;bosses?:string[]}[];endings:Ending[];realms:string[];rules:{routeRows:string[][];actStartFullHeal:boolean;actStartHealPercent?:number;actStartMinHpPercent?:number;poolSchools:number;poolHybrids:number;trackingMultiplier?:number;xpThresholds:number[];levelStats:Partial<Stats>;rageMax:number;basicRage:number;hitRage:number;maxRounds:number;burnDamage:number;weakPercent:number;breakDefense:number;vulnerablePercent:number;startingGold:number;refreshPrices:number[];restPercent:number;enemyHpPercentByAct?:number[];enemyAttackPercentByAct?:number[];rewards:Record<string,{gold:number;xp:number}>};labels:Record<string,Record<string,string>>; }
export interface Equipped { id:string; rank:number; }
export interface RouteNode {id:string;act:number;row:number;lane:number;type:string;ref?:string;}
export type Phase = 'map'|'battle'|'reward'|'shop'|'rest'|'event'|'event_result'|'ending'|'finished'|'dead';
export interface Fighter {name:string;stats:Stats;hp:number;rage:number;shield:number;status:Record<string,number>;abilities:Equipped[];fate?:Fate;used:string[];tags:string[];cooldown:Record<string,number>;phase:number;}
export interface CombatBreakdown { base:number; scaled:number; afterDefense:number; afterVulnerable:number; afterBuild:number; afterCrit:number; absorbed:number; hpLoss:number; }
export type AbilityBuildRole='starter'|'core'|'amplifier'|'bridge'|'finisher';
export interface AbilityRoleInfo {role:AbilityBuildRole;label:string;reason:string;fit:number;}
export interface BuildLink {id:string;name:string;count:number;description:string;}
export interface BuildProfile {tags:Record<MechanicTag,number>;dominant:MechanicTag[];effects:Record<string,number>;statuses:Record<string,number>;links:BuildLink[];relic:{name:string;rank:number;description:string};strategy:{name:string;description:string};score:number;}
export interface Frame {round:number;actor:'p'|'e'|'system';kind:string;label:string;amount:number;crit?:boolean;p:Fighter;e:Fighter;sourceId?:string;detail?:string;breakdown?:CombatBreakdown;objective?:string;phase?:number;tags?:MechanicTag[];}
export interface BattleContribution {damage:number;heal:number;shield:number;rage:number;conversions:number;triggers:number;}
export interface BattleSummary {playerDamage:number;enemyDamage:number;playerShieldAbsorbed:number;enemyShieldAbsorbed:number;playerCrits:number;enemyCrits:number;playerMisses:number;enemyMisses:number;playerRageSkills:number;enemyRageSkills:number;playerConversions:number;enemyConversions:number;statusTicks:number;phaseChanges:number;contributions:Record<string,BattleContribution>;}
export interface BattleDiagnosticResourceTotals {produced:number;consumed:number;read:number;reads:number;maxRead:number;zeroNet:number;}
export interface BattleDiagnosticResource extends BattleDiagnosticResourceTotals {byActor:Record<'p'|'e',BattleDiagnosticResourceTotals>;bySource:Record<string,BattleDiagnosticResourceTotals>;}
export interface BattleDiagnosticObservation {actual:number;required:number;count:number;lastActual:number;}
export interface BattleDiagnosticTrigger {actor:'p'|'e';sourceId:string;triggerIndex:number;on:string;attempts:number;fired:number;blocked:Record<string,number>;firstBlocked?:string;actual:Record<string,number>;required:Record<string,number>;observations:Record<string,BattleDiagnosticObservation>;reads:Record<string,{count:number;total:number;max:number}>;zeroNet:number;}
export interface BattleDiagnosticActionSource {offered:number;available:number;selected:number;blocked:Record<string,number>;}
export interface BattleDiagnosticActionSide {attempts:number;selected:number;waits:number;blocked:Record<string,number>;bySource:Record<string,BattleDiagnosticActionSource>;strategy:{decisions:number;byReason:Record<string,number>};}
export interface BattleDiagnosticConversion {actor:'p';sourceId:string;index:number;from:ConversionEvent;to:ConversionTarget;attempts:number;converted:number;input:number;output:number;blocked:Record<string,number>;zeroOutput:number;unattempted:number;lastBlocked?:string;}
export interface BattleDiagnosticLossTotals {total:number;byCategory:Record<string,number>;byRound:Record<string,number>;bySource:Record<string,number>;}
export interface BattleDiagnosticLink {sourceActor:'p'|'e'|'system';sourceId:string;event:string;targetActor:'p'|'e';targetId:string;targetSourceId:string;triggerIndex:number;arrivals:number;attempts:number;fired:number;blocked:Record<string,number>;zeroNet:number;firstBlocked?:string;}
export interface BattleDiagnostics {
 schemaVersion:1;
 sources:Array<{actor:'p'|'e';id:string;kind:string;name:string}>;
 events:Record<string,{arrivals:number}>;
 triggers:Record<string,BattleDiagnosticTrigger>;
 links:BattleDiagnosticLink[];
 resources:Record<string,BattleDiagnosticResource>;
 actions:{p:BattleDiagnosticActionSide;e:BattleDiagnosticActionSide};
 conversions:{attempts:number;converted:number;unattempted:number;bySource:Record<string,BattleDiagnosticConversion>};
 losses:{total:number;byCategory:Record<string,number>;byRound:Record<string,number>;player:BattleDiagnosticLossTotals;enemy:BattleDiagnosticLossTotals;};
}
export interface Battle {enemyId:string;frames:Frame[];won:boolean;rounds:number;hp:number;cursor:number;objective:BattleObjective;summary:BattleSummary;objectiveProgress:number;diagnostics?:BattleDiagnostics;}
export interface Stock {kind:'ability'|'heal'|'stat';id?:string;price:number;sold:boolean;stat?:Stat;value?:number;}
export interface Pending {id:string;source:'reward'|'shop'|'event';price:number;index?:number;}
export interface EventCheckResult {eventId:string;phase:string;choiceId:string;stat:Stat;chance:number;roll:number;success:boolean;}
export interface StoryLogItem {act:number;title:string;choice:string;phase?:string;result?:string;chance?:number;roll?:number;success?:boolean;eventId?:string;choiceId?:string;category?:string;consequence?:string;promiseId?:string;promiseAction?:string;promiseStatus?:PromiseStatus;evidenceNodeId?:string;promiseReason?:string;}
export interface RunState {talents:string[];talentQueue:number[];talentDraft?:TalentDraft;talentHistory:{level:number;id:string}[];race:string;contentPool:RunPool;version:string;rulesVersion:string;seed:string;name:string;portrait:string;origin:string;fate:string;act:number;row:number;lane:number;phase:Phase;hp:number;gold:number;xp:number;level:number;bonus:Partial<Stats>;slots:(Equipped|null)[];rng:Record<string,number>;route:RouteNode[];visited:string[];facts:Record<string,boolean>;counters:Record<string,number>;threads:Record<string,string>;seenEvents:Record<string,number>;refreshes:number[];reward:string[];stock:Stock[];temper:Stat[];current?:RouteNode;battle?:Battle;pending?:Pending;eventId?:string;eventPhase?:string;eventStep?:number;lastCheck?:EventCheckResult;resultText?:string;endingId?:string;trackedCharacter?:string;/** @deprecated Use trackedCharacter. */ followedCharacter?:string;promises:Record<string,CharacterPromiseState>;actionLog:{command:string;args:any[]}[];storyLog:StoryLogItem[];rewardInfo?:{gold:number;xp:number};}

export const SLOT_ORDER:LoadoutSlot[]=['basic','rage','component','component','component','component','relic','strategy'];
export const CONTENT_SLOTS:Slot[]=['basic','rage','aux','artifact','component','relic','strategy'];
export const MECHANIC_TAGS:MechanicTag[]=['burst','multi','duration','counter','charge','chain','convert','consume','evade','control'];
export const MECHANIC_TAG_LABELS:Record<MechanicTag,string>={burst:'爆发',multi:'多段',duration:'持续',counter:'反击',charge:'蓄势',chain:'连锁',convert:'转化',consume:'消耗',evade:'闪避',control:'控制'};
export const STAT_KEYS:Stat[]=['hp','attack','defense','speed','hit','dodge','luck'];
export const EFFECT_TYPES=['damage','resource_damage','heal','gain_shield','gain_rage','lose_rage','consume_status','consume_shield','apply_status','remove_status','modify_stat','gain_currency','gain_xp','rank_up','set_fact','add_counter','advance_thread'];
export const TRIGGER_TYPES=['battle_start','before_action','after_action','on_hit','on_damage','on_crit','on_evade','on_heal','on_shield_gain','on_status_apply','on_status_tick','on_consume','on_rage_spend','on_damaged','on_rage_skill','hp_threshold','round_end','battle_end'];
export const CONDITION_TYPES=['hp_below','hp_above','has_status','status_stack_at_least','rage_at_least','has_fact','counter_at_least','act_is','enemy_tag','player_tag','currency_at_least','hp_above_absolute','thread_is','event_seen','stat_at_least','race_is','has_talent','promise_state','promise_reward_available'];
const PROMISE_BOUNDARIES=new Set(['act_end','ordinary_combat_end','node']);
const ROUTE_NODE_TYPES=new Set(['combat','elite','event','hidden','shop','rest','major','treasure','boss']);
export const clone=<T>(x:T):T=>JSON.parse(JSON.stringify(x));
export const value=(x:Num|undefined,r=0):number=>Math.trunc(Array.isArray(x)?x[Math.min(r,x.length-1)]:(x??0));
export const clamp=(x:number,min:number,max:number)=>Math.max(min,Math.min(max,x));
export function hash(text:string):number {let x=2166136261;for(let i=0;i<text.length;i++){x^=text.charCodeAt(i);x=Math.imul(x,16777619);}return (x>>>0)||1;}
export function random(s:{seed:string;rng:Record<string,number>},stream:string):number {let x=s.rng[stream]??hash(s.seed+'|'+stream);x^=x<<13;x^=x>>>17;x^=x<<5;s.rng[stream]=x>>>0;return (x>>>0)/4294967296;}
export function pick<T>(s:{seed:string;rng:Record<string,number>},stream:string,a:T[]):T {if(!a.length)throw new Error('Empty choice pool');return a[Math.floor(random(s,stream)*a.length)];}
export function sample<T>(s:{seed:string;rng:Record<string,number>},stream:string,a:T[],n:number):T[]{const pool=[...a],out:T[]=[];while(pool.length&&out.length<n)out.push(pool.splice(Math.floor(random(s,stream)*pool.length),1)[0]);return out;}
export function fateOptions(c:Content,seed:string):Fate[]{return sample({seed,rng:{}},'fate',c.fates,3);}

export function abilityLoadoutSlot(a:Ability):LoadoutSlot {
 if(a.equipRole)return a.equipRole;
 if(a.slot==='basic'||a.slot==='rage'||a.slot==='strategy'||a.slot==='relic')return a.slot;
 if(a.slot==='artifact'&&a.rarity==='mythic')return 'relic';
 return 'component';
}

/** Mechanic tags describe HOW an effect behaves; resources, statuses and schools are intentionally excluded. */
export function abilityMechanicTags(a:Ability):MechanicTag[] {
 const out=new Set<MechanicTag>(a.mechanicTags??[]),all=[...a.effects,...(a.triggers??[]).flatMap(t=>t.effects??[])],legacy=new Set(a.tags??[]);
 if(legacy.has('burst'))out.add('burst');if(legacy.has('counter'))out.add('counter');if(legacy.has('evade'))out.add('evade');if(legacy.has('control'))out.add('control');
 if(a.mechanicRole==='converter'||all.some(e=>['resource_damage','consume_status','consume_shield'].includes(e.type))||a.relicConversions?.length)out.add('convert');
 if(all.some(e=>['consume_status','consume_shield','lose_rage'].includes(e.type)))out.add('consume');
 if((a.triggers??[]).length)out.add('chain');
 if((a.triggers??[]).some(t=>['round_end','battle_end'].includes(t.on))||all.some(e=>e.type==='apply_status'&&e.status==='burn'))out.add('duration');
 if((a.cooldown??0)>=2||a.mechanicRole==='payoff')out.add('charge');
 const damageEffects=all.filter(e=>e.type==='damage'||e.type==='resource_damage').length;if(damageEffects>=2)out.add('multi');
 return [...out].filter(t=>MECHANIC_TAGS.includes(t));
}

export function slotLabel(slot:LoadoutSlot):string {return ({basic:'普攻',rage:'怒技',component:'组件',relic:'命器',strategy:'战策'} as Record<LoadoutSlot,string>)[slot];}

function weighted<T>(s:{seed:string;rng:Record<string,number>},stream:string,items:T[],weight:(x:T)=>number):T {
 if(!items.length)throw new Error('Empty weighted pool');const weights=items.map(x=>Math.max(0,weight(x))),total=weights.reduce((a,b)=>a+b,0);if(total<=0)return items[0];
 let cursor=random(s,stream)*total;for(let i=0;i<items.length;i++){if(cursor<weights[i])return items[i];cursor-=weights[i];}return items[items.length-1];
}

export function validateContent(c:Content):void {
 if(!c||!c.version||!Array.isArray(c.abilities))throw new Error('Invalid content pack');
 if(!Array.isArray(c.talents))throw new Error('Missing talent registry');
 if(!Array.isArray(c.races)||!c.races.length)throw new Error('Missing race registry');
 const schoolIds=new Set(c.schools?.map(x=>x.id)),hybridIds=new Set(c.hybrids?.map(x=>x.id));
 if(schoolIds.size!==c.schools?.length||!schoolIds.size||hybridIds.size!==c.hybrids?.length)throw new Error('Invalid school registry');
 for(const h of c.hybrids)if(h.schools.length!==2||h.schools[0]===h.schools[1]||h.schools.some(id=>!schoolIds.has(id)))throw new Error('Broken hybrid');
 if(c.rules.poolSchools<2||c.rules.poolSchools>schoolIds.size||c.rules.poolHybrids<1||c.rules.poolHybrids>hybridIds.size)throw new Error('Invalid run pool size');
 if(c.rules.trackingMultiplier!==undefined&&(!Number.isFinite(c.rules.trackingMultiplier)||c.rules.trackingMultiplier<=0||c.rules.trackingMultiplier>100))throw new Error('Invalid tracking multiplier');
 if(c.rules.actStartHealPercent!==undefined&&(!Number.isInteger(c.rules.actStartHealPercent)||c.rules.actStartHealPercent<0||c.rules.actStartHealPercent>100))throw new Error('Invalid act heal percent');
 if(c.rules.actStartMinHpPercent!==undefined&&(!Number.isInteger(c.rules.actStartMinHpPercent)||c.rules.actStartMinHpPercent<0||c.rules.actStartMinHpPercent>100))throw new Error('Invalid act minimum HP percent');
 if(!c.rules.routeRows?.length||c.rules.routeRows.at(-1)?.join()!=='boss')throw new Error('Invalid route rows');
 for(const row of c.rules.routeRows)if(![1,3].includes(row.length)||row.some(t=>!['combat','elite','event','hidden','shop','rest','major','treasure','boss'].includes(t)))throw new Error('Invalid route node');
 for(const curve of [c.rules.enemyHpPercentByAct,c.rules.enemyAttackPercentByAct])if(curve&&(curve.length!==c.acts.length||curve.some(x=>!Number.isInteger(x)||x<20||x>150)))throw new Error('Invalid enemy balance curve');
 const ids=new Set<string>();for(const list of [c.abilities,c.talents,c.races,c.origins,c.fates,c.enemies,c.events,c.endings])for(const entity of list){if(!entity.id||ids.has(entity.id))throw new Error('Duplicate or missing ID: '+entity.id);ids.add(entity.id);}
 const abilities=new Set(c.abilities.map(x=>x.id));
 const pathIds=new Set<string>();
 for(const path of c.buildPaths??[]){
  if(pathIds.has(path.id)||!schoolIds.has(path.school)||(path.hybrid&&!hybridIds.has(path.hybrid))||path.abilities.length!==3||new Set(path.abilities).size!==3||path.abilities.some(id=>!abilities.has(id))||!path.talents.length||path.talents.some(id=>!c.talents.some(t=>t.id===id)))throw new Error('Invalid build path');
  const used:Record<string,number>={};for(const id of path.abilities){const slot=abilityLoadoutSlot(c.abilities.find(a=>a.id===id)!);used[slot]=(used[slot]??0)+1;}for(const [slot,n] of Object.entries(used))if(n>SLOT_ORDER.filter(x=>x===slot).length)throw new Error('Impossible build path');pathIds.add(path.id);
 }
 const checkConditions=(a:Condition[])=>{for(const x of a){if(!CONDITION_TYPES.includes(x.type))throw new Error('Unknown condition '+x.type);if(x.stat&&!STAT_KEYS.includes(x.stat))throw new Error('Unknown condition stat');if(x.type==='race_is'&&!c.races.some(r=>r.id===x.key)||x.type==='has_talent'&&!c.talents.some(t=>t.id===x.key))throw new Error('Unknown progression condition');}};
 const checkEffects=(a:Effect[])=>{for(const e of a){if(!EFFECT_TYPES.includes(e.type))throw new Error('Unknown effect '+e.type);if(e.coefficient!==undefined&&[e.coefficient].flat().some(x=>!Number.isFinite(x)||x<0||x>2000))throw new Error('Unsafe coefficient');if(e.stat&&!STAT_KEYS.includes(e.stat))throw new Error('Unknown stat');if(['apply_status','remove_status','consume_status'].includes(e.type)&&!['burn','weak','break','stun','vulnerable'].includes(e.status??''))throw new Error('Unknown status effect');if(e.type==='resource_damage'&&!['burn','break','weak','vulnerable','shield','rage'].includes(e.resource??''))throw new Error('Unknown combat resource');if(e.type==='resource_damage'&&e.resourceTarget&&!['self','enemy'].includes(e.resourceTarget))throw new Error('Unknown resource target');}};
 const checkGrant=(g:{id?:string;slot?:Slot}|null|undefined)=>{if(g?.id&&!abilities.has(g.id))throw new Error('Broken grant');if(g?.slot&&!CONTENT_SLOTS.includes(g.slot))throw new Error('Broken grant slot');};
 const checkChoice=(choice:Choice,phaseIds?:Set<string>)=>{checkEffects(choice.effects??[]);checkConditions(choice.conditions??[]);checkGrant(choice.grant);if(choice.next&&phaseIds&&!phaseIds.has(choice.next))throw new Error('Broken event phase '+choice.next);if(choice.check){if(!STAT_KEYS.includes(choice.check.stat)||!Number.isFinite(choice.check.base)||!Number.isFinite(choice.check.difficulty))throw new Error('Invalid event check');for(const branch of [choice.check.success,choice.check.failure]){checkEffects(branch.effects??[]);checkGrant(branch.grant);if(branch.next&&phaseIds&&!phaseIds.has(branch.next))throw new Error('Broken event branch '+branch.next);}}};
 const promiseIds=new Set<string>(),promiseFactOwners=new Map<string,string>();
 for(const def of c.characterPromises??[]){
  if(!def.id||promiseIds.has(def.id)||!def.relationKey||PROMISE_TYPES.has(def.type)===false||!def.facts||!def.facts.accepted||!def.facts.fulfilled||!def.facts.declined)throw new Error('Invalid character promise');
  promiseIds.add(def.id);
  if(!Number.isInteger(def.amount??0)&&def.type==='reserve_currency')throw new Error('Invalid promise amount');
  if(def.amount!==undefined&&(!Number.isInteger(def.amount)||def.amount<0))throw new Error('Invalid promise amount');
  if(['reserve_currency','rescue_opposed'].includes(def.type)&&!Number.isInteger(def.amount))throw new Error('Promise cost must be configured');
  if(def.deadline&&(!Number.isInteger(def.deadline.act)||def.deadline.act<0||!Number.isInteger(def.deadline.row)||def.deadline.row<0||def.deadline.boundary!==undefined&&!PROMISE_BOUNDARIES.has(def.deadline.boundary)))throw new Error('Invalid promise deadline');
  const factKeys=new Set([...promiseFactKeys(def),def.fulfillment?.fact].filter((x):x is string=>!!x));
  for(const key of factKeys){const owner=promiseFactOwners.get(key);if(owner&&owner!==def.id)throw new Error('Duplicate promise fact '+key);promiseFactOwners.set(key,def.id);}
  const acceptance=def.acceptance;
  if(acceptance){
   const event=c.events.find(x=>x.id===acceptance.eventId);if(!event)throw new Error('Broken promise acceptance event');
   const phase=(event.phases??[]).find(x=>x.id===acceptance.phase);
   const choices=phase?.choices??(acceptance.phase?[]:event.choices??[]);
   const ids=acceptance.choiceIds??(acceptance.choiceId?[acceptance.choiceId]:[]);
   if(acceptance.choiceIds&&!Array.isArray(acceptance.choiceIds)||acceptance.choiceIds&&new Set(acceptance.choiceIds).size!==acceptance.choiceIds.length||acceptance.phase&&!phase||ids.some(id=>!choices.some(x=>x.id===id)))throw new Error('Broken promise acceptance choice');
  }
  const fulfillment=def.fulfillment;
  if(fulfillment?.eventId){
   const event=c.events.find(x=>x.id===fulfillment.eventId);if(!event)throw new Error('Broken promise fulfillment event');
   const phase=(event.phases??[]).find(x=>x.id===fulfillment.phase);
   const choices=phase?.choices??(fulfillment.phase?[]:event.choices??[]);
   if(fulfillment.choiceId&&!choices.some(x=>x.id===fulfillment.choiceId))throw new Error('Broken promise fulfillment choice');
  }
  if(fulfillment?.nodeType&&(!ROUTE_NODE_TYPES.has(fulfillment.nodeType)||fulfillment.nodeTypes&&!fulfillment.nodeTypes.includes(fulfillment.nodeType))||fulfillment?.nodeTypes&&(!Array.isArray(fulfillment.nodeTypes)||fulfillment.nodeTypes.length===0||fulfillment.nodeTypes.some(x=>!ROUTE_NODE_TYPES.has(x))))throw new Error('Invalid promise fulfillment nodes');
  if(def.rewardId&&!abilities.has(def.rewardId))throw new Error('Broken promise reward');
 }
 for(const a of c.abilities){if(a.schools?.some(id=>!schoolIds.has(id))||(a.hybrid&&!hybridIds.has(a.hybrid)))throw new Error('Broken ability school');if(!CONTENT_SLOTS.includes(a.slot))throw new Error('Invalid slot');if(a.equipRole&&!SLOT_ORDER.includes(a.equipRole))throw new Error('Invalid equip role');if(a.mechanicTags?.some(t=>!MECHANIC_TAGS.includes(t)))throw new Error('Unknown mechanic tag');for(const x of a.relicConversions??[]){if(!['damage','damage_taken','heal','shield_gain','rage_spend','status_tick','status_consume'].includes(x.from)||!['damage','heal','shield','rage'].includes(x.to)||[x.percent].flat().some(n=>!Number.isFinite(n)||n<0||n>500))throw new Error('Invalid relic conversion');}if(a.strategyRules&&abilityLoadoutSlot(a)!=='strategy')throw new Error('Strategy rules require strategy slot');if(a.defaultAction&&abilityLoadoutSlot(a)!=='strategy')throw new Error('Default action requires strategy slot');for(const r of a.strategyRules??[]){if(!['basic','rage'].includes(r.action))throw new Error('Invalid strategy action');checkConditions(r.conditions??[]);}if((a.cooldown??0)<0||(a.cooldown??0)>20)throw new Error('Invalid cooldown');checkEffects(a.effects);for(const t of a.triggers){if(!TRIGGER_TYPES.includes(t.on))throw new Error('Unknown trigger');checkEffects(t.effects);checkConditions(t.conditions??[]);}}
 const checkTrigger=(t:Trigger)=>{
  if(!TRIGGER_TYPES.includes(t.on)||t.chance!==undefined&&(!Number.isFinite(t.chance)||t.chance<0||t.chance>100)||t.maxPerRound!==undefined&&(!Number.isInteger(t.maxPerRound)||t.maxPerRound<1||t.maxPerRound>5))throw new Error('Invalid trigger limits');
  for(const tags of [t.requiresTags,t.anyTags,t.excludeTags])if(tags?.some(x=>!MECHANIC_TAGS.includes(x)))throw new Error('Unknown trigger mechanic tag');
  checkEffects(t.effects);checkConditions(t.conditions??[]);
 };
 for(const source of [...c.abilities,...c.races,...c.fates,...c.talents])for(const t of source.triggers??[])checkTrigger(t);
 const talentIds=new Set(c.talents.map(t=>t.id));
 for(const t of c.talents){
  if(t.race!=='common'&&!c.races.some(r=>r.id===t.race)||!Number.isInteger(t.minLevel)||t.minLevel<1||t.minLevel>=c.realms.length||!t.schools.length||t.schools.some(s=>!schoolIds.has(s)))throw new Error('Invalid talent identity');
  for(const id of t.requires){const prerequisite=c.talents.find(x=>x.id===id);if(!talentIds.has(id)||!prerequisite||prerequisite.minLevel>=t.minLevel||(prerequisite.race!=='common'&&prerequisite.race!==t.race))throw new Error('Invalid talent prerequisite');}
  for(const [k,v] of Object.entries(t.stats))if(!STAT_KEYS.includes(k as Stat)||!Number.isInteger(v)||Math.abs(v)>50)throw new Error('Invalid talent stat');
  if(t.world?.checkBonus!==undefined&&(!Number.isInteger(t.world.checkBonus)||t.world.checkBonus<0||t.world.checkBonus>10)||t.world?.draftChoices!==undefined&&t.world.draftChoices!==4)throw new Error('Invalid talent world modifier');
 }
 for(const race of c.races){for(const [k,v] of Object.entries(race.stats))if(!STAT_KEYS.includes(k as Stat)||!Number.isInteger(v)||Math.abs(v)>100)throw new Error('Invalid race stat');for(const t of race.triggers){if(!TRIGGER_TYPES.includes(t.on))throw new Error('Unknown race trigger');checkEffects(t.effects);checkConditions(t.conditions??[]);}}
 for(const f of c.fates){for(const id of f.resonanceBias??[])if(!c.schools.some(x=>x.id===id))throw new Error('Unknown fate resonance '+id);for(const t of f.triggers??[]){checkEffects(t.effects);checkConditions(t.conditions??[]);}}
 for(const x of [...c.origins.map(x=>({ids:x.starting,stats:x.stats})),...c.enemies.map(x=>({ids:x.abilities,stats:x.stats}))]){for(const id of x.ids)if(!abilities.has(id))throw new Error('Broken ability reference '+id);for(const key of STAT_KEYS)if(!Number.isInteger(x.stats[key])||x.stats[key]<0||x.stats[key]>10000)throw new Error('Invalid stat '+key);if(x.stats.hp<1)throw new Error('Invalid HP');}
 for(const enemy of c.enemies){if(enemy.objective&&!['kill','survive','break'].includes(enemy.objective.type))throw new Error('Invalid objective');for(const p of enemy.phases??[]){if(p.hpPercent<=0||p.hpPercent>=100)throw new Error('Invalid boss phase');checkEffects(p.effects??[]);}}
 for(const e of c.events){checkConditions(e.relevance??[]);checkConditions(e.requirements??[]);if((e.phases?.length??0)>5)throw new Error('Too many event phases');const phaseIds=new Set((e.phases??[]).map(p=>p.id));if(e.phases?.length&&phaseIds.size!==e.phases.length)throw new Error('Duplicate event phase');for(const entry of e.starts??[]){if(!phaseIds.has(entry.phase)||entry.weight<=0)throw new Error('Broken random event start');checkConditions(entry.conditions??[]);}if(e.startPhase&& !phaseIds.has(e.startPhase))throw new Error('Broken start phase');for(const choice of e.choices??[])checkChoice(choice,phaseIds);for(const p of e.phases??[]){if(p.choices.length<2||p.choices.length>4)throw new Error('Event phase must have 2-4 choices');for(const choice of p.choices)checkChoice(choice,phaseIds);}}
 const authoredPromiseKeys=(def:CharacterPromiseDefinition,action:string):Set<string>=>{
  const base=promiseBase(def.relationKey),keys=new Set<string>();
  const add=(...values:(string|undefined)[])=>values.filter((x):x is string=>!!x).forEach(x=>keys.add(x));
  if(action==='accept')add(def.facts.accepted,def.facts.task,def.facts.available,`${base}_promise`,`${base}_promise_accepted`);
  else if(action==='decline')add(def.facts.declined);
  else if(action==='abandon')add(def.facts.abandoned);
  else if(action==='fulfill')add(def.facts.accepted,def.facts.fulfilled,def.facts.saved,def.facts.available,def.fulfillment?.fact,`${base}_promise`,`${base}_promise_accepted`,`${base}_kept`);
  return keys;
 };
 const checkAuthoredMeta=(event:Story,authored:ChoiceAuthored|undefined)=>{
  if(!authored)return;
  if(authored.promiseId&&!promiseIds.has(authored.promiseId))throw new Error('Broken authored promise reference');
  if(authored.role&&['meeting','meeting_check','promise_acceptance','promise_progress','gift_choice','gift','reward','cross_line_echo'].indexOf(authored.role)<0)throw new Error('Unknown authored role');
  if(authored.role&&['meeting','meeting_check','promise_acceptance','promise_progress','gift_choice','reward'].includes(authored.role)&&!authored.promiseId)throw new Error('Authored promise role requires promise');
  if(authored.sourceFact&&typeof authored.sourceFact!=='string')throw new Error('Invalid authored source fact');
  if(authored.crossLineFact&&typeof authored.crossLineFact!=='string')throw new Error('Invalid authored cross-line fact');
  if(authored.amount!==undefined&&(!Number.isInteger(authored.amount)||authored.amount<0))throw new Error('Invalid authored amount');
  if(authored.deadline&&(!Number.isInteger(authored.deadline.act)||!Number.isInteger(authored.deadline.row)||authored.deadline.act<0||authored.deadline.row<0||authored.deadline.boundary!==undefined&&!PROMISE_BOUNDARIES.has(authored.deadline.boundary)))throw new Error('Invalid authored deadline');
  if(authored.allowedNodeTypes&&(!Array.isArray(authored.allowedNodeTypes)||authored.allowedNodeTypes.length===0||authored.allowedNodeTypes.some(x=>!ROUTE_NODE_TYPES.has(x))))throw new Error('Invalid authored node types');
 };
 const checkAuthored=(event:Story,choice:Choice)=>{
  const explicit=choice.authored,effective=explicit??(event.authored?.role==='reward'&&choice.grant?event.authored:undefined);
  checkAuthoredMeta(event,explicit);
  const protectedKeys=new Set((c.characterPromises??[]).flatMap(p=>[...promiseFactKeys(p),p.fulfillment?.fact].filter((x):x is string=>!!x)));
  const allowed=effective?.promiseId?authoredPromiseKeys((c.characterPromises??[]).find(x=>x.id===effective.promiseId)!,effective.action??''):new Set<string>();
  for(const branch of [choice,choice.check?.success,choice.check?.failure])for(const effect of branch?.effects??[])if(effect.type==='set_fact'&&protectedKeys.has(effect.key??'')&&!allowed.has(effect.key??''))throw new Error('Unauthorized promise fact write');
 };
 for(const event of c.events){
  checkAuthoredMeta(event,event.authored as ChoiceAuthored|undefined);
  for(const choice of event.choices??[])checkAuthored(event,choice);
  for(const phase of event.phases??[]){
   checkAuthoredMeta(event,phase.authored);
   for(const choice of phase.choices)checkAuthored(event,choice);
  }
 }
 for(const a of c.acts){if(a.bosses?.some(id=>!c.enemies.some(e=>e.id===id&&e.kind==='boss')))throw new Error('Broken boss pool');if(!c.enemies.some(e=>e.id===a.boss)||!c.events.some(e=>e.id===a.major))throw new Error('Broken act reference');}
 for(const e of c.endings)checkConditions(e.conditions);
}

export function playerStats(c:Content,s:RunState):Stats {
 const o=c.origins.find(x=>x.id===s.origin)!;const f=c.fates.find(x=>x.id===s.fate)!;const race=c.races.find(x=>x.id===s.race)!;const r={...o.stats};
 for(const k of STAT_KEYS)r[k]+=value(race.stats[k])+value(s.bonus[k])+value(f.stats?.[k])+value(c.rules.levelStats[k])*s.level;
 for(const t of c.talents.filter(t=>s.talents.includes(t.id)))for(const k of STAT_KEYS)r[k]+=value(t.stats[k]);
 for(const eq of s.slots)if(eq){const a=c.abilities.find(x=>x.id===eq.id)!;for(const k of STAT_KEYS)r[k]+=value(a.stats[k],eq.rank);}
 for(const k of STAT_KEYS)r[k]=Math.max(k==='hp'?1:0,Math.floor(r[k]*(100+value(f.percent?.[k]))/100));return r;
}

/** Build analysis is descriptive only: it explains the player's mechanism graph and grants no hidden school bonus. */
export function buildProfile(c:Content,s:RunState):BuildProfile {
 const equipped=s.slots.filter((x):x is Equipped=>!!x).map(eq=>({eq,a:c.abilities.find(x=>x.id===eq.id)!}));
 const tags=Object.fromEntries(MECHANIC_TAGS.map(t=>[t,0])) as Record<MechanicTag,number>,effects:Record<string,number>={},statuses:Record<string,number>={};
 for(const {a} of equipped){for(const tag of abilityMechanicTags(a))tags[tag]++;const all=[...a.effects,...(a.triggers??[]).flatMap(t=>t.effects??[])];for(const ef of all){effects[ef.type]=(effects[ef.type]??0)+1;if(ef.status)statuses[ef.status]=(statuses[ef.status]??0)+1;}}
 const dominant=(Object.entries(tags) as [MechanicTag,number][]).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,4).map(([k])=>k);
 const links:BuildLink[]=[];const add=(id:string,name:string,count:number,description:string)=>{if(count>0)links.push({id,name,count,description});};
 add('duration-burst','持续 → 爆发',Math.min(tags.duration,tags.burst),'持续效果先铺场，再由爆发动作收束伤害。');
 add('shield-counter','护盾 → 反击',Math.min(effects.gain_shield??0,tags.counter),'护盾提供安全窗口，反击把防守重新变成输出。');
 add('rage-chain','回气 → 连锁',Math.min(effects.gain_rage??0,tags.chain),'额外怒气缩短怒技循环，触发件继续放大行动收益。');
 add('consume-payoff','消耗 → 收束',Math.min(tags.consume,tags.burst+tags.chain),'主动吃掉已有资源或状态，换取更集中的收益。');
 add('heal-convert','回复 → 转化',Math.min(effects.heal??0,tags.convert),'回复不只用于续航，也可以成为命器或组件的输入资源。');
 const relicEq=s.slots.find((eq,i)=>eq&&SLOT_ORDER[i]==='relic'),relic=relicEq?c.abilities.find(a=>a.id===relicEq.id):undefined;
 const strategyEq=s.slots.find((eq,i)=>eq&&SLOT_ORDER[i]==='strategy'),strategy=strategyEq?c.abilities.find(a=>a.id===strategyEq.id):undefined;
 if(relic?.relicConversions?.length)for(const cv of relic.relicConversions)add('relic-'+cv.from+'-'+cv.to,`${cv.from} → ${cv.to}`,1,`${relic.name}把一种战斗结果转换为另一种资源或效果。`);
 const ranks=equipped.reduce((n,{eq})=>n+eq.rank,0),score=equipped.length*4+ranks*2+dominant.length*3+links.length*5;
 const strategyPlan=strategy?[...(strategy.strategyRules??[]).map(r=>r.label??`${r.action==='rage'?'怒技':'普攻'}条件`),strategy.defaultAction?`默认${strategy.defaultAction==='rage'?'怒技':'普攻'}`:''].filter(Boolean).join('；'):'';
 return {tags,dominant,effects,statuses,links,relic:{name:relic?.name??'命器未得',rank:relicEq?.rank??0,description:relic?.relicConversions?.length?'命器正在改变资源与效果之间的连接。':'命器位负责规则转换，不要求绑定任何预设流派。'},strategy:{name:strategy?.name??'未装配战策',description:strategy?`行动程序：${strategyPlan||'按可用行动择优执行'}。战策触发效果仍会随事件链生效。`:'战策位决定自动战斗如何行动。'},score};
}

const BUILD_ROLE_LABELS:Record<AbilityBuildRole,string>={starter:'启动件',core:'核心件',amplifier:'放大件',bridge:'桥接件',finisher:'终局件'};

/** Contextual role of an ability inside the current board. The same ability may change role after the board pivots. */
export function abilityRole(c:Content,s:RunState,a:Ability):AbilityRoleInfo {
 const b=buildProfile(c,s),slot=abilityLoadoutSlot(a),tags=abilityMechanicTags(a),tagWeight=(t:MechanicTag)=>['burst','multi','duration','counter','evade','control'].includes(t)?2:1,overlap=tags.reduce((n,t)=>n+(b.tags[t]?tagWeight(t):0),0),all=[...a.effects,...(a.triggers??[]).flatMap(t=>t.effects??[])],statusMatch=all.some(e=>e.status&&(b.statuses[e.status]??0)>0);
 let dependencyFit=0,deadDependency=0;const eventReady=(on:string)=>on==='on_heal'?(b.effects.heal??0)>0:on==='on_shield_gain'?(b.effects.gain_shield??0)>0:on==='on_status_tick'?(b.tags.duration??0)>0:on==='on_consume'?(b.tags.consume??0)>0:on==='on_evade'?(b.tags.evade??0)>0:on==='on_rage_skill'||on==='on_rage_spend'?!!s.slots[1]:on==='on_status_apply'?(b.effects.apply_status??0)>0:true;
 for(const t of a.triggers??[]){let ready=true;if(t.requiresTags?.length){const matches=t.requiresTags.filter(tag=>(b.tags[tag]??0)>0).length;ready=matches===t.requiresTags.length;dependencyFit+=ready?4+matches:-3;}else if(t.anyTags?.length){ready=t.anyTags.some(tag=>(b.tags[tag]??0)>0);dependencyFit+=ready?4:-2;}if(!eventReady(t.on)){ready=false;dependencyFit-=3;}else if(['on_heal','on_shield_gain','on_status_tick','on_consume','on_evade','on_rage_skill','on_rage_spend','on_status_apply'].includes(t.on))dependencyFit+=2;for(const q of t.conditions??[])if(q.type==='status_stack_at_least'||q.type==='has_status'){const exists=q.status==='shield'?(b.effects.gain_shield??0)>0:(b.statuses[q.status??'']??0)>0;dependencyFit+=exists?3:-4;if(!exists)ready=false;}if(!ready)deadDependency++;}
 for(const e of all){if(e.type==='consume_status'){const ready=(b.statuses[e.status??'']??0)>0;dependencyFit+=ready?3:-3;if(!ready)deadDependency++;}if(e.type==='consume_shield'){const ready=(b.effects.gain_shield??0)>0;dependencyFit+=ready?3:-3;if(!ready)deadDependency++;}if(e.type==='resource_damage'){const ready=e.resource==='shield'?(b.effects.gain_shield??0)>0:e.resource==='rage'?!!s.slots[1]:(b.statuses[e.resource??'']??0)>0;dependencyFit+=ready?3:-3;if(!ready)deadDependency++;}}
 const triggerMatch=dependencyFit>0;let role:AbilityBuildRole,reason:string;
 if(slot==='relic'){role='finisher';reason='命器改变资源或效果之间的连接，是整套构筑的规则转换器。';}
 else if(slot==='strategy'){role='finisher';reason='战策决定自动斗法的行动偏好，但不要求与某个预设流派同源。';}
 else if(slot==='basic'){role='starter';reason='唯一普攻槽，负责稳定启动每回合的基础循环。';}
 else if(slot==='rage'){role='core';reason='唯一怒技槽，承接资源循环并承担主要收束动作。';}
 else if(tags.includes('convert')||tags.includes('consume')||statusMatch||triggerMatch){role='bridge';reason=deadDependency?`它有 ${deadDependency} 个条件尚缺输入，但已能连接当前部分机制。`:'它能读取当前已有资源、状态或触发事件，把两段机制接成一条链。';}
 else if((a.triggers??[]).length||tags.includes('chain')){role='amplifier';reason='它通过被动触发放大已有行动，不占用角色主行动。';}
 else {role='core';reason=overlap?'它与当前机制有直接交集，可继续加深现有循环。':'它提供新的机制入口，适合主动转型而不是补齐预设配方。';}
 const fit=Math.max(-8,overlap+(statusMatch?3:0)+dependencyFit+(tags.includes('convert')?1:0)-deadDependency*2);
 return {role,label:BUILD_ROLE_LABELS[role],reason,fit};
}

function fighter(c:Content,s:RunState,enemy?:Enemy):Fighter {const stats=enemy?{...enemy.stats}:playerStats(c,s);if(enemy){const hpPct=c.rules.enemyHpPercentByAct?.[enemy.act]??100,atkPct=c.rules.enemyAttackPercentByAct?.[enemy.act]??100;stats.hp=Math.max(1,Math.floor(stats.hp*hpPct/100));stats.attack=Math.max(1,Math.floor(stats.attack*atkPct/100));}return {name:enemy?.name??s.name,stats,hp:enemy?stats.hp:Math.min(s.hp,stats.hp),rage:0,shield:0,status:{},abilities:enemy?enemy.abilities.map(id=>({id,rank:0})):clone(s.slots.filter((x):x is Equipped=>!!x)),fate:enemy?undefined:c.fates.find(x=>x.id===s.fate),used:[],tags:enemy?.tags??[c.origins.find(x=>x.id===s.origin)!.affinity],cooldown:{},phase:0};}

function promiseStateForCondition(c:Content,s:RunState,key:string|undefined):CharacterPromiseState|undefined {
 if(!key)return undefined;
 const direct=s.promises?.[key];if(direct)return direct;
 const def=promiseDefinitions(c).find(x=>x.relationKey===key);
 return def?s.promises?.[def.id]:undefined;
}
function promiseConditionValues(q:Condition):string[] {
 const raw=(q as Condition&{statuses?:unknown}).statuses??q.status??q.text??q.value;
 const values=Array.isArray(raw)?raw:[raw];
 return values.filter(x=>x!==undefined&&x!==null).flatMap(x=>String(x).split('|')).map(x=>x.trim()).filter(Boolean);
}
function promiseConditionUnaccepted(value:string):boolean {
 return ['none','missing','unaccepted','not_accepted','not_started'].includes(value.toLowerCase());
}
function promiseConditionOK(c:Content,s:RunState,q:Condition):boolean {
 const state=promiseStateForCondition(c,s,q.key),wanted=promiseConditionValues(q);
 if(!state)return wanted.some(promiseConditionUnaccepted);
 if(!wanted.length)return true;
 return wanted.some(value=>!promiseConditionUnaccepted(value)&&value===state.status);
}

export function conditionOK(c:Content,s:RunState,q:Condition,self?:Fighter,enemy?:Fighter):boolean {
 const who=q.target==='enemy'?enemy:self;const hp=who?.hp??s.hp,max=who?.stats.hp??playerStats(c,s).hp;const n=q.status==='shield'?(who?.shield??0):(who?.status[q.status??'']??0);
 switch(q.type){case 'has_talent':return s.talents.includes(q.key??'');case 'race_is':return s.race===q.key;case 'hp_below':return hp*100<max*(q.value??0);case 'hp_above':return hp*100>max*(q.value??0);case 'hp_above_absolute':return hp>(q.value??0);case 'has_status':return n>0;case 'status_stack_at_least':return n>=(q.value??1);case 'rage_at_least':return (who?.rage??0)>=(q.value??0);case 'has_fact':return !!s.facts[q.key??''];case 'counter_at_least':return (s.counters[q.key??'']??0)>=(q.value??0);case 'currency_at_least':return s.gold>=(q.value??0);case 'act_is':return s.act===(q.value??0);case 'enemy_tag':return !!enemy?.tags.includes(q.tag??'');case 'player_tag':return !!self?.tags.includes(q.tag??'');case 'thread_is':return s.threads[q.key??'']===q.text;case 'event_seen':return (s.seenEvents[q.key??'']??0)>=(q.value??1);case 'stat_at_least':return playerStats(c,s)[q.stat??'luck']>=(q.value??0);case 'promise_state':return promiseConditionOK(c,s,q);case 'promise_reward_available':{const state=promiseStateForCondition(c,s,q.key);return !!state&&state.status==='fulfilled'&&!state.finalRewardOffered;}default:throw new Error('Unsupported condition: '+q.type);}
}

/** Resolve once, then replay snapshots. Playback speed can never alter the result. */
export function simulateBattle(c:Content,s:RunState,enemy:Enemy):Battle {
 const p=fighter(c,s),e=fighter(c,s,enemy),frames:Frame[]=[];let round=0,eventBudget=0,objectiveProgress=0,objectiveWon=false;
 const build=buildProfile(c,s),relicEq=s.slots.find((eq,i)=>eq&&SLOT_ORDER[i]==='relic'),relic=relicEq?c.abilities.find(a=>a.id===relicEq.id):undefined,strategyEq=s.slots.find((eq,i)=>eq&&SLOT_ORDER[i]==='strategy'),strategy=strategyEq?c.abilities.find(a=>a.id===strategyEq.id):undefined;
 const objective:BattleObjective=clone(enemy.objective??{type:'kill',label:'击败敌人'});const summary:BattleSummary={playerDamage:0,enemyDamage:0,playerShieldAbsorbed:0,enemyShieldAbsorbed:0,playerCrits:0,enemyCrits:0,playerMisses:0,enemyMisses:0,playerRageSkills:0,enemyRageSkills:0,playerConversions:0,enemyConversions:0,statusTicks:0,phaseChanges:0,contributions:{}};
 const side=(f:Fighter)=>f===p?'p':f===e?'e':'system';
 const actorSide=(f:Fighter):'p'|'e'=>f===p?'p':'e';
 const emptyResourceTotals=():BattleDiagnosticResourceTotals=>({produced:0,consumed:0,read:0,reads:0,maxRead:0,zeroNet:0});
 const emptyActionSide=():BattleDiagnosticActionSide=>({attempts:0,selected:0,waits:0,blocked:{},bySource:{},strategy:{decisions:0,byReason:{}}});
 const emptyLossTotals=():BattleDiagnosticLossTotals=>({total:0,byCategory:{},byRound:{},bySource:{}});
 const diagnostics:BattleDiagnostics={
  schemaVersion:1,
  sources:[],
  events:{},
  triggers:{},
  links:[],
  resources:{},
  actions:{p:emptyActionSide(),e:emptyActionSide()},
  conversions:{attempts:0,converted:0,unattempted:0,bySource:{}},
  losses:{total:0,byCategory:{},byRound:{},player:emptyLossTotals(),enemy:emptyLossTotals()}
 };
 const frame=(actor:Fighter|undefined,kind:string,label:string,amount=0,crit=false,meta:Partial<Frame>={})=>frames.push({round,actor:actor?side(actor):'system',kind,label,amount,crit,p:clone(p),e:clone(e),...meta});
 const contribution=(sourceId?:string)=>{if(!sourceId)return undefined;return summary.contributions[sourceId]??={damage:0,heal:0,shield:0,rage:0,conversions:0,triggers:0};};
 const asAmount=(n:number)=>Number.isFinite(n)?Math.max(0,Math.floor(n)):0;
 const resourceTotals=(resource:string,actor:'p'|'e',sourceId?:string)=>{
  const d=diagnostics.resources[resource]??=Object.assign(emptyResourceTotals(),{byActor:{p:emptyResourceTotals(),e:emptyResourceTotals()},bySource:{}});
  const sourceKey=`${actor}:${sourceId??'system'}`;
  const source=d.bySource[sourceKey]??=emptyResourceTotals();
  return {d,actor:d.byActor[actor],source};
 };
 const recordResourceRead=(resource:string,amount:number,holder:Fighter,sourceId?:string)=>{
  const n=asAmount(amount),parts=resourceTotals(resource,actorSide(holder),sourceId);
  for(const bucket of [parts.d,parts.actor,parts.source]){bucket.read+=n;bucket.reads++;bucket.maxRead=Math.max(bucket.maxRead,n);}
 };
 const recordResourceChange=(resource:string,field:'produced'|'consumed',amount:number,attempted:number,holder:Fighter,sourceId?:string)=>{
  const n=asAmount(amount),wanted=asAmount(attempted),parts=resourceTotals(resource,actorSide(holder),sourceId);
  for(const bucket of [parts.d,parts.actor,parts.source]){
   bucket[field]+=n;
   if(wanted>0&&n<=0)bucket.zeroNet++;
  }
 };
 const recordLoss=(target:Fighter,category:string,amount:number,sourceId?:string)=>{
  const n=asAmount(amount);if(n<=0)return;
  const totals=target===p?diagnostics.losses.player:diagnostics.losses.enemy,roundKey=String(Math.max(0,Math.min(round,c.rules.maxRounds)));
  totals.total+=n;totals.byCategory[category]=(totals.byCategory[category]??0)+n;totals.byRound[roundKey]=(totals.byRound[roundKey]??0)+n;if(sourceId)totals.bySource[sourceId]=(totals.bySource[sourceId]??0)+n;
  if(target===p){diagnostics.losses.total+=n;diagnostics.losses.byCategory[category]=(diagnostics.losses.byCategory[category]??0)+n;diagnostics.losses.byRound[roundKey]=(diagnostics.losses.byRound[roundKey]??0)+n;}
 };
 const stat=(f:Fighter,k:Stat)=>k==='attack'?Math.max(1,Math.floor(f.stats.attack*(f.status.weak?100-c.rules.weakPercent:100)/100)):k==='defense'?Math.max(0,f.stats.defense-(f.status.break??0)*c.rules.breakDefense):f.stats[k];
 const changeRage=(f:Fighter,n:number,sourceId?:string)=>{
  const before=f.rage;f.rage=clamp(f.rage+n,0,c.rules.rageMax);const delta=f.rage-before;
  if(delta>0)recordResourceChange('rage','produced',delta,Math.max(0,n),f,sourceId);else if(delta<0)recordResourceChange('rage','consumed',-delta,Math.max(0,-n),f,sourceId);else if(n!==0)recordResourceChange('rage',n>0?'produced':'consumed',0,Math.abs(n),f,sourceId);
 };
 const origin=c.origins.find(o=>o.id===s.origin);
 type TriggerItem={id:string;sourceId:string;rank:number;triggers:Trigger[];kind:string;name:string};
 const triggerItems=(a:Fighter):TriggerItem[]=>{
  const items:TriggerItem[]=a.abilities.map(eq=>{const source=c.abilities.find(x=>x.id===eq.id)!;return {id:eq.id,sourceId:eq.id,rank:eq.rank,triggers:source.triggers??[],kind:'ability',name:source.name};});
  if(a.fate)items.push({id:'fate',sourceId:`fate.${s.fate}`,rank:0,triggers:a.fate.triggers??[],kind:'fate',name:a.fate.name});
  if(a===p){
   const race=c.races.find(r=>r.id===s.race)!;
   items.push({id:`race.${s.race}`,sourceId:`race.${s.race}`,rank:0,triggers:race.triggers??[],kind:'race',name:race.trait});
   for(const talent of c.talents.filter(t=>s.talents.includes(t.id)))items.push({id:talent.id,sourceId:talent.id,rank:0,triggers:talent.triggers??[],kind:'talent',name:talent.name});
  }
  return items;
 };
 const sourceKeys=new Set<string>();
 const registerSource=(actor:'p'|'e',id:string,kind:string,name:string)=>{
  const key=`${actor}:${id}`;if(sourceKeys.has(key))return;sourceKeys.add(key);diagnostics.sources.push({actor,id,kind,name});
 };
 const triggerKey=(a:Fighter,item:TriggerItem,index:number)=>`${actorSide(a)}:${item.sourceId}:${index}`;
 const ensureTrigger=(a:Fighter,item:TriggerItem,index:number,t:Trigger):BattleDiagnosticTrigger=>{
  const key=triggerKey(a,item,index);
  return diagnostics.triggers[key]??={
   actor:actorSide(a),sourceId:item.sourceId,triggerIndex:index,on:t.on,attempts:0,fired:0,blocked:{},actual:{},required:{},observations:{},reads:{},zeroNet:0
  };
 };
 type DiagnosticEventSource={actor:'p'|'e'|'system';id:string;kind:string};
 const eventSource=(actor:'p'|'e'|'system',id:string,kind='event'):DiagnosticEventSource=>({actor,id,kind});
 const linkKeys=new Map<string,BattleDiagnosticLink>();
 const ensureLink=(source:DiagnosticEventSource,on:string,target:Fighter,item:TriggerItem,index:number):BattleDiagnosticLink=>{
  const targetActor=actorSide(target),key=`${source.actor}:${source.id}:${on}->${targetActor}:${item.sourceId}:${index}`;
  const existing=linkKeys.get(key);if(existing)return existing;
  const link:BattleDiagnosticLink={sourceActor:source.actor,sourceId:source.id,event:on,targetActor,targetId:item.sourceId,targetSourceId:item.sourceId,triggerIndex:index,arrivals:0,attempts:0,fired:0,blocked:{},zeroNet:0};
  linkKeys.set(key,link);diagnostics.links.push(link);return link;
 };
 const blockLink=(link:BattleDiagnosticLink,reason:string)=>{
  link.blocked[reason]=(link.blocked[reason]??0)+1;if(!link.firstBlocked)link.firstBlocked=reason;
 };
 const blockTrigger=(d:BattleDiagnosticTrigger,reason:string,link?:BattleDiagnosticLink)=>{
  d.blocked[reason]=(d.blocked[reason]??0)+1;if(!d.firstBlocked)d.firstBlocked=reason;
  if(link)blockLink(link,reason);
 };
 const observeCondition=(d:BattleDiagnosticTrigger,q:Condition,a:Fighter,b:Fighter)=>{
  const who=q.target==='enemy'?b:a;
  let key:string|undefined,actual:number|undefined,required:number|undefined,resource:string|undefined;
  const statusValue=q.status==='shield'?(who.shield??0):(who.status[q.status??'']??0);
  switch(q.type){
   case 'has_status':key=q.status==='shield'?'shield':q.status??'status';actual=statusValue;required=1;resource=key;break;
   case 'status_stack_at_least':key=q.status==='shield'?'shield':q.status??'status';actual=statusValue;required=q.value??1;resource=key;break;
   case 'rage_at_least':key='rage';actual=who.rage;required=q.value??0;resource='rage';break;
   case 'hp_below':
   case 'hp_above':key='hp';actual=who.stats.hp?Math.floor(who.hp*100/who.stats.hp):0;required=q.value??0;resource='hp';break;
   case 'hp_above_absolute':key='hp';actual=who.hp;required=q.value??0;resource='hp';break;
   case 'counter_at_least':key=`counter:${q.key??''}`;actual=s.counters[q.key??'']??0;required=q.value??0;break;
   case 'currency_at_least':key='currency';actual=s.gold;required=q.value??0;break;
   case 'stat_at_least':key=`stat:${q.stat??'luck'}`;actual=playerStats(c,s)[q.stat??'luck'];required=q.value??0;break;
   case 'event_seen':key=`event:${q.key??''}`;actual=s.seenEvents[q.key??'']??0;required=q.value??1;break;
   case 'enemy_tag':key=`tag:${q.tag??''}`;actual=enemy.tags.includes(q.tag??'')?1:0;required=1;break;
   case 'player_tag':key=`tag:${q.tag??''}`;actual=a.tags.includes(q.tag??'')?1:0;required=1;break;
   case 'has_talent':key=`talent:${q.key??''}`;actual=s.talents.includes(q.key??'')?1:0;required=1;break;
   case 'has_fact':key=`fact:${q.key??''}`;actual=s.facts[q.key??'']?1:0;required=1;break;
   case 'act_is':key='act';actual=s.act;required=q.value??0;break;
   case 'race_is':key='race';actual=s.race===q.key?1:0;required=1;break;
   case 'thread_is':key=`thread:${q.key??''}`;actual=s.threads[q.key??'']===q.text?1:0;required=1;break;
  }
  if(actual===undefined||required===undefined)return;
  if(resource)recordResourceRead(resource,actual,who,d.sourceId);
  const observation=d.observations[key??q.type]??={actual,required,count:0,lastActual:actual};
  observation.count++;observation.lastActual=actual;observation.actual=Math.max(observation.actual,actual);observation.required=required;
  d.actual[key??q.type]=Math.max(d.actual[key??q.type]??0,actual);d.required[key??q.type]=required;
  d.reads[key??q.type]=d.reads[key??q.type]??{count:0,total:0,max:0};d.reads[key??q.type].count++;d.reads[key??q.type].total+=actual;d.reads[key??q.type].max=Math.max(d.reads[key??q.type].max,actual);
 };
 const conditionReason=(q:Condition):string=>{
  if(['has_status','status_stack_at_least'].includes(q.type))return 'missing_status';
  if(['hp_below','hp_above','hp_above_absolute','rage_at_least','counter_at_least','currency_at_least','stat_at_least','event_seen','act_is'].includes(q.type))return 'below_threshold';
  if(['enemy_tag','player_tag'].includes(q.type))return 'missing_tag';
  return 'condition_failed';
 };
 for(const actor of [p,e])for(const item of triggerItems(actor)){
  registerSource(actorSide(actor),item.sourceId,item.kind,item.name);
  for(let index=0;index<item.triggers.length;index++)ensureTrigger(actor,item,index,item.triggers[index]);
 }
 if(origin)registerSource('p',`origin.${origin.id}`,'origin',origin.name);
 const stream=(f:Fighter,kind:string)=>`combat.${f===p?'p':'e'}.${kind}`;
 type ChainContext={depth:number;visited:Set<string>;converted:boolean;tags:Set<MechanicTag>};const root=(tags:MechanicTag[]=[]):ChainContext=>({depth:0,visited:new Set(),converted:false,tags:new Set(tags)});const child=(ctx:ChainContext,key?:string,converted=ctx.converted,tags:Iterable<MechanicTag>=ctx.tags):ChainContext=>({depth:ctx.depth+1,visited:new Set(key?[...ctx.visited,key]:ctx.visited),converted,tags:new Set(tags)});
 const conversionNames:Record<ConversionTarget,string>={damage:'伤害',heal:'回复',shield:'护盾',rage:'怒气'},eventNames:Record<ConversionEvent,string>={damage:'造成伤害',damage_taken:'承受伤害',heal:'实际回复',shield_gain:'获得护盾',rage_spend:'消耗怒气',status_tick:'持续结算',status_consume:'状态消耗'};
 const conversionKey=(relicId:string,index:number)=>`p:${relicId}:${index}`;
 const ensureConversion=(index:number,cv:RelicConversion):BattleDiagnosticConversion=>{
  const key=conversionKey(relic!.id,index);
  return diagnostics.conversions.bySource[key]??=({actor:'p',sourceId:relic!.id,index,from:cv.from,to:cv.to,attempts:0,converted:0,input:0,output:0,blocked:{},zeroOutput:0,unattempted:0});
 };
 if(relic)for(let index=0;index<(relic.relicConversions??[]).length;index++)ensureConversion(index,relic.relicConversions![index]);
 const combatState=(f:Fighter)=>JSON.stringify({hp:f.hp,shield:f.shield,rage:f.rage,status:f.status,stats:f.stats});
 function runRelicConversion(owner:Fighter,other:Fighter,from:ConversionEvent,amount:number,ctx:ChainContext,status?:string){
  if(owner!==p||!relic||!relicEq)return;
  for(let i=0;i<(relic.relicConversions??[]).length;i++){
   const cv=relic.relicConversions![i],key=`relic:${relic.id}:${i}`;
   if(cv.from!==from||cv.status&&cv.status!==status)continue;
   const conversion=ensureConversion(i,cv),block=(reason:string)=>{conversion.blocked[reason]=(conversion.blocked[reason]??0)+1;if(!conversion.lastBlocked)conversion.lastBlocked=reason;};
   conversion.attempts++;diagnostics.conversions.attempts++;
   if(ctx.converted){block('converted_chain');continue;}
   if(ctx.depth>=8){block('depth_limit');continue;}
   if(ctx.visited.has(key)){block('visited');continue;}
   if(amount<=0){block('no_input');continue;}
   const input=Math.min(amount,cv.cap??amount),out=Math.floor(input*value(cv.percent,relicEq.rank)/100);
   conversion.input+=asAmount(input);
   if(out<=0){conversion.zeroOutput++;block('zero_output');continue;}
   conversion.converted++;conversion.output+=asAmount(out);diagnostics.conversions.converted++;
   summary.playerConversions++;
   const rc=contribution(relic.id);if(rc)rc.conversions++;
   const relicTags=new Set<MechanicTag>([...abilityMechanicTags(relic),'convert']),next=child(ctx,key,true,relicTags),label=cv.label??relic.name,beforeOwner=combatState(owner),beforeOther=combatState(other),source=eventSource('p',relic.id,'conversion');
   if(cv.to==='damage'&&other.hp>0)apply(owner,other,{type:'damage',value:out,pure:true},relicEq.rank,label,true,relic.id,next,source);
   else if(cv.to==='heal')apply(owner,other,{type:'heal',target:'self',value:out},relicEq.rank,label,true,relic.id,next,source);
   else if(cv.to==='shield')apply(owner,other,{type:'gain_shield',target:'self',value:out},relicEq.rank,label,true,relic.id,next,source);
   else if(cv.to==='rage')apply(owner,other,{type:'gain_rage',target:'self',value:out},relicEq.rank,label,true,relic.id,next,source);
   if(beforeOwner===combatState(owner)&&beforeOther===combatState(other)){conversion.zeroOutput++;block('zero_output');}
   frame(owner,'convert',label,out,false,{sourceId:relic.id,tags:[...relicTags],detail:`${eventNames[from]} ${input} → ${conversionNames[cv.to]} ${out}`});
  }
 }
 const lossCategory=(attacker:Fighter,target:Fighter,sourceId?:string,label?:string)=>{
  if(attacker===target)return 'self';
  if(sourceId?.startsWith('status.')||label==='燃烧')return 'persistent';
  if(attacker===e&&target===p)return 'enemy_attack';
  if(attacker===p&&target===e)return 'player_attack';
  return 'other';
 };
 function hurt(a:Fighter,b:Fighter,n:number,label:string,crit=false,breakdown?:CombatBreakdown,sourceId?:string,ctx:ChainContext=root(),source?:DiagnosticEventSource):number {
  n=Math.max(1,Math.floor(n));const shieldBefore=b.shield;const absorbed=Math.min(b.shield,n);b.shield-=absorbed;const hpLoss=Math.max(0,n-absorbed);b.hp=Math.max(0,b.hp-hpLoss);
  recordResourceRead('shield',shieldBefore,b,sourceId);if(absorbed>0)recordResourceChange('shield','consumed',absorbed,absorbed,b,sourceId);if(hpLoss>0)recordLoss(b,lossCategory(a,b,sourceId,label),hpLoss,sourceId);
  if(b===p){if(a!==p)summary.enemyDamage+=hpLoss;summary.playerShieldAbsorbed+=absorbed;}else if(b===e){if(a===p){summary.playerDamage+=hpLoss;const cc=contribution(sourceId);if(cc)cc.damage+=hpLoss;}summary.enemyShieldAbsorbed+=absorbed;if(a===p)objectiveProgress+=hpLoss+absorbed;}if(breakdown){breakdown.absorbed=absorbed;breakdown.hpLoss=hpLoss;}
  frame(a,'damage',label,hpLoss,crit,{sourceId,tags:[...ctx.tags],breakdown,detail:absorbed?`护盾吸收 ${absorbed}`:undefined});if(a===p&&b===e&&hpLoss>0)runRelicConversion(p,e,'damage',hpLoss,ctx);if(b===p&&a!==p&&hpLoss>0)runRelicConversion(p,a,'damage_taken',hpLoss,ctx);if(a!==b&&a.hp>0&&hpLoss+absorbed>0)trigger(a,b,'on_damage',ctx,source??eventSource(actorSide(a),sourceId??'system.damage'));
  if(objective.type==='break'&&objectiveProgress>=(objective.value??1))objectiveWon=true;if(b===e)checkBossPhase();return hpLoss;
 }
 function apply(a:Fighter,b:Fighter,ef:Effect,rank:number,label:string,secondary=false,sourceId?:string,ctx:ChainContext=root(),source?:DiagnosticEventSource){
  if(++eventBudget>768)throw new Error('Combat effect budget exceeded');
  const t=ef.target==='self'?a:b;let n=value(ef.value,rank);
  switch(ef.type){
   case 'damage':{
    const base=n,scaled=base+Math.floor(stat(a,ef.stat??'attack')*value(ef.coefficient,rank)/100)+Math.floor(t.stats.hp*(ef.maxHpPercent??0)/100),afterDefense=ef.pure?Math.max(1,scaled):Math.max(1,scaled-stat(t,'defense')),afterVulnerable=t.status.vulnerable?Math.floor(afterDefense*(100+c.rules.vulnerablePercent)/100):afterDefense;
    let afterBuild=afterVulnerable,crit=false;
    if(t!==a&&!secondary){
     const hit=clamp(9500+a.stats.hit*50-t.stats.dodge*50,6000,10000);
     if(random(s,stream(a,'hit'))*10000>=hit){
      if(a===p)summary.playerMisses++;else summary.enemyMisses++;
      frame(a,'miss',label,0,false,{sourceId,tags:[...ctx.tags],detail:`命中率 ${(hit/100).toFixed(1)}%`});
      if(t.hp>0)trigger(t,a,'on_evade',ctx,source??eventSource(actorSide(a),sourceId??'system.damage'));
      return false;
     }
     crit=random(s,stream(a,'crit'))*10000<Math.min(5000,500+a.stats.luck*30);
     if(crit){afterBuild=Math.floor(afterBuild*150/100);if(a===p)summary.playerCrits++;else summary.enemyCrits++;}
    }
    let afterCrit=afterBuild;
    if(a.fate?.damageByRound&&t!==a)afterCrit=Math.floor(afterCrit*a.fate.damageByRound[Math.min(Math.max(round-1,0),a.fate.damageByRound.length-1)]/100);
    const breakdown:CombatBreakdown={base,scaled,afterDefense,afterVulnerable,afterBuild,afterCrit,absorbed:0,hpLoss:0};
    hurt(a,t,afterCrit,label,crit,breakdown,sourceId,ctx,source??eventSource(actorSide(a),sourceId??'system.damage'));
    if(crit&&a.hp>0)trigger(a,t,'on_crit',ctx,source??eventSource(actorSide(a),sourceId??'system.damage'));
    return true;
   }
   case 'resource_damage':{
    const holder=ef.resourceTarget==='self'?a:b,key=ef.resource!,raw=key==='shield'?holder.shield:key==='rage'?holder.rage:(holder.status[key]??0);
    recordResourceRead(key,raw,holder,sourceId);
    const units=Math.min(Math.max(0,raw),Math.max(0,ef.cap??9999)),per=value(ef.coefficient,rank);
    if(units<=0||per<=0)break;
    return apply(a,b,{type:'damage',target:ef.target,coefficient:units*per,stat:ef.stat??'attack',pure:ef.pure},rank,label,true,sourceId,ctx,source);
   }
   case 'heal':{
    const before=t.hp,amount=n+Math.floor(t.stats.hp*(ef.maxHpPercent??0)/100);
    t.hp=Math.min(t.stats.hp,t.hp+amount);
    const healed=t.hp-before;
    recordResourceChange('hp','produced',healed,amount,t,sourceId);
    if(healed>0){
     if(t===p){const cc=contribution(sourceId);if(cc)cc.heal+=healed;}
     frame(a,'heal',label,healed,false,{sourceId,tags:[...ctx.tags]});
     if(t===p)runRelicConversion(p,t===a?b:a,'heal',healed,ctx);
     trigger(t,t===p?e:p,'on_heal',ctx,source??eventSource(actorSide(a),sourceId??'system.heal'));
    }
    break;
   }
   case 'gain_shield':{
    const before=t.shield,gain=n+Math.floor(stat(a,ef.stat??'defense')*value(ef.coefficient,rank)/100);
    t.shield=Math.min(9999,t.shield+gain);
    const gained=t.shield-before;
    recordResourceChange('shield','produced',gained,gain,t,sourceId);
    if(gained>0){
     if(t===p){const cc=contribution(sourceId);if(cc)cc.shield+=gained;}
     if(t===p)runRelicConversion(p,t===a?b:a,'shield_gain',gained,ctx);
     trigger(t,t===a?b:a,'on_shield_gain',ctx,source??eventSource(actorSide(a),sourceId??'system.shield'));
    }
    break;
   }
   case 'gain_rage':{
    const before=t.rage;changeRage(t,n,sourceId);
    if(t===p){const cc=contribution(sourceId);if(cc)cc.rage+=Math.max(0,t.rage-before);}
    break;
   }
   case 'lose_rage':changeRage(t,-n,sourceId);break;
   case 'consume_status':{
    const key=ef.status!,before=t.status[key]??0;
    recordResourceRead(key,before,t,sourceId);
    const spent=Math.min(before,Math.max(0,n));t.status[key]=Math.max(0,before-spent);
    recordResourceChange(key,'consumed',spent,n,t,sourceId);
    if(spent>0){
     if(a===p){summary.playerConversions++;const cc=contribution(sourceId);if(cc)cc.conversions++;}else summary.enemyConversions++;
     const resource=key==='burn'?'燃烧':key==='break'?'破甲':key;
     frame(a,'convert',label,0,false,{sourceId,tags:[...ctx.tags],detail:`炼化 ${spent} 层${resource}`});
     if(a===p)runRelicConversion(p,b,'status_consume',spent,ctx,key);
     trigger(a,b,'on_consume',ctx,source??eventSource(actorSide(a),sourceId??'system.consume'));
    }
    break;
   }
   case 'consume_shield':{
    const before=t.shield;recordResourceRead('shield',before,t,sourceId);
    const spent=Math.min(t.shield,Math.max(0,n));t.shield=Math.max(0,t.shield-spent);
    recordResourceChange('shield','consumed',spent,n,t,sourceId);
    if(spent>0){
     if(a===p){summary.playerConversions++;const cc=contribution(sourceId);if(cc)cc.conversions++;}else summary.enemyConversions++;
     frame(a,'convert',label,0,false,{sourceId,tags:[...ctx.tags],detail:`炼化 ${spent} 护盾`});
     if(a===p)runRelicConversion(p,b,'status_consume',spent,ctx,'shield');
     trigger(a,b,'on_consume',ctx,source??eventSource(actorSide(a),sourceId??'system.consume_shield'));
    }
    break;
   }
   case 'apply_status':{
    const key=ef.status!,before=t.status[key]??0;
    t.status[key]=clamp(before+n,0,ef.status==='stun'?1:20);
    const gained=Math.max(0,t.status[key]-before);
    recordResourceChange(key,'produced',gained,n,t,sourceId);
    if(n>0)trigger(a,b,'on_status_apply',ctx,source??eventSource(actorSide(a),sourceId??'system.status'));
    break;
   }
   case 'remove_status':{
    const key=ef.status!,before=t.status[key]??0;delete t.status[key];
    recordResourceChange(key,'consumed',before,before,t,sourceId);
    break;
   }
   case 'modify_stat':{
    const k=ef.stat!;t.stats[k]=Math.max(k==='hp'?1:0,Math.floor(t.stats[k]*(100+value(ef.percent,rank))/100)+n);if(k==='hp')t.hp=Math.min(t.hp,t.stats.hp);
    break;
   }
   default:throw new Error('Non-combat effect in combat: '+ef.type);
  }
  return true;
 }
 function checkBossPhase(){const phases=enemy.phases??[];while(e.phase<phases.length&&e.hp*100<=e.stats.hp*phases[e.phase].hpPercent){const ph=phases[e.phase++];summary.phaseChanges++;frame(undefined,'phase',ph.label,0,false,{phase:e.phase,detail:`生命降至 ${ph.hpPercent}% 阈值`});for(const ef of ph.effects??[])apply(e,p,ef,0,ph.label,true,'boss.phase');}}
 function trigger(a:Fighter,b:Fighter,on:string,ctx:ChainContext=root(),source:DiagnosticEventSource=eventSource('system',`system.${on}`,'system')){
  const arrivals=diagnostics.events[on]??={arrivals:0};arrivals.arrivals++;
  if(a.hp<=0||ctx.depth>=8)return;
  const list=triggerItems(a);
  for(const item of list)for(let i=0;i<item.triggers.length;i++){
   const t=item.triggers[i],key=`trigger:${item.id}:${i}`,quota=`quota:${item.id}:${i}:${round}:`,used=a.used.filter(x=>x.startsWith(quota)).length,has=(tag:MechanicTag)=>ctx.tags.has(tag),diagnostic=ensureTrigger(a,item,i,t);
   if(t.on!==on)continue;
   const link=ensureLink(source,on,a,item,i);
   diagnostic.attempts++;
   link.arrivals++;link.attempts++;
   if(ctx.visited.has(key)){blockTrigger(diagnostic,'visited',link);continue;}
   if(t.requiresTags?.find(tag=>!has(tag))){blockTrigger(diagnostic,'missing_tag',link);continue;}
   if(t.anyTags?.length&&!t.anyTags.some(has)){blockTrigger(diagnostic,'missing_tag',link);continue;}
   if(t.excludeTags?.some(has)){blockTrigger(diagnostic,'excluded_tag',link);continue;}
   if(t.maxPerRound!==undefined&&used>=t.maxPerRound){blockTrigger(diagnostic,'quota',link);continue;}
   if(t.once&&a.used.includes(key)){blockTrigger(diagnostic,'quota',link);continue;}
   let conditionsPass=true;
   for(const condition of t.conditions??[]){
    const passed=conditionOK(c,s,condition,a,b);
    observeCondition(diagnostic,condition,a,b);
    if(!passed){blockTrigger(diagnostic,conditionReason(condition),link);conditionsPass=false;break;}
   }
   if(!conditionsPass)continue;
   if(t.chance!==undefined&&random(s,stream(a,'trigger.'+on))*100>=t.chance){blockTrigger(diagnostic,'chance_failed',link);continue;}
   diagnostic.fired++;
   link.fired++;
   if(t.once)a.used.push(key);
   if(t.maxPerRound!==undefined)a.used.push(quota+used);
   if(a===p){const cc=contribution(item.id);if(cc)cc.triggers++;}
   const abilitySource=c.abilities.find(x=>x.id===item.id),sourceTags=abilitySource?abilityMechanicTags(abilitySource):[],next=child(ctx,key,ctx.converted,sourceTags.length?sourceTags:ctx.tags),beforeA=combatState(a),beforeB=combatState(b),triggerSource=eventSource(actorSide(a),item.sourceId,'trigger');
   for(const effect of t.effects){
    if(b.hp<=0&&effect.target!=='self')continue;
    apply(a,b,effect,item.rank,abilitySource?.name??c.talents.find(x=>x.id===item.id)?.name??(item.id.startsWith('race.')?c.races.find(r=>r.id===s.race)!.trait:a.fate?.name)??on,true,item.id,next,triggerSource);
   }
   if(beforeA===combatState(a)&&beforeB===combatState(b)){diagnostic.zeroNet++;link.zeroNet++;}
   if(item.id.startsWith('talent.')||item.id.startsWith('race.'))frame(a,item.id.startsWith('talent.')?'talent':'ancestry',c.talents.find(t=>t.id===item.id)?.name??c.races.find(r=>r.id===s.race)!.trait,0,false,{sourceId:item.id,tags:[...next.tags]});
  }
 }
 function legalActions(a:Fighter){return a.abilities.map(eq=>({eq,ability:c.abilities.find(x=>x.id===eq.id)!})).filter(x=>['basic','rage'].includes(x.ability.slot)&&(a.cooldown[x.ability.id]??0)<=0&&(x.ability.slot!=='rage'||a.rage>=x.ability.cost));}
 function actionScore(x:{eq:Equipped;ability:Ability}){const hit=x.ability.effects.find(e=>e.type==='damage');return (x.ability.priority??0)+(x.ability.slot==='rage'?200:0)+value(hit?.coefficient,x.eq.rank)+value(hit?.value,x.eq.rank);}
 const observeActionAvailability=(a:Fighter)=>{
  const summary=diagnostics.actions[actorSide(a)];
  for(const eq of a.abilities){
   const ability=c.abilities.find(x=>x.id===eq.id)!;
   if(!['basic','rage'].includes(ability.slot))continue;
   const source=summary.bySource[eq.id]??=({offered:0,available:0,selected:0,blocked:{}});
   source.offered++;
   if((a.cooldown[ability.id]??0)>0){source.blocked.cooldown=(source.blocked.cooldown??0)+1;summary.blocked.cooldown=(summary.blocked.cooldown??0)+1;continue;}
   if(ability.slot==='rage'&&a.rage<ability.cost){source.blocked.rage=(source.blocked.rage??0)+1;summary.blocked.rage=(summary.blocked.rage??0)+1;continue;}
   source.available++;
  }
 };
 const recordActionSelection=(a:Fighter,picked:{eq:Equipped;ability:Ability}|undefined)=>{
  const summary=diagnostics.actions[actorSide(a)];
  if(!picked){summary.waits++;return;}
  summary.selected++;
  const source=summary.bySource[picked.eq.id]??=({offered:0,available:0,selected:0,blocked:{}});
  source.selected++;
  if(a===p&&strategyDecision){summary.strategy.decisions++;const key=strategyDecision.slice(0,96);summary.strategy.byReason[key]=(summary.strategy.byReason[key]??0)+1;}
 };
 let strategyDecision='';
 function chooseAction(a:Fighter,b:Fighter){
  const summary=diagnostics.actions[actorSide(a)];summary.attempts++;const all=legalActions(a);observeActionAvailability(a);strategyDecision='';
  if(!all.length)return undefined;
  if(a===p&&strategy){
   const holdKey=`strategy-hold:${strategy.id}`,clearHold=()=>{a.used=a.used.filter(x=>x!==holdKey);};
   for(const rule of strategy.strategyRules??[]){
    if(!(rule.conditions??[]).every(q=>conditionOK(c,s,q,a,b)))continue;
    const candidates=all.filter(x=>x.ability.slot===rule.action).sort((x,y)=>actionScore(y)-actionScore(x));
    if(candidates.length){if(rule.action==='rage')clearHold();strategyDecision=rule.label??`${rule.action==='rage'?'释放怒技':'使用普攻'}：条件已满足`;return candidates[0];}
   }
   if(strategy.defaultAction){
    const candidates=all.filter(x=>x.ability.slot===strategy.defaultAction).sort((x,y)=>actionScore(y)-actionScore(x));
    if(candidates.length){
     const rage=all.filter(x=>x.ability.slot==='rage').sort((x,y)=>actionScore(y)-actionScore(x));
     if(strategy.defaultAction==='basic'&&rage.length){
      if(a.used.includes(holdKey)){clearHold();strategyDecision='满怒已保留一轮，避免怒气溢出，释放怒技';return rage[0];}
      a.used.push(holdKey);strategyDecision='条件尚未成熟，保留一轮满怒继续铺垫';return candidates[0];
     }
     clearHold();strategyDecision=`默认执行${strategy.defaultAction==='rage'?'怒技':'普攻'}`;return candidates[0];
    }
   }
  }
  if(a===p){
   const rage=all.filter(x=>x.ability.slot==='rage').sort((x,y)=>actionScore(y)-actionScore(x));
   if(rage.length){strategyDecision=strategy?'无额外条件，释放可用怒技':'';return rage[0];}
   return all.filter(x=>x.ability.slot==='basic').sort((x,y)=>actionScore(y)-actionScore(x))[0]??all[0];
  }
  if(enemy.ai==='weighted')return weighted(s,'combat.enemy_ai',all,x=>Math.max(1,actionScore(x)));
  return [...all].sort((x,y)=>actionScore(y)-actionScore(x)||x.ability.id.localeCompare(y.ability.id))[0];
 }
 function tickStatuses(a:Fighter,b:Fighter){
  let changed=false;
  if(a.status.burn&&a.hp>0){
   const beforeBurn=a.status.burn,n=beforeBurn*c.rules.burnDamage,ctx=root(['duration']);
   recordResourceRead('burn',beforeBurn,a,'status.burn');a.status.burn=Math.max(0,beforeBurn-1);recordResourceChange('burn','consumed',beforeBurn-a.status.burn,1,a,'status.burn');
   const statusSource=eventSource(actorSide(a),'status.burn','status');
   summary.statusTicks++;hurt(b,a,n,'燃烧',false,{base:n,scaled:n,afterDefense:n,afterVulnerable:n,afterBuild:n,afterCrit:n,absorbed:0,hpLoss:0},'status.burn',ctx,statusSource);if(b===p)runRelicConversion(p,a,'status_tick',n,ctx,'burn');trigger(b,a,'on_status_tick',ctx,statusSource);changed=true;
  }
  for(const st of ['weak','break','vulnerable'])if(a.status[st]){
   const before=a.status[st];a.status[st]=Math.max(0,before-1);recordResourceChange(st,'consumed',before-a.status[st],1,a,'status.tick');changed=true;
  }
  if(changed&&a.hp>0)frame(undefined,'status_tick',a.name+' 状态结算',0,false,{tags:['duration'],detail:'持续状态衰减'});
 }
 function objectiveReached(fullRound=false){if(p.hp<=0)return false;if(objective.type==='kill')return e.hp<=0;if(objective.type==='break')return e.hp<=0||objectiveWon;if(objective.type==='survive')return e.hp<=0||fullRound&&round>=(objective.rounds??1);return false;}
 frame(undefined,'start','斗法开始',0,false,{objective:objective.label??objective.type});
 const active=build.dominant.map(t=>`${MECHANIC_TAG_LABELS[t]}×${build.tags[t]}`);for(const link of build.links.slice(0,2))active.push(link.name);if(build.relic.name!=='命器未得')active.push(`命器·${build.relic.name}`);if(build.strategy.name!=='未装配战策')active.push(`战策·${build.strategy.name}`);if(active.length)frame(undefined,'build','命盘结构',0,false,{detail:active.join(' / ')});
 if(origin?.battleStartEffects?.length){const originSource=eventSource('p',`origin.${origin.id}`,'origin');for(const ef of origin.battleStartEffects)apply(p,e,ef,0,origin.name,false,`origin.${origin.id}`,root(),originSource);frame(undefined,'origin',`出身 · ${origin.name}`,0,false,{sourceId:`origin.${origin.id}`,detail:origin.description});}trigger(p,e,'battle_start',root(),eventSource('system','system.battle_start','system'));trigger(e,p,'battle_start',root(),eventSource('system','system.battle_start','system'));frame(undefined,'ready','命格与法宝已生效');
 for(round=1;round<=c.rules.maxRounds&&p.hp>0&&e.hp>0&&!objectiveWon;round++){
  eventBudget=0;for(const a of [p,e])for(const id of Object.keys(a.cooldown))if(a.cooldown[id]>0)a.cooldown[id]--;
  const order=p.stats.speed>=e.stats.speed?[p,e]:[e,p];
  for(const a of order){
   const b=a===p?e:p;
   if(a.hp<=0||b.hp<=0||objectiveWon)break;
   if(a.status.stun){delete a.status.stun;frame(a,'stun','眩晕，跳过行动');continue;}
   const turnSource=eventSource('system','system.before_action','system');
   trigger(a,b,'before_action',root(),turnSource);trigger(a,b,'hp_threshold',root(),turnSource);
   if(a.hp<=0||b.hp<=0)break;
   const picked=chooseAction(a,b);recordActionSelection(a,picked);
   if(!picked){changeRage(a,5,'system.wait');frame(a,'wait','无可用主行动',0,false,{detail:'冷却或怒气条件未满足；怒气 +5'});continue;}
   if(a===p&&strategy&&strategyDecision)frame(undefined,'strategy',`战策 · ${strategy.name}`,0,false,{sourceId:strategy.id,detail:strategyDecision});
   const {eq,ability}=picked,useRage=ability.slot==='rage',actionTags=abilityMechanicTags(ability),ctx=root(actionTags),actionSource=eventSource(actorSide(a),ability.id,'action');
   if(useRage){
    changeRage(a,-ability.cost,ability.id);
    if(a===p){summary.playerRageSkills++;runRelicConversion(p,b,'rage_spend',ability.cost,ctx);}else summary.enemyRageSkills++;
    trigger(a,b,'on_rage_spend',ctx,actionSource);
   }
   let hit=false;
   for(const ef of ability.effects){
    if(b.hp<=0&&ef.target!=='self')continue;
    const landed=apply(a,b,ef,eq.rank,ability.name,false,ability.id,ctx,actionSource);
    if(ef.type==='damage'&&ef.target!=='self')hit=landed!==false;
    if(objectiveWon)break;
   }
   if(ability.cooldown)a.cooldown[ability.id]=ability.cooldown;
   if(ability.slot==='basic')changeRage(a,c.rules.basicRage,ability.id);
   if(hit){changeRage(b,c.rules.hitRage,'rule.hitRage');trigger(a,b,'on_hit',ctx,actionSource);trigger(b,a,'on_damaged',ctx,actionSource);trigger(b,a,'hp_threshold',ctx,actionSource);}
   if(useRage)trigger(a,b,'on_rage_skill',ctx,actionSource);
   trigger(a,b,'after_action',ctx,actionSource);trigger(a,b,'hp_threshold',ctx,actionSource);
   const notes:string[]=[];if(ability.cooldown)notes.push(`进入 ${ability.cooldown} 回合冷却`);
   frame(a,useRage?'rage':'action',ability.name,0,false,{sourceId:ability.id,tags:actionTags,detail:notes.join('；')||undefined});
   if(objectiveReached()){objectiveWon=true;break;}
  }
  if(p.hp<=0||e.hp<=0||objectiveWon)break;for(const a of [p,e]){const b=a===p?e:p;const roundSource=eventSource('system','system.round_end','system');trigger(a,b,'round_end',root(),roundSource);tickStatuses(a,b);trigger(a,b,'hp_threshold',root(),eventSource('system','system.round_end','system'));if(p.hp<=0||e.hp<=0)break;}if(objectiveReached(true)){objectiveWon=true;break;}
 }
 const won=p.hp>0&&(objectiveWon||e.hp<=0);if(won)trigger(p,e,'battle_end',root(),eventSource('system','system.battle_end','system'));if(!won&&p.hp>0){const remaining=p.hp;p.hp=0;recordLoss(p,'system_failure',remaining,'system.timeout');frame(undefined,'timeout','劫气耗尽',0,false,{detail:'未在规则允许的回合内完成目标'});}for(const conversion of Object.values(diagnostics.conversions.bySource))if(conversion.attempts===0){conversion.unattempted=1;conversion.blocked.unattempted=(conversion.blocked.unattempted??0)+1;diagnostics.conversions.unattempted++;}frame(undefined,won?'win':'loss',won?'斗法告捷':'此身入劫',0,false,{objective:objective.label??objective.type,detail:won?`目标完成：${objective.label??objective.type}`:`目标失败：${objective.label??objective.type}`});
 return {enemyId:enemy.id,frames,won,rounds:Math.min(round,c.rules.maxRounds),hp:p.hp,cursor:0,objective,summary,objectiveProgress,diagnostics};
}

/** Legacy school metadata stays readable, but no longer gates what can appear in a run. */
export function selectRunPool(c:Content,_s:RunState):RunPool {return {schools:c.schools.map(x=>x.id),hybrids:c.hybrids.map(x=>x.id)};}
export function inRunPool(_c:Content,_s:RunState,_a:Ability):boolean {return true;}
export function routeLength(c:Content):number{return c.rules.routeRows.length;}

const PROMISE_TYPES=new Set(['reserve_currency','elite_completion','bypass_combat','rescue_opposed']);
const promiseBase=(relationKey:string)=>relationKey.replace(/^char_/,'');
export function promiseDefinitions(c:Content):CharacterPromiseDefinition[]{return c.characterPromises??[];}
export function promiseDefinition(c:Content,id:string):CharacterPromiseDefinition|undefined{return promiseDefinitions(c).find(x=>x.id===id);}
export function promiseMetFact(def:CharacterPromiseDefinition):string {return `met_${promiseBase(def.relationKey)}`;}
export function knownCharacters(c:Content,s:RunState):string[]{
 const known=new Set<string>();
 for(const event of c.events){
  if(!event.relationKey||!event.character)continue;
  const met=s.facts[promiseMetFact({relationKey:event.relationKey} as CharacterPromiseDefinition)];
  const entered=(s.seenEvents[event.id]??0)>0;
  if(met||entered)known.add(event.relationKey);
 }
 return [...known].sort();
}
const nodePosition=(node:{act:number;row:number})=>node.act*1000+node.row;
const nodeBefore=(a:{act:number;row:number},b:{act:number;row:number})=>nodePosition(a)<nodePosition(b);
const nodeAtOrBefore=(a:{act:number;row:number},b:{act:number;row:number})=>nodePosition(a)<=nodePosition(b);
function currentProgressNode(s:RunState):{act:number;row:number}|undefined{return s.current?{act:s.current.act,row:s.current.row}:{act:s.act,row:s.row};}
function reachableFutureRouteNodes(c:Content,s:RunState):RouteNode[]{
 const start=currentProgressNode(s);if(!start)return [];
 let lanes=new Set<number>([s.current?.lane??s.lane]),out:RouteNode[]=[];
 for(let act=start.act;act<c.acts.length;act++){
  const firstRow=act===start.act?start.row+1:0;
  for(let row=firstRow;row<routeLength(c);row++){
   const rowNodes=s.route.filter(node=>node.act===act&&node.row===row);
   const reachable=act>start.act&&row===0
    ?rowNodes
    :rowNodes.filter(node=>[...lanes].some(lane=>Math.abs(lane-node.lane)<=1));
   out.push(...reachable.filter(node=>!s.visited.includes(node.id)));
   lanes=new Set(reachable.map(node=>node.lane));
  }
 }
 return out;
}
function futureRouteNodes(c:Content,s:RunState,def:CharacterPromiseDefinition,typeFilter?:string[]):RouteNode[]{
 const deadline=def.deadline;
 return reachableFutureRouteNodes(c,s).filter(node=>
  (!typeFilter||typeFilter.includes(node.type))&&(!deadline||nodeAtOrBefore(node,deadline))
 );
}
function currentRouteNodes(c:Content,s:RunState):RouteNode[]{
 if(s.phase!=='map')return [];
 return s.route.filter(node=>node.act===s.act&&node.row===s.row&&(s.row===0||Math.abs(node.lane-s.lane)<=1)&&!s.visited.includes(node.id));
}
function taskRouteNodes(c:Content,s:RunState,def:CharacterPromiseDefinition,typeFilter:string[]):RouteNode[]{
 const current=currentRouteNodes(c,s).filter(node=>typeFilter.includes(node.type));
 return [...current,...futureRouteNodes(c,s,def,typeFilter)].filter((node,index,nodes)=>nodes.findIndex(x=>x.id===node.id)===index);
}
export function storyCandidates(c:Content,s:RunState,n:RouteNode):Story[]{
 if(n.ref)return c.events.filter(e=>e.id===n.ref);
 const hidden=n.type==='hidden';
 const base=c.events.filter(e=>e.act===n.act&&!e.major&&!!e.hiddenOnly===hidden&&(e.requirements??[]).every(q=>conditionOK(c,s,q)));
 let pool=base.filter(e=>(s.seenEvents[e.id]??0)<(e.maxPerRun??(e.profile==='B'?2:1)));
 if(!pool.length)pool=base;
 return pool;
}
export function storyCandidatesForRelation(c:Content,s:RunState,n:RouteNode,relationKey:string):Story[]{
 return storyCandidates(c,s,n).filter(event=>event.relationKey===relationKey&&!event.major&&!event.hiddenOnly);
}
/**
 * Returns only unparsed, reachable event nodes that can currently draw a
 * relation's story. The map's current row is included; later rows follow the
 * same lane reachability rules as normal navigation.
 */
export function storyOpportunitiesForRelation(c:Content,s:RunState,relationKey:string):RouteNode[]{
 const current=currentRouteNodes(c,s);
 const future=reachableFutureRouteNodes(c,s);
 const seen=new Set<string>();
 return [...current,...future].filter(node=>{
  if(seen.has(node.id)){return false;}
  seen.add(node.id);
  return !s.visited.includes(node.id)&&!node.ref&&['event','hidden'].includes(node.type)&&storyCandidatesForRelation(c,s,node,relationKey).length>0;
 });
}
export function characterRouteClues(c:Content,s:RunState,relationKey:string):CharacterRouteClues {
 const story=storyOpportunitiesForRelation(c,s,relationKey);
 const result:CharacterRouteClues={story,elite:[],bypass:[]};
 const defs=promiseDefinitions(c).filter(def=>def.relationKey===relationKey);
 for(const def of defs){
  const state=s.promises?.[def.id];
  if(!state)continue;
  if(def.type==='elite_completion'&&state.status==='active'){
   result.elite=taskRouteNodes(c,s,def,def.fulfillment?.nodeTypes??(def.fulfillment?.nodeType?[def.fulfillment.nodeType]:['elite']));
  }
  if(def.type==='bypass_combat'&&state.status==='active'&&state.bypassPermit?.state==='available'){
   result.bypass=taskRouteNodes(c,s,def,def.fulfillment?.nodeTypes??(def.fulfillment?.nodeType?[def.fulfillment.nodeType]:['combat']));
  }
 }
 return result;
}
export const eventCandidates=storyCandidates;


/** Talents are progression choices, not equipment or virtual resonance counts. */
export function talentEligible(c:Content,s:RunState,t:Talent,level:number):boolean {
 return (t.race==='common'||t.race===s.race)&&t.minLevel<=level&&!s.talents.includes(t.id)&&t.requires.every(id=>s.talents.includes(id))&&(!t.exclusiveGroup||!c.talents.some(x=>s.talents.includes(x.id)&&x.exclusiveGroup===t.exclusiveGroup));
}
export function talentCheckBonus(c:Content,s:RunState):number {return Math.min(15,c.talents.filter(t=>s.talents.includes(t.id)).reduce((n,t)=>n+(t.world?.checkBonus??0),0));}
export function validateTalentState(c:Content,s:RunState):void {
 if(!Array.isArray(s.talents)||!Array.isArray(s.talentQueue)||!Array.isArray(s.talentHistory)||s.talents.length!==s.talentHistory.length||s.talentHistory.length+s.talentQueue.length!==s.level)throw new Error('Invalid talent progress');
 const acquired:string[]=[];
 for(let i=0;i<s.talentHistory.length;i++){const h=s.talentHistory[i],t=c.talents.find(t=>t.id===h.id);if(h.level!==i+1||s.talents[i]!==h.id||!t||!talentEligible(c,{...s,talents:acquired},t,h.level))throw new Error('Invalid acquired talent');acquired.push(h.id);}
 for(let i=0;i<s.talentQueue.length;i++)if(s.talentQueue[i]!==s.talentHistory.length+i+1)throw new Error('Invalid talent queue');
 if(s.talentQueue.length){const draft=s.talentDraft,count=Math.max(3,...c.talents.filter(t=>s.talents.includes(t.id)).map(t=>t.world?.draftChoices??3));if(!draft||draft.level!==s.talentQueue[0]||!Array.isArray(draft.offers)||draft.offers.length!==count||new Set(draft.offers).size!==count||draft.offers.some(id=>{const t=c.talents.find(t=>t.id===id);return !t||!talentEligible(c,s,t,draft.level);}))throw new Error('Invalid talent draft');if(!draft.offers.some(id=>c.talents.find(t=>t.id===id)!.race==='common')||!draft.offers.some(id=>c.talents.find(t=>t.id===id)!.race===s.race))throw new Error('Invalid talent pool mixture');}
 else if(s.talentDraft)throw new Error('Unexpected talent draft');
}
function promiseFactKeys(def:CharacterPromiseDefinition):string[]{
 const facts=[...Object.values(def.facts),def.fulfillment?.fact].filter((x):x is string=>typeof x==='string');
 return [...new Set([...facts,`${promiseBase(def.relationKey)}_promise`,`${promiseBase(def.relationKey)}_kept`])];
}
function promiseStatusFromFacts(def:CharacterPromiseDefinition,s:RunState):PromiseStatus|undefined {
 const facts=s.facts;
 if(def.facts.fulfilled&&facts[def.facts.fulfilled]||def.fulfillment?.fact&&facts[def.fulfillment.fact]||facts[`${promiseBase(def.relationKey)}_kept`])return 'fulfilled';
 if(def.facts.abandoned&&facts[def.facts.abandoned])return 'declined';
 if(def.facts.declined&&facts[def.facts.declined])return 'declined';
 if(def.facts.accepted&&facts[def.facts.accepted]||facts[`${promiseBase(def.relationKey)}_promise`])return 'active';
 return undefined;
}
function promiseStateFromFacts(def:CharacterPromiseDefinition,s:RunState):CharacterPromiseState|undefined {
 const status=promiseStatusFromFacts(def,s);if(!status)return undefined;
 const accepted=!!(def.facts.accepted&&s.facts[def.facts.accepted]||s.facts[`${promiseBase(def.relationKey)}_promise`]);
 const state:CharacterPromiseState={
  definitionId:def.id,
  status,
  acceptedAt:status!=='declined'||accepted?{act:0,row:0,nodeId:'legacy'}:undefined,
  evidenceNodeId:status==='fulfilled'?'legacy':undefined,
  finalRewardOffered:false,
  settlementClaimed:status==='fulfilled',
  reason:status==='declined'?(def.facts.abandoned&&s.facts[def.facts.abandoned]?'abandoned':'declined'):undefined
 };
 if(def.type==='bypass_combat'){
  const used=status==='fulfilled',hasPermit=accepted||!!(def.facts.available&&s.facts[def.facts.available])||used;
  if(hasPermit)state.bypassPermit={state:used?'consumed':status==='active'?'available':'expired',issuedAtNodeId:'legacy',usedAtNodeId:used?'legacy':undefined};
 }
 return state;
}
function isPromiseStatus(value:unknown):value is PromiseStatus{return typeof value==='string'&&['active','fulfilled','broken','expired','declined'].includes(value);}
function isRecord(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function promiseReferenceValid(c:Content,s:RunState,id:string):boolean{
 if(id==='legacy')return true;
 return s.route.some(node=>node?.id===id)||c.events.some(event=>event.id===id);
}
function promiseEvidenceNode(c:Content,s:RunState,id:string):RouteNode|undefined{return id==='legacy'?undefined:s.route.find(node=>node.id===id);}
function promiseAllowedNodeTypes(def:CharacterPromiseDefinition):string[]{
 return def.fulfillment?.nodeTypes??(def.fulfillment?.nodeType?[def.fulfillment.nodeType]:[]);
}
function promiseStateValid(c:Content,s:RunState,id:string,state:CharacterPromiseState):boolean {
 const def=promiseDefinition(c,id);
 if(!def||!isRecord(state)||state.definitionId!==id||!isPromiseStatus(state.status))return false;
 if(typeof state.finalRewardOffered!=='boolean'||typeof state.settlementClaimed!=='boolean')return false;
 if(state.reason!==undefined&&(typeof state.reason!=='string'||!state.reason))return false;
 const needsAccepted=state.status==='active'||state.status==='fulfilled'||state.status==='broken'||state.status==='expired';
 if(needsAccepted&&!isRecord(state.acceptedAt))return false;
 if(state.acceptedAt){
  if(!Number.isInteger(state.acceptedAt.act)||state.acceptedAt.act<0||state.acceptedAt.act>=c.acts.length||!Number.isInteger(state.acceptedAt.row)||state.acceptedAt.row<0||state.acceptedAt.row>=routeLength(c)||typeof state.acceptedAt.nodeId!=='string'||!state.acceptedAt.nodeId||!promiseReferenceValid(c,s,state.acceptedAt.nodeId))return false;
  const acceptedNode=promiseEvidenceNode(c,s,state.acceptedAt.nodeId),acceptedEvent=c.events.find(event=>event.id===state.acceptedAt!.nodeId);
  if(acceptedNode&& (acceptedNode.act!==state.acceptedAt.act||acceptedNode.row!==state.acceptedAt.row))return false;
  if(acceptedEvent&&acceptedEvent.act!==state.acceptedAt.act)return false;
 }
 if(state.evidenceNodeId!==undefined&&(typeof state.evidenceNodeId!=='string'||!state.evidenceNodeId||!promiseReferenceValid(c,s,state.evidenceNodeId)))return false;
 if(state.status==='fulfilled'&&!state.evidenceNodeId)return false;
 if(state.status!=='fulfilled'&&state.evidenceNodeId!==undefined)return false;
 if(state.status!=='fulfilled'&&!['active','declined'].includes(state.status)&&!state.reason)return false;
 if(state.status==='declined'&&!state.reason)return false;
 if(state.status==='fulfilled'&&def.type!=='elite_completion'&&!state.settlementClaimed)return false;
 if(state.status!=='fulfilled'&&state.settlementClaimed)return false;
 if(state.finalRewardOffered&&state.status!=='fulfilled')return false;
  if(state.bypassPermit){
  if(def.type!=='bypass_combat'||!isRecord(state.bypassPermit)||!['available','consumed','expired'].includes(state.bypassPermit.state)||typeof state.bypassPermit.issuedAtNodeId!=='string'||!state.bypassPermit.issuedAtNodeId||!promiseReferenceValid(c,s,state.bypassPermit.issuedAtNodeId))return false;
  if(state.bypassPermit.state==='consumed'){
   if(typeof state.bypassPermit.usedAtNodeId!=='string'||!state.bypassPermit.usedAtNodeId||!promiseReferenceValid(c,s,state.bypassPermit.usedAtNodeId))return false;
   const legacyPermit=state.acceptedAt?.act===0&&state.acceptedAt.row===0&&state.acceptedAt.nodeId==='legacy'&&state.bypassPermit.issuedAtNodeId==='legacy'&&state.bypassPermit.usedAtNodeId==='legacy'&&state.evidenceNodeId==='legacy';
   const usedNode=promiseEvidenceNode(c,s,state.bypassPermit.usedAtNodeId),allowed=promiseAllowedNodeTypes(def);
   if(!legacyPermit&&(!usedNode||usedNode.type!=='combat'||allowed.length&&!allowed.includes(usedNode.type)||!state.evidenceNodeId||state.evidenceNodeId!==state.bypassPermit.usedAtNodeId||!s.visited.includes(usedNode.id)))return false;
  }else if(state.bypassPermit.usedAtNodeId!==undefined)return false;
 }else if(def.type==='bypass_combat'&&['active','fulfilled','expired'].includes(state.status))return false;
 if(def.type==='bypass_combat'){
  if(state.status==='active'&&state.bypassPermit?.state!=='available')return false;
  if(state.status==='fulfilled'&&state.bypassPermit?.state!=='consumed')return false;
  if(state.status==='expired'&&state.bypassPermit?.state!=='expired')return false;
  if(state.status==='declined'&&state.bypassPermit&&state.bypassPermit.state!=='expired')return false;
 }else if(state.bypassPermit)return false;
 if(state.status==='fulfilled'&&def.type!=='bypass_combat'){
  const evidence=state.evidenceNodeId==='legacy'?undefined:promiseEvidenceNode(c,s,state.evidenceNodeId!);
  if(evidence){
   const allowed=promiseAllowedNodeTypes(def);
   if(allowed.length&&!allowed.includes(evidence.type))return false;
   if(def.fulfillment?.eventId&&evidence.ref!==def.fulfillment.eventId)return false;
  }else if(state.evidenceNodeId!=='legacy'&&!def.fulfillment?.eventId)return false;
 }
 return true;
}
function projectPromiseFacts(c:Content,s:RunState,only?:Set<string>):void {
 for(const def of promiseDefinitions(c)){
  if(only&&!only.has(def.id))continue;
  const state=s.promises[def.id];if(!state)continue;
  if(def.facts.accepted&&['active','fulfilled','broken','expired'].includes(state.status))s.facts[def.facts.accepted]=true;
  if(def.facts.fulfilled){
   if(state.status==='fulfilled')s.facts[def.facts.fulfilled]=true;else delete s.facts[def.facts.fulfilled];
  }
  if(def.fulfillment?.fact){
   if(state.status==='fulfilled')s.facts[def.fulfillment.fact]=true;else delete s.facts[def.fulfillment.fact];
  }
  if(state.status==='fulfilled')s.facts[`${promiseBase(def.relationKey)}_kept`]=true;else delete s.facts[`${promiseBase(def.relationKey)}_kept`];
  if(def.facts.declined){
   if(state.status==='declined')s.facts[def.facts.declined]=true;else delete s.facts[def.facts.declined];
  }
  if(def.facts.abandoned){
   if(state.status==='declined'&&state.reason==='abandoned')s.facts[def.facts.abandoned]=true;else delete s.facts[def.facts.abandoned];
  }
  if(def.facts.available){
   if(state.bypassPermit?.state==='available')s.facts[def.facts.available]=true;else delete s.facts[def.facts.available];
  }
 }
}
const LEGACY_MIGRATION_COMMAND='__migrateLegacy';
function legacyMigrationFacts(c:Content,s:RunState,ids:Set<string>):Record<string,boolean>{
 const facts:Record<string,boolean>={};
 for(const def of promiseDefinitions(c)){
  if(!ids.has(def.id))continue;
  for(const key of promiseFactKeys(def))facts[key]=!!s.facts[key];
 }
 return facts;
}
function applyLegacyMigration(c:Content,s:RunState,payload:LegacyMigrationPayload):void{
 if(!isRecord(payload)||!isRecord(payload.promises)||!isRecord(payload.facts))throw new Error('Invalid legacy migration');
 if(payload.trackedCharacter===null)delete s.trackedCharacter;
 else if(payload.trackedCharacter!==undefined)s.trackedCharacter=payload.trackedCharacter;
 for(const [id,state] of Object.entries(payload.promises))s.promises[id]=clone(state);
 for(const [key,value] of Object.entries(payload.facts))if(value)s.facts[key]=true;else delete s.facts[key];
 projectPromiseFacts(c,s,new Set(Object.keys(payload.promises)));
}
function migratePromiseState(c:Content,s:RunState):void {
 if(s.promises===undefined||s.promises===null)s.promises={};
 else if(!isRecord(s.promises))throw new Error('Invalid promise state');
 const tracked=(s as RunState&{trackedCharacter?:unknown}).trackedCharacter,followed=(s as RunState&{followedCharacter?:unknown}).followedCharacter;
 if(tracked!==undefined&&tracked!==null&&typeof tracked!=='string')throw new Error('Invalid tracked character');
 if(followed!==undefined&&followed!==null&&typeof followed!=='string')throw new Error('Invalid followed character');
 const migratedTracked=tracked===undefined&&typeof followed==='string';
 if(migratedTracked)s.trackedCharacter=followed;
 else if(typeof tracked==='string'&&typeof followed==='string'&&tracked!==followed)throw new Error('Conflicting tracked character');
 else if(tracked===null&&typeof followed==='string')throw new Error('Conflicting tracked character');
 if((s as RunState&{trackedCharacter?:string|null}).trackedCharacter===null)delete s.trackedCharacter;
 delete s.followedCharacter;
 const migrated=new Set<string>();
 for(const def of promiseDefinitions(c)){
  if(!s.promises[def.id]){
   const state=promiseStateFromFacts(def,s);if(state){s.promises[def.id]=state;migrated.add(def.id);}
  }
 }
 if(migrated.size)projectPromiseFacts(c,s,migrated);
 const alreadyRecorded=Array.isArray(s.actionLog)&&s.actionLog.some(action=>action.command===LEGACY_MIGRATION_COMMAND);
 if(!alreadyRecorded&&(migratedTracked||migrated.size)){
  const payload:LegacyMigrationPayload={
   promises:Object.fromEntries([...migrated].map(id=>[id,clone(s.promises[id])])),
   facts:legacyMigrationFacts(c,s,migrated)
  };
  if(migratedTracked)payload.trackedCharacter=String(s.trackedCharacter);
  s.actionLog.push({command:LEGACY_MIGRATION_COMMAND,args:[payload]});
 }
}
function validatePromiseStates(c:Content,s:RunState):void {
 if(!isRecord(s.promises))throw new Error('Invalid promise state');
 for(const [id,state] of Object.entries(s.promises))if(!promiseStateValid(c,s,id,state))throw new Error('Invalid promise state');
 if(s.trackedCharacter!==undefined&&(typeof s.trackedCharacter!=='string'||!knownCharacters(c,s).includes(s.trackedCharacter)))throw new Error('Invalid tracked character');
}
export class Game {
 c:Content;s:RunState;
 constructor(c:Content,s:RunState){migratePromiseState(c,s);this.c=c;this.s=s;}
 promiseDefinition(id:string):CharacterPromiseDefinition|undefined{return promiseDefinition(this.c,id);}
 promiseState(id:string):CharacterPromiseState|undefined{return this.s.promises?.[id];}
 promiseFacts(def:CharacterPromiseDefinition):string[]{return promiseFactKeys(def);}
 promiseFactSnapshot():Record<string,boolean|undefined>{
  const out:Record<string,boolean|undefined>={};for(const def of promiseDefinitions(this.c))for(const key of this.promiseFacts(def))out[key]=this.s.facts[key];return out;
 }
 applyLegacyMigration(payload:LegacyMigrationPayload):void {
  applyLegacyMigration(this.c,this.s,payload);
 }
 restorePromiseFacts(snapshot:Record<string,boolean|undefined>):void {
  for(const [key,value] of Object.entries(snapshot))if(value===undefined)delete this.s.facts[key];else this.s.facts[key]=value;
 }
 promiseNodeId(eventId:string):string{return this.s.current?.id??eventId;}
 promisePosition():{act:number;row:number}{return this.s.current?{act:this.s.current.act,row:this.s.current.row}:{act:this.s.act,row:this.s.row};}
 promiseDeadlinePassedAt(def:CharacterPromiseDefinition,position:{act:number;row:number}):boolean {
  if(!def.deadline)return false;
  if(def.deadline.boundary==='act_end')return position.act>def.deadline.act;
  return nodePosition(position)>nodePosition(def.deadline);
 }
 promiseDeadlineReachedAfterAction(def:CharacterPromiseDefinition,context='action'):boolean {
  if(this.promiseDeadlinePassed(def))return true;
  const deadline=def.deadline,position=this.promisePosition();
  if(!deadline||position.act!==deadline.act||position.row!==deadline.row)return false;
  if(deadline.boundary==='node')return true;
  return deadline.boundary==='ordinary_combat_end'&&context==='battle'&&this.s.current?.type==='combat';
 }
 promiseDeadlinePassed(def:CharacterPromiseDefinition):boolean {
  return this.promiseDeadlinePassedAt(def,this.promisePosition());
 }
 promiseAcceptanceAvailable(def:CharacterPromiseDefinition,auth:ChoiceAuthored):boolean {
  const existing=this.promiseState(def.id);if(existing)return false;
  if(def.type==='reserve_currency'){
   const amount=auth.amount??def.amount??0;if(this.s.gold<amount)return false;
  }
  if(def.type==='elite_completion'){
   const allowed=auth.allowedNodeTypes??def.fulfillment?.nodeTypes??(def.fulfillment?.nodeType?[def.fulfillment.nodeType]:['elite']);
   if(!futureRouteNodes(this.c,this.s,def,allowed).length)return false;
  }
  if(def.type==='bypass_combat'){
   const allowed=auth.allowedNodeTypes??def.fulfillment?.nodeTypes??(def.fulfillment?.nodeType?[def.fulfillment.nodeType]:['combat']);
   if(!futureRouteNodes(this.c,this.s,def,allowed).length)return false;
  }
  return true;
 }
 authoredChoiceLegal(event:Story,phase:EventPhase,choice:Choice):string|undefined {
  const authored=choice.authored??(event.authored?.role==='reward'&&choice.grant?event.authored:undefined);if(!authored)return undefined;
  if(authored.sourceFact&&!this.s.facts[authored.sourceFact])return '前置事实未成立';
  if(!authored.promiseId)return undefined;
  const def=this.promiseDefinition(authored.promiseId);if(!def)return '承诺定义不存在';
  const action=authored.action??'';
  const acceptedHere=def.acceptance?.eventId===event.id&&(!def.acceptance.phase||def.acceptance.phase===phase.id)&&(!def.acceptance.choiceId||def.acceptance.choiceId===choice.id)&&(!def.acceptance.choiceIds||def.acceptance.choiceIds.includes(choice.id));
  const fulfilledHere=def.fulfillment?.eventId===event.id&&(!def.fulfillment.phase||def.fulfillment.phase===phase.id)&&(!def.fulfillment.choiceId||def.fulfillment.choiceId===choice.id);
  if(['accept'].includes(action)&&!acceptedHere)return '承诺接受地点无效';
  if(['fulfill'].includes(action)&&def.fulfillment?.eventId&&!fulfilledHere)return '承诺兑现地点无效';
  const state=this.promiseState(def.id);
  if(authored.role==='meeting'||authored.role==='meeting_check'){
   return action&&action!=='meet'?'相识动作无效':undefined;
  }
  if(authored.role==='promise_acceptance'||action==='accept'){
   if(action==='decline')return state&&state.status!=='declined'?'承诺已开始或已结束':undefined;
   if(!['promise_acceptance','promise_progress'].includes(authored.role??''))return undefined;
   return this.promiseAcceptanceAvailable(def,authored)?undefined:'承诺当前不可接受';
  }
  if(action==='decline'){
   return state&&state.status!=='active'?'承诺当前不可放弃':undefined;
  }
  if(action==='abandon'){
   return !state||state.status!=='fulfilled'?undefined:'承诺当前不可放弃';
  }
  if(action==='evidence_only'){
   return state?.status==='active'?undefined:'尚未有活跃承诺';
  }
  if(action==='ack_active'){
   return state?.status==='active'?undefined:'承诺当前不可确认';
  }
  if(action==='fulfill'){
   if(state?.status==='broken'||state?.status==='expired'||state?.status==='declined')return '承诺已失效';
   if(state?.status==='fulfilled'){
    return state.settlementClaimed?'兑现已结算':undefined;
   }
   if(def.type==='reserve_currency'){
    const amount=authored.amount??def.amount??0,paid=(choice.effects??[]).filter(e=>e.type==='gain_currency').reduce((n,e)=>n+Math.min(0,value(e.value)),0);
    return state?.status==='active'&&this.s.gold>=amount&&paid<=-amount?undefined:'未满足保留灵石条件';
   }
   if(def.type==='elite_completion'){
    const fact=def.fulfillment?.fact??'leizhenzi_elite_completed';return state?.status==='active'&&!!this.s.facts[fact]?'': '尚无正式精英胜利证据';
   }
   if(def.type==='rescue_opposed'){
    const amount=authored.amount??def.amount??0,paid=(choice.effects??[]).filter(e=>e.type==='gain_currency').reduce((n,e)=>n+Math.min(0,value(e.value)),0);
    const sameAction=def.fulfillment?.sameAction===true,sameActionHere=!sameAction||acceptedHere,stateAllowed=sameAction?(!state||state.status==='active'):state?.status==='active';
    return stateAllowed&&sameActionHere&&this.s.gold>=amount&&paid<=-amount?'':'救助代价不足';
   }
   return state?.status==='active'?'':'尚未有活跃承诺';
  }
  if(authored.role==='reward'){
   if(state?.status!=='fulfilled')return '承诺尚未真实兑现';
   return state.finalRewardOffered?'奖励已领取':'';
  }
  return undefined;
 }
 applyStoryEffects(effects:Effect[]):void {
  const snapshot=this.promiseFactSnapshot();for(const effect of effects)this.applyWorld(effect);this.restorePromiseFacts(snapshot);
 }
 syncPromiseProjection(def:CharacterPromiseDefinition,state:CharacterPromiseState):void {
  const facts=def.facts;
  if(facts.accepted&&['active','fulfilled','broken','expired'].includes(state.status))this.s.facts[facts.accepted]=true;
 if(facts.fulfilled&&state.status==='fulfilled')this.s.facts[facts.fulfilled]=true;
  if(state.status==='fulfilled')this.s.facts[`${promiseBase(def.relationKey)}_kept`]=true;
  if(facts.declined&&state.status==='declined')this.s.facts[facts.declined]=true;
  if(facts.abandoned&&state.status==='declined'&&state.reason==='abandoned')this.s.facts[facts.abandoned]=true;
  if(facts.available&&state.bypassPermit?.state==='available')this.s.facts[facts.available]=true;
  if(facts.fulfilled&&state.bypassPermit?.state==='consumed')this.s.facts[facts.fulfilled]=true;
 }
 setPromiseState(def:CharacterPromiseDefinition,state:CharacterPromiseState):void {
  this.s.promises[def.id]=state;this.syncPromiseProjection(def,state);
 }
 recordPromiseAudit(def:CharacterPromiseDefinition,state:CharacterPromiseState,action:string):void {
  const last=this.s.storyLog.at(-1);
  if(last&&this.s.phase==='event'&&last.eventId===this.s.eventId){last.promiseId=def.id;last.promiseAction=action;last.promiseStatus=state.status;last.evidenceNodeId=state.evidenceNodeId;last.promiseReason=state.reason;return;}
  this.s.storyLog.push({act:this.s.act,title:def.character??def.id,choice:action,phase:this.s.phase,result:action,promiseId:def.id,promiseAction:action,promiseStatus:state.status,evidenceNodeId:state.evidenceNodeId,promiseReason:state.reason});
 }
 acceptPromise(def:CharacterPromiseDefinition,auth:ChoiceAuthored,eventId:string):void {
  const state:CharacterPromiseState={definitionId:def.id,status:'active',acceptedAt:{act:this.s.act,row:this.s.row,nodeId:this.promiseNodeId(eventId)},finalRewardOffered:false,settlementClaimed:false};
  if(def.type==='bypass_combat')state.bypassPermit={state:'available',issuedAtNodeId:this.promiseNodeId(eventId)};
  this.setPromiseState(def,state);
 }
 abandonPromise(def:CharacterPromiseDefinition,reason='abandoned'):void {
  const state=this.promiseState(def.id);if(state&&['fulfilled','broken','expired','declined'].includes(state.status))return;
  this.setPromiseState(def,{...(state??{definitionId:def.id}),definitionId:def.id,status:'declined',reason,finalRewardOffered:false,settlementClaimed:state?.settlementClaimed??false,bypassPermit:def.type==='bypass_combat'&&state?.bypassPermit?{...state.bypassPermit,state:'expired'}:state?.bypassPermit});
 }
 commitAuthoredPromise(event:Story,phase:EventPhase,choice:Choice):void {
  const auth=choice.authored??(event.authored?.role==='reward'&&choice.grant?event.authored:undefined);if(!auth?.promiseId)return;
  const def=this.promiseDefinition(auth.promiseId);if(!def)throw new Error('Broken authored promise reference');
  const action=auth.action??'',state=this.promiseState(def.id);
  if(auth.role==='meeting'||auth.role==='meeting_check')return;
  if(action==='accept'){
   if(!state)this.acceptPromise(def,auth,event.id);
   return;
  }
  if(action==='decline'){
   if(!state||state.status==='declined')this.setPromiseState(def,{definitionId:def.id,status:'declined',reason:'declined',finalRewardOffered:false,settlementClaimed:false});
   return;
  }
  if(action==='abandon'){this.abandonPromise(def);return;}
  if(action==='evidence_only'||action==='ack_active')return;
  if(action==='fulfill'){
   const existing=state;
   if(existing?.status==='fulfilled'){
    if(def.type==='elite_completion'&&!existing.settlementClaimed)existing.settlementClaimed=true;
    return;
   }
   const next:CharacterPromiseState={
    ...(existing??{definitionId:def.id}),
    definitionId:def.id,
    status:'fulfilled',
    acceptedAt:existing?.acceptedAt??{act:this.s.act,row:this.s.row,nodeId:this.promiseNodeId(event.id)},
    evidenceNodeId:this.promiseNodeId(event.id),
    finalRewardOffered:existing?.finalRewardOffered??false,
    settlementClaimed:true
   };
   this.setPromiseState(def,next);
   if(auth.crossLineFact&&!this.s.facts[auth.crossLineFact])this.s.facts[auth.crossLineFact]=true;
  }
 }
 settlePromisesAfterAction(context='action'):void {
  for(const def of promiseDefinitions(this.c)){
   const state=this.promiseState(def.id);if(!state||state.status!=='active')continue;
   if(def.type==='reserve_currency'&&this.s.gold<(def.amount??0)){state.status='broken';state.reason='reserved_currency_spent';this.setPromiseState(def,state);this.recordPromiseAudit(def,state,'broken');continue;}
   if(this.promiseDeadlineReachedAfterAction(def,context)){state.status='expired';state.reason='deadline';if(state.bypassPermit)state.bypassPermit={...state.bypassPermit,state:'expired'};this.setPromiseState(def,state);this.recordPromiseAudit(def,state,'expired');}
  }
 }
 recordElitePromiseEvidence():void {
  const def=promiseDefinitions(this.c).find(x=>x.type==='elite_completion'),current=this.s.current;if(!def||!current||current.type!=='elite'||!this.s.battle?.won)return;
  const state=this.promiseState(def.id);if(!state||state.status!=='active')return;
  if(state.acceptedAt&&nodePosition(current)<=nodePosition(state.acceptedAt))return;
  if(this.promiseDeadlinePassedAt(def,current))return;
  state.evidenceNodeId=current.id;state.status='fulfilled';const fact=def.fulfillment?.fact??'leizhenzi_elite_completed';this.s.facts[fact]=true;this.setPromiseState(def,state);this.recordPromiseAudit(def,state,'elite_victory');
 }
 finalRewardAvailable(def:CharacterPromiseDefinition):boolean {
  const state=this.promiseState(def.id);return !!state&&state.status==='fulfilled'&&!state.finalRewardOffered;
 }
 static create(c:Content,seed:string,origin:string,fate:string,name='无名',portrait='',race='human'):Game {
  validateContent(c);const o=c.origins.find(x=>x.id===origin);if(!c.races.some(r=>r.id===race))throw new Error('Invalid race');if(!o||!fateOptions(c,seed).some(x=>x.id===fate))throw new Error('Invalid origin or offered fate');
  const s:RunState={race,talents:[],talentQueue:[],talentHistory:[],contentPool:{schools:[],hybrids:[]},version:c.version,rulesVersion:c.rulesVersion,seed,name:name.slice(0,14)||'无名',portrait:portrait||o.art,origin,fate,act:0,row:0,lane:1,phase:'map',hp:0,gold:c.rules.startingGold,xp:0,level:0,bonus:{},slots:SLOT_ORDER.map(()=>null),rng:{},route:[],visited:[],facts:{},counters:{mercy:0,defiance:0,chan_relation:0,jie_relation:0},threads:{},seenEvents:{},refreshes:[0,0,0,0],reward:[],stock:[],temper:[],promises:{},actionLog:[],storyLog:[]};
  for(const id of o.starting){const a=c.abilities.find(x=>x.id===id)!,role=abilityLoadoutSlot(a),index=SLOT_ORDER.findIndex((slot,i)=>slot===role&&!s.slots[i]);if(index<0)throw new Error('Starting loadout exceeds '+role+' capacity');s.slots[index]={id,rank:0};}s.hp=playerStats(c,s).hp;s.contentPool=selectRunPool(c,s);
  for(let act=0;act<c.acts.length;act++){
   const boss=pick(s,`route.boss.${act}`,c.acts[act].bosses??[c.acts[act].boss]);
   const bags:Record<string,string[]>={};
   for(let row=0;row<routeLength(c);row++){
    const types=c.rules.routeRows[row],order=types.length===3?sample(s,`route.${act}`,types,3):types;
    order.forEach((type,i)=>{
     const lane=order.length===1?1:i;let ref:string|undefined;
     if(['combat','elite'].includes(type)){
      if(!bags[type]?.length)bags[type]=sample(s,`route.encounter.${act}.${type}`,c.enemies.filter(e=>e.act===act&&e.kind===type).map(e=>e.id),99);
      ref=bags[type].pop();
     }
     if(type==='major')ref=c.acts[act].major;if(type==='boss')ref=boss;
     s.route.push({id:`${act}.${row}.${lane}`,act,row,lane,type,ref});
    });
   }
  }
  return new Game(c,s);
 }
 static load(c:Content,text:string):Game {
  if(text.length>4000000)throw new Error('Save too large');
  const s=JSON.parse(text) as RunState;
  if(s.version!==c.version||s.rulesVersion!==c.rulesVersion)throw new Error('Save/content version mismatch');
  if(!c.races.some(r=>r.id===s.race)||!c.origins.some(o=>o.id===s.origin)||!c.fates.some(f=>f.id===s.fate)||typeof s.seed!=='string'||typeof s.name!=='string')throw new Error('Invalid identity');
  if(!Array.isArray(s.slots)||s.slots.length!==8||!s.slots[0]||!s.slots[1])throw new Error('Invalid slots');
  const seen=new Set<string>();s.slots.forEach((eq,i)=>{if(eq){const a=c.abilities.find(x=>x.id===eq.id);if(!a||abilityLoadoutSlot(a)!==SLOT_ORDER[i]||!Number.isInteger(eq.rank)||eq.rank<0||eq.rank>3||seen.has(eq.id))throw new Error('Invalid ability');seen.add(eq.id);}});
  for(const k of ['hp','gold','xp','level','act','row','lane'] as const)if(!Number.isInteger(s[k])||s[k]<0)throw new Error('Invalid '+k);
  if(s.act>=c.acts.length||s.row>=routeLength(c)||s.lane>2||s.lane<0||s.level>=c.realms.length||!['map','battle','reward','shop','rest','event','event_result','ending','finished','dead'].includes(s.phase))throw new Error('Invalid progress');
  if(!s.contentPool||!Array.isArray(s.contentPool.schools)||!Array.isArray(s.contentPool.hybrids)||s.contentPool.schools.some(id=>!c.schools.some(d=>d.id===id))||s.contentPool.hybrids.some(id=>!c.hybrids.some(h=>h.id===id)))throw new Error('Invalid saved pool');
  s.contentPool=selectRunPool(c,s);
  if(!s.rng||!s.facts||!s.counters||!s.threads||!s.seenEvents||!Array.isArray(s.route)||!Array.isArray(s.actionLog)||s.actionLog.length>10000)throw new Error('Invalid save shape');
  migratePromiseState(c,s);validatePromiseStates(c,s);
  if(s.phase==='battle'&&(!s.battle||!c.enemies.some(e=>e.id===s.battle!.enemyId)||!Array.isArray(s.battle.frames)||s.battle.frames.length>4000))throw new Error('Invalid replay');
  if(s.pending&&!c.abilities.some(a=>a.id===s.pending!.id))throw new Error('Invalid pending reward');
  if(['event','event_result'].includes(s.phase)&&!c.events.some(e=>e.id===s.eventId))throw new Error('Invalid story');
  validateTalentState(c,s);return new Game(c,s);
 }
 stats():Stats{return playerStats(this.c,this.s);}
 build():BuildProfile{return buildProfile(this.c,this.s);}
 role(id:string):AbilityRoleInfo{return abilityRole(this.c,this.s,this.ability(id));}
 ability(id:string):Ability {const a=this.c.abilities.find(a=>a.id===id);if(!a)throw new Error('Unknown ability');return a;}
 log(command:string,...args:any[]){this.s.actionLog.push({command,args});}
 available():RouteNode[]{const s=this.s;return s.phase==='map'?s.route.filter(n=>n.act===s.act&&n.row===s.row&&(s.row===0||Math.abs(n.lane-s.lane)<=1)):[];}
 knownCharacters():string[]{return knownCharacters(this.c,this.s);}
 updateTrackedCharacter(relationKey:string|null,command:'trackCharacter'|'followCharacter'|'clearCharacterFollow'):void {
  this.requireTalentResolved();const s=this.s;
  if(s.phase!=='map'||s.pending)throw new Error('Cannot track character now');
  if(relationKey!==null&&typeof relationKey!=='string')throw new Error('Invalid tracked character');
  if(relationKey!==null&&!this.knownCharacters().includes(relationKey))throw new Error('Character not known');
  if(command==='clearCharacterFollow')this.log(command);else this.log(command,relationKey);
  if(relationKey===null)delete s.trackedCharacter;else s.trackedCharacter=relationKey;
 }
 trackCharacter(relationKey:string|null):void {
  this.updateTrackedCharacter(relationKey,'trackCharacter');
 }
 followCharacter(relationKey:string):void {
  this.updateTrackedCharacter(relationKey,'followCharacter');
 }
 clearCharacterFollow():void {
  this.updateTrackedCharacter(null,'clearCharacterFollow');
 }
  resolveStory(n:RouteNode):Story {
   if(n.ref){const existing=this.c.events.find(e=>e.id===n.ref);if(!existing)throw new Error('Broken event reference');return existing;}
   const pool=storyCandidates(this.c,this.s,n);if(!pool.length)throw new Error(n.type==='hidden'?'No hidden event pool':'No visible event pool');
   const tracked=this.s.trackedCharacter;
   const trackingMultiplier=this.c.rules.trackingMultiplier??1;
   const chosen=weighted(this.s,`event.select.${n.id}`,pool,e=>{const relevant=(e.relevance?.length??0)>0&&(e.relevance??[]).every(q=>conditionOK(this.c,this.s,q)),fresh=(this.s.seenEvents[e.id]??0)===0,trackedMatch=!!tracked&&!e.major&&!e.hiddenOnly&&e.relationKey===tracked;return Math.max(.1,(e.weight??1)*(relevant?4:1)*(fresh?1.25:.65)*(trackedMatch?trackingMultiplier:1));});
   n.ref=chosen.id;return chosen;
  }
 enter(id:string){this.requireTalentResolved();const n=this.available().find(x=>x.id===id);if(!n)throw new Error('Node not reachable');const s=this.s;s.current=n;s.lane=n.lane;s.visited.push(n.id);s.pending=undefined;s.resultText=undefined;s.lastCheck=undefined;this.log('enter',id);if(['combat','elite','boss'].includes(n.type)){s.phase='battle';s.battle=simulateBattle(this.c,s,this.c.enemies.find(e=>e.id===n.ref)!);}else if(n.type==='event'||n.type==='major'||n.type==='hidden'){s.phase='event';const ev=n.type==='major'?this.c.events.find(e=>e.id===n.ref)!:this.resolveStory(n);s.eventId=ev.id;const starts=(ev.starts??[]).filter(x=>(x.conditions??[]).every(q=>conditionOK(this.c,s,q)));s.eventPhase=starts.length?weighted(s,`event.entry.${n.id}`,starts,x=>x.weight).phase:ev.startPhase??ev.phases?.[0]?.id;s.eventStep=0;s.seenEvents[ev.id]=(s.seenEvents[ev.id]??0)+1;}else if(n.type==='treasure'){s.phase='reward';s.rewardInfo={gold:0,xp:0};s.reward=this.rollAbilities(3,'treasure','component');}else if(n.type==='shop'){s.phase='shop';this.rollShop();}else{s.phase='rest';s.temper=sample(s,'reward',STAT_KEYS,3);}}
 advance(){const s=this.s;s.current=undefined;s.pending=undefined;s.battle=undefined;s.reward=[];s.stock=[];s.resultText=undefined;s.lastCheck=undefined;s.eventId=undefined;s.eventPhase=undefined;s.eventStep=undefined;if(s.row===routeLength(this.c)-1){if(s.act===this.c.acts.length-1){s.phase='ending';return;}s.act++;s.row=0;s.lane=1;const max=this.stats().hp;if(this.c.rules.actStartFullHeal)s.hp=max;else{const healed=Math.floor(max*(this.c.rules.actStartHealPercent??0)/100),floor=Math.floor(max*(this.c.rules.actStartMinHpPercent??0)/100);s.hp=Math.min(max,Math.max(s.hp+healed,floor));}}else{s.row++;}s.phase='map';}
 finishBattle(){
  this.requireTalentResolved();const s=this.s;if(s.phase!=='battle'||!s.battle)throw new Error('No battle');
  this.log('finishBattle');s.hp=s.battle.hp;
  if(!s.battle.won){s.phase='dead';this.settlePromisesAfterAction('battle');return;}
  this.recordElitePromiseEvidence();
  const gain=this.c.rules.rewards[s.current!.type];s.gold+=gain.gold;this.gainXP(gain.xp);s.rewardInfo=clone(gain);s.phase='reward';
  const minRare=s.current!.type==='boss'?2:s.current!.type==='elite'?1:0;s.reward=this.rollAbilities(3,'reward',undefined,minRare);
  this.settlePromisesAfterAction('battle');
 }
 gainXP(amount:number){
  if(!Number.isInteger(amount)||amount<0)throw new Error('Invalid experience');
  const s=this.s;s.xp+=amount;
  while(s.level+1<this.c.rules.xpThresholds.length&&s.xp>=this.c.rules.xpThresholds[s.level+1]){s.level++;s.talentQueue.push(s.level);}
  this.prepareTalents();
 }
 prepareTalents():void {
  const s=this.s;if(s.talentDraft||!s.talentQueue.length)return;
  const level=s.talentQueue[0],eligible=this.c.talents.filter(t=>talentEligible(this.c,s,t,level)),racial=eligible.filter(t=>t.race===s.race),common=eligible.filter(t=>t.race==='common'),offers:string[]=[];
  const draw=(pool:Talent[],stream:string)=>{const available=pool.filter(t=>!offers.includes(t.id));if(!available.length)throw new Error('Talent pool exhausted');offers.push(weighted(s,`talent.offer.${level}.${stream}`,available,t=>1+(t.requires.length?2:0)).id);};
  draw(racial,'race');draw(common,'common');
  const count=Math.max(3,...this.c.talents.filter(t=>s.talents.includes(t.id)).map(t=>t.world?.draftChoices??3));
  while(offers.length<count)draw(level===1&&racial.some(t=>!offers.includes(t.id))?racial:eligible,'flex.'+offers.length);
  s.talentDraft={level,offers};
 }
 chooseTalent(id:string):void {
  const s=this.s,d=s.talentDraft,t=this.c.talents.find(t=>t.id===id);
  if(!d||['dead','finished'].includes(s.phase)||!d.offers.includes(id)||!t||!talentEligible(this.c,s,t,d.level))throw new Error('Talent not offered');
  this.log('chooseTalent',id);s.talents.push(id);s.talentHistory.push({level:d.level,id});s.talentQueue.shift();s.talentDraft=undefined;this.prepareTalents();
 }
 requireTalentResolved():void {if(this.s.talentDraft)throw new Error('Choose a talent before continuing');}

 rollAbilities(n:number,streamName:string,slot?:Slot,minRare=0):string[]{
  const s=this.s,build=this.build(),slotMatch=(a:Ability)=>!slot||(slot==='aux'||slot==='artifact'?a.slot===slot:abilityLoadoutSlot(a)===slot);let pool=this.c.abilities.filter(a=>a.rarity!=='mythic'&&inRunPool(this.c,s,a)&&slotMatch(a)&&!s.slots.some(eq=>eq?.id===a.id&&eq.rank===3)),out:string[]=[];
  const overlap=(a:Ability)=>abilityMechanicTags(a).reduce((sum,t)=>sum+(build.tags[t]??0),0),novel=(a:Ability)=>abilityMechanicTags(a).filter(t=>(build.tags[t]??0)===0).length,common=(a:Ability)=>2+Math.min(8,overlap(a))+this.role(a.id).fit+(a.rarity==='rare'?1:0);
  const choose=(lane:'reinforce'|'connector'|'wild',index:number)=>{let candidates=pool;if(lane==='connector'){const focused=pool.filter(a=>{const t=abilityMechanicTags(a),r=this.role(a.id);return r.role==='bridge'||t.includes('convert')||t.includes('consume')||t.includes('chain');});if(focused.length)candidates=focused;}else if(lane==='wild'){const fresh=pool.filter(a=>!s.slots.some(eq=>eq?.id===a.id)&&novel(a)>0);if(fresh.length)candidates=fresh;}const picked=weighted(s,`${streamName}.${lane}.${index}`,candidates,a=>lane==='reinforce'?common(a)+overlap(a)*2:lane==='connector'?common(a)+(this.role(a.id).role==='bridge'?7:0):2+novel(a)*4+(overlap(a)===0?3:0));out.push(picked.id);pool=pool.filter(x=>x.id!==picked.id);};
  if(n>=3&&!slot){choose('reinforce',0);if(pool.length)choose('connector',1);if(pool.length)choose('wild',2);while(pool.length&&out.length<n)choose('reinforce',out.length);}else while(pool.length&&out.length<n){const picked=weighted(s,`${streamName}.fit.${out.length}`,pool,a=>common(a));out.push(picked.id);pool=pool.filter(x=>x.id!==picked.id);}const floor=Math.min(Math.max(0,minRare),out.length);while(out.filter(id=>this.ability(id).rarity==='rare').length<floor){const candidates=pool.filter(a=>a.rarity==='rare');if(!candidates.length)break;let index=-1;for(let i=out.length-1;i>=0;i--)if(this.ability(out[i]).rarity==='common'){index=i;break;}if(index<0)break;const picked=weighted(s,`${streamName}.rarity.${index}.${floor}`,candidates,a=>common(a));out[index]=picked.id;pool=pool.filter(x=>x.id!==picked.id);}return out;
 }
 acquire(id:string,source:Pending['source'],price=0,index?:number){const s=this.s;if(s.pending)throw new Error('Resolve existing replacement');if(s.gold<price)throw new Error('Not enough currency');const a=this.ability(id),duplicate=s.slots.findIndex(eq=>eq?.id===id);if(duplicate>=0){if(s.slots[duplicate]!.rank>=3)throw new Error('Maximum rank');s.slots[duplicate]!.rank++;this.completeAcquire({id,source,price,index});return;}const role=abilityLoadoutSlot(a),empty=SLOT_ORDER.findIndex((slot,i)=>slot===role&&!s.slots[i]);if(empty>=0){s.slots[empty]={id,rank:0};this.completeAcquire({id,source,price,index});return;}s.pending={id,source,price,index};}
 completeAcquire(pending:Pending){const s=this.s;s.gold-=pending.price;if(pending.source==='shop')s.stock[pending.index!].sold=true;s.hp=Math.min(s.hp,this.stats().hp);s.pending=undefined;if(pending.source==='reward')this.advance();}
 replace(index:number){this.requireTalentResolved();const p=this.s.pending;if(!p||SLOT_ORDER[index]!==abilityLoadoutSlot(this.ability(p.id))||!this.s.slots[index])throw new Error('Invalid replacement');if(this.s.gold<p.price)throw new Error('Not enough currency');this.log('replace',index);this.s.slots[index]={id:p.id,rank:0};this.completeAcquire(p);this.settlePromisesAfterAction('replace');}
 cancelReplacement(){this.requireTalentResolved();if(!this.s.pending)throw new Error('No replacement');this.log('cancelReplacement');this.s.pending=undefined;}
 reward(index:number){this.requireTalentResolved();if(this.s.phase!=='reward'||!this.s.reward[index]||this.s.pending)throw new Error('No reward');this.log('reward',index);this.acquire(this.s.reward[index],'reward');this.settlePromisesAfterAction('reward');}
 skipReward(){this.requireTalentResolved();if(this.s.phase!=='reward'||this.s.pending)throw new Error('No reward');this.log('skipReward');this.advance();this.settlePromisesAfterAction('skipReward');}
 rollShop(){const s=this.s;s.stock=this.rollAbilities(3,'shop').map(id=>({kind:'ability' as const,id,price:this.ability(id).rarity==='rare'?55:35,sold:false}));s.stock.push({kind:'heal',price:25,value:30,sold:false});const stat=pick(s,'shop.stat',STAT_KEYS.filter(x=>x!=='hp'));s.stock.push({kind:'stat',price:45,stat,value:stat==='attack'?2:1,sold:false});}
 buy(index:number){this.requireTalentResolved();const s=this.s,offer=s.stock[index];if(s.phase!=='shop'||s.pending||!offer||offer.sold||s.gold<offer.price)throw new Error('Cannot buy');this.log('buy',index);if(offer.kind==='ability')this.acquire(offer.id!,'shop',offer.price,index);else if(offer.kind==='heal'){s.gold-=offer.price;s.hp=Math.min(this.stats().hp,s.hp+Math.floor(this.stats().hp*(offer.value??30)/100));offer.sold=true;}else{s.gold-=offer.price;s.bonus[offer.stat!]=(s.bonus[offer.stat!]??0)+(offer.value??1);offer.sold=true;}if(!s.pending)this.settlePromisesAfterAction('buy');}
 refresh(){this.requireTalentResolved();const s=this.s,n=s.refreshes[s.act],price=this.c.rules.refreshPrices[n];if(s.phase!=='shop'||s.pending||price===undefined||s.gold<price)throw new Error('Cannot refresh');this.log('refresh');s.gold-=price;s.refreshes[s.act]++;this.rollShop();this.settlePromisesAfterAction('refresh');}
 leaveShop(){this.requireTalentResolved();if(this.s.phase!=='shop'||this.s.pending)throw new Error('Not in shop');this.log('leaveShop');this.advance();this.settlePromisesAfterAction('leaveShop');}
 rest(kind:string,index?:number){this.requireTalentResolved();const s=this.s;if(s.phase!=='rest')throw new Error('Not resting');if(kind==='heal')s.hp=Math.min(this.stats().hp,s.hp+Math.floor(this.stats().hp*this.c.rules.restPercent/100));else if(kind==='temper'){const stat=s.temper[index??-1];if(!stat)throw new Error('Invalid temper');s.bonus[stat]=(s.bonus[stat]??0)+(stat==='hp'?12:stat==='attack'?3:2);}else{const eq=s.slots[index??-1],role=eq?abilityLoadoutSlot(this.ability(eq.id)):undefined,isGear=role==='component'||role==='relic';if(!eq||eq.rank>=3||(isGear!==(kind==='artifact')))throw new Error('Cannot rank up');eq.rank++;}this.log('rest',kind,index);this.advance();this.settlePromisesAfterAction('rest');}
 applyWorld(ef:Effect){const s=this.s,n=value(ef.value);switch(ef.type){case 'heal':s.hp=Math.min(this.stats().hp,s.hp+n+Math.floor(this.stats().hp*(ef.maxHpPercent??0)/100));break;case 'damage':s.hp=Math.max(0,s.hp-n-Math.floor(this.stats().hp*(ef.maxHpPercent??0)/100));break;case 'gain_currency':s.gold=Math.max(0,s.gold+n);break;case 'gain_xp':this.gainXP(n);break;case 'modify_stat':s.bonus[ef.stat!]=(s.bonus[ef.stat!]??0)+n+Math.floor(this.stats()[ef.stat!]*value(ef.percent)/100);break;case 'set_fact':s.facts[ef.key!]=!!ef.value;break;case 'add_counter':s.counters[ef.key!]=(s.counters[ef.key!]??0)+n;break;case 'advance_thread':s.threads[ef.key!]=String(ef.value);break;case 'rank_up':{const eq=s.slots.find(x=>x?.id===ef.key);if(eq)eq.rank=Math.min(3,eq.rank+Math.max(1,n));break;}default:throw new Error('Non-world effect in event: '+ef.type);}}
 currentEvent():Story {const e=this.c.events.find(x=>x.id===this.s.eventId);if(!e)throw new Error('No event');return e;}
 eventPhase():EventPhase {const event=this.currentEvent();if(!event.phases?.length)return {id:'root',text:event.text,choices:event.choices};const id=this.s.eventPhase??event.startPhase??event.phases[0].id;const phase=event.phases.find(p=>p.id===id);if(!phase)throw new Error('Invalid event phase');return phase;}
 checkChance(choice:Choice):number|undefined {if(!choice.check)return undefined;const st=this.stats();return clamp(Math.round(choice.check.base+(st[choice.check.stat]-choice.check.difficulty)*4+st.luck/5+talentCheckBonus(this.c,this.s)),10,95);}
  conditionLabel(q:Condition):string {switch(q.type){case 'has_talent':return `需悟得${this.c.talents.find(t=>t.id===q.key)?.name??'另一门天赋'}`;case 'race_is':return `需为${this.c.races.find(r=>r.id===q.key)?.name??'另一族裔'}`;case 'currency_at_least':return `需要 ${q.value??0} 灵石`;case 'hp_above_absolute':return `需要生命高于 ${q.value??0}`;case 'has_fact':return `需要因果 · ${this.c.labels.facts?.[q.key??'']??'旧事未成'}`;case 'counter_at_least':return `需要 ${this.c.labels.counters?.[q.key??'']??q.key} ≥ ${q.value??0}`;case 'stat_at_least':return `需要 ${this.c.labels.stats?.[q.stat??'luck']??q.stat} ≥ ${q.value??0}`;case 'thread_is':return '需要另一条旧因';case 'event_seen':return `需要先经历 ${this.c.events.find(e=>e.id===q.key)?.name??'前缘'}`;case 'act_is':return `仅在第 ${(q.value??0)+1} 幕可选`;case 'promise_state':return `承诺状态未达成`;case 'promise_reward_available':return '承诺奖励已领取';default:return '条件未达成';}}
  eventChoices(){const event=this.currentEvent(),phase=this.eventPhase();return phase.choices.map(choice=>{const unmet=(choice.conditions??[]).filter(q=>!conditionOK(this.c,this.s,q)),authoredReason=this.authoredChoiceLegal(event,phase,choice),legal=unmet.length===0&&!authoredReason;return {choice,legal,lockReason:legal?undefined:unmet.map(q=>this.conditionLabel(q)).concat(authoredReason??[]).join(' · '),chance:this.checkChance(choice),stat:choice.check?.stat,eventId:event.id,phase:phase.id};});}
 chooseEvent(id:string){
   this.requireTalentResolved();const s=this.s;if(s.phase!=='event'||s.pending)throw new Error('No event');
   const event=this.currentEvent(),phase=this.eventPhase(),info=this.eventChoices().find(x=>x.choice.id===id);if(!info||!info.legal)throw new Error('Choice locked');
   const choice=info.choice;this.log('chooseEvent',id);let result=choice.text,next=choice.next,grant=choice.grant,chance:number|undefined,roll:number|undefined,success:boolean|undefined;
   let effects=choice.effects??[];
   if(choice.check){
    chance=info.chance!;roll=Math.floor(random(s,`event.check.${event.id}.${phase.id}.${choice.id}`)*100)+1;success=roll<=chance;
    const branch=success?choice.check.success:choice.check.failure;effects=branch.effects??[];result=branch.text;next=branch.next;grant=branch.grant;s.lastCheck={eventId:event.id,phase:phase.id,choiceId:choice.id,stat:choice.check.stat,chance,roll,success};
   }
   const auth=choice.authored??(event.authored?.role==='reward'&&choice.grant?event.authored:undefined),stateBefore=auth?.promiseId?this.promiseState(auth.promiseId):undefined;
   const skipRepeat=!!auth?.promiseId&&auth.action==='fulfill'&&stateBefore?.status==='fulfilled'&&!!stateBefore.settlementClaimed;
   if(!skipRepeat)this.applyStoryEffects(effects);
   this.commitAuthoredPromise(event,phase,choice);
   const committedState=auth?.promiseId?this.promiseState(auth.promiseId):undefined;
   s.storyLog.push({act:s.act,title:event.name,choice:choice.label,phase:phase.id,result,chance,roll,success,eventId:event.id,choiceId:choice.id,category:event.category,consequence:choice.consequence,promiseId:auth?.promiseId,promiseAction:auth?.action,promiseStatus:committedState?.status,evidenceNodeId:committedState?.evidenceNodeId});
   s.resultText=result;if(s.hp<=0){s.phase='dead';this.settlePromisesAfterAction('event');return;}
   if(next){if((s.eventStep??0)>=4)throw new Error('Event phase budget exceeded');s.eventPhase=next;s.eventStep=(s.eventStep??0)+1;s.phase='event';}else s.phase='event_result';
   if(grant){
    if(auth?.role==='reward'&&auth.promiseId){const def=this.promiseDefinition(auth.promiseId)!;const state=this.promiseState(def.id);if(!state||state.finalRewardOffered)throw new Error('Reward already offered');state.finalRewardOffered=true;this.setPromiseState(def,state);}
    const ability=grant.id??this.rollAbilities(1,'event.reward',grant.slot)[0];if(ability)this.acquire(ability,'event');
   }
   this.settlePromisesAfterAction('event');
  }
 canBypassCombat(nodeId:string):boolean {
  const s=this.s;
  if(s.phase!=='map'||s.pending||s.talentDraft)return false;
  const node=this.available().find(item=>item.id===nodeId);
  if(!node||node.type!=='combat')return false;
  const def=promiseDefinitions(this.c).find(item=>item.type==='bypass_combat'),state=def?this.promiseState(def.id):undefined;
  const allowed=def?.fulfillment?.nodeTypes??(def?.fulfillment?.nodeType?[def.fulfillment.nodeType]:['combat']);
  if(!def||!state||state.status!=='active'||state.bypassPermit?.state!=='available'||!allowed.includes(node.type))return false;
  return !def.deadline||nodeAtOrBefore(node,def.deadline);
 }
 bypassCombat(nodeId:string):void {
  this.requireTalentResolved();const s=this.s;
  if(s.phase!=='map'||s.pending)throw new Error('Cannot bypass combat now');
  const node=this.available().find(n=>n.id===nodeId);
  if(!node||node.type!=='combat')throw new Error('Only a reachable ordinary combat can be bypassed');
  if(!this.canBypassCombat(nodeId))throw new Error('No bypass permit');
  const def=promiseDefinitions(this.c).find(x=>x.type==='bypass_combat'),state=def?this.promiseState(def.id):undefined;
  const allowed=def?.fulfillment?.nodeTypes??(def?.fulfillment?.nodeType?[def.fulfillment.nodeType]:['combat']);
  if(!def||!state||state.status!=='active'||state.bypassPermit?.state!=='available'||!allowed.includes(node.type))throw new Error('No bypass permit');
  this.log('bypassCombat',nodeId);s.current=node;s.lane=node.lane;s.visited.push(node.id);
  state.status='fulfilled';state.evidenceNodeId=node.id;state.settlementClaimed=true;state.bypassPermit={...state.bypassPermit,state:'consumed',usedAtNodeId:node.id};this.s.facts[def.fulfillment?.fact??def.facts.fulfilled??'tuxingsun_bypass_used']=true;this.setPromiseState(def,state);this.recordPromiseAudit(def,state,'bypass_combat');
  this.advance();this.settlePromisesAfterAction('bypassCombat');
 }
  leaveEvent(){this.requireTalentResolved();if(this.s.phase!=='event_result'||this.s.pending)throw new Error('Unresolved event');this.log('leaveEvent');this.advance();this.settlePromisesAfterAction('leaveEvent');}
 legalEndings():Ending[]{return this.c.endings.filter(e=>e.conditions.every(q=>conditionOK(this.c,this.s,q)));}
 chooseEnding(id:string){this.requireTalentResolved();if(this.s.phase!=='ending'||!this.legalEndings().some(e=>e.id===id))throw new Error('Ending unavailable');this.log('chooseEnding',id);this.s.endingId=id;this.s.phase='finished';}
  command(command:string,args:any[]){const actions:Record<string,(...a:any[])=>void>={chooseTalent:this.chooseTalent,enter:this.enter,finishBattle:this.finishBattle,reward:this.reward,skipReward:this.skipReward,replace:this.replace,cancelReplacement:this.cancelReplacement,buy:this.buy,refresh:this.refresh,leaveShop:this.leaveShop,rest:this.rest,chooseEvent:this.chooseEvent,leaveEvent:this.leaveEvent,chooseEnding:this.chooseEnding,followCharacter:this.followCharacter,clearCharacterFollow:this.clearCharacterFollow,bypassCombat:this.bypassCombat,trackCharacter:this.trackCharacter,[LEGACY_MIGRATION_COMMAND]:(payload:LegacyMigrationPayload)=>{this.applyLegacyMigration(payload);this.log(LEGACY_MIGRATION_COMMAND,payload);}};if(!actions[command])throw new Error('Invalid command');actions[command].apply(this,args);}
}
export function replayRun(c:Content,source:RunState):RunState {const g=Game.create(c,source.seed,source.origin,source.fate,source.name,source.portrait,source.race);for(const a of source.actionLog)g.command(a.command,a.args);return g.s;}
