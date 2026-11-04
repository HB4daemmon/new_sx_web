/**
 * 山海劫的故事：主线（逆潮之谜）、首领台词、人物因缘与结局。
 * 山海逆潮、渡厄真人与各人物的相遇都是游戏原创叙事，只借用山海经与神话的人物与意象。
 */
import type { RunState } from './types.js';

export interface ActStory { title: string; prelude: string[]; goal: string }

export const ACT_STORY: Record<number, ActStory> = {
  1: {
    title: '第一幕 · 东海潮口',
    prelude: [
      '那年三月，海先上了山。',
      '潮水退去之后不肯回海，沿着石阶一级一级往山上爬。你是潮口长大的散修，家在最低的那条街。',
      '老人们说，海是被什么东西叫走的。',
    ],
    goal: '循着逆潮，找到它要去哪里。',
  },
  2: {
    title: '第二幕 · 断桥',
    prelude: [
      '共工的遗影散去之前，说水不是自己往上走的，是被叫上去的。',
      '逆潮沿着旧河道一路涨到断桥。桥下的水是温的，越往上游越烫。',
    ],
    goal: '查清是什么把河推回了山。',
  },
  3: {
    title: '第三幕 · 火海',
    prelude: [
      '相柳的毒涎在河里冒了烟——热流从火海那边顶过来，把整条河推回了山。',
      '火海深处有一道火口，火光直直地照向昆仑。',
    ],
    goal: '找到火口，看看火通向哪里。',
  },
  4: {
    title: '第四幕 · 昆仑前门',
    prelude: [
      '刑天倒下前，把斧刃转向山顶：「火口连着昆仑的封口。有人在山顶聚水聚火，要炼一场劫。」',
      '昆仑的门前没有守门的神，只有一条照了一万年门的龙。',
    ],
    goal: '越过烛龙，打开天门。',
  },
  5: {
    title: '终幕 · 天门',
    prelude: [
      '天门洞开。门里是倒悬的海，和一团一团滚动的雷。',
      '海和雷绕着一个人转。他背对着你，衣角还沾着潮口的盐。',
    ],
    goal: '渡过这一劫。',
  },
};

export interface BossStory { before: string[]; after: string }
export const BOSS_STORY: Record<string, BossStory> = {
  gonggong: {
    before: ['又一个往山上走的。', '当年我一头撞断不周山，天倾西北，水才肯往东流。现在有人要把它倒回去——是不是你？'],
    after: '遗影散成一阵咸雾，最后一句话落在你耳边：「水不是自己往上走的……是被叫上去的。」',
  },
  xiangliu: {
    before: ['上游热，下游冷。', '九个头，九种毒，没有一种是从这条河里来的。你修不好这座桥。'],
    after: '相柳沉进河里，河水嘶嘶冒烟——水是烫的。真正推着河往回走的，是上游的火。',
  },
  xingtian: {
    before: ['无首的巨人背对着你，干戚指着昆仑。', '我在等那个封住天门的人下来。你若是他的人，就先死在这里。'],
    after: '刑天的斧刃慢慢转向山顶：「火口连着昆仑的封口。有人在上面聚水聚火……要炼一场劫。」',
  },
  zhulong: {
    before: ['烛龙睁开一只眼，山就亮了。', '我照了这扇门一万年。上面的人说，再收三年的水和雷，他就能自己造一场天劫，渡过去。', '你要上去，得先让天黑下来。'],
    after: '烛龙闭上眼。天门在黑暗里打开，门缝里漏出咸味和雷声。',
  },
  tianjie: {
    before: ['那人转过身。他的脸被雷光照得发白，却和潮口的老人们一样，眼角有被海风割出来的纹。', '「我叫渡厄。三百年前，我也是从潮口出发的。」', '「那年海也上了山——是我叫的。天不给我劫，我就自己造一场。」'],
    after: '雷云一层层塌下来，最后缩成你掌心里一粒滚烫的劫种。渡厄笑了一下，散成了海风。',
  },
};

/** One-line lore shown on the enemy plate and in the 图鉴. */
export const LORE: Record<string, string> = {
  shiyuan: '潮口浅滩的老鼋，背上的山石比村子还老。逆潮让它找不到回海的路。',
  leita: '风穴里的獭，毛尖带电。潮水灌进洞穴后，它们见谁都扑。',
  huochi: '无角的小螭，吐的是火也是潮气，是逆潮里生出来的怪东西。',
  hebo: '河伯的一道影子，守着潮口最后一段泄水石阶，把所有往上走的人都当成凶手。',
  gonggong: '撞断不周山的水神留下的怒意。他记得水本该往哪里流。',
  qingshe: '断桥下的青蛇，缠住过路人吸走修为，再慢慢蜕一层皮。',
  chiyu: '羽毛像刀的赤鸟，顺着上游的热风飞下来。',
  leijiao: '潜在断桥深水里的鲛人，叉上带雷。',
  jieliu: '一位截流的将军，铠甲里只剩一股不肯放水过去的执念。',
  xiangliu: '共工之臣，九首蛇身。它吐过的地方，土地都变成沼泽。',
  bifang: '一足的火鸟，所到之处必有讹火。',
  yinhuo: '在赤砂里引火的修士，把火海当成了道场。',
  chenjia: '火海谷底巡行的巨甲虫，甲壳厚到岩浆都烧不透。',
  zhurong: '火神的试炼化身，乘着两条火龙。',
  xingtian: '与天帝争神，被断首，仍以乳为目、以脐为口，操干戚以舞。',
  luwu: '昆仑的守神，虎身九尾，司天之九部。',
  kaiming: '九首人面的守门兽，每张脸都在看你有没有资格。',
  jinyan: '三足金乌的一支，替天巡行，羽毛落下就是火。',
  shoubei: '刻满昼夜的石碑，记下了每一个上过山的人——包括三百年前那一个。',
  zhulong: '人面蛇身，视为昼，瞑为夜，衔烛照九阴。',
  tianjie: '渡厄真人用三百年的海与雷炼成的劫。他自己也已经是劫的一部分。',
};

