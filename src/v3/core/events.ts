import { RELIC, RELICS, VOW } from './content.js';
import { ELEMENTS, EL_NAME, type El } from './elements.js';
import { PATTERNS, PATTERN_ORDER } from './patterns.js';
import { chance, pick, sample } from './rng.js';
import type { RunState, Screen, Tile } from './types.js';
// Imported lazily through the function bodies to avoid a load-order cycle with run.ts.
import * as R from './run.js';

export interface EventOption {
  label: string;
  desc: string;
  can?: (run: RunState) => boolean;
  apply: (run: RunState) => string | Screen;
}
export interface EventDef { id: string; title: string; glyph: string; text: string; once?: boolean; options: EventOption[] }

const leave: EventOption = { label: '离开', desc: '不节外生枝', apply: () => '你收起心神，继续赶路。' };
const healPct = (run: RunState, pct: number) => { const h = Math.round(run.maxHp * pct); run.hp = Math.min(run.maxHp, run.hp + h); return h; };
const curse = (run: RunState, n: number) => { for (let i = 0; i < n; i += 1) R.addTile(run, { el: 'zhuo', v: 0 }); };
const tileText = (t: Omit<Tile, 'uid'>) => `${t.mod ? ({ lei: '雷', zhong: '重', ling: '灵', jing: '晶' } as const)[t.mod] : ''}${EL_NAME[t.el as El] ?? '浊'}${t.v}`;

