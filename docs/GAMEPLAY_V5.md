# Gameplay V5 — build bridges and finishers

V5 turns the V4 resonance layer into a three-step build arc.

## 1. Core school

The strongest equipped resonance becomes the run's current core school. This is derived from the eight-slot board and is never stored in save data.

## 2. Cross-school bridge

Exactly one deterministic bridge is surfaced at a time. The closest/strongest pair wins the tie-break so the player always has a readable next target instead of several simultaneous hidden bonuses.

- Rage + Burn: **雷火轮转** — rage skills add Burn and can trigger extra fire damage.
- Rage + Break: **狂澜裂阵** — rage skills recycle rage against broken enemies; tier 2 also raises rage-skill damage.
- Burn + Guard: **炉心金身** — enemy Burn ticks forge Shield.
- Guard + Break: **铁壁摧锋** — the first shielded hit each round applies Break back to the attacker.

Each bridge has tier 1 when both schools are at least tier 1 and tier 2 when both are tier 2.

## 3. Finisher / 终局法相

A finisher unlocks only when all three conditions are true:

1. the core school is tier 2;
2. Strategy Alignment is tier 2;
3. all eight slots are filled.

Only the core school's finisher is active, so a complete build gains a clear identity instead of stacking every capstone.

- Rage: **九转雷劫** — first rage skill creates an attack-scaled follow-up strike.
- Burn: **焚天劫火** — at 8 Burn, detonate and consume 3 stacks.
- Guard: **玄武返照** — first shield break retaliates and reforges shield.
- Break: **万剑决阵** — at 6 Break, add Vulnerable and a pure follow-up strike.

## Reward direction

Ability rolls now consider origin affinity, current tags, the core school, and the weaker side of the surfaced bridge. The extra bridge weighting is deliberately mild so the system helps completion without removing pivot choices.

## Balance changes

V4's Guard resonance produced the strongest automated results, so its opening shield is reduced from 80% to 60% Defense and its shielded damage bonus from 15% to 10%. Rage tier 2 refund rises from 15 to 18. The new bridge/finisher mechanics add ceiling mainly to Rage, Burn, and Break rather than multiplying Guard's existing floor.

Because combat rules change, content/rules version advances to 2.2.0.