// —— 因缘：两遇人物线 ——
export type BondState = 'kept' | 'declined' | 'done';
export interface BondDef {
  id: string;
  name: string;
  glyph: string;
  /** Final-battle help when the thread is completed. */
  assist: string;
  assistLine: string;
}
export const BONDS: BondDef[] = [
  { id: 'jingwei', name: '精卫', glyph: '卫', assist: '终战中天劫化身无法混入浊符', assistLine: '一只小鸟衔着石子撞进劫云——一次，两次，一千次。劫云被填满了。' },
  { id: 'houyi', name: '后羿', glyph: '羿', assist: '终战开场一箭：天劫化身失去 15% 气血', assistLine: '山下有人拉开了弓。一箭穿云，劫光碎了一角。' },
  { id: 'yu', name: '禹', glyph: '禹', assist: '终战中天劫化身的攻击 -20%', assistLine: '倒悬的海忽然分成了九道。禹在山腰挖开的河，把劫水引走了一半。' },
  { id: 'shennong', name: '神农', glyph: '农', assist: '终战开场回满气血并获得护盾（气血上限的一半）', assistLine: '你嘴里忽然泛起一股苦味——是神农那包药。伤口一处处合上了。' },
  { id: 'nezha', name: '哪吒', glyph: '吒', assist: '终战开场剑意全满，并带 3 次换符', assistLine: '风火轮的火光从门外冲进来：「欠你一阵！」你的剑意一下子满了。' },
  { id: 'tieshan', name: '铁扇公主', glyph: '扇', assist: '终战开场天劫化身身上燃起大火（灼烧）', assistLine: '一阵芭蕉风卷着火海的火，从门缝灌进来，把劫云点着了。' },
];
export const BOND: Record<string, BondDef> = Object.fromEntries(BONDS.map(b => [b.id, b]));

// —— 结局 ——
export interface EndingDef { id: string; name: string; choice: string; desc: string; text: string[]; requires?: (run: RunState) => boolean; lockedHint?: string }
export const bondsDone = (run: RunState) => Object.values(run.bonds ?? {}).filter(s => s === 'done').length;

export const ENDINGS: EndingDef[] = [
  {
    id: 'ascend', name: '飞升', choice: '吞下劫种，渡劫飞升',
    desc: '三百年的劫是现成的。你可以替渡厄走完他没走完的路。',
    text: [
      '你把劫种按进丹田。雷从你的骨头里往外长，天门在头顶一层层打开。',
      '你飞升了。',
      '劫种带走了门里的雷，却没有带走倒悬的海。很多年以后，潮口的人在半山腰重新盖起了村子，管那片海叫「上海」。',
      '他们说，曾经有个从最低那条街走出去的人，没有回来。',
    ],
  },
  {
    id: 'return', name: '归水', choice: '捏碎劫种，放海回家',
    desc: '没有劫，就没有飞升。但海会回去。',
    text: [
      '你握紧拳头。劫种碎了，像一颗咸咸的冰。',
      '倒悬的海翻了个身，顺着火口、断桥、潮口一路往下流，三天三夜才流完。',
      '你走回最低的那条街。门口的石阶还是湿的，但水已经在往下走了。',
      '你没有飞升。你在潮口开了一间小小的道场，门口挂着一块木牌：「水往低处流。」',
    ],
  },
  {
    id: 'pillar', name: '补天', choice: '以劫为石，补一根新的天柱',
    desc: '需要两位守约之人相助。共工撞断的那根柱子，也许可以重新立起来。',
    requires: run => bondsDone(run) >= 2,
    lockedHint: '若有两位守约之人在侧，或许还有第三条路……',
    text: [
      '你没有吞下劫种，也没有捏碎它。你把它举过头顶。',
      '守约的人都来了。他们一个衔石，一个分水，一个搭弓，把劫种里的雷和海一点点捶成了一根柱子。',
      '不周山断了一万年的地方，长出了一根新的天柱。天不再往西北倾，海也不必再被谁叫走。',
      '后来的修士上山，都会在柱子下停一停。柱子上刻着很多名字，最下面一个，是你的。',
    ],
  },
];
export const ENDING: Record<string, EndingDef> = Object.fromEntries(ENDINGS.map(e => [e.id, e]));
