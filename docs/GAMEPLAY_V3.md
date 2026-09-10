# Gameplay V3

This revision adapts gameplay architecture from `ssxx2/dev` CORE_GAMEPLAY and ENGINE_CAPABILITIES to the current browser game.

- Deterministic RNG is split by route, event checks, enemy AI, hit, crit and trigger domains.
- Combat remains fully automatic; build selection is the player's battle intent. Main actions are resolved through a legal-action selector with cooldown and enemy greedy/weighted AI.
- Encounters may use kill, survive or break objectives. Bosses can transition through deterministic HP phases.
- Combat emits typed replay frames with damage-pipeline breakdown and battle summary.
- Events support 2-4 choices per phase, up to five phases, public attribute-check probability, confirm-time RNG only, occurrence profiles/weights and cross-act fact/thread echoes.
- One hidden route node may appear per act without revealing its event before entry.
- Shop stock mixes build options, recovery and immediate attribute growth. Rest remains a one-of-four preparation decision.
- The current game intentionally retains the merged seven-stat model (HP, attack, defense, speed, hit, dodge, luck) rather than restoring ssxx2's split physical/magical panel.
