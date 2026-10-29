# V2 Forging Controlled Combat Comparison

- Build version: 5
- Content version: `shanhai-content-0.2`
- Content SHA-256: `c6c6bdbad4c9d5459a894b683202ffc17bcbe0912d5fb25e2e92515999fbe4e5` (155 files, manifest plus listed entity YAML)
- Runtime: `build/shanhai/combat.js (existing build; this script does not build)`
- Reproduce with: `node tests/shanhai-v2-forging-compare.mjs`

All combat inputs use explicit fixture stats to keep targets alive and isolate measured mechanics. These deterministic fixtures are not normal run intensity, player outcomes, balance, or fun evidence.

Every RC01 arm keeps RC01 equipped with the same number of layers. The paired control changes only `RC01.core_rule`; it does not unequip the artifact or alter stats.

### rkf02-split-total-base-damage

RKF02 plus 剑丸成阵: total basic base damage after returning-breath segments are finalized

Seed: `v2-forging-compare-rkf02-split`; round limit: 2. RC01 remains equipped with the same layer count; cloned content removes only RC01.core_rule.

Fixture player: `RKF02`, talents `V2-J2-C`, artifacts `RC01 x1, RL04 x1`; base stats {"attack":100,"defense":0,"max_hp":100000,"crit_rate":0,"speed":30}.

Fixture enemy: `RKF01`, talents `none`; base stats {"attack":0,"defense":0,"max_hp":1000000000,"crit_rate":0,"speed":1}.

Calculated stats match across arms: player {"attack":118,"defense":0,"max_hp":100000,"crit_rate":0,"speed":31}; enemy {"attack":0,"defense":0,"max_hp":1000000000,"crit_rate":0,"speed":1}.

Explicit high-HP, low-pressure stats are a controlled combat fixture, not normal progression strength.

| Arm | Player HP loss | Enemy HP loss | Base hits | Merged segments | Base damage | Critical base hits | Poison added / final | Poison DOT | Hit rage | Retaliations / damage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| RC01 equipped, core rule removed | 0 | 537.785 | 5 | 0 | 301.785 | 0 | 0 / 0 | 0 | 0 | 0 / 0 |
| RC01 equipped, convergence active | 0 | 613.2313 | 1 | 5 | 377.2312 | 0 | 0 / 0 | 0 | 0 | 0 / 0 |

With-core minus control: {"playerHpLoss":0,"enemyHpLoss":75.44625008106232,"baseHitCount":-4,"segmentsMerged":5,"baseDamage":75.44624999999996,"poisonApplicationLayers":0,"poisonLayersAtEnd":0,"poisonDotDamage":0,"hitRage":0,"retaliationCount":0,"retaliationDamage":0}.

### full-crit-unavoidable-cost

At 100% critical rate, compare split critical hits with the converged noncritical hit

Seed: `v2-forging-compare-critical-tradeoff`; round limit: 2. RC01 remains equipped with the same layer count; cloned content removes only RC01.core_rule.

Fixture player: `RKF02`, talents `V2-J2-C`, artifacts `RC01 x1, RL04 x1`; base stats {"attack":100,"defense":0,"max_hp":100000,"crit_rate":1,"speed":30}.

Fixture enemy: `RKF01`, talents `none`; base stats {"attack":0,"defense":0,"max_hp":1000000000,"crit_rate":0,"speed":1}.

Calculated stats match across arms: player {"attack":118,"defense":0,"max_hp":100000,"crit_rate":1,"speed":31}; enemy {"attack":0,"defense":0,"max_hp":1000000000,"crit_rate":0,"speed":1}.

Explicit high-HP, low-pressure stats are a controlled combat fixture, not normal progression strength.

| Arm | Player HP loss | Enemy HP loss | Base hits | Merged segments | Base damage | Critical base hits | Poison added / final | Poison DOT | Hit rage | Retaliations / damage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| RC01 equipped, core rule removed | 0 | 806.6775 | 5 | 0 | 452.6775 | 5 | 0 / 0 | 0 | 0 | 0 / 0 |
| RC01 equipped, convergence active | 0 | 731.2313 | 1 | 5 | 377.2312 | 0 | 0 / 0 | 0 | 0 | 0 / 0 |

With-core minus control: {"playerHpLoss":0,"enemyHpLoss":-75.4462502002716,"baseHitCount":-4,"segmentsMerged":5,"baseDamage":-75.44625000000008,"poisonApplicationLayers":0,"poisonLayersAtEnd":0,"poisonDotDamage":0,"hitRage":0,"retaliationCount":0,"retaliationDamage":0}.

### rkf06-poison-and-hit-rage-reduction

RKF06 with three-segment basics: poison applications and hit-rage rewards follow the effective hit count

Seed: `v2-forging-compare-rkf06-hit-effects`; round limit: 1. RC01 remains equipped with the same layer count; cloned content removes only RC01.core_rule.

Fixture player: `RKF06`, talents `V2-J2-C, V2-J3-A`, artifacts `RC01 x1`; base stats {"attack":100,"defense":0,"max_hp":100000,"crit_rate":0,"speed":30}.

