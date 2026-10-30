# 山海版首发内容库

版本：`shanhai-content-0.2`，日期：2026-10-27。

这里是新版内容的单一编辑来源，采用 YAML 1.2，每个实体一个文件；根游戏构建先校验内容，
再为 `src/shanhai/` 运行时按目录编译独立实体文件。文档站的内容阅读页由独立工具生成，
不手工维护第二份卡面。数值是可用于首轮实现的设计输入，不是已平衡或实测结果。

## 范围与目录

| 目录 | 范围 |
| --- | --- |
| `rules/` | 公共规则、首测属性与经济、状态语义 |
| `methods/` | RKF01-RKF10；每门基础动作、行旅、12 张天赋、3 条路线 |
| `artifacts/common/` | RC01-RC24 |
| `artifacts/rare/` | RR01-RR15 |
| `artifacts/legendary/` | RL01-RL08 |
| `events/ordinary/` | RE001-RE036，36 个短事件 |
| `events/core/` | RK001-RK016，12 次人物相遇与4个独立机缘 |
| `storylines/` | RS01-RS06，每条恰好两次相遇 |
| `enemies/act1/` 至 `act4/` | 每幕4普通、2精英、2候选首领，共32套 |
| `enemies/final/` | EN-F1、EN-F2，两种终战候选 |
| `acts/` | RA01-RA04及RF01；节点、池、主线、资源与幕间文案 |
| `manifest.yaml` | 显式文件清单、数量与版本；新增文件必须登记 |

单局仍为四幕各11节点加一场终战。每局只计划一条两遇人物线，加零或一个独立机缘；
实际可全绕过。内容池数量不增加单局节点，不保证每个角色、功法或传奇出现。

四幕共同叙事以 `docs/shanhai/rework/STORY_ARC.md` 为准。幕 `story` 中的目标、前情、
战前、战后、过幕与胜败文案只读展示；`boss_variants` 按实际遇到的一个首领 ID 选择，
不把候选名单写成同局全部战果。

事件选项可写 `story_echo`，内部战选项可另写 `story_failure_echo`，均为非空、
最多 100 个 Unicode 字符的行迹短句。它们不产生旗标或资源；`outcome` 与
`encounter.failure_outcome` 仍负责当下结算叙述。回声只从已完成的事件及选项历史读取，
内部战另需明确成功或失败结果；旧存档缺结果时不猜胜利。延迟约定的立约与兑现分开写，
不得在立约回声中提前发放奖励。

## 编辑与验证

独立工具位于 `tools/content-kit/`，使用自身依赖与锁文件，不修改根目录依赖：

```sh
cd tools/content-kit
npm ci
npm test
npm run validate
npm run docs
```

`docs` 只生成明确列出的阅读页；文档站自动扫描 `docs/shanhai/` 并发布 Markdown，
不需要逐页登记、手动执行站点构建或暂停 watcher。
未准备公开的草稿应留在公开根之外或隐藏目录，校验通过后再生成正式阅读页。
YAML 文件、校验报告、内部工具不作为静态资源公开。

## 所有实体的公共字段

```yaml
schema_version: 1
content_version: shanhai-content-0.2
kind: artifact
id: RC01
name: 青锋石
status: design_target
summary: 攻击提高
description: 一块开过刃的青石，适合补足直接输出。
tags: [attack, direct]
source:
  basis: original
  reference: null
  note: 游戏原创器物，不声称古籍存在此效果。
balance:
  target: {B: 1}
  measured: null
```

- `kind` 为 `rules/method/artifact/event/storyline/enemy/act`。
- V2 内容版本为 `shanhai-content-0.2`；schema shape 仍是 1。它取代 V1 的法宝无限生效规则，并给指定功法、法宝增加显式的 resonance 被动规则。
- `source.basis` 为 `original/myth_adaptation`；人物原典确认与游戏原创能力分开写。
  不确定来源使用 `reference:null` 并注明待核验，不编造知识库 ID、回目或校对状态。
- 所有记录 `status:design_target`、`balance.measured:null`。可写首测系数，
  不把目标直接复制到实测。公式和资源值不能写成待实现的任意 JavaScript。
- 玩家名与短说明分开。天赋正式名四个汉字，`quick` 是直白的选择摘要。

## 效果块

功法动作、被动、行旅、天赋与法宝共用描述结构：

