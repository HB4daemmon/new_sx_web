# Gameplay V8 — Ability Identity Pass

V8 moves the 43-ability pool from mostly tag/stat variations toward authored mechanical identities while keeping the existing eight-slot, deterministic auto-combat and JSON-first content model.

## Static mechanic roles

Every ability now carries one JSON-authored `mechanicRole`: `starter`, `generator`, `converter`, `amplifier`, `bridge`, `keystone`, `risk`, or `payoff`. This is intentionally separate from V6 contextual `abilityRole`: the mechanic role says what the authored piece fundamentally does, while contextual role says what that piece would do for the current run.

## Generic payoff primitive

`resource_damage` is a deterministic combat effect that reads a declared live resource (`burn`, `break`, `shield`, or `rage`) from self/enemy and turns each unit into additional stat-scaled damage, with an optional cap. It does not consume the resource; explicit `consume_status` / `consume_shield` remain the converter primitives.

## Reworked pieces

- 红莲业火 is now a Burn payoff rather than a second large Burn generator.
- 斩天一剑 is now a Break payoff rather than a generic high-coefficient rage skill.
- 沧浪式 now links Shield and Rage and is authored as a bridge starter.
- 定海神珠 now actually expresses both halves of its Burn/Shield identity every round.

This gives generators → converters → payoffs a clearer division of labor, while keystones and risk pieces can still redirect a run.
