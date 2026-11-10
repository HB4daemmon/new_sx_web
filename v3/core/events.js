import { RELIC, RELICS, TALENTS, VOW } from './content.js';
import { ELEMENTS, EL_NAME } from './elements.js';
import { PATTERNS, PATTERN_ORDER } from './patterns.js';
import { chance, pick, sample } from './rng.js';
// Imported lazily through the function bodies to avoid a load-order cycle with run.ts.
import * as R from './run.js';
const leave = { label: '离开', desc: '不节外生枝', apply: () => '你收起心神，继续赶路。' };
const healPct = (run, pct) => { const h = Math.round(run.maxHp * pct); run.hp = Math.min(run.maxHp, run.hp + h); return h; };
const curse = (run, n) => { for (let i = 0; i < n; i += 1)
    R.addTile(run, { el: 'zhuo', v: 0 }); };
const tileText = (t) => `${t.mod ? { ling: '灵', huan: '幻', bao: '宝', lei: '倍' }[t.mod] : ''}${EL_NAME[t.el] ?? '浊'}${t.v}`;
export const EVENTS = [
    {
        id: 'vow', title: '断生碑', glyph: '誓', once: true,
        text: '崖下一块断碑，碑上只有一行字：「立誓者，断一生路，得一生力。」誓言一旦立下，终生不可更改。',
        options: [
            ...['suidan', 'juenian', 'gujian'].map(id => ({
                label: `立誓 · ${VOW[id].name}`, desc: VOW[id].desc,
                can: (run) => !run.vow,
                apply: (run) => { R.applyVow(run, id); return `誓成。碑上多了一行新刻的字：「${VOW[id].name}」。`; },
            })),
            leave,
        ],
    },
    {
        id: 'cave', title: '古修洞府', glyph: '府',
        text: '洞府深处，一具坐化的枯骨仍握着法宝。洞壁上浊气翻涌——取宝的人，都会带走一点它的怨念。',
        options: [
            { label: '取宝', desc: '获得一件随机传说法宝；符袋混入 3 枚浊符', apply: run => {
                    const pool = RELICS.filter(r => r.rarity === 'legend' && !run.relics.includes(r.id));
                    const relic = pick(run.rng, pool);
                    if (run.relics.length >= run.relicSlots) {
                        curse(run, 3);
                        return { name: 'reward', gold: 0, options: [], relicOptions: [{ type: 'relic', relic: relic.id }], picked: true, relicPicked: false, next: 'map' };
                    }
                    R.gainRelic(run, relic.id);
                    curse(run, 3);
                    return `你取下了「${relic.name}」。三缕浊气钻进了符袋。`;
                } },
            { label: '叩拜', desc: '回复 20% 气血', apply: run => `前辈遗泽。回复 ${healPct(run, 0.2)} 气血。` },
        ],
    },
    {
        id: 'furnace', title: '炼符炉', glyph: '炉',
        text: '一座无人看管的炼符炉，炉火仍旺。符纸投进去，出来时沉得压手。',
        options: [
            { label: '投符入炉', desc: '选两枚符化为宝符（+1 番）', apply: run => ({ name: 'pick-tile', purpose: 'reforge', count: 2, then: { name: 'event', event: 'furnace', resolved: '炉火一收，两枚符透出宝光。' }, title: '炼符炉 · 选至多两枚符化为宝符' }) },
            { label: '借火温养', desc: '回复 25% 气血', apply: run => `炉火温热。回复 ${healPct(run, 0.25)} 气血。` },
        ],
    },
    {
        id: 'spring', title: '灵泉', glyph: '泉',
        text: '石缝里涌出一眼灵泉，水面上浮着细碎的光。',
        options: [
            { label: '痛饮', desc: '回复 40% 气血', apply: run => `回复 ${healPct(run, 0.4)} 气血。` },
            { label: '洗髓', desc: '气血上限 +12', apply: run => { run.maxHp += 12; run.hp += 12; return '经脉一阵刺痛，随后通透。气血上限 +12。'; } },
        ],
    },
    {
        id: 'gamble', title: '赌石客', glyph: '赌',
        text: '一个满脸油彩的赌石客拦住你：「三十五枚灵石，赌一块石头。开出来是宝，开不出来是命。」',
        options: [
            { label: '赌！', desc: '花费 35 灵石：五成开出一件法宝', can: run => run.gold >= 35, apply: run => {
                    run.gold -= 35;
                    if (!chance(run.rng, 0.5))
                        return '石皮剥尽——空的。赌石客笑得前仰后合。';
                    const [option] = R.relicChoices(run, 1, 'elite');
                    if (!option)
                        return '石里什么都没有。';
                    return { name: 'reward', gold: 0, options: [], relicOptions: [option], picked: true, relicPicked: false, next: 'map' };
                } },
            leave,
        ],
    },
    {
        id: 'stele', title: '五行碑', glyph: '碑',
        text: '五面石碑围成一圈，各刻一字。手按上去，只有一面会回应你。',
        options: ELEMENTS.map(el => ({
            label: `按「${EL_NAME[el]}」碑`, desc: `符袋中所有${EL_NAME[el]}符点数 +1`,
            apply: (run) => { let n = 0; for (const t of run.bag)
                if (t.el === el) {
                    t.v += 1;
                    n += 1;
                } return `${n} 枚${EL_NAME[el]}符微微发烫，点数 +1。`; },
        })),
    },
    {
        id: 'tomb', title: '剑冢', glyph: '冢',
        text: '万剑插地，剑意未散。在这里放下的东西，不会再跟你走。',
        options: [
            { label: '葬符', desc: '移除至多两枚符', apply: () => ({ name: 'pick-tile', purpose: 'remove', count: 2, then: { name: 'event', event: 'tomb', resolved: '符纸在剑意中化为飞灰。符袋轻了。' }, title: '剑冢 · 选至多两枚符永久移除' }) },
            { label: '拔剑', desc: '获得一枚 倍金7', apply: run => { R.addTile(run, { el: 'jin', v: 7, mod: 'lei' }); return '剑出冢鸣，化作一枚倍金符。'; } },
        ],
    },
    {
        id: 'thunder', title: '雷劫遗迹', glyph: '雷',
        text: '焦黑的山顶，前人渡劫的雷意还残留在石头里。伸手去握，会疼。',
        options: [
            { label: '握雷', desc: '失去 12% 气血上限的气血，获得两枚随机倍符', apply: run => {
                    run.hp = Math.max(1, run.hp - Math.round(run.maxHp * 0.12));
                    const made = [0, 1].map(() => { const tile = { el: pick(run.rng, ELEMENTS), v: 5 + Math.min(3, run.act - 1), mod: 'lei' }; R.addTile(run, tile); return tileText(tile); });
                    return `雷意入体。获得 ${made.join('、')}。`;
                } },
            leave,
        ],
    },
    {
        id: 'fox', title: '青丘狐', glyph: '狐',
        text: '九尾狐坐在路中央，眯着眼看你腰间的法宝：「一件换两件，换不换？」',
        options: [
            { label: '换', desc: '失去最左侧的法宝，获得两件随机法宝', can: run => run.relics.length > 0, apply: run => {
                    const lost = RELIC[run.relics.shift()];
                    const gained = R.relicChoices(run, 2, 'elite').filter(o => o.type === 'relic').map(o => o.relic);
                    for (const id of gained)
                        if (run.relics.length < run.relicSlots)
                            run.relics.push(id), RELIC[id].onGain?.(run);
                    return `「${lost.name}」不见了，手里多了 ${gained.map(id => `「${RELIC[id].name}」`).join('、')}。狐狸已经不在了。`;
                } },
            { label: '摸摸它', desc: '五成机会：随机一种诀式 +1', apply: run => {
                    if (!chance(run.rng, 0.5))
                        return '狐狸咬了你一口，跑了。';
                    const id = pick(run.rng, PATTERN_ORDER);
                    run.patternLv[id] += 1;
                    return `狐狸蹭了蹭你的手。你忽然悟了：「${PATTERNS[id].name}」+1。`;
                } },
        ],
    },
    {
        id: 'demon', title: '心魔', glyph: '魔',
        text: '你的影子从地上站了起来，用你的声音说：「你到底想变多强？」',
        options: [
            { label: '直面', desc: '失去 15 气血；「同元」「相生」各 +1', apply: run => { run.hp = Math.max(1, run.hp - 15); run.patternLv.yuan += 1; run.patternLv.sheng += 1; return '你与它对坐良久。它叹了口气，散了。同元、相生 +1。'; } },
            { label: '斩之', desc: '失去 25 气血；「相生」+2', apply: run => { run.hp = Math.max(1, run.hp - 25); run.patternLv.sheng += 2; return '一剑下去，影子碎成五色，又一环环接回来。相生 +2。'; } },
            leave,
        ],
    },
    {
        id: 'wanderer', title: '落难修士', glyph: '修',
        text: '一个受伤的修士靠在树下：「道友……可有灵石，借我疗伤？」',
        options: [
            { label: '解囊', desc: '花费 30 灵石；随机一种诀式 +1', can: run => run.gold >= 30, apply: run => {
                    run.gold -= 30;
                    const id = pick(run.rng, PATTERN_ORDER);
                    run.patternLv[id] += 1;
                    return `修士塞给你一页残谱作为回礼：「${PATTERNS[id].name}」+1。`;
                } },
            { label: '劫财', desc: '+55 灵石；符袋混入 1 枚浊符', apply: run => { run.gold += 55; curse(run, 1); return '你拿走了他的储物袋。心里多了一点脏东西。'; } },
            leave,
        ],
    },
    {
        id: 'hetu', title: '河图洛书', glyph: '图',
        text: '河面浮起一块刻满点阵的龟甲。看久了，五行的界线开始模糊。',
        options: [
            { label: '参悟', desc: '随机 2 枚符化为灵符（可当任意元素）', apply: run => {
                    const tiles = sample(run.rng, run.bag.filter(t => t.el !== 'zhuo' && t.mod !== 'ling'), 2);
                    for (const t of tiles)
                        t.mod = 'ling';
                    return `${tiles.map(tileText).join('、')} 化为灵符。`;
                } },
            { label: '拓印', desc: '「相生」+2', apply: run => { run.patternLv.sheng += 2; return '相生 +2。'; } },
        ],
    },
    {
        id: 'tree', title: '不死树', glyph: '树',
        text: '昆仑以西的不死树落下一颗果子，正好落在你手里。',
        options: [
            { label: '吃下', desc: '气血上限 +15', apply: run => { run.maxHp += 15; run.hp += 15; return '气血上限 +15。'; } },
            { label: '种下', desc: '回复全部气血', apply: run => { run.hp = run.maxHp; return '果核落地生根，你在树下睡了一觉。气血全满。'; } },
        ],
    },
    {
        id: 'jingwei', title: '精卫', glyph: '卫',
        text: '一只小鸟衔着石子，一次又一次投进海里。它看了你一眼，把石子放在你脚边。',
        options: [
            { label: '收下石子', desc: '获得一枚 宝土6', apply: run => { R.addTile(run, { el: 'tu', v: 6, mod: 'bao' }); return '石子化作一枚宝土符。'; } },
            { label: '帮它填海', desc: '+40 灵石（海底捞出来的）', apply: run => { run.gold += 40; return '+40 灵石。'; } },
        ],
    },
];
// —— 道树「奇遇新卷」解锁 ——
EVENTS.push({ id: 'fusang', unlock: 'events2', title: '扶桑', glyph: '桑',
    text: '十个太阳歇过脚的扶桑树倒悬在崖边，枝头还挂着一点没散的日火。爬上去会被烫伤，但树顶有东西在发光。',
    options: [
        { label: '攀上树顶', desc: '失去 18% 气血；从三件灵品以上的法宝中选一件', apply: run => { run.hp = Math.max(1, run.hp - Math.round(run.maxHp * 0.18)); return { name: 'reward', gold: 0, options: [], relicOptions: R.relicChoices(run, 3, 'boss'), picked: true, relicPicked: false, next: 'map' }; } },
        { label: '在树下取火', desc: '获得两枚 雷火6', apply: run => { R.addTile(run, { el: 'huo', v: 6, mod: 'lei' }); R.addTile(run, { el: 'huo', v: 6, mod: 'lei' }); return '你接住两缕落下的日火，化成了雷火符。'; } },
    ] }, { id: 'yaochi', unlock: 'events2', title: '瑶池', glyph: '池',
    text: '西王母的瑶池边没有人。池水照出你身上每一件法宝，也照出你学过的每一式诀。池边石刻：「以器换道」。',
    options: [
        { label: '投一件法宝入池', desc: '失去最右侧的法宝；所有诀式 +1 重', can: run => run.relics.length > 0, apply: run => { const lost = RELIC[run.relics.pop()]; for (const id of PATTERN_ORDER)
                run.patternLv[id] += 1; return `「${lost.name}」沉进池底。池水一亮，你学过的每一式都深了一层。`; } },
        leave,
    ] }, { id: 'kuafu', unlock: 'events2', title: '夸父之杖', glyph: '杖',
    text: '一根桃木杖插在干涸的河床上。追日的巨人倒在这里，杖上还留着他没走完的路。',
    options: [
        { label: '拔起木杖', desc: '气血上限 -20；立即领悟一道随机天赋', apply: run => {
                run.maxHp = Math.max(30, run.maxHp - 20);
                run.hp = Math.min(run.hp, run.maxHp);
                const pool = TALENTS.filter(t => !run.talents.includes(t.id) && t.id !== 'dongtian');
                const t = pick(run.rng, pool);
                R.gainTalent(run, t.id);
                return `杖一离地，你身上多了一条不属于自己的路：「${t.name}」——${t.desc}。`;
            } },
        leave,
    ] }, { id: 'nvwa', unlock: 'events2', title: '补天石', glyph: '娲',
    text: '女娲补天剩下的一块五色石。它能把两样东西熔成一样，熔出来的会比原来的加起来更亮。',
    options: [
        { label: '熔符', desc: '选两枚符熔成一枚：点数相加的宝符', apply: () => ({ name: 'pick-tile', purpose: 'fuse', count: 2, then: { name: 'event', event: 'nvwa', resolved: '两枚符在五色石上化开，凝成了一枚宝符。' }, title: '补天石 · 选两枚符熔为一枚（元素取第一枚）' }) },
        { label: '收起石头', desc: '获得一枚 灵土7', apply: run => { R.addTile(run, { el: 'tu', v: 7, mod: 'ling' }); return '五色石在你手里变成了一枚灵符。'; } },
    ] });
