# 山海 V2 难度样本报告

> V2 内容尚未校准；本报告只记录指定策略和种子批次的直接观测，不是人类玩家胜率或体验结论。

## 运行配置

- 报告结构版本：1
- 输入配置哈希：c97b4bc95fc980646f575ffb891e7b6c5984282d1198de5252e0b79ccee17a8a
- 实验轨道：V2 experimental; shanhai-content-0.2; uncalibrated
- 内容版本：shanhai-content-0.2
- 样本解释：Observed results from this exact deterministic policy and seed batch only; no V1 calibration or fitted win rate is carried forward.
- 源内容 SHA-256：5a53cc9acec3748827f6b9a1e747c8d479696aa163b13c501c46ce502320835f
- 运行时与策略 SHA-256：0d132dfd022242647ee3daf2043a10ef235af5ac915d99e72e8a8387add3446e
- 种子前缀：v2-smoke-0-train
- 种子拆分：train
- 每种起始功法种子数：1
- 起始功法：RKF01、RKF02、RKF03、RKF04、RKF05
种子标签数：5
种子标签：
  - `v2-smoke-0-train-RKF01-0001`
  - `v2-smoke-0-train-RKF02-0001`
  - `v2-smoke-0-train-RKF03-0001`
  - `v2-smoke-0-train-RKF04-0001`
  - `v2-smoke-0-train-RKF05-0001`
- 策略：steady
- 策略实现：tests/shanhai-difficulty.mjs difficultyCommand; tests/shanhai-policy.mjs nextCommand

## 四幕通关表现

累计通关分母固定为该组全部运行数；条件幕胜率只以进入该幕的运行数为分母。

| 幕 | 累计通关率（成功/固定总样本） | 目标 | 累计样本数 | Wilson 95% CI | 条件幕胜率（成功/入幕样本） | 入幕样本数 | 条件 Wilson 95% CI |
| --- | --- | ---: | ---: | --- | --- | ---: | --- |
| 第 1 幕 | 2/5（40.0%） | 80.0% | 5 | [11.8%, 76.9%] | 2/5（40.0%） | 5 | [11.8%, 76.9%] |
| 第 2 幕 | 2/5（40.0%） | 65.0% | 5 | [11.8%, 76.9%] | 2/2（100.0%） | 2 | [34.2%, 100.0%] |
| 第 3 幕 | 2/5（40.0%） | 50.0% | 5 | [11.8%, 76.9%] | 2/2（100.0%） | 2 | [34.2%, 100.0%] |
| 第 4 幕 | 2/5（40.0%） | 35.0% | 5 | [11.8%, 76.9%] | 2/2（100.0%） | 2 | [34.2%, 100.0%] |

## 各起始功法四幕率

每种功法分别以自己的运行样本作为固定累计分母；条件幕胜率仍以该功法中进入该幕的运行数为分母。

### RKF01

样本数：1

| 幕 | 累计通关率（成功/固定总样本） | 目标 | 累计样本数 | Wilson 95% CI | 条件幕胜率（成功/入幕样本） | 入幕样本数 | 条件 Wilson 95% CI |
| --- | --- | ---: | ---: | --- | --- | ---: | --- |
| 第 1 幕 | 1/1（100.0%） | 80.0% | 1 | [20.7%, 100.0%] | 1/1（100.0%） | 1 | [20.7%, 100.0%] |
| 第 2 幕 | 1/1（100.0%） | 65.0% | 1 | [20.7%, 100.0%] | 1/1（100.0%） | 1 | [20.7%, 100.0%] |
| 第 3 幕 | 1/1（100.0%） | 50.0% | 1 | [20.7%, 100.0%] | 1/1（100.0%） | 1 | [20.7%, 100.0%] |
| 第 4 幕 | 1/1（100.0%） | 35.0% | 1 | [20.7%, 100.0%] | 1/1（100.0%） | 1 | [20.7%, 100.0%] |

### RKF02

样本数：1

| 幕 | 累计通关率（成功/固定总样本） | 目标 | 累计样本数 | Wilson 95% CI | 条件幕胜率（成功/入幕样本） | 入幕样本数 | 条件 Wilson 95% CI |
| --- | --- | ---: | ---: | --- | --- | ---: | --- |
| 第 1 幕 | 1/1（100.0%） | 80.0% | 1 | [20.7%, 100.0%] | 1/1（100.0%） | 1 | [20.7%, 100.0%] |
| 第 2 幕 | 1/1（100.0%） | 65.0% | 1 | [20.7%, 100.0%] | 1/1（100.0%） | 1 | [20.7%, 100.0%] |
| 第 3 幕 | 1/1（100.0%） | 50.0% | 1 | [20.7%, 100.0%] | 1/1（100.0%） | 1 | [20.7%, 100.0%] |
| 第 4 幕 | 1/1（100.0%） | 35.0% | 1 | [20.7%, 100.0%] | 1/1（100.0%） | 1 | [20.7%, 100.0%] |

### RKF03

样本数：1

