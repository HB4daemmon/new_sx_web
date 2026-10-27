# V2 Experimental Verification

Track: `feat/v2-build-engine`, content `shanhai-content-0.2`.
Current experiment: independent reactions and paid reward seeking, 2026-10-27,
buildVersion 3, storage namespace `-v2-reactions`. Previous resonance saves stay
untouched and are not silently migrated.
V1 remains at tag `V1` (`2f08f08`); this directory does not supersede its
calibration evidence. Reports use real authored combat unless explicitly
described as a UI fixture.

## Functional Checks

- `npm test`: 312 passing tests, including 13 focused reaction/trial tests and
  26 updated resonance tests,
  equipment, save isolation, frozen talent drafts, segmented route topology,
  seven new intrinsic method loops and eight artifact replacements.
- `npm run test:content`: 39 passing tests.
- `node --test tests/shanhai-v2-reactions-ui.mjs`: 5 playback/source checks.
- Content validation: 152 entities, zero validation errors.
- `docs:check`: all 32 generated pages match the YAML source.
- Generated documentation remains in the experimental worktree; the experiment
  was not published to the formal documentation site.

## Observed Samples

`npm run simulate` used five seeds for each of the five starting
methods, rotating the existing avoid/steady/tracking heuristic. It completed
25 runs: **22 wins, 3 losses**, no unfinished run or exception. Each action
was followed by serialization, reload and state equality checks.

| Starting Method | Wins / Runs |
| --- | ---: |
| RKF01 | 4 / 5 |
| RKF02 | 5 / 5 |
| RKF03 | 3 / 5 |
| RKF04 | 5 / 5 |
| RKF05 | 5 / 5 |

Cumulative passes of acts 1-4 were **22/25 at each act**. All three losses were
at act-one step 2; mid/late-run snowballing remains too strong. These are observations of one heuristic family, not
player win probabilities. They do **not** meet the V1 target curve
80% / 65% / 50% / 35%; V2 difficulty is explicitly uncalibrated.

`npm run calibrate` measured 850 fixed-reference encounters:
823 wins, 27 losses, no unresolved battle or error.
Its 25 full runs produced 22 wins and 3 losses. The latter seeds overlap the simulation pool
and are not additional independent samples. The reference encounter win rate
is not the full-run win rate. Trial enemies in the fixed board now retain their
authored encounter IDs, so their preparations are simulated too.
The heuristic does not use the new paid-seeking command. These samples do not
measure its value or establish the difficulty of a player actively pursuing a build.

## Browser Evidence

- `browser/report.json`: standard UI fixture checks, not evidence of a real win.
- `journey/report.json`: actual browser clicks from character creation, a
  45-node desktop win and an 11-node first-act mobile journey.
- `tests/shanhai-v2-ui.mjs`: 360/390/430/1440 viewport checks, equipment changes,
  inventory versus active gear, shared talent details, V1 storage isolation,
  core copy and compact contribution feedback.
- `tests/shanhai-v2-resonance-ui.mjs`: source labels, authored rule details and
  counter frame updates at 360/390/430/1440. These use explicit UI fixtures,
  not fabricated combat evidence.
- `tests/shanhai-v2-reactions-browser.mjs`: actual deterministic combat replays
  using explicit test stats, not unmodified progression. Sword/guard/spring
  responses cover 360/390/430/1440. Also checks authored boss disclosure,
  charge release and interruption feedback; paid search preview, payment,
  reload, reduced candidate count and single claim. Screenshots are in
  `/tmp/shanhai-v2-reactions-browser`.
- Actual browser journey: desktop 174 stages, mobile 43 stages; no failures or
  page errors. Root also visually inspected a real opening battle at 390/1440.
- Mobile rewards additionally check vertical layout, readable role badges,
  and unclipped core mechanisms and tradeoffs.
- The desktop journey's act-three/act-four bosses still ended in 3 rounds
  and the final fight in 4. This is evidence of remaining late-game pressure
  problems, not a success criterion.

Screenshots are local evidence and are ignored by Git. Browser fixtures do
not replace human playtesting. The old optional V1 art/tree browser suites
have not all been migrated and are not claimed as V2 acceptance results.

## Remaining Gates

Cross-core balance, core selection diversity, reward quality, build completion
timing and human assessments of fun, power and replay appeal remain open.
Contribution totals explain actual events; they are not a counterfactual
measurement of the net benefit of equipping an item.
The recent-item badge has not yet received a focused end-to-end acquisition
test; source inspection and the ordinary journey are not a substitute for one.

`difficulty/observed-smoke.*` is older experiment evidence, not a measurement
of this reaction revision. Do not combine it with the current 25-run sample.
