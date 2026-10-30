# V2 Experimental Verification

Track: `feat/v2-build-engine`, 2026-10-30, content `shanhai-content-0.2`.
The second overhaul uses `buildVersion: 5` and the `-v2-overhaul` storage
namespace. Older saves are left untouched. V1 remains at tag `V1` (`2f08f08`);
these reports do not replace its evidence or establish player win rates.

The dated observations below record earlier V2 iterations. The latest
multi-policy holdout and its content fingerprint are in
`difficulty/v2-final-holdout-20261030.json` and its accompanying report;
do not combine it with earlier seed cohorts or fixed encounter boards.

The final content passes 471 runtime tests, 48 content-kit tests and the
32-page generated-content check. The independent paired-policy sample has
four-act cumulative passage of 76.7% / 66.3% / 55.3% / 42.3%; it is not a
measurement of human players, and the last two values remain above target.
The final browser journey used the handpicked `v2-functional-RKF01-1` seed:
desktop completed 45 nodes and the mobile run completed all 11 first-act nodes,
with no reported page errors. The common browser suite passed 13 checks.

## Functional Checks

- `npm test`: 413 tests passed, including five-slot ordering and replay,
  fusion, companion assistance, rage chains, challenge settlement and saves.
- Content-kit: 45 tests passed; 155 entities, including 47 artifacts, validate.
- Generated content: 32 pages checked without drift.
- Five-slot, challenge and fusion browser fixtures cover 360, 390, 430 and
  1440 pixels. Fixture battles and injected presentation frames are explicitly
  test scenarios, not normal progression samples.
- Mixed-frame feedback covers damage, shield, status and rage at the same
  widths, including reduced motion. Damage and generated shield have separate
  top-three rankings; the shield ranking is collapsed by default.
- The general browser suite passed 13 checks. A mobile real-click journey
  completed the first act's 11 nodes in 43 actions, without page errors.
- A real desktop click journey reached victory in 45 nodes and 177 actions,
  with no page errors. It formed RL06 during the run and the ending recorded
  that fusion. Its act-three boss, act-four boss and final enemy each lasted
  two rounds; the handpicked functional seed is not a win-rate sample.

## Observed Samples

`simulation.json` contains 25 real game runs, five per starting method, with a
deterministic route and equipment heuristic. The sample uses paired seed names
and a seed-dependent route preference: it is not a sample of independent players
or evidence of balanced difficulty. The file is regenerated after balancing;
the earlier 10-win/15-loss result belongs to a prior content version.

An earlier build was also measured with 20 paired seeds per starting method:
**74 wins in 100 runs**, cumulative act passage **78 / 77 / 77 / 74**, and 57
winning final battles of three rounds or fewer. Details and the content hash
are in `simulation-100-current.json`. The 25-run sample is a subset and must
not be added to the 100; neither represents a player win rate.

A wider run of the previous build, before the vow and mirror were added,
with 20 paired seeds per method produced
**72 wins in 100 runs**, with cumulative act passage **78 / 77 / 75 / 73**;
the per-run outcomes and content hash are in `simulation-100-summary.json`.
These are correlated method/seed pairs from the previous content hash, not a
measurement of this build or 100 independent players. Among the
72 wins, 52 final battles lasted three rounds or fewer. This reinforces the
need to inspect late-game pressure; it does not prove the overall player rate.

The earlier calibration recorded 850 fixed-reference encounters and 825 player
wins. The regenerated board now scales its five reference artifacts by
cultivation tier; its input hash and layer rule are recorded in the report, so
its outcomes are not directly comparable with that earlier board. Its 25 full
runs use the same seed cohort as the simulation and must not be counted twice.

`vow-comparison.json` compares 15 seed pairs under the current build. The vow
was offered and selected in all pairs: the baseline won 12/15 and the forced
vow won 9/15. These are small, paired policy samples, not player win rates.
Reproduce with `node tests/shanhai-v2-vow-comparison.mjs`.

The policy fills five slots and responds to normal rewards and events. It does
not actively use thunder challenges, reward seeking or reward refinement;
companions and qualifying fusion still activate automatically when acquired.
These results do not establish how a player pursuing those systems will fare.

`forging-comparison.json` and its Markdown companion contain deterministic
high-HP fixtures that compare RC01 with and without its convergence rule, and
isolate RC14's awakening. They explain specific effects and tradeoffs; they do
not establish general strength, player enjoyment or causal value of every item.

## Remaining Work

Act-one losses remain clustered while later successful builds can end the
final battle quickly. The V1 cumulative passage targets of 80% / 65% / 50% /
35% have not been established for this V2 ruleset. Wider paired-seed and
multi-policy tests plus human play are still needed to evaluate pressure,
build diversity, fun and replay appeal. Damage contributions record actual
credited output, not the counterfactual gain from equipping an item.

The current mirror copies eligible triggered outputs of its immediate right
neighbor, including eligible non-awakening outputs. Inscriptions and the
one-HP sacrifice are implemented; static attributes, travel effects and copied
secondary triggers are not mirrored. The battle comparison is one same-seed
counterfactual, not an estimate across opponents and random seeds. Old
experimental saves are not guaranteed to load after the content pool changed.