| 幕 | 累计通关率（成功/固定总样本） | 目标 | 累计样本数 | Wilson 95% CI | 条件幕胜率（成功/入幕样本） | 入幕样本数 | 条件 Wilson 95% CI |
| --- | --- | ---: | ---: | --- | --- | ---: | --- |
| 第 1 幕 | 0/1（0.0%） | 80.0% | 1 | [0.0%, 79.3%] | 0/1（0.0%） | 1 | [0.0%, 79.3%] |
| 第 2 幕 | 0/1（0.0%） | 65.0% | 1 | [0.0%, 79.3%] | 0/0（无样本） | 0 | 无样本 |
| 第 3 幕 | 0/1（0.0%） | 50.0% | 1 | [0.0%, 79.3%] | 0/0（无样本） | 0 | 无样本 |
| 第 4 幕 | 0/1（0.0%） | 35.0% | 1 | [0.0%, 79.3%] | 0/0（无样本） | 0 | 无样本 |

### RKF04

样本数：1

| 幕 | 累计通关率（成功/固定总样本） | 目标 | 累计样本数 | Wilson 95% CI | 条件幕胜率（成功/入幕样本） | 入幕样本数 | 条件 Wilson 95% CI |
| --- | --- | ---: | ---: | --- | --- | ---: | --- |
| 第 1 幕 | 0/1（0.0%） | 80.0% | 1 | [0.0%, 79.3%] | 0/1（0.0%） | 1 | [0.0%, 79.3%] |
| 第 2 幕 | 0/1（0.0%） | 65.0% | 1 | [0.0%, 79.3%] | 0/0（无样本） | 0 | 无样本 |
| 第 3 幕 | 0/1（0.0%） | 50.0% | 1 | [0.0%, 79.3%] | 0/0（无样本） | 0 | 无样本 |
| 第 4 幕 | 0/1（0.0%） | 35.0% | 1 | [0.0%, 79.3%] | 0/0（无样本） | 0 | 无样本 |

### RKF05

样本数：1

| 幕 | 累计通关率（成功/固定总样本） | 目标 | 累计样本数 | Wilson 95% CI | 条件幕胜率（成功/入幕样本） | 入幕样本数 | 条件 Wilson 95% CI |
| --- | --- | ---: | ---: | --- | --- | ---: | --- |
| 第 1 幕 | 0/1（0.0%） | 80.0% | 1 | [0.0%, 79.3%] | 0/1（0.0%） | 1 | [0.0%, 79.3%] |
| 第 2 幕 | 0/1（0.0%） | 65.0% | 1 | [0.0%, 79.3%] | 0/0（无样本） | 0 | 无样本 |
| 第 3 幕 | 0/1（0.0%） | 50.0% | 1 | [0.0%, 79.3%] | 0/0（无样本） | 0 | 无样本 |
| 第 4 幕 | 0/1（0.0%） | 35.0% | 1 | [0.0%, 79.3%] | 0/0（无样本） | 0 | 无样本 |

## 第五幕终战

- 统计口径：standalone final battle; reported only among runs entering act 5
- 进入第五幕样本：2
- 终战胜场：2
- 终战胜率：2/2（100.0%）；Wilson 95% CI [34.2%, 100.0%]
- 终战结果：通关 2 / 失败 0 / 未决 0 / 错误 0
- 此统计独立于第一至第四幕累计通关率。

## 运行结局

- 全部运行：通关 2 / 失败 3 / 未决 0 / 错误 0
- 未决运行数：0
- 错误运行数：0
- 结局分布：通关 2 / 失败 3 / 未决 0 / 错误 0

## 离线敌方倍率

- 调整模式：offline_memory_enemy_entity_base_stats_only
- 调整字段：attack、defense、max_hp

| 幕 | 攻击 | 防御 | 最大气血 |
| --- | ---: | ---: | ---: |
| 1 | 1 | 1 | 1 |
| 2 | 1 | 1 | 1 |
| 3 | 1 | 1 | 1 |
| 4 | 1 | 1 | 1 |
| 5 | 1 | 1 | 1 |

- 说明：Applies only to cloned enemy entity stats in memory; player stats, runtime node values, seed, and YAML files are unchanged.

## 策略边界与实测状态

- 策略限制：uses the current phase, currently reachable nodes, currently visible rewards, public costs, owned artifacts and current equipment; never reads future route nodes, hinted event outcomes, future battle results, or future reward candidates
- 策略说明：Uses the fixed V2 talent plan and fills empty equipment slots, then replaces the weakest same-role slot only for a strictly higher inventory score. Prioritizes reachable rest at 18% missing HP or shop at 20% missing HP when recovery is affordable; otherwise prefers common battles. Does not use reforge or temper.
- 运行步数上限：600
- 单场战斗回合上限：4096
- 目标胜率：Pass rates are direct observations in this V2 seed batch under the selected deterministic policy; they are not calibrated targets or measured human-player win rates.
- 内容实测字段：`measured: null`（按报告元数据标记）
- 模拟结果仅用于所选策略下的校准参考，不得写入内容的实测字段或表述为人类胜率。