export const EVENTS: EventDef[] = [
  {
    id: 'vow', title: '断生碑', glyph: '誓', once: true,
    text: '崖下一块断碑，碑上只有一行字：「立誓者，断一生路，得一生力。」誓言一旦立下，终生不可更改。',
    options: [
      ...['suidan', 'juenian', 'gujian'].map(id => ({
        label: `立誓 · ${VOW[id].name}`, desc: VOW[id].desc,
        can: (run: RunState) => !run.vow,
        apply: (run: RunState) => { R.applyVow(run, id); return `誓成。碑上多了一行新刻的字：「${VOW[id].name}」。`; },
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
        if (run.relics.length >= run.relicSlots) { curse(run, 3); return { name: 'reward', gold: 0, options: [], relicOptions: [{ type: 'relic', relic: relic.id }], picked: true, relicPicked: false, next: 'map' }; }
        R.gainRelic(run, relic.id); curse(run, 3);
        return `你取下了「${relic.name}」。三缕浊气钻进了符袋。`;
      } },
      { label: '叩拜', desc: '回复 20% 气血', apply: run => `前辈遗泽。回复 ${healPct(run, 0.2)} 气血。` },
    ],
  },
  {
    id: 'furnace', title: '炼符炉', glyph: '炉',
    text: '一座无人看管的炼符炉，炉火仍旺。符纸投进去，出来时沉得压手。',
    options: [
      { label: '投符入炉', desc: '选两枚符化为重符（气翻倍）', apply: run => ({ name: 'pick-tile', purpose: 'reforge', count: 2, then: { name: 'event', event: 'furnace', resolved: '炉火一收，两枚符沉如铁石。' }, title: '炼符炉 · 选至多两枚符化为重符' }) },
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
        if (!chance(run.rng, 0.5)) return '石皮剥尽——空的。赌石客笑得前仰后合。';
        const [option] = R.relicChoices(run, 1, 'elite');
        if (!option) return '石里什么都没有。';
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
      apply: (run: RunState) => { let n = 0; for (const t of run.bag) if (t.el === el) { t.v += 1; n += 1; } return `${n} 枚${EL_NAME[el]}符微微发烫，点数 +1。`; },
    })),
  },
  {
    id: 'tomb', title: '剑冢', glyph: '冢',
    text: '万剑插地，剑意未散。在这里放下的东西，不会再跟你走。',
    options: [
      { label: '葬符', desc: '移除至多两枚符', apply: () => ({ name: 'pick-tile', purpose: 'remove', count: 2, then: { name: 'event', event: 'tomb', resolved: '符纸在剑意中化为飞灰。符袋轻了。' }, title: '剑冢 · 选至多两枚符永久移除' }) },
      { label: '拔剑', desc: '获得一枚 雷金7', apply: run => { R.addTile(run, { el: 'jin', v: 7, mod: 'lei' }); return '剑出冢鸣，化作一枚雷金符。'; } },
    ],
  },
  {
    id: 'thunder', title: '雷劫遗迹', glyph: '雷',
    text: '焦黑的山顶，前人渡劫的雷意还残留在石头里。伸手去握，会疼。',
    options: [
      { label: '握雷', desc: '失去 12% 气血上限的气血，获得两枚随机雷符', apply: run => {
        run.hp = Math.max(1, run.hp - Math.round(run.maxHp * 0.12));
        const made = [0, 1].map(() => { const tile = { el: pick(run.rng, ELEMENTS), v: 5 + Math.min(3, run.act - 1), mod: 'lei' as const }; R.addTile(run, tile); return tileText(tile); });
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
        const lost = RELIC[run.relics.shift()!];
        const gained = R.relicChoices(run, 2, 'elite').filter(o => o.type === 'relic').map(o => (o as { relic: string }).relic);
        for (const id of gained) if (run.relics.length < run.relicSlots) run.relics.push(id), RELIC[id].onGain?.(run);
        return `「${lost.name}」不见了，手里多了 ${gained.map(id => `「${RELIC[id].name}」`).join('、')}。狐狸已经不在了。`;
      } },
      { label: '摸摸它', desc: '五成机会：随机一种诀式 +1', apply: run => {
        if (!chance(run.rng, 0.5)) return '狐狸咬了你一口，跑了。';
        const id = pick(run.rng, PATTERN_ORDER.filter(p => p !== 'san')); run.patternLv[id] += 1;
        return `狐狸蹭了蹭你的手。你忽然悟了：「${PATTERNS[id].name}」+1。`;
      } },
    ],
  },
  {
    id: 'demon', title: '心魔', glyph: '魔',
    text: '你的影子从地上站了起来，用你的声音说：「你到底想变多强？」',
    options: [
      { label: '直面', desc: '失去 15 气血；「三才」「三生」各 +1', apply: run => { run.hp = Math.max(1, run.hp - 15); run.patternLv.sancai += 1; run.patternLv.sheng3 += 1; return '你与它对坐良久。它叹了口气，散了。三才、三生 +1。'; } },
      { label: '斩之', desc: '失去 25 气血；「五行轮转」+2', apply: run => { run.hp = Math.max(1, run.hp - 25); run.patternLv.lunzhuan += 2; return '一剑下去，影子碎成五色。五行轮转 +2。'; } },
      leave,
    ],
  },
  {
    id: 'wanderer', title: '落难修士', glyph: '修',
    text: '一个受伤的修士靠在树下：「道友……可有灵石，借我疗伤？」',
    options: [
      { label: '解囊', desc: '花费 30 灵石；随机一种诀式 +1', can: run => run.gold >= 30, apply: run => {
        run.gold -= 30; const id = pick(run.rng, PATTERN_ORDER.filter(p => p !== 'san')); run.patternLv[id] += 1;
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
        for (const t of tiles) t.mod = 'ling';
        return `${tiles.map(tileText).join('、')} 化为灵符。`;
      } },
      { label: '拓印', desc: '「五行俱全」+2', apply: run => { run.patternLv.wuxing += 2; return '五行俱全 +2。'; } },
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
      { label: '收下石子', desc: '获得一枚 晶土6', apply: run => { R.addTile(run, { el: 'tu', v: 6, mod: 'jing' }); return '石子化作一枚晶土符。'; } },
      { label: '帮它填海', desc: '+40 灵石（海底捞出来的）', apply: run => { run.gold += 40; return '+40 灵石。'; } },
    ],
  },
];
export const EVENT: Record<string, EventDef> = Object.fromEntries(EVENTS.map(e => [e.id, e]));
