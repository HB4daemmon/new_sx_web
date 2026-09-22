# Artifact Budget Audit

This directory contains a small deterministic arithmetic and node-ledger checker for
the artifact baseline. It is a verification fixture, not a combat engine, shop
simulator, or card-data calibration. Inputs are hand-authored fixtures plus
explicit real-node snapshots; passing this module does not claim full runtime or
44-card coverage.

## Run

From the repository root:

```sh
node --check verification/artifact-budget/audit.mjs
node verification/artifact-budget/audit.mjs
node verification/artifact-budget/audit.mjs --json
```

The normal command reports the check count and pass count. `--json` emits stable
machine-readable output. There is no date, random seed, runtime state, or external
dependency.

## Contracts covered

- `compareCombat` imports and reuses `powerScore` from
  `verification/power-budget/audit.mjs`. It computes
  `A = 100 * (P_with / P_without - 1)` only when both ledgers explicitly carry
  `complete:true`, `L > 0`, `H > 0`, and `P_without > 0`. `D = 0` is a valid
  diagnostic result (`A = -100`); it is not a budget acceptance. `D`, `L`, and
  `H` are read together from each ledger, so mixed defense, life, and output
  effects are not separately scored. The result is score-only and never claims
  overall budget acceptance. Invalid input returns `null`/`reason` through the
  result object, or throws with `{strict:true}`.
- `stackBudget` computes same-ID `A_n` and marginal `M_n` against one no-ID
  `P0`. Ordinary layer caps are exactly 3 or 5; rare and legendary items are
  single-item. Layer 0 must use the same `P0` and therefore has `A_0 = 0`.
  Layer 1 must also use that zero-layer reference as its previous layer.
  The result is score-only and does not simulate rage thresholds or claim that
  every card has a linear measured curve.
- `travelUtility` uses
  `J = S/(.5*C) + XP/(.2*X) + Heal/(.2*H)`. `C` is the common reference price,
  `X` is the complete next-breakthrough demand, and `H` is fixed reference
  maximum HP excluding the measured artifact. Raw, usable, waste, and unknown
  resource amounts are kept separately and must conserve as
  `raw = usable + waste + unknown`. A positive amount with unknown future use,
  validity, or anchor produces a `null` contribution and reason; a known zero
  remains `0`, not `null` or `NaN`. Missing `nextRealm` defaults to `unknown`;
  `nextRealmConfirmed:false` also means unconfirmed, while explicit `none` means
  no next realm. Missing `coinFutureUse`/`futureUse.coin` defaults to unknown,
  not confirmed use. `futureUse.xp` is not an XP validity interface. Terminal
  output is retained as raw output, moved exactly once to waste, and has usable
  value `0`. `X` is never a remaining-gap estimate.
- `buildNodeLedger` accepts explicit real nodes (`C/E/K/L/S/R/B`) and explicit
  `entryStacks`/`exitEligibleOriginalStacks`. `RC16`, `RC17`, and `RC18` qualify
  on every real node; `RR06` qualifies only on `C/L/B`. New acquisition,
  mid-node removal, re-buy, death, duplicate node IDs, terminal payout, full
  HP, partial HP, and event-internal battles are not inferred. Snapshot counts
  are limited to 3 for `RC16`-`RC18` and 1 for `RR06`; only these IDs are
  checked by this small audit, not all 44 artifact IDs. Duplicate IDs throw by
  default; `{duplicate:'skip'}` drops the duplicate line without moving a
  window position. A death node remains in the attempted route with no reward,
  then later nodes are not settled. A terminal node may retain raw rewards,
  converts them to waste with usable value `0`, and stops the route.
  `hpGap` or `maxHp/currentHp` is required to make a positive node-heal amount
  effective. Missing `nextRealm` and missing coin future-use state remain
  unknown rather than being silently treated as usable.
  A node can override `coinFutureUse` and `nextRealm` from the fixture defaults,
  so later nodes need not assume earlier shopping or breakthrough opportunities.
  Unknown trigger counts remain unknown in totals. At a terminal node, even an
  unknown raw amount has known usable value `0`; only its wasted amount remains
  unknown.
- `selectTravelWindow` returns the actual next 3, next 11, or remaining real
  adventure nodes without padding a short route. It includes a death node in
  the attempted window with no later nodes after it; terminal nodes are excluded
  by default and still stop the route. Duplicate handling uses the same
  throw/skip policy.
- `purchaseSavings` counts only `oldPrice - paidPrice` for a completed purchase.
  `nominalOfferBudget` reports placement arithmetic only: 4 common + 2 rare is
  `8.8U` per act and `35.2U` over four acts; a legendary replacing a rare adds
  `1.6U`, and an elite replacing a common adds `1.4U`. The result is explicitly
  `nominalOnly` and never a direct `176%` power claim.
- `totalBudget` evaluates `U = A/5 + J`. Acceptance is evaluated only with a
  known rarity and its range: common `0.8-1.2` around `B=1`, rare `2-3` around
  `B=2.4`, and legendary `3.6-5` around `B=4`. A missing rarity is unassessed;
  an unknown rarity is rejected. Negative `A` is retained for diagnosis but
  always sets `budgetAcceptance:false`; it cannot subsidize extra travel budget.

## Exported entry points

`RARITY_BUDGET`, `BUDGET_TARGETS`, `SCORE_TEMPLATES`, `NODE_TYPES`,
`COMBAT_NODE_TYPES`, and `TRAVEL_WINDOWS` expose the fixed anchors.
The main pure functions are `compareCombat`, `combatA`, `stackBudget`,
`travelUtility`, `buildNodeLedger`, `selectTravelWindow`, `purchaseSavings`,
`pickedOfferBudget`, `nominalOfferBudget`, `totalBudget`, and
`evaluateTemplate`. The alias `calculateTravelJ` is provided for readable
fixture imports.

## Limits

The node input is an explicit post-acquisition fixture supplied by an upstream
runtime or test; the acquisition node itself is not included unless the fixture
deliberately records it as a later real node. This file does not discover nodes,
run battles, resolve shops, generate card offers, convert XP into later
equipment, or infer future resource use.
Unknown snapshots stay unknown. A downstream conversion must not count the same
resource again. The arithmetic targets are design estimates and have no claim of
full-card numerical calibration or win-rate validation.
