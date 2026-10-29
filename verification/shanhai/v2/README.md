# V2 Experimental Verification

Track: `feat/v2-build-engine`, 2026-10-29, content `shanhai-content-0.2`.
The second overhaul uses `buildVersion: 5` and the `-v2-overhaul` storage
namespace. Older saves are left untouched. V1 remains at tag `V1` (`2f08f08`);
these reports do not replace its evidence or establish player win rates.

## Functional Checks

- `npm test`: 393 tests passed, including five-slot ordering and replay,
  fusion, companion assistance, rage chains, challenge settlement and saves.
- Content-kit: 44 tests passed; 154 entities, including 46 artifacts, validate.
- Generated content: 32 pages checked without drift.
- Five-slot, challenge and fusion browser fixtures cover 360, 390, 430 and
  1440 pixels. Fixture battles and injected presentation frames are explicitly
  test scenarios, not normal progression samples.
- The general browser suite passed 13 checks. A mobile real-click journey
  completed the first act's 11 nodes in 43 actions, without page errors.
- A real desktop click journey reached victory in 45 nodes and 177 actions,
  with no page errors. It formed RL06 during the run and the ending recorded
  that fusion. Its act-three boss, act-four boss and final enemy each lasted
  two rounds; the handpicked functional seed is not a win-rate sample.

## Observed Samples

`simulation.json` contains 25 real game runs, five per starting method, with a
deterministic route and equipment heuristic. The current sample is **10 wins,
15 losses and no errors**. Each method won 2/5. All losses occurred in act 1
(steps 2, 6, 8 and 9); cumulative passage of each of the four acts was 10/25.
The sample uses paired seed names and a seed-dependent route preference: it is
not a sample of independent players or evidence of balanced difficulty.

A wider run of the same policy with 20 paired seeds per method produced
**72 wins in 100 runs**, with cumulative act passage **78 / 77 / 75 / 73**;
the per-run outcomes and content hash are in `simulation-100-summary.json`.
These are correlated method/seed pairs, not 100 independent players. Among the
72 wins, 52 final battles lasted three rounds or fewer. This reinforces the
need to inspect late-game pressure; it does not prove the overall player rate.

The calibration report contains 850 fixed-reference encounters: **825 player
wins and 25 enemy wins**. Its 25 full runs use the same seed cohort as the
simulation and must not be counted as another 25 independent runs. The current
reference board uses five equipment slots, so its outcomes are not a direct
comparison with earlier four-slot reference reports.

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

The universal right-neighbor copying mirror, inscriptions and one-HP sacrifice
remain proposals, not implemented features. Old reaction and resonance
experiments are documented in `docs/shanhai/rework/V2_EXPERIMENT.md`; do not
combine their samples with this version.
