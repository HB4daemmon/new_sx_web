/** Per-act multipliers: authored numbers are act-1 scale. */
export const ACT_HP = [0, 1, 2.6, 6.5, 11, 15];
/** Enemy HP by rank (authored HP × act × rank). */
export const RANK_HP = { fight: 11, elite: 7, boss: 3.1 };
export const ACT_ATK = [0, 1.3, 1.9, 2.6, 3.3, 4.0];
export const RANK_ATK = { fight: 1.3, elite: 1.1, boss: 0.9 };
export const HEAT_HP = 0.15;
export const HEAT_ATK = 0.08;
export const ENEMIES = [
    // —— 第一幕 东海潮口 ——
    { id: 'shiyuan', name: '浅滩石鼋', title: '负山之壳', el: 'tu', act: 1, rank: 'fight', hp: 170, art: 'a1-turtle',
        moves: [{ name: '缩壳', armor: 18 }, { name: '撞击', atk: 9 }, { name: '潮涌', atk: 5, hits: 2 }] },
    { id: 'leita', name: '风穴雷獭', title: '连爪如电', el: 'jin', act: 1, rank: 'fight', hp: 125, art: 'a1-otter',
        moves: [{ name: '连爪', atk: 3, hits: 3 }, { name: '蓄雷', charge: true }, { name: '雷扑', atk: 9 }] },
    { id: 'huochi', name: '灰潮火螭', title: '吐焰为潮', el: 'huo', act: 1, rank: 'fight', hp: 145, art: 'a1-chi',
        moves: [{ name: '吐焰', atk: 4, burn: 3 }, { name: '甩尾', atk: 9 }, { name: '炎鳞', armor: 10, burn: 2 }] },
    { id: 'hebo', name: '河伯遗影', title: '浊浪之主', el: 'shui', act: 1, rank: 'elite', hp: 400, art: 'a1-elite',
        moves: [{ name: '浊浪', atk: 5, curse: 2 }, { name: '回潮', armor: 24 }, { name: '怒涛', atk: 7, hits: 2 }, { name: '蓄潮', charge: true }, { name: '倒卷', atk: 12 }] },
    { id: 'gonggong', name: '共工', title: '怒触不周', el: 'shui', act: 1, rank: 'boss', hp: 950, art: 'a1-boss',
        moves: [{ name: '撼柱', atk: 11 }, { name: '倒灌', curse: 3, atk: 4 }, { name: '怒触不周', charge: true }, { name: '天倾', atk: 14 }, { name: '潮甲', armor: 35 }],
        phase2: { name: '不周山崩', text: '共工头触不周山——天柱折，地维绝！', buff: 3,
            moves: [{ name: '山崩', atk: 9, hits: 2 }, { name: '洪流', atk: 7, curse: 2 }, { name: '怒触不周', charge: true }, { name: '天倾', atk: 16 }] } },
    // —— 第二幕 断桥 ——
    { id: 'qingshe', name: '断桥青蛇', title: '缠骨吸元', el: 'mu', act: 2, rank: 'fight', hp: 160, art: 'a2-snake',
        moves: [{ name: '缠绕', atk: 5, drain: 25 }, { name: '毒牙', atk: 4, hits: 2, burn: 2 }, { name: '蜕皮', armor: 14, heal: 0.08 }] },
    { id: 'chiyu', name: '断桥赤羽', title: '羽落如刀', el: 'huo', act: 2, rank: 'fight', hp: 135, art: 'a2-bird',
        moves: [{ name: '羽刃', atk: 3, hits: 4 }, { name: '振翅', buff: 2, armor: 8 }, { name: '俯冲', atk: 11 }] },
    { id: 'leijiao', name: '断桥雷鲛', title: '潜渊引电', el: 'shui', act: 2, rank: 'fight', hp: 175, art: 'a2-shark',
        moves: [{ name: '叉刺', atk: 9 }, { name: '雷鳍', atk: 5, burn: 3 }, { name: '潜渊', armor: 20 }, { name: '蓄电', charge: true }] },
    { id: 'jieliu', name: '玄甲截流将', title: '一戟断江', el: 'jin', act: 2, rank: 'elite', hp: 430, art: 'a2-elite',
        moves: [{ name: '玄甲', armor: 32 }, { name: '截流', curse: 2, drain: 35 }, { name: '戟扫', atk: 8, hits: 2 }, { name: '破阵', atk: 16 }] },
    { id: 'xiangliu', name: '相柳', title: '九首蛇身', el: 'mu', act: 2, rank: 'boss', hp: 1000, art: 'a2-boss',
        moves: [{ name: '九首噬', atk: 2, hits: 6 }, { name: '毒沼', burn: 6, curse: 1 }, { name: '蓄毒', charge: true }, { name: '吞吐', atk: 14 }],
        phase2: { name: '九首齐怒', text: '九首同时抬起——毒雾遮天！', buff: 1,
            moves: [{ name: '九首噬', atk: 2, hits: 8 }, { name: '毒雾', atk: 6, burn: 7 }, { name: '再生', armor: 24, heal: 0.06 }, { name: '吞吐', atk: 16 }] } },
    // —— 第三幕 火海 ——
    { id: 'bifang', name: '毕方烈羽', title: '独足讹火', el: 'huo', act: 3, rank: 'fight', hp: 150, art: 'a3-bifang',
        moves: [{ name: '讹火', burn: 6, armor: 6 }, { name: '独足踏', atk: 10 }, { name: '焚羽', atk: 5, hits: 2, burn: 2 }] },
    { id: 'yinhuo', name: '赤砂引火客', title: '砂中藏火', el: 'huo', act: 3, rank: 'fight', hp: 140, art: 'a3-sand',
        moves: [{ name: '引火', burn: 4, buff: 2 }, { name: '火砂', atk: 4, hits: 3 }, { name: '焚身', atk: 13 }] },
    { id: 'chenjia', name: '沉甲巡谷', title: '万钧之甲', el: 'tu', act: 3, rank: 'fight', hp: 200, art: 'a3-beetle',
        moves: [{ name: '沉甲', armor: 26 }, { name: '碾压', atk: 12 }, { name: '裂地', atk: 6, hits: 2 }] },
    { id: 'zhurong', name: '祝融试火', title: '乘两龙', el: 'huo', act: 3, rank: 'elite', hp: 460, art: 'a3-elite',
        moves: [{ name: '火龙', atk: 5, hits: 3, burn: 2 }, { name: '炎甲', armor: 28, buff: 2 }, { name: '蓄焰', charge: true }, { name: '焚天', atk: 16 }] },
    { id: 'xingtian', name: '刑天', title: '猛志固常在', el: 'jin', act: 3, rank: 'boss', hp: 1050, art: 'a3-boss',
        trait: 'revive', traitText: '首次被击倒时以乳为目、以脐为口，复起一次',
        moves: [{ name: '干戚', atk: 13 }, { name: '战意', buff: 3, armor: 20 }, { name: '舞干戚', atk: 5, hits: 3 }, { name: '怒吼', charge: true }],
        phase2: { name: '无首之怒', text: '刑天断首不死——以乳为目，以脐为口，操干戚以舞！', buff: 3,
            moves: [{ name: '无首之怒', atk: 9, hits: 2 }, { name: '战意', buff: 4 }, { name: '怒吼', charge: true }, { name: '断首一击', atk: 18 }] } },
    // —— 第四幕 昆仑 ——
    { id: 'luwu', name: '陆吾', title: '司天之九部', el: 'tu', act: 4, rank: 'fight', hp: 200, art: 'a4-luwu',
        moves: [{ name: '九尾扫', atk: 3, hits: 4 }, { name: '守门', armor: 30 }, { name: '虎扑', atk: 14 }] },
    { id: 'kaiming', name: '开明兽', title: '九首人面', el: 'jin', act: 4, rank: 'fight', hp: 185, art: 'a4-kaiming',
        moves: [{ name: '九面审视', drain: 40, curse: 1, armor: 10 }, { name: '镇阶', atk: 12 }, { name: '连咬', atk: 5, hits: 3 }] },
    { id: 'jinyan', name: '金焰巡天', title: '三足金乌', el: 'huo', act: 4, rank: 'fight', hp: 165, art: 'a4-sun',
        moves: [{ name: '日炎', atk: 4, burn: 6 }, { name: '金乌啄', atk: 6, hits: 2 }, { name: '烈阳', charge: true }, { name: '坠日', atk: 13 }] },
    { id: 'shoubei', name: '晨昏守碑', title: '刻尽昼夜', el: 'tu', act: 4, rank: 'elite', hp: 520, art: 'a4-elite',
        moves: [{ name: '碑文', armor: 42 }, { name: '晨钟', atk: 9, hits: 2 }, { name: '暮鼓', curse: 3, drain: 30 }, { name: '碑压', atk: 20 }] },
    { id: 'zhulong', name: '烛龙', title: '视为昼，瞑为夜', el: 'huo', act: 4, rank: 'boss', hp: 1150, art: 'a4-boss',
        trait: 'alternate', traitText: '每回合睁目闭目：在火与水之间轮换元素',
        moves: [{ name: '睁目为昼', atk: 14, burn: 4 }, { name: '闭目为夜', armor: 36, heal: 0.05 }, { name: '衔烛', charge: true }, { name: '烛照九阴', atk: 7, hits: 3 }],
        phase2: { name: '昼夜同天', text: '烛龙双目俱开——昼夜同天！', buff: 3,
            moves: [{ name: '日月同辉', atk: 10, hits: 2, burn: 4 }, { name: '烛阴', curse: 2, drain: 30, armor: 20 }, { name: '衔烛', charge: true }, { name: '焚天', atk: 24 }] } },
    // —— 终幕 天门 ——
    { id: 'tianjie', name: '天劫化身', title: '九重雷劫', el: 'jin', act: 5, rank: 'boss', hp: 1250, art: 'final-boss',
        trait: 'cycle', traitText: '每回合流转五行：元素按相生顺序变化',
        moves: [{ name: '一重雷', atk: 16 }, { name: '二重雷', atk: 7, hits: 3 }, { name: '劫云', curse: 3, drain: 30 }, { name: '蓄劫', charge: true }, { name: '九重雷', atk: 22 }],
        phase2: { name: '心魔劫', text: '雷云散尽，心魔自生——最后一劫！', buff: 4,
            moves: [{ name: '心魔', atk: 10, curse: 3 }, { name: '天雷', atk: 9, hits: 3 }, { name: '蓄劫', charge: true }, { name: '灭', atk: 30 }] } },
];
export const ENEMY = Object.fromEntries(ENEMIES.map(e => [e.id, e]));
export const ACTS = [
    { n: 1, name: '东海潮口', sub: '潮水倒灌入山，潮源不在海上', bg: 'bg-act1' },
    { n: 2, name: '断桥', sub: '旧河断处，有热流顶回潮水', bg: 'bg-act2' },
    { n: 3, name: '火海', sub: '循热流上溯，火口与昆仑相连', bg: 'bg-act3' },
    { n: 4, name: '昆仑前门', sub: '越过旧阵，独面困住水火的回流', bg: 'bg-act4' },
    { n: 5, name: '天门', sub: '独自渡过最后一劫', bg: 'bg-final' },
];