```yaml
- id: RKF01-BASIC-DAMAGE
  trigger: basic_action
  operation: damage
  target: enemy
  params: {attack_ratio: 1.0, segments: 1, can_crit: true}
  requires: []
  consumes: []
  replaces: []
  limit: {scope: action, count: 1}
  text: 按攻击造成一段伤害。
```

效果 ID 全局唯一；`requires/consumes/replaces` 必填数组，表达明确输入、消费和替代关系。
`replaces` 引用本实体的效果 ID；跨实体修改在 `params` 中引用规则选择器，不伪造本地 ID。
每个效果的 `text` 必须足以让实现者理解顺序，不能只写泛称“加强流派”。

允许的 `trigger`：
`battle_start/basic_action/rage_action/basic_hit/direct_hit/direct_crit/action_end/enemy_action_end/
shield_absorbed/shield_broken/heal_resolved/overflow_resolved/dot_resolved/round_end/
node_complete/battle_node_complete/rest_complete/event_cost_paid/always`。

允许的 `operation`：
`damage/heal/shield/apply_status/modify_stat/modify_effect/rage_gain/rage_cap/rage_drain/
rage_drain_resist/convert_overflow/consume_status/consume_shield/advance_phase/grant_resource/
prepare_next_battle/reduce_event_cost/replace_action/chance_damage/modify_chance`。

`target` 为 `self/enemy/both/run`；`limit.scope` 为
`segment/action/enemy_action/round/battle/node/run/permanent`，`count` 为正整数。
百分比用0至1比例；暴击率也用比例，不用“2”表示2个百分点。次数与层数均为整数。
这是设计数据协议，不代表通用效果引擎已实现；复杂条件仍需实现时逐项接线测试。

### V2 共鸣规则

V2 共鸣效果只允许用于已接入的实体，且只能放在功法 `passives` 或法宝 `effects`。
效果固定为 `trigger: always`、`operation: modify_effect`、`target: self`、空的
`requires/consumes/replaces` 和 `{scope: permanent, count: 1}`；ID 必须是实体 ID 加
`-V2-RESONANCE`。该 limit 只安装规则，不表示每战只触发一次。不能把规则放进功法天赋，
不能复制旧触发作为第二套效果。

| 实体 | `params.resonance` | 其它参数键 |
| --- | --- | --- |
| RKF01 | `guard_pressure` | `absorb_ratio`, `cap_hp_ratio`, `release_ratio`, `counter_threshold_hp_ratio` |
| RKF02 | `returning_breath` | `extra_segments`, `segment_ratio`, `rage_bonus` |
| RKF03 | `spring_bloom` | `threshold_hp_ratio`, `burst_hp_ratio` |
| RKF04 | `burn_accelerate` | `ticks` |
| RKF05 | `sword_array` | `artifact_intent_limit`, `consume_stacks`, `attack_ratio`, `opening_swords`, `flying_sword_cap`, `flying_sword_ratio` |
| RKF07 | `thunder_induction` | `hit_threshold`, `attack_ratio`, `max_per_action` |
| RKF08 | `moon_hex` | `attack_ratio`, `drain_per_kind` |
| RC13 | `shield_retort` | `defense_ratio` |
| RR03 | `venom_pin` | `hit_threshold`, `poison_stacks`, `duration_rounds`, `attack_ratio`, `max_per_action` |
| RR04 | `wealth_strikes` | `coins_per_segment`, `max_segments`, `attack_ratio` |
| RR09 | `rebound_guard` | `rage_gain`, `defense_ratio` |
| RR11 | `toxic_furnace` | `remaining_damage_ratio`, `rage_gain` |
| RR12 | `healing_blades` | `max_charges`, `attack_ratio` |
| RL02 | `ember_furnace` | `stored_ratio`, `cap_hp_ratio`, `segments` |
| RL03 | `wheel_storm` | `hit_threshold`, `segments`, `attack_ratio`, `max_per_action` |

