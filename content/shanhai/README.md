# 山海版首发内容库

版本：`shanhai-content-0.1`，日期：2026-09-21。

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
| `artifacts/legendary/` | RL01-RL05 |
| `events/ordinary/` | RE001-RE036，36 个短事件 |
| `events/core/` | RK001-RK016，12 次人物相遇与4个独立机缘 |
| `storylines/` | RS01-RS06，每条恰好两次相遇 |
| `enemies/act1/` 至 `act4/` | 每幕4普通、2精英、2候选首领，共32套 |
| `enemies/final/` | EN-F1、EN-F2，两种终战候选 |
| `acts/` | RA01-RA04及RF01；节点、池、主线、资源与幕间文案 |
| `manifest.yaml` | 显式文件清单、数量与版本；新增文件必须登记 |

单局仍为四幕各11节点加一场终战。每局只计划一条两遇人物线，加零或一个独立机缘；
实际可全绕过。内容池数量不增加单局节点，不保证每个角色、功法或传奇出现。

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
content_version: shanhai-content-0.1
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

## 各类型必填内容

### 功法

`rarity` 为 `common/rare/legendary`；RKF01-05普通、06-08稀有、09-10传奇。
字段：`role/stat_focus/mechanic/acquisition/actions/passives/travel/talents/routes`。
`mechanic` 描述最多一种专属状态，没有时为 `null`。
`acquisition: {start: true, pools: [method_common]}`，仅普通可开局选。
`actions.basic` 与 `actions.rage` 各含 `name/quick/effects`；`passives/travel` 为效果数组。
`talents` 恰好12项：
`{id: RKF01-J1-A, tier: 1, branch: A, name: 金刚厚壁, quick: 普攻怒技加盾,
category: enhance, effects: [...]}`。
`category` 为 `enhance/cycle/convert`。四层每层A/B/C三选一，无跨层隐藏前置。
`routes` 三项，含 `name/summary/talents`，每条选四个合法不同层的ID，允许混列。
`balance.target` 至少包含 `P_by_tier`，普通100/125/150/175/200，稀有乘1.1，
传奇乘1.25。动作系数只是初版输入，不声称实际P达到目标。

### 法宝

字段：`rarity/max_stacks/unique_group/attributes/effects/acquisition`。
`attributes: {flat: {attack: 6}, percent: {}}`，只允许五维
`attack/defense/max_hp/crit_rate/speed`；暴击率放flat且按比例加。
普通按已定3或5层，稀有/传奇1层；不设全局槽位。
`unique_group:null` 或真实互斥组，RL01为`overflow_outlet`。
`acquisition.pools` 引用 `common_artifact/rare_artifact/legendary_artifact` 等公共池。
`balance.target: {B: 1, A: 5, J: 0}`；旅途型按法宝基线分摊，不能在B外再免费加属性。
所有44个已有ID、名称、已定效果和数值保留；补全未定参数时写清首测值。

### 事件

字段：`event_type/acts/scene/options/settlement`，普通为`ordinary`、核心为`core`。
`acts` 为允许出现幕的整数数组。场景尽量两句内，每项2-3个互斥选项。
每个选项含 `id/label/quick/requirements/costs/rewards/outcome`；
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
`settlement` 至少写
`{once: true, internal_battle_package: false, travel_triggers: 1, fallback: coins}`。
如需更多效果，先明确结构，不用无定义的新资源、无限随机数或免费追加节点。
按事件基线给 `balance.target.gross_U` 区间；购买列成本，不按免费获得累计。

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
`stats` 是装备和功法修正前的五维基础值；计算预览时再加合法法宝，禁止双计。
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
