# 族裔、天赋与命途扩展

基线：530f431（规则 3.0.0，UI 15.0）。本轮规则 4.1.0，界面 16.0。

## 设计边界
族裔决定先天禀赋与专属天赋池；出身决定初始功法与属性；命格保留原有一次选择。三者独立，族裔不锁职业，也不把技能塞进八槽之外的假装备位。

参考的是《王者万象棋》官方介绍里的棋手差异、阵容成长及随机选择结构；种族、天赋与事件均为本项目原创，并非复制其牌面或宣称逐项对应。参考：https://www.taptap.cn/app/243110

## 阶段一
- 四族：人族、精怪、龙裔、灵族。每族都有一个直接生效的入战/行动禀赋与两条可发展的方向。
- 五种出身：山野散修、行伍武者、方士、行脚药师、旧观咒徒。
- 种族属性与触发器来自内容 JSON，玩家专用，不影响敌人的共享技能。
- 4.0 使用独立存档键；3.0 旧档不自动改写，可从静室导出备份。旧档不能用于新规则，避免中途塞入天赋而破坏重放。
- 保留 UI15 战斗特效和所有技能/法宝 SVG。

## 阶段二：手选天赋
每次境界突破产生一次选择（筑基、金丹、元婴、化神，共四次）。候选三项，至少一项通悟、一项族裔；首次突破展示两个族裔起点。候选在产生时固定，读档、浏览与重新绘制都不重抽。一次跨越多境界时逐次选择，不丢次数。

40 项：16 通悟 + 4 族各 6 项。每族两条三段路线（最低境界 1/2/4），必须先学前置；也可以放弃终段、改拿公共组件。人族“百家”令之后候选变为四项，但不增加选择次数。天赋不占八槽，也不提供虚拟共鸣。

新增 `maxPerRound` 防止触发器递归及连击放大。触发额度在执行效果前记账。实际恢复才触发恢复联动，所有天赋效果均走真实战斗结算与来源日志。

自动策略仅增加了必须完成的天赋决策，旧选装备、选路、坊市估值保持原样。新胜率不能与 3.0 直接作数值平衡比较；旧策略哈希保留在验收记录中。

## Stage 3 - sub-schools and conversion pieces

Eight main schools each have two authored sub-school recipes. Six selected hybrid routes link actual equipment, not a new virtual buff tier. Recipes are a read-only disclosure in the build view, filter unavailable racial talent suggestions, and explicitly label off-pool pieces. Eight new rare artifacts create reserve-rage, burn-to-heal, shield-to-rage, break-to-weak, crit recovery, evade-to-break, healing growth, and weak-to-guard loops. Every trigger is limited to once per round. Existing shared enemy skills remain unchanged.

## Stage 4 - ancestry event arcs

Each ancestry now has two multi-phase world stories (8 new events, 56 total). Every arc includes at least one public deterministic stat check, a talent-specific alternative, and a later callback that gains relevance from an earlier fact without forcing a single canonical route. Human stories ask who gets recorded by institutions; spirits negotiate kinship and old names; dragon-blooded characters decide what inherited obligation means; spirit-bodied characters ask whether existence requires a remembered name. Combat builds remain untouched in this stage.

## 阶段五：地点事件文本重构
- 保留 12 个既有地点事件的奖励、检定、条件和阶段路由，仅重写场景、动作动词、成功/失败与事后文本。
- 朝歌夜渡、陈塘药棚、西岐军械铺、万仙遗市四条三阶段事件不再共用同一套“帮忙/动手/离开”模板。
- 四幕交易与四处秘境分别拥有与地点一致的检定叙事；测试锁定事件机制指纹，防止文案改动误伤数值。

## 阶段六：4.1 平衡校准
- 先跑四族 × 五出身 × 25 种子的 500 局矩阵，不再只验证默认人族。
- 初始基线暴露行伍武者 94% 胜率、山野散修 23%，以及龙裔 68% 对灵族 43.2% 的明显落差。
- 本轮只调整出身/族裔底盘与被动数值，不改敌人、技能池、事件奖励、路线结构和天赋树形状。
- 4.1 使用独立存档键，4.0 与更早存档保留为可导出备份，避免旧行动日志在新数值下失去确定性。
- 第二次矩阵校准不改共享技能：武者改为玄甲起手、反震需后续补齐；散修提高起始怒气；药师获得起手护盾；咒徒起手施加虚弱；龙裔削减无条件生命/护盾；灵族增加起手护盾与闪避。