`params` 只能使用 `resonance` 和表中该实体的参数键，不可省略或添加字段；所有参数必须
是有限非负数，比例不超过 1，阈值必须大于 0，次数/层数/段数必须是正整数。RKF01盾压
达到最大气血12%或敌方主动作真实破盾后独立释放一次；RKF03自疗最多储存两份春生阈值，
在存活敌方主动作结束后至多消费一份；RKF05开战携一柄、普攻后逐柄养剑，存活敌方主动作
后每柄以0.18倍率齐射。参数范围和
数值由内容工具校验，怒气点数也必须是整数。规则的具体时机、排除项和资源结算顺序写在
卡面 `text`；其它实体与功法天赋均不得声明 V2 共鸣规则。

### 反应试炼与悬赏寻器

只有 `EN-A1-B1` 和 `EN-A1-B2` 可声明可选 `trial`，字段必须按类型精确匹配，未知、遗漏
或其它敌人的试炼配置均会被校验拒绝。潮势试炼 `{kind: tidal_charge, period: 3,
charges: 3, attack_ratio_per_charge: 0.45}` 每次敌方有效直接或派生命中消耗一层，
不受持续伤害或反震影响；回生雾 `{kind: reviving_mist, period: 3, charges: 3,
heal_hp_ratio_per_charge: 0.045}` 只被实际扣除气血的中毒/燃烧跳伤打断。两者的公开
`preview` 与 `counterplay` 都必须说明周期、准备内容和实际打断手段。

`RULES.economy.reward_seeking` 固定公开 `{price: 8, max_per_act: 1, families: ...}`；
四个且仅四个显式族为 `sword/guard/vitality/affliction`，引用现存普通或稀有法宝 ID，
每族至少各含两张普通与稀有法宝，允许跨族复用，不允许族内重复或用传奇卡填数。寻器只在
首个保底核心奖励之后的第1-4幕奖励阶段开放；免费预览不重抽，付款后仅替换原候选，不加
奖励位、不升稀有度、不用无关卡补满，实际支付进入行旅账本。RC01 青锋石保留
`common_artifact` 获取池，并加入 sword 寻器族。

`RULES.economy.reward_refining` 固定为 `{max_per_act: 1}`，校验要求仅含该字段且值必须
为整数 `1`。第1-4幕初始保底核心奖励之后，冻结的普通法宝奖励候选可炼化，每幕最多一次：
放弃本次整组候选，消耗一层已拥有且未装备的普通法宝，为另一件已装备且未满
`max_stacks` 的普通法宝增加一层。来源与目标必须不同；不能炼化空候选、混合/稀有/
传奇候选或保底核心奖励，也不能在错误阶段、奖励未结算、次数耗尽、来源未装备、目标
不存在/已满层或引用非法时执行。炼化不收付灵石、不增加新法宝种类、稀有度或额外领取；
来源最后一层可被消耗，持有种类数会随之减少。增加最大气血不治疗，既有节点入场行旅快照
继续生效。先寻器再炼化允许，但不退寻器费用，也不再产生第二份奖励。

## 各类型必填内容

### 功法

`rarity` 为 `common/rare/legendary`；RKF01-05普通、06-08稀有、09-10传奇。
字段：`role/stat_focus/mechanic/acquisition/companion/actions/passives/travel/talents/routes`。
`mechanic` 描述最多一种专属状态，没有时为 `null`。
`acquisition: {start: true, pools: [method_common]}`，仅普通可开局选。
`companion` 固定含 `name/quick/trigger/effect/pair_bonuses`，可选含 `alternate_effect`；`effect` 与
可选 `alternate_effect` 均必须严格为 `{kind, value}`。有 `alternate_effect` 时，无适用配对加成的
合格存活主动作依次使用 `effect`、`alternate_effect` 并循环；配对加成生效时只使用配对效果，不推进循环。配对由不同主修功法 ID 与
触发事件匹配；交替状态按携带伴生者的一方独立，并在每场战斗重置。
`actions.basic` 与 `actions.rage` 各含 `name/quick/effects`；`passives/travel` 为效果数组。
`talents` 恰好12项：
`{id: RKF01-J1-A, tier: 1, branch: A, name: 金刚厚壁, quick: 普攻怒技加盾,
category: enhance, effects: [...]}`。
`category` 为 `enhance/cycle/convert`。四层每层A/B/C三选一，无跨层隐藏前置。
`routes` 三项，含 `name/summary/talents`，每条选四个合法不同层的ID，允许混列。
`balance.target` 至少包含 `P_by_tier`，普通100/125/150/175/200，稀有乘1.1，
传奇乘1.25。动作系数只是初版输入，不声称实际P达到目标。

