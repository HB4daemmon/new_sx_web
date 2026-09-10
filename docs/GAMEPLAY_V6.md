# Gameplay V6 — ability roles and directed drafts

V6 stops adding raw resonance tiers and improves the quality of each build decision.

## Contextual ability roles

Every ability is evaluated against the current eight-slot board and labelled as one of five roles:

- Starter — reliable opening / base loop.
- Core — primary damage or resource loop for the current axis.
- Amplifier — passive, trigger, artifact or scaling layer that multiplies an existing loop.
- Bridge — repairs the weaker side of the currently closest two-school bridge.
- Finisher — strategy or a piece that directly closes late-run finisher requirements.

Roles are derived, never persisted. The same ability may change role after the player pivots the board.

## Directed three-choice draft

Battle rewards (and three-ability shop rolls) are now generated in three deterministic lanes:

1. Core lane — biased toward the current axis and its amplifiers.
2. Bridge lane — biased toward the weaker side of the closest bridge.
3. Pivot lane — biased toward novel tags and non-equipped abilities, preserving the option to change direction.

The lanes use separate RNG domains, so changes to one lane do not silently perturb the other two.

## Build diagnosis UI

The build panel now presents a five-step path: Start → Core → Amplify → Bridge → Finish. Equipped pieces show contextual role badges, and the next missing layer is called out explicitly. Reward cards also show their role and why they matter to the current board.

Because reward generation and deterministic run outcomes change, content/rules version advances to 2.3.0.
