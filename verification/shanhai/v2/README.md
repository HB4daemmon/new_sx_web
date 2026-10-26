# V2 Experimental Verification

Track: `feat/v2-build-engine`, content `shanhai-content-0.2`.
V1 remains at tag `V1` (`2f08f08`); this directory does not supersede its
calibration evidence. Reports use real authored combat unless explicitly
described as a UI fixture.

## Functional Checks

- `npm test`: 234 passing tests, including equipment, save isolation, frozen
  talent drafts, segmented route topology and six ordinary core mechanisms.
- `npm run test:content`: 34 passing tests.
- Content validation: 152 entities, zero validation errors.
- `docs:check`: all 32 generated pages match the YAML source.
- Documentation staged independently with link/navigation/credential checks;
  the experiment was not published to the formal documentation site.

## Observed Samples

`SIM_SEEDS=20 npm run simulate` used 20 seeds for each of the five starting
methods, rotating the existing avoid/steady/tracking heuristic. It completed
100 runs: **57 wins, 43 losses**, no unfinished run or exception. Each action
was followed by serialization, reload and state equality checks.

| Starting Method | Wins / Runs |
| --- | ---: |
| RKF01 | 15 / 20 |
| RKF02 | 14 / 20 |
| RKF03 | 8 / 20 |
| RKF04 | 10 / 20 |
| RKF05 | 10 / 20 |

Cumulative passes of acts 1-4 were **88/100, 87/100, 85/100, 65/100**.
The final encounter accounts for the difference between 65 act-four survivors
and 57 completed runs. These are observations of one heuristic family, not
player win probabilities. They do **not** meet the V1 target curve
80% / 65% / 50% / 35%; V2 difficulty is explicitly uncalibrated.

`npm run calibrate` measured 850 fixed-reference encounters:
830 wins, 20 losses, zero unresolved battles or errors. Its 25 full runs
produced 14 wins and 11 losses. The latter seeds overlap the simulation pool
and are not additional independent samples. The reference encounter win rate
is not the full-run win rate.

## Browser Evidence

- `browser/report.json`: standard UI fixture checks, not evidence of a real win.
- `journey/report.json`: actual browser clicks from character creation, a
  45-node desktop win and an 11-node first-act mobile journey.
- `tests/shanhai-v2-ui.mjs`: 390/430/1440 viewport checks, equipment changes,
  inventory versus active gear, shared talent details, V1 storage isolation,
  core copy and compact contribution feedback.
- Mobile rewards additionally check vertical layout, readable role badges,
  and unclipped core mechanisms and tradeoffs.

Screenshots are local evidence and are ignored by Git. Browser fixtures do
not replace human playtesting. The old optional V1 art/tree browser suites
have not all been migrated and are not claimed as V2 acceptance results.

## Remaining Gates

Cross-core balance, core selection diversity, reward quality, build completion
timing and human assessments of fun, power and replay appeal remain open.
Contribution totals explain actual events; they are not a counterfactual
measurement of the net benefit of equipping an item.
