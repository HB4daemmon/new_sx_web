# Gameplay V7 — Resource Engines

V7 converts the four build schools from mostly passive resonance bonuses into distinct battle engines while preserving the eight-slot, deterministic auto-battle rules.

## Engine loops

- **怒潮**: generate rage → cast rage skill → refund rage → thunder echo.
- **焚劫**: stack Burn → consume Burn stacks → gain rage / burst immediately → restack.
- **玄甲**: generate Shield → absorb damage → spend Shield → defense-scaled counterattack.
- **破阵**: stack Break → consume Break → gain rage / pursuit damage → restack.

## New deterministic effects

- `consume_status`: consumes a fixed number of status stacks after a trigger condition proves enough stacks exist.
- `consume_shield`: consumes a fixed amount of Shield after a trigger condition proves enough Shield exists.

Both effects emit typed `convert` replay frames and increment battle summary conversion counters. They use no extra randomness and do not change replay semantics.

## Reworked pieces

`纳气`, `焚心`, `聚灵幡`, `九天雷动`, and the four school strategies now expose generation/spend loops. Existing bridge artifacts such as `玄火珠` and `破魔针` remain cross-school glue.

## Compatibility

Content and rules versions are both `2.4.0`. V6 saves are intentionally rejected because combat resolution and reward outcomes can differ.

## Balance calibration

- Wanderer now starts with `引雷咒` rather than `青锋诀`, so its opening kit forms a coherent Rage generator → Rage skill loop without buffing generic sword enemies.
- Burn harvesters consume fewer stacks and deliberately leave residual Burn for DoT ticks.
- The automated simulation policy now understands contextual roles and converter pieces instead of judging rewards only by tags/rarity/stats.

## Origin battle talents

V7 keeps origin base stats unchanged, but adds optional JSON-configured `battleStartEffects` for targeted early-game identity and balance. Wanderer gains 15 Rage at battle start; Alchemist gains 8 Shield; Warrior receives no extra perk because its base stat package already has the strongest simulation margin. These effects apply only to the player origin and never modify enemies that happen to use the same named abilities.