### 共享突破天赋

`rules.insights` 是16项跨功法共享天赋：首阶七项，第二至第四阶各三项，ID 固定为
`V2-J1-A` 至 `V2-J1-G`、`V2-J2-A` 至 `V2-J4-C`，字段与功法天赋相同：
`{id, tier, branch, name, quick, category, effects}`。候选可给任何功法使用；
每个角色的首破从一阶七项中按种子固定展示三项；后续突破将本阶一项功法天赋与两项共享天赋并列展示。
候选冻结，不因查看、重读或切换功法重抽。

15项新共享机制必须使用唯一效果结构：`trigger: always`、`operation: modify_effect`、
`target: self`、`limit: {scope: permanent, count: 1}`，并将`requires/consumes/replaces`
留空数组。此limit只表示安装一条规则，不限制kind内部的命中或行动触发次数；
参数严格为`{build: <kind>, ...}`，每种kind只能使用下表列出的字段：

| ID | `build` | 参数与取值范围 |
| --- | --- | --- |
| V2-J1-A | `wealth_damage` | `scale: 0..5`、`half_saturation: 1..10000` |
| V2-J1-B | `hunter` | `base_attack/base_defense/elite_attack/elite_defense/boss_attack/boss_defense: 0..100` |
| V2-J1-C | `speed_damage` | `speed_bonus: 0..100`、`max_multiplier: 1..5` |
| V2-J1-D | `carapace` | `defense_per_hit: 0..100`、`reflect_ratio: 0..1` |
| V2-J1-E | `spending_power` | `base_attack: 0..100`、`attack_per_coin: 0..1` |
| V2-J1-F | `collection_damage` | `base_bonus/per_kind: 0..1` |
| V2-J1-G | `blood_vow` | `healing_multiplier: 1.5`、`damage_multiplier: 1.35` |
| V2-J2-A | `bounty` | `attack_bonus: 0..100`、`normal_coins/elite_coins/boss_coins: 0..1000整数` |
| V2-J2-B | `shop_discount` | `ratio: 0..1` |
| V2-J2-C | `basic_split` | `extra_segments: 1..10整数`、`segment_ratio: 0..1` |
| V2-J3-A | `hit_rage` | `amount: 0..100整数` |
| V2-J3-B | `rage_echo` | `ratio: 0..1` |
| V2-J3-C | `veteran_shield` | `base_ratio/elite_ratio/boss_ratio: 0..1` |
| V2-J4-A | `wealth_shield` | `base_shield: 0..10000`、`shield_per_coin: 0..100` |
| V2-J4-B | `trophy_damage` | `base_bonus/elite_bonus/boss_bonus: 0..1` |

仅V2-J4-C保留既有`always/modify_stat`：自身攻击`percent_add: 0.35`。效果ID必须为
天赋ID加`-BUILD`（J4-C为`-ATTACK`）；不得添加参数、效果字段或功法专属条件。

### 法宝

字段：`rarity/max_stacks/unique_group/equipment_role/attributes/effects/acquisition`；
普通核心法宝另有受限枚举的 `core_rule`。
`attributes: {flat: {attack: 6}, percent: {}}`，只允许五维
`attack/defense/max_hp/crit_rate/speed`；暴击率放flat且按比例加。

