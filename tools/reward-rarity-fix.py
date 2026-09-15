from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def replace_once(text, old, new, label):
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    return text.replace(old,new,1)

p=ROOT/'src/engine.ts'
text=p.read_text(encoding='utf-8')
text=replace_once(text,
" rollAbilities(n:number,streamName:string,slot?:Slot):string[]{",
" rollAbilities(n:number,streamName:string,slot?:Slot,minRare=0):string[]{",
'rollAbilities signature')
text=replace_once(text,
"if(n>=3&&!slot){choose('core',0);if(pool.length)choose('bridge',1);if(pool.length)choose('pivot',2);while(pool.length&&out.length<n)choose(out.length%2?'bridge':'core',out.length);}else while(pool.length&&out.length<n){const picked=weighted(s,`${streamName}.fit.${out.length}`,pool,a=>common(a)+(a.tags.some(t=>coreTags.includes(t))?2:0)+(build.bridge.tier<2&&a.tags.some(t=>weakTags.includes(t))?2:0));out.push(picked.id);pool=pool.filter(x=>x.id!==picked.id);}return out;",
"if(n>=3&&!slot){choose('core',0);if(pool.length)choose('bridge',1);if(pool.length)choose('pivot',2);while(pool.length&&out.length<n)choose(out.length%2?'bridge':'core',out.length);}else while(pool.length&&out.length<n){const picked=weighted(s,`${streamName}.fit.${out.length}`,pool,a=>common(a)+(a.tags.some(t=>coreTags.includes(t))?2:0)+(build.bridge.tier<2&&a.tags.some(t=>weakTags.includes(t))?2:0));out.push(picked.id);pool=pool.filter(x=>x.id!==picked.id);}const floor=Math.min(Math.max(0,minRare),out.length);while(out.filter(id=>this.ability(id).rarity==='rare').length<floor){const candidates=pool.filter(a=>a.rarity==='rare');if(!candidates.length)break;let index=-1;for(let i=out.length-1;i>=0;i--)if(this.ability(out[i]).rarity==='common'){index=i;break;}if(index<0)break;const picked=weighted(s,`${streamName}.rarity.${index}.${floor}`,candidates,a=>common(a)+(a.tags.some(t=>coreTags.includes(t))?2:0)+(build.bridge.tier<2&&a.tags.some(t=>weakTags.includes(t))?2:0));out[index]=picked.id;pool=pool.filter(x=>x.id!==picked.id);}return out;",
'rarity floor postprocess')
text=replace_once(text,
"s.rewardInfo=clone(gain);s.phase='reward';s.reward=this.rollAbilities(3,'reward');",
"s.rewardInfo=clone(gain);s.phase='reward';const minRare=s.current!.type==='boss'?2:s.current!.type==='elite'?1:0;s.reward=this.rollAbilities(3,'reward',undefined,minRare);",
'finishBattle rarity floor')
p.write_text(text,encoding='utf-8')

p=ROOT/'tests/engine.test.mjs'
text=p.read_text(encoding='utf-8')
anchor="test('mythic relics never appear in ordinary reward or shop pools',()=>{const g=fresh();for(let i=0;i<80;i++)for(const id of g.rollAbilities(3,'reward'))assert.notEqual(g.ability(id).rarity,'mythic');});"
addition=anchor+"\ntest('elite rewards always contain a rare choice and boss rewards contain at least two',()=>{for(let i=0;i<120;i++){for(const [type,minRare] of [['elite',1],['boss',2]]){const g=fresh('RARITY-'+type+'-'+i);g.s.bonus.attack=1000;g.s.current={id:'audit',act:0,row:0,lane:0,type};g.s.phase='battle';g.s.battle=simulateBattle(c,g.s,c.enemies[0]);assert.equal(g.s.battle.won,true);g.finishBattle();const rarities=g.s.reward.map(id=>g.ability(id).rarity);assert(rarities.filter(x=>x==='rare').length>=minRare,`${type} ${i}: ${rarities.join(',')}`);assert(!rarities.includes('mythic'));}}});\ntest('rarity-floor drafts remain deterministic',()=>{for(const [minRare,stream] of [[1,'elite'],[2,'boss']]){const a=fresh('RARITY-DETERMINISM-'+stream),b=fresh('RARITY-DETERMINISM-'+stream);assert.deepEqual(a.rollAbilities(3,'reward',undefined,minRare),b.rollAbilities(3,'reward',undefined,minRare));}});"
text=replace_once(text,anchor,addition,'engine rarity tests')
p.write_text(text,encoding='utf-8')
print('Reward rarity floor patch applied')
