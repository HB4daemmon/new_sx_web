# 一期全量内容索引

状态：可评审草案；每个条目已有内容和取得或投放接口，数值、权重与实际体验仍待测试。
本页恢复为新版目录，不恢复旧 G/B/T 编号、主辅槽位或旧奖励绑定。

| 内容 | ID 与数量 | 正式定义 |
| --- | --- | --- |
| 功法与天赋 | KF01-KF10，10 门、120 个候选 | [总览](./CULTIVATION_TREES.md)、[01-03](./CULTIVATION_TREES_01_03.md)、[04-06](./CULTIVATION_TREES_04_06.md)、[07-10](./CULTIVATION_TREES_07_10.md) |
| 人物与主线 | 五条随机人物线，每局二至三条；女娲公共终幕 | [五幕故事](./STORY_OUTLINE.md)、[人物](./CHARACTERS.md) |
| 既有名器 | FB01-FB08，8 件，保留人物取得资格 | [法宝总览](./ARTIFACTS.md) |
| 公共器物 | FB09-FB32 普通 24 件；FB33-FB40 珍稀 8 件 | [公共法宝](./content/ARTIFACTS_COMMON.md) |
| 新传奇名器 | FB41-FB48，8 件，对应 R01-R08 | [名器卡面](./content/ARTIFACTS_MYTHIC.md) |
| 核心事件 | E01-E08，8 个 | [核心事件](./CORE_EVENTS.md) |
| 普通事件 | E101-E124，24 个 | [普通事件](./content/COMMON_EVENTS.md) |
| 求法机缘 | L01-L05，5 个，对应 KF06-KF10 | [求法与寻宝](./content/OPPORTUNITY_EVENTS.md) |
| 寻宝机缘 | R01-R08，8 个 | [求法与寻宝](./content/OPPORTUNITY_EVENTS.md) |
| 普通敌人 | EN01-EN20，20 套 | [敌人册](./ENEMIES.md) |
| 神话精英 | EL01-EL10，10 套 | [敌人册](./ENEMIES.md) |
| 幕首领 | BS01-BS05，5 套 | [敌人册](./ENEMIES.md) |

共计 48 件法宝、45 个事件、35 个基础敌人配置。事件中的分段、守器者配装和公共变体
不重复计为新的基础 ID。

## 如何接入

- [投放表](./CONTENT_DISTRIBUTION.md)定义节点、候选池、固定奖励、商店、换法与有限产出。
- [战斗规则](./COMBAT_RULES.md)和[法宝规则](./rules/ARTIFACT_RULES.md)定义敌我共用的动作、状态、触发与唯一实体。
- [测试计划](./CONTENT_TEST_PLAN.md)区分文档结构检查、后续实现测试、数值模拟和真人可理解性验收。
- [本轮范围](./FULL_CONTENT_PLAN.md)记录新增内容边界与首稿整合决定。

## 原典与改编

[原有人物线来源](./MYTH_SOURCES.md)、[新增名器来源](./content/MYTH_ARTIFACT_SOURCES.md)
与[敌方人物来源](./content/MYTH_ENEMY_SOURCES.md)提供回目、段号与短引文。
人物身份和典故不等于本作配装；原创公共器物、功法搭配、机缘取得与战斗效果都按游戏改编标注。

旧目录的历史正文仍可用以下命令查看：
`git show a3f19bb:docs/shanhai/CONTENT_CATALOG.md`