仅 RL08 `昆仑镜` 可声明 `mirror_rule: {kind: neighbor_awakening}`，且规则映射不得增加
其它字段或新kind。它只镜映紧邻右侧已装备、达到该法宝满层数，并拥有 `awakening.trigger`
为 `basic/rage/either` 且含 `awakening.effects` 的法宝：右侧本体按原规则结算，镜器在相同的
普攻或怒技结束时复制该次觉醒输出一次。它不复制属性、行旅、核心规则或融合，也不适用于
没有显式普攻/怒技结束触发效果的旧式被动、破盾或治疗事件觉醒；右侧为空、层数未满或
没有合格觉醒时无效。这项规则只覆盖上述明确的觉醒输出，不代表通用触发复制。
普通按已定3或5层，稀有/传奇1层。每局最多装备五件互不重复的法宝，不按
`equipment_role`拆分容量；`core/support`仅是描述类型：`RC01`、`RC09-RC12`、`RC14-RC15`、
`RL01-RL07` 为 `core`，其余为`support`。层数不额外占装备件数，但获得与持有层数仍受法宝
`max_stacks` 约束。
库存仍记录在 `state.artifacts`；只有已装备的法宝层数进入属性、战斗配装和节点行旅快照，
未装备法宝没有属性或行旅收益。装备容量未满时，新取得的法宝自动装备；替换或卸下不治疗、
不刷新节点、不重抽遭遇。地图、奖励、商店、休整和幕间可调整，事件、斗法及战前预览中不可调整。
已装备法宝的槽位顺序可自由调整；处于同一触发结算路径的法宝效果按槽位顺序处理。不同触发类别
之间不设统一的全局顺序；融合规则使用独立的固定优先级。
法宝获取机会与装备容量互不替代；装备已满时可保留库存中的未装备法宝，但不会使其生效。
法宝配装仍受总件数限制；纯属性与机制法宝自由组合，不要在已定 A/J/B 预算外补免费属性。
核心定位法宝的玩家摘要与说明必须讲明能力、代价与定位，不把 `core_rule` 再复制成普通 `effects`。
只有装备对应法宝时，其独立规则生效，参数不乘法宝叠层数。七件普通核心规则如下：

| 法宝 | 规则 | 参数与取舍 |
| --- | --- | --- |
| RC01 | `basic_convergence` | `damage_ratio: 1.25`；只将每次存活主普攻的基础段合为一次不可暴击直接命中，每次行动一次、不随层数叠加；保留攻击+6/层，满层另有独立追击觉醒 |
| RC09 | `basic_echo` | `ratio: 0.45`；怒技基础伤害倍率 `0.65` |
| RC10 | `rage_gambit` | 怒技完成返怒 `20`；受到直接伤害倍率 `1.12` |
| RC11 | `shield_burst` | 开场护盾为最大气血 `0.12`；怒技消耗实际护盾，参数 `shield_ratio: 0.5`、`damage_ratio: 1.4` |
| RC12 | `healing_guard` | 普攻按最大气血 `0.04` 自疗；有效治疗转护盾比例 `0.6`；直接伤害倍率 `0.8` |
| RC14 | `poison_detonation` | 普攻施加1层中毒；怒技消费自身施加的中毒，按剩余 tick 与倍率 `1.1` 造成伤害 |
| RC15 | `burn_siphon` | 普攻施加1层燃烧；燃烧实际造成气血伤害的 `0.25` 转为治疗；怒技基础伤害倍率 `0.8` |

传奇核心不添加第二套 `core_rule`；`RL01/RL04/RL05` 保留原有机制，
`RL02/RL03` 的旧效果由上文共鸣规则替换，不同时执行旧出口。
`unique_group:null` 或真实互斥组，RL01为`overflow_outlet`。
`acquisition.pools` 引用 `common_artifact/rare_artifact/legendary_artifact` 等公共池。
`balance.target: {B: 1, A: 5, J: 0}`；旅途型按法宝基线分摊，不能在B外再免费加属性。
保留44件既有法宝的ID、名称、层数和基础属性；新增两件融合传奇各一件且不附加基础属性，以及传奇昆仑镜。
融合数据固定为 `fusion_recipe: {inputs: [<两张普通法宝ID>], fights: 2}` 与
`fusion_rule: {kind: toxic_flame|twin_swords}`，并且 `acquisition.pools: []`，不进入商店或随机奖励池。
每场计数的合格战斗可来自普通流程或事件内部战斗；战斗开始和胜利结算时都须持有每种材料至少一层，
融合完成时各消耗一层。RL06 配方为 RC14+RC15；RL07 配方为 RC01+RC09；每个配方只对应唯一融合产物。
`fusion_recipe` 与 `fusion_rule` 只允许出现在 RL06/RL07；二者均为一件、无基础属性，配方输入
ID 必须存在、不得重复，且不得出现在任何随机获取池中。已有核心普通法宝 RC01 仍保留
`common_artifact` 获取资格，供首次普通核心奖励按现有规则抽取。
V2契约指定的交互卡按新规则替换旧触发，
其余效果和数值沿用既定内容；补全未定参数时写清首测值。
可选 `awakening: {at_stacks: 3, name: ..., quick: ...}` 只能在
`at_stacks == max_stacks` 时声明完整叠层觉醒；相应法宝效果可写顶层 `min_stacks`，
必须为不超过该法宝上限的正整数。达门槛后该效果只触发一次，不乘总层数；
其它实体效果不能使用 `min_stacks`。阅读页显示觉醒条件与效果门槛。