Fixture enemy: `RKF01`, talents `none`; base stats {"attack":0,"defense":0,"max_hp":1000000000,"crit_rate":0,"speed":1}.

Calculated stats match across arms: player {"attack":106,"defense":0,"max_hp":100000,"crit_rate":0,"speed":30}; enemy {"attack":0,"defense":0,"max_hp":1000000000,"crit_rate":0,"speed":1}.

Explicit high-HP, low-pressure stats are a controlled combat fixture, not normal progression strength.

| Arm | Player HP loss | Enemy HP loss | Base hits | Merged segments | Base damage | Critical base hits | Poison added / final | Poison DOT | Hit rage | Retaliations / damage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| RC01 equipped, core rule removed | 0 | 197.16 | 3 | 0 | 171.72 | 0 | 3 / 3 | 25.44 | 9 | 0 / 0 |
| RC01 equipped, convergence active | 0 | 223.13 | 1 | 3 | 214.65 | 0 | 1 / 1 | 8.48 | 3 | 0 / 0 |

With-core minus control: {"playerHpLoss":0,"enemyHpLoss":25.96999990940094,"baseHitCount":-2,"segmentsMerged":3,"baseDamage":42.930000000000035,"poisonApplicationLayers":-2,"poisonLayersAtEnd":-2,"poisonDotDamage":-16.96,"hitRage":-6,"retaliationCount":0,"retaliationDamage":0}.

### carapace-retaliations

Against 猬甲护身, compare the number and total damage of retaliation hits

Seed: `v2-forging-compare-carapace`; round limit: 1. RC01 remains equipped with the same layer count; cloned content removes only RC01.core_rule.

Fixture player: `RKF02`, talents `V2-J2-C`, artifacts `RC01 x1`; base stats {"attack":100,"defense":0,"max_hp":100000,"crit_rate":0,"speed":30}.

Fixture enemy: `RKF01`, talents `V2-J1-D`; base stats {"attack":0,"defense":0,"max_hp":1000000000,"crit_rate":0,"speed":1}.

Calculated stats match across arms: player {"attack":106,"defense":0,"max_hp":100000,"crit_rate":0,"speed":30}; enemy {"attack":0,"defense":0,"max_hp":1000000000,"crit_rate":0,"speed":1}.

Explicit high-HP, low-pressure stats are a controlled combat fixture, not normal progression strength.

| Arm | Player HP loss | Enemy HP loss | Base hits | Merged segments | Base damage | Critical base hits | Poison added / final | Poison DOT | Hit rage | Retaliations / damage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| RC01 equipped, core rule removed | 8.64 | 279.5979 | 3 | 0 | 279.5979 | 0 | 0 / 0 | 0 | 0 | 3 / 8.64 |
| RC01 equipped, convergence active | 1.44 | 369.675 | 1 | 3 | 369.675 | 0 | 0 / 0 | 0 | 0 | 1 / 1.44 |

With-core minus control: {"playerHpLoss":-7.2000000000116415,"enemyHpLoss":90.0771427154541,"baseHitCount":-2,"segmentsMerged":3,"baseDamage":90.0771428571428,"poisonApplicationLayers":0,"poisonLayersAtEnd":0,"poisonDotDamage":0,"hitRage":0,"retaliationCount":-2,"retaliationDamage":-7.200000000000001}.

### RC14 Awakening

Compare RC14 at two and three layers, and isolate the real three-layer awakening against the same loadout with awakenings disabled

Seed: `v2-forging-compare-rc14-awakening`. RKF09 basic applies burn before RC14 core applies poison during the same action.

Explicit high-HP stats and one-round observation are controlled fixtures, not normal progression strength.

| Layers | Awakening enabled | Player HP loss | Enemy HP loss | Burn layers | Poison layers | RC14 poison DOT | RC14 contribution triggers |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 2 | true | 0 | 121.6384 | 1 | 1 | 9.3184 | 4 |
| 2 | false | 0 | 121.6384 | 1 | 1 | 9.3184 | 4 |
| 3 | true | 0 | 128.7264 | 1 | 1 | 14.2464 | 6 |
| 3 | false | 0 | 124.4864 | 1 | 1 | 10.0064 | 5 |

At two layers, enabled-minus-disabled trigger delta is 0 and poison DOT delta is 0.
At three layers, enabled-minus-disabled trigger delta is 1 and poison DOT delta is 4.24.
Observed three-minus-two layer poison DOT delta with awakenings enabled: 4.928.
The enabled/disabled pair holds content, loadout, stats, enemy, seed, and duration fixed; only the runtime awakening switch differs.

## Assertions

- RKF02 finalized five-segment base damage increased by exactly the authored 1.25 multiplier.
- At full critical rate, five split critical hits exceed the single converged noncritical base hit.
- RKF06 poison layer additions and hit-rage gains track three effective base hits versus one.
- The 猬甲 fixture reports fewer retaliation hits and lower player HP loss with convergence.
- RC14 remains below awakening at two layers and produces an isolated extra poison DOT at three layers when pre-burned.

These are mechanical observations under controlled fixture stats. They do not establish balance, typical progression strength, preference, or fun.
