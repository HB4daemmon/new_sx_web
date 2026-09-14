import {Content,RunState,inRunPool} from './engine.js';
/** Read-only recipes: no extra thresholds, passive modifiers, storage or RNG. */
export function buildPathProgress(c:Content,s:RunState){
 const equipped=new Set(s.slots.filter(Boolean).map(x=>x!.id));
 return (c.buildPaths??[]).filter(p=>p.hybrid?s.contentPool.hybrids.includes(p.hybrid):s.contentPool.schools.includes(p.school)).map(p=>{
  const pieces=p.abilities.map(id=>{const a=c.abilities.find(a=>a.id===id)!;return {id,name:a.name,owned:equipped.has(id),available:inRunPool(c,s,a)};});
  const supports=p.talents.map(id=>c.talents.find(t=>t.id===id)!).filter(t=>t.race==='common'||t.race===s.race).map(t=>({id:t.id,name:t.name,owned:s.talents.includes(t.id)}));
  return {...p,pieces,supports,owned:pieces.filter(x=>x.owned).length};
 });
}