### 事件

字段：`event_type/acts/scene/options/settlement`，普通为`ordinary`、核心为`core`。
`acts` 为允许出现幕的整数数组。场景尽量两句内，通常2-3个互斥选项；已有三个
风险或交易分支的事件可增加第4个无成本离开选项，不删除旧选项或改写旧选择的含义。
每个选项含 `id/label/quick/requirements/costs/rewards/outcome`，可选含 `commitment`；
`requirements/costs/rewards` 均为数组，`outcome` 是玩家选择后的短文案。
选项 ID 必须以事件ID开头。代价或奖励条目：

```yaml
costs:
  - {type: resource, resource: hp, amount: 0.12, basis: reference_hp, must_survive: true}
rewards:
  - {type: artifact, id: RC03, count: 2}
  - {type: resource, resource: coins, amount: 0.2, basis: common_price}
```

资源仅`hp/coins/xp`，`basis` 为`flat/reference_hp/common_price/next_xp`；
后三者读取当前阶段冻结参照，不读下次突破剩余缺口。
其它奖励类型：
`{type: method, id: RKF03}`、`{type: pool, pool: common_artifact, count: 1}`、
`{type: preparation, effect: shield, amount: 0.1, basis: reference_hp}`、
`{type: swap_method, pool: owned_methods}`。
资格：`{type: can_pay}`、`{type: capacity, id: RC03, count: 2}`、
`{type: owned_artifact, id: RC07, count: 1}`、
`{type: flag, id: RS01-promised, value: true}`、`{type: known_method, id: RKF03}`。
`capacity` 检查还能取得几层，`owned_artifact` 检查实际持有，二者不能替代。
可另加 `set_flags` 对象、`encounter: {enemy_id: EN-A1-C1, mode: nonlethal,
failure_hp_floor: 1, failure_rewards: [], failure_outcome: ...}`；
有encounter时 `rewards/outcome` 只在胜利兑现。失败不发通用战斗包。

同一选项禁止同时使用 `encounter` 与 `commitment`。延迟承诺是选项的一部分，不增加节点、
不刷新候选。结构固定为：

```yaml
commitment:
  name: 护送药箱
  after_nodes: 3
  avoid_node_types: [R]
  rewards:
    - {type: artifact, id: RC17, count: 2}
  success_outcome: 药箱送达，取得两层行医囊。
  failure_outcome: 护送失约，已付盘缠不退，也没有行医囊。
```

`after_nodes` 仅允许2或3；`avoid_node_types` 必须是一个或两个不重复的 `R`/`S`。
延迟奖励只允许已支持的固定法宝奖励，或 `basis: flat` 的气血、灵石、修为奖励；
法宝层数必须是1至5的有限整数，单项承诺最多3种奖励。事件所在节点不计数；
从该节点之后开始，每完成一个真实非终战节点计一次，跨幕继续计数。进入承诺列出的休整
或商店节点即失约；进入终战 `F` 时，尚未兑现的承诺过期。死亡后不推进承诺，也不处理其
奖励。兑现、失约或过期都只结算一次；失约和过期不退已付成本，不发延迟奖励。承诺内容
（来源事件/选项、幕/步、剩余节点数、状态及选项内容快照）保存在本局状态中，旧存档缺少
该字段按空列表读取。

即时检定可加在不含内部战斗的选项上；检定不作为选项可用性条件，不能暗扣气血或另加
失败成本。`rewards/outcome/story_echo` 是成功分支，`check.failure_rewards`,
`check.failure_outcome` 与 `check.failure_echo` 是失败分支：

```yaml
check:
  kind: stat
  hint: 稳住身形后再压入炉料。
  stat: hp_ratio
  threshold: 0.55
  failure_rewards: []
  failure_outcome: 炉料滑脱，没有取得器物。
  failure_echo: 炉料滑脱，你收拾行装继续前行。
```