// —— 因缘：每条线两次相遇。初遇立约有代价；再遇守约（终战相助）或收下厚礼（线就此了结）。——
const hurt = (run, pct) => { const d = Math.round(run.maxHp * pct); run.hp = Math.max(1, run.hp - d); return d; };
const bond = (run, id, state, deed) => { run.bonds[id] = state; run.deeds.push(deed); };
const relicOffer = (run, preferred) => {
    const own = new Set(run.relics);
    const pool = preferred.filter(id => !own.has(id));
    const options = pool.length ? pool.slice(0, 2).map(relic => ({ type: 'relic', relic })) : R.relicChoices(run, 2, 'boss');
    return { name: 'reward', gold: 0, options: [], relicOptions: options, picked: true, relicPicked: false, next: 'map' };
};
export const BOND_EVENTS = [
    { id: 'bond-jingwei-1', bond: 'jingwei', title: '精卫', glyph: '卫',
        text: '一只小鸟衔着石子，一次又一次投进逆潮里。潮水每涨一寸，她就多衔一块。一个浪头打过来，眼看要把她拍进水里。',
        options: [
            { label: '替她挡浪', desc: '失去 12% 气血；与精卫约好在火海再见', apply: run => { const d = hurt(run, 0.12); bond(run, 'jingwei', 'kept', '你在潮口替精卫挡了一个浪头，约好火海再见。'); return `浪砸在你背上（-${d}）。精卫落在你肩头，啄了啄你的耳朵，往火海的方向飞走了。`; } },
            { label: '收下她的石子', desc: '获得一枚 宝土6', apply: run => { R.addTile(run, { el: 'tu', v: 6, mod: 'bao' }); bond(run, 'jingwei', 'declined', '你收下了精卫的一颗石子。'); return '石子在你手心化成一枚晶土符。精卫继续衔她的石头，没有再看你。'; } },
        ] },
    { id: 'bond-jingwei-2', bond: 'jingwei', title: '精卫的堤', glyph: '卫',
        text: '火海边上横着一道石堤，每一颗石子都带着潮口的盐。堤还差最后一段，精卫站在堤头冲你叫了一声。',
        options: [
            { label: '陪她把堤垒完', desc: '失去 15% 气血；移除符袋中所有浊符。精卫会在终战相助', apply: run => { const d = hurt(run, 0.15); const n = run.bag.filter(t => t.el === 'zhuo').length; run.bag = run.bag.filter(t => t.el !== 'zhuo'); bond(run, 'jingwei', 'done', '你陪精卫在火海边垒完了最后一段堤。'); return `你搬石头搬到手掌起泡（-${d}）。堤垒成的那一刻，${n ? `${n} 枚浊符被潮气冲散了` : '你觉得心里干净了很多'}。精卫说：「上山的时候，叫我。」`; } },
            { label: '收下谢礼', desc: '从两件法宝中选一件；此线就此了结', apply: run => { bond(run, 'jingwei', 'declined', '精卫把堤里最亮的一颗石子送给了你，然后继续一个人垒堤。'); return relicOffer(run, ['chaoxi', 'wuse']); } },
        ] },
    { id: 'bond-houyi-1', bond: 'houyi', title: '后羿', glyph: '羿',
        text: '断桥头有个人在磨箭，箭头对着天。「九个太阳我射下来了，」他说，「这回天上要掉下来的东西，我想先备一支好箭。缺块铁。」',
        options: [
            { label: '替他买铁', desc: '花费 30 灵石；与后羿约好在昆仑再见', can: run => run.gold >= 30, apply: run => { run.gold -= 30; bond(run, 'houyi', 'kept', '你在断桥替后羿买了一块箭铁。'); return '后羿掂了掂铁块：「昆仑见。到时候你往上走，我往上射。」'; } },
            { label: '向他讨教', desc: '获得一枚 倍金7', apply: run => { R.addTile(run, { el: 'jin', v: 7, mod: 'lei' }); bond(run, 'houyi', 'declined', '后羿教了你一招握箭的手法。'); return '他教你怎么握箭。你把那股劲收进了一枚重金符里。'; } },
        ] },
    { id: 'bond-houyi-2', bond: 'houyi', title: '风口试射', glyph: '羿',
        text: '昆仑的风口，后羿的箭已经磨好了。他要你站到靶子旁边——风太乱，得有人替他报风向。',
        options: [
            { label: '站到靶边', desc: '失去 15% 气血；「同元」+2。后羿会在终战相助', apply: run => { const d = hurt(run, 0.15); run.patternLv.yuan += 2; bond(run, 'houyi', 'done', '你在昆仑风口替后羿报了一整天的风向。'); return `一支箭擦着你的耳朵过去（-${d}）。后羿收了弓：「准了。你上天门的时候，抬头看。」你对成双的东西忽然敏锐了许多。`; } },
            { label: '收下他的箭', desc: '从两件法宝中选一件；此线就此了结', apply: run => { bond(run, 'houyi', 'declined', '后羿把一支箭送给了你，自己留在了风口。'); return relicOffer(run, ['yinlei', 'mingmu']); } },
        ] },
    { id: 'bond-yu-1', bond: 'yu', title: '禹', glyph: '禹',
        text: '一个满腿泥的人在逆潮边挖沟。「堵是堵不住的，」他头也不抬，「得给水留条路。你身上的力气，借我一点？」',
        options: [
            { label: '借他力气', desc: '气血上限 -8；与禹约好在火海再见', apply: run => { run.maxHp = Math.max(20, run.maxHp - 8); run.hp = Math.min(run.hp, run.maxHp); bond(run, 'yu', 'kept', '你在潮口帮禹挖了一段引水沟。'); return '你挖到天黑，腰再也直不起来。禹拍拍你：「火海那边还有一段。到时候再借。」'; } },
            { label: '各走各路', desc: '+35 灵石（他塞给你的路费）', apply: run => { run.gold += 35; bond(run, 'yu', 'declined', '禹塞给你一点路费，继续一个人挖沟。'); return '他塞给你一把灵石：「路上用。」然后接着挖。'; } },
        ] },
    { id: 'bond-yu-2', bond: 'yu', title: '分水', glyph: '禹',
        text: '火海里，禹的沟已经挖到了火口边上。只差最后一锹，就能把热流引开——但那一锹得有人站在火口里挖。',
        options: [
            { label: '站进火口', desc: '失去 15% 气血；「相生」+2、「同元」+1。禹会在终战相助', apply: run => { const d = hurt(run, 0.15); run.patternLv.sheng += 2; run.patternLv.yuan += 1; bond(run, 'yu', 'done', '你站在火口里挖下了禹的最后一锹。'); return `火燎掉了你的眉毛（-${d}）。热流一分为九，顺着沟走了。你忽然明白：疏导，就是一节接一节。`; } },
            { label: '借他的息壤', desc: '气血全满，气血上限 +12；此线就此了结', apply: run => { run.maxHp += 12; run.hp = run.maxHp; bond(run, 'yu', 'declined', '禹把一捧息壤给了你，自己跳进了火口。'); return '一捧息壤敷在身上，伤全好了。禹自己跳进了火口。'; } },
        ] },
    { id: 'bond-shennong-1', bond: 'shennong', title: '神农', glyph: '农',
        text: '潮线上一个老人在搬药篓。他尝一口草，脸就绿一阵。「水往上走，药都泡坏了。帮我雇两个挑夫，把药挑到山上去？」',
        options: [
            { label: '替他雇挑夫', desc: '花费 25 灵石；与神农约好在火海再见', can: run => run.gold >= 25, apply: run => { run.gold -= 25; bond(run, 'shennong', 'kept', '你在潮口替神农雇了挑夫，把药挑上了山。'); return '神农把一包药塞进你怀里：「现在别吃。火海见。」'; } },
            { label: '讨一口药', desc: '回复 30% 气血', apply: run => { healPct(run, 0.3); bond(run, 'shennong', 'declined', '你吃了神农一口药。'); return '药很苦，伤却好了大半。神农背起药篓走了。'; } },
        ] },
    { id: 'bond-shennong-2', bond: 'shennong', title: '药棚', glyph: '农',
        text: '火海的风口搭着一座药棚。神农正在熬一锅能治劫伤的药，缺一个人试药。',
        options: [
            { label: '替他试药', desc: '失去 15% 气血；气血上限 +15。神农会在终战相助', apply: run => { const d = hurt(run, 0.15); run.maxHp += 15; bond(run, 'shennong', 'done', '你在火海药棚替神农试了一锅劫药。'); return `你吐了三回（-${d}），筋骨却硬了一圈（上限 +15）。神农把药方折好：「天门上见。」`; } },
            { label: '收下药囊', desc: '从两件法宝中选一件；此线就此了结', apply: run => { bond(run, 'shennong', 'declined', '神农把一只药囊送给了你。'); return relicOffer(run, ['changming', 'yuye']); } },
        ] },
    { id: 'bond-nezha-1', bond: 'nezha', title: '哪吒', glyph: '吒',
        text: '断桥上一个踩着火轮的少年拦住你：「听说有人要上天门？先接我一枪！」',
        options: [
            { label: '接他一枪', desc: '失去 12% 气血；与哪吒约好在昆仑再打一场', apply: run => { const d = hurt(run, 0.12); bond(run, 'nezha', 'kept', '你在断桥硬接了哪吒一枪。'); return `枪尖撞在你胸口（-${d}）。你没退。哪吒眼睛一亮：「好！昆仑再打一场！」`; } },
            { label: '让他过去', desc: '获得一枚 雷火6', apply: run => { R.addTile(run, { el: 'huo', v: 6, mod: 'lei' }); bond(run, 'nezha', 'declined', '你给哪吒让了路，他甩下一团雷火。'); return '哪吒哼了一声，丢下一团雷火就飞走了。'; } },
        ] },
    { id: 'bond-nezha-2', bond: 'nezha', title: '再接一阵', glyph: '吒',
        text: '昆仑山道上，哪吒把火尖枪插在地上：「上回没打完。这回我用三头六臂。」',
        options: [
            { label: '奉陪到底', desc: '失去 20% 气血；剑意相关天赋「剑意通明」。哪吒会在终战相助', apply: run => { const d = hurt(run, 0.2); R.gainTalent(run, 'tongming'); bond(run, 'nezha', 'done', '你在昆仑山道和哪吒打到天亮。'); return `你们打到天亮（-${d}），谁也没赢。哪吒大笑：「天门上的那个，算我一份！」你的剑意更快了。`; } },
            { label: '认输', desc: '从两件法宝中选一件；此线就此了结', apply: run => { bond(run, 'nezha', 'declined', '你向哪吒认了输，他把一件宝贝丢给了你。'); return relicOffer(run, ['leiwen', 'qiming']); } },
        ] },
    { id: 'bond-tieshan-1', bond: 'tieshan', title: '铁扇公主', glyph: '扇',
        text: '断桥上游热风扑面，一个持扇的女子拦在风口：「前面是火海，没有我的风你过不去。借风，要付钱。」',
        options: [
            { label: '付钱借风', desc: '花费 30 灵石；与铁扇约好在昆仑还扇', can: run => run.gold >= 30, apply: run => { run.gold -= 30; bond(run, 'tieshan', 'kept', '你在断桥向铁扇公主借了一阵风。'); return '她轻轻一扇，热风倒卷回火海。「扇子借你的风，到昆仑来还。」'; } },
            { label: '硬闯热风', desc: '失去 8% 气血，获得一枚 灵火5', apply: run => { hurt(run, 0.08); R.addTile(run, { el: 'huo', v: 5, mod: 'ling' }); bond(run, 'tieshan', 'declined', '你没有借铁扇的风，硬闯过了热风。'); return '你被燎得够呛，却从热风里抓住了一缕灵火。'; } },
        ] },
    { id: 'bond-tieshan-2', bond: 'tieshan', title: '还扇', glyph: '扇',
        text: '昆仑脚下，铁扇公主等着你还她的风。「天门上那团火是偷来的，」她说，「我想把它扇回去。你帮我扛着扇子上山。」',
        options: [
            { label: '扛扇上山', desc: '失去 15% 气血；符袋中所有火符点数 +2。铁扇会在终战相助', apply: run => { const d = hurt(run, 0.15); for (const t of run.bag)
                    if (t.el === 'huo')
                        t.v += 2; bond(run, 'tieshan', 'done', '你替铁扇公主把芭蕉扇扛上了昆仑。'); return `扇子重得像一座山（-${d}）。扛到半路，你的火符都烫手了。`; } },
            { label: '收下扇骨', desc: '从两件法宝中选一件；此线就此了结', apply: run => { bond(run, 'tieshan', 'declined', '铁扇公主拆下一根扇骨送了你。'); return relicOffer(run, ['xinhuo', 'chiyan']); } },
        ] },
];
export const EVENT = Object.fromEntries([...EVENTS, ...BOND_EVENTS].map(e => [e.id, e]));
