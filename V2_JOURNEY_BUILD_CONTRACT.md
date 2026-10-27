# V2 Journey Build Experiment

Implementation contract, 2026-10-26. Experimental branch only; not V1 or main.
This supersedes the old unimplemented synergy proposal, which is not part of this change.
The later V2_RESONANCE_CONTRACT.md updates method/artifact rules and storage to
buildVersion 2 / `-v2-resonance`; this file records the preceding journey baseline.

## Shared Interfaces

- `RunEquipment = {slots: string[]}`: up to four unique owned artifacts, regardless of
  `equipment_role`. Roles remain descriptive metadata, not capacity restrictions.
- `RunState.buildVersion = 1`, `progress = {coinsSpent, eliteWins, bossWins}`.
  Validate finite nonnegative values and integer victories; reject incompatible old saved runs.
- `Loadout.journey?: {coins, coinsSpent, eliteWins, bossWins, artifactKinds, knownMethods}`.
  Player snapshots freeze current run facts. Absence means zero for standalone battles.
  Inventory diversity counts distinct owned artifacts, not layers; unequipped artifact effects
  remain inactive. Learned methods count distinct owned methods.
- `ShanhaiGame.canChallengeElite(): boolean` and command `{type:'challenge_elite'}`:
  with the hunter insight, once per act, upgrade the current normal combat preview to an
  actual elite encounter and its rewards. Preserve node count, save integrity and reload stability.
- First breakthrough: three seeded shared choices from six tier-one candidates.
  Later breakthroughs: one local method choice and two shared choices from that tier.
  All candidates frozen; no reroll on view, reload or method switching.

## Insight Data

Keep existing insight IDs A-C at all four tiers and add V2-J1-D/E/F (15 total).
These are replacement mechanics, not additions to every existing talent.
All build rules use one standard effect:
`trigger: always`, `operation: modify_effect`, `target: self`,
`params: {build: <kind>, ...authored numbers}`,
empty requires/consumes/replaces, limit permanent/count 1.
This limit denotes one installed rule, not one hit trigger. Runtime implements the rule's
explicit per-hit/action semantics. Preserve measured:null.

| ID | Name | Kind | Parameters / intent |
| --- | --- | --- | --- |
| V2-J1-A | 财能通神 | wealth_damage | scale:1.2, half_saturation:150; direct/derived outgoing multiplier 1 + scale*coins/(coins+half_saturation) |
| V2-J1-B | 破军战骨 | hunter | base_attack:8, base_defense:6, elite_attack:8, elite_defense:6, boss_attack:12, boss_defense:8; also unlock invite-elite command |
| V2-J1-C | 动若脱兔 | speed_damage | speed_bonus:2, max_multiplier:2.5; direct/derived damage multiplier max(1,min(max_multiplier,ownSpeed/enemySpeed)), protect zero denominator |
| V2-J1-D | 猬甲护身 | carapace | defense_per_hit:6, reflect_ratio:0.24; grow battle-only defense on effective hostile direct hit, then reflect by current defense; shields count, DoT/self/reflect do not, no reentry |
| V2-J1-E | 挥金如土 | spending_power | base_attack:8, attack_per_coin:0.08; based on actual paid run coins, not rewards, hypothetical prices or replays |
| V2-J1-F | 万宝朝宗 | collection_damage | base_bonus:0.1, per_kind:0.04; direct/derived multiplier 1+base_bonus+per_kind*distinct inventory kinds |
| V2-J2-A | 战利生财 | bounty | attack_bonus:8, normal_coins:4, elite_coins:20, boss_coins:30; actual settled combat victory, no terminal reward, no loss/replay farm |
| V2-J2-B | 市井仙缘 | shop_discount | ratio:0.75; future shop inventory quotes only, minimum price 1, actual paid amount enters spending ledger |
| V2-J2-C | 剑丸成阵 | basic_split | extra_segments:2, segment_ratio:0.6; base basic attack segments +2, each 60% original segment power; do not duplicate whole actions, returns or costs |
| V2-J3-A | 战意不息 | hit_rage | amount:3; each effective outgoing direct/derived hit adds rage through existing end-round accounting, not reflection or DoT |
| V2-J3-B | 身外化身 | rage_echo | ratio:0.45; replay rage body's damage/healing/shield/status at reduced strength, no rage payment/main-action incomes or recursive echoes; source attributed |
| V2-J3-C | 百战护体 | veteran_shield | base_ratio:0.06, elite_ratio:0.02, boss_ratio:0.03; opening max-HP shield by past victories |
| V2-J4-A | 锦衣护道 | wealth_shield | base_shield:30, shield_per_coin:0.4; opening shield by frozen current coins |
| V2-J4-B | 百战封侯 | trophy_damage | base_bonus:0.12, elite_bonus:0.1, boss_bonus:0.15; direct/derived outgoing multiplier by past victories |
| V2-J4-C | 先天神力 | existing modify_stat | always/modify_stat attack percent_add 0.35 |

The combat module owns `src/shanhai/build-mechanics.ts`. Export:
`buildMechanicViews(content: Content, loadout: Loadout, stats: Stats): {id:string,name:string,summary:string}[]`
for concise truthful current-value UI; callers pass authoritative `calculateStats` output.
Journey flat stats enter before percentage amplification. Echo body outputs are credited to
the echo talent, and secondary artifact outputs to their artifacts. Consumed-resource bursts
are not copied by an echo. Status counts/durations round to at least one.
Do not claim source contribution is a counterfactual net benefit.

## Ownership

- Progression worker: run.ts, equipment.ts, progression/equipment tests and old affected
  runtime tests except combat-focused tests. Do not modify types.ts without root coordination.
- Combat worker: combat.ts, build-mechanics.ts, combat-focused tests.
- Content worker: content/shanhai YAML/README, tools/content-kit source/tests;
  generated docs only through tool command. No root dependency changes.
- UI worker: app.ts, style.css and browser fixtures/scripts as needed.
- Root: shared types, integration, documentation, final checks and Git operations.

No change to game length, V1 saves, production assets, formal main, or unrelated user edits.
New namespace for this experiment's saves/replays; do not silently reinterpret old V2 saves.