`kind: stat` 比较 `stats[stat] >= threshold`；`stat` 可为五维 `attack/defense/max_hp/
crit_rate/speed` 或当前气血比 `hp_ratio`。概率检定使用 `kind: chance` 与 `chance: 0..1`，
可选 `bonuses` 为 `{type: stat, stat, threshold, amount}`、
`{type: method, id, amount}` 或 `{type: artifact, id, amount}`；各满足条件的 `amount`
累加到基础概率，最后限制在 `0.05..0.95`。检定按固定命名种子
`seed/act/step/eventId/optionId` 计算，不消费全局随机序列；一次选择只结算一次。失败奖励
使用已支持的奖励类型，失败回声最多 100 个 Unicode 字符。检定对象和加成只允许协议字段，
非法属性/功法/法宝引用及未知字段均会使内容校验失败。

可选 `reveal: hint` 在选择前隐藏具体奖励与分支结果，但照常公开成本、条件和 `check.hint`。
RE001-C、RE002-B 的 `legacy_commitment` 与 `legacy_story_echo` 仅供旧存档读取，不能作为新局
延迟承诺；迁移时保留原承诺对象与原成功回声，不把它们显示为新局奖励。
同一选项不能同时有 `encounter` 和 `check`。每个事件仍应保留至少一个不依赖灵石或法宝容量的安全退出。

兑现法宝时若容量已满，或实际唯一组冲突导致无法取得对应层数，未取得的每层按公开政策
折为4枚灵石；不能把无效层数作为白送奖励，也不按失约原因额外补偿。事件快读文案和阅读
页必须分别说明即时效果、兑现条件、失约/终战过期及不退款；选了承诺不会追加节点或候选。

`settlement` 至少写
`{once: true, internal_battle_package: false, travel_triggers: 1, fallback: coins}`。
如需更多效果，先明确结构，不用无定义的新资源、无限随机数或免费追加节点。
按事件基线给 `balance.target.gross_U` 区间；购买列成本，不按免费获得累计。

新局不再投放 `commitment` 型延后任务。上面的承诺协议仅维护已有付费存档；
新内容采用即时奖励、即时检定或当场内部挑战，不增加“走若干节点后再领奖”的任务。

### 人物线

字段：`character/premise/encounters/commitment/resolution/selection`。
`encounters` 恰好两个核心事件ID，先后顺序固定、实际放在不同幕。
`selection: {planned_per_run: 1, optional: true, fallback: ordinary_event}`。
初遇未发生则续遇回退普通事件；承诺取消不补发奖励。不同线的承诺必须有形式区别。

### 敌人

字段：`acts/tier/identity/method/n/talents/artifacts/stats/pressure/counterplay/
preview/phases/reward_profile`。
`tier: normal/elite/boss/final`，`method` 为真实RKF ID，
`talents` 为完整ID数组，每阶最多一项且不越n；`artifacts: [{id: RC01, stacks: 1}]`。
`stats` 是装备和功法修正前的五维基础值；敌方最多装备5件互不重复的法宝，
不按`equipment_role`拆分容量；计算预览时再加已装备法宝，禁止双计。
`pressure` 为1-3个标签，`counterplay` 至少两条具体战前选择。
`phases` 可为空，非空必须有现有卡面来源；不能私造隐藏倍率或流派免疫。
`reward_profile` 为`C/L/B/F`；掉落由节点决定，不掉敌人整套装备。
数值按敌人基线首测目标写明确输入，`measured`保持null。

### 幕

字段：`index/story/node_budget/routes/pools/rewards/economy/cultivation/transition`。
四幕 `node_budget: {C: 4, E: 3, L: 1, S: 1, R: 1, B: 1}`，
`routes` 含既有六条11节点序列。`pools` 引用敌人和事件ID，不复制实体。
`story` 含目标、幕前、普通战后短句、首领前与首领后文案；一句说清目标。
`economy` 给公开商店、恢复和奖励首测输入，`cultivation` 读真实XP门槛。
终段RF01仅`F:1`；无新奖励候选、商店、恢复或免费突破。

## 验收

内容完整性、ID、引用、候选数量、敌方配装、叠层、奖励边界与文档漂移由工具校验。
十门功法每门81种合法天赋组合应能枚举，但枚举不等于完成810组战斗实测。
伤害、持续伤害、护盾、治疗、buff/debuff和怒气必须遵守现有共享合同；
禁止为了让内容“可运行”暗加回血、免费属性、自动突破或修改节点预算。
