# V2 Method / Artifact Resonance

Implementation contract, 2026-10-27. Experimental branch only. V1/main unchanged.
This builds on V2_JOURNEY_BUILD_CONTRACT.md, not the unimplemented synergy draft.

## Scope and Protocol

Seven methods change their intrinsic loop; eight artifacts replace their old
trigger rules. Existing ten-method/44-artifact pool, four equipment slots, talents,
45 nodes and approved visuals remain. RKF06/09/10 keep poison, multihit fire and
phase identities and gain access to the new artifact interactions.

Each rule is an authored passive/effect with id `<entity>-V2-RESONANCE`,
trigger `always`, operation `modify_effect`, target `self`, params
`{resonance: <kind>, ...numeric parameters below}`, empty requires/consumes/replaces,
limit `{scope: permanent, count: 1}`. This installs a rule; actual proc limits are
below. Exactly one matching rule per listed entity; none on other entities or talents.
Reject unknown keys/kinds, missing/nonfinite/negative parameters, zero thresholds,
noninteger counts, fractions over one and mismatched owner/effect id.
Parameters are authored numbers, not duplicated hardcoded balance constants.
No new root dependencies. Keep measured:null.

Common eligibility: effective hostile direct/derived hits (HP or shield damage);
not reflect, DoT, self damage, opening preparation, or rage echo. Each reaction
excludes its own damage as input. Other rules may react, but limits are reserved
BEFORE emitting damage so two rules cannot recurse indefinitely. Counters persist
only within this battle and never grant extra full actions.
Damage remains source-attributed and goes through ordinary mitigation.
Consumption uses actual live resources and cannot be repeated by echoes.
Outputs can feed the existing hit_rage talent; its existing echo rules are unchanged.
Real round-end healing uses one shared settlement context per fighter per round.
Its derived blossom damage can charge hit reactions under that context's single
set of limits; the DoT ticks themselves never charge hit reactions.

## Methods

| Owner | Kind | Numeric parameters | Semantics |
| --- | --- | --- | --- |
| RKF01 | guard_pressure | absorb_ratio:0.75, cap_hp_ratio:0.4, release_ratio:1 | Store shield absorption from hostile direct hits. At main rage start release and clear stored pressure in one derived hit. Does not consume shield, including alongside RC11/J4-B. Existing retaliation remains. |
| RKF02 | returning_breath | extra_segments:2, segment_ratio:0.55, rage_bonus:10 | Completed main rage readies and forces the next main basic. Its base segments +2, ALL resulting base segments x0.55, extra10 completion rage, then clear. Combine with basic_split multiplicatively. Merge existing forcedBasic bonuses, don't overwrite them. No readiness from echo. |
| RKF03 | spring_bloom | threshold_hp_ratio:0.2, burst_hp_ratio:0.12, max_per_action:1 | All positive self-heal amounts (effective+overflow, including real round-end healing, excluding echo) fill a reservoir to20% maxHP. Spend one threshold for a derived burst12% maxHP; max1 per owning action/round-DOT settlement. Bank at most one threshold for later, no unbounded queue. Existing overflow outlets remain exclusive. No repeated synthetic action reset per DoT layer. |
| RKF04 | burn_accelerate | ticks:1 | At main rage start resolve ONE remaining tick of each preexisting own burn now, then decrement/remove that live layer. Actual DoT kind, existing own-burn heal/rage hooks fire under their normal round limits. Do not create extra ticks or use expired/consumed layer snapshots later. No echo acceleration. Newly applied rage burn waits normally. |
| RKF05 | sword_array | artifact_intent_limit:2, consume_stacks:3, attack_ratio:0.22 | Each eligible equipped-artifact hit gains1 sword intent, max2 per main action; native basic gain remains. Rage follows base with one derived sword per actually consumed preexisting layer, up to3. J2-A retains all layers and disables this intrinsic expenditure; J2-B replaces the intrinsic expenditure with up to5 swords x0.32, not a second consume. Newly generated intent in the same rage is ineligible. |
| RKF07 | thunder_induction | hit_threshold:3, attack_ratio:0.45, max_per_action:2 | Every3 eligible outgoing hits discharge one derived bolt. Own induction bolts do not recharge it. Existing random chains/charge luck remain; capped2 discharges per main action, carry remainder below threshold only. |
| RKF08 | moon_hex | attack_ratio:0.2, drain_per_kind:2 | At completed main action end, for each different live enemy debuff among poison/burn/weakness/armor_break, fire one derived seal and request2 rage drain; one set/action. Do not consume debuffs. Max4 types, same normal drain limits. |

Move some base power to the new loop:
RKF01 basic0.80/rage1.10 (from0.95/1.35);
RKF02 basic1.55/rage2.00 (from1.90/2.50);
RKF03 basic0.75/rage1.15 (from0.88/1.35);
RKF05 basic1.15/rage1.70 (from1.40/2.10);
RKF07 basic0.75/rage0.38 per segment (from0.90/0.45).
RKF04/08 keep current base ratios.
Update affected quick text, effect text, mechanism/route notes and J2-A/J2-B sword
wording; do not leave V1's "rage always preserves intent" claim on the base.

## Artifacts

Keep names, attributes, rarity, slots and max stacks.
Replace old effects for RC13/RR03/RR04/RR09/RR12/RL02/RL03, so their hardcoded old
paths MUST stop executing. RR11 retains its first-own-DoT round rage at5 instead
of10 and adds the rule below. Existing common core rules unchanged.

| Owner | Kind | Numeric parameters | Semantics |
| --- | --- | --- | --- |
| RC13 | shield_retort | defense_ratio:0.18 | Once per hostile main action with direct shield absorption, reflect18% current DEF per owned equipped stack. Grants reflect to any method, no old6% multiplier. Shield-only hits count; reflect cannot reflect. |
| RR03 | venom_pin | hit_threshold:3, poison_stacks:2, duration_rounds:3, attack_ratio:0.08, max_per_action:1 | Every3 eligible outgoing hits apply2 own poison layers. Cap1 activation per main action; carry only remainder below threshold. Normal poison cap10; no old first-basic guaranteed poison. |
| RR04 | wealth_strikes | coins_per_segment:100, max_segments:3, attack_ratio:0.22 | After an effective completed main basic, append 1+floor(frozenCoins/100) derived hits, max3, no coin payment. No probability roll or second activation from echoes. |
| RR09 | rebound_guard | rage_gain:10, defense_ratio:0.35 | On first effective reflect during a hostile main action, grant35% current DEF shield and queue10 rage; once/hostile action, works with method, carapace and RC13. Remove old action-end extra10. |
| RR11 | toxic_furnace | remaining_damage_ratio:0.8, rage_gain:8 | Main action end consumes oldest live OWN poison and burn layer when both exist. Burst80% of their actual remaining tick damage as one derived hit plus8 rage. Once/action, cannot consume removed layers or enemy-owned layers. Keep old own-DoT5 rage/round separately. |
| RR12 | healing_blades | max_charges:2, attack_ratio:0.35 | Positive effective self-heal (not pure overflow, echo/opening/travel) readies one blade, once per owning main action or round-DOT settlement; max2 charges. At NEXT main basic start reserve/clear charges; after base attacks emit one derived hit per reserved charge. No old10 healing rage. Healing later in that basic cannot be immediately spent. |
| RL02 | ember_furnace | stored_ratio:0.6, cap_hp_ratio:0.5, segments:3 | Actual own burn HP damage fills a furnace at60% of damage, cap50% maxHP. Main rage start reserves/clears existing heat; after base attacks emits3 derived hits dividing heat evenly. Later burn acceleration can fill the next furnace, not this one. No old burn healing. |
| RL03 | wheel_storm | hit_threshold:6, segments:4, attack_ratio:0.25, max_per_action:1 | Every6 eligible outgoing hits release4 derived hits. Own wheel hits don't recharge it, but can feed other rules. Max1 storm/main action, reserve limit before output; carry only remainder below threshold. No old2 guaranteed basic followups. |

## Feedback / Persistence

Root adds optional `FighterView.counters: {id:string,name:string,value:number,max:number}[]`.
Combat exposes truthful snapshots of pressure, breath readiness, bloom reservoir,
induction, venom/wheel counts, healing blades and furnace; omit absent rules and
use finite bounded values. Sword intent uses existing status display.
UI uses a compact line outside character art; details disclose full rule text.
Brief spell names/source labels on procs. Do not put long rules on battle screen.
Content summary/card rules must show mechanics, not only attribute gains.

New save/build/replay keys end `-v2-resonance`, old keys untouched. Run
`buildVersion:2` also rejects raw states from the previous mechanics, even without
a wrapper key. No silent reinterpretation. No new artwork required.

## Module Ownership

- Combat worker: combat.ts and NEW tests/shanhai-v2-resonance-combat.test.mjs only.
  Can report required legacy test changes; root integrates them. No new TS modules.
- Content worker: content/shanhai YAML/README, tools/content-kit source/tests and
  generated docs via tool. No runtime or root tests.
- UI worker: app.ts, cartoon.css/style.css, NEW tests/shanhai-v2-resonance-ui.mjs.
  No content/runtime or existing browser fixtures; avoid reading untracked draft.
- Root: types.ts, storage, integration/independent tests, baseline docs, final checks/Git.

Workers must read exact code they change, not fork agents, not commit, not rebuild
dist or run browser checks while other workers are active. Content tools tests,
tsc --noEmit, and read-only focused checks are allowed. Root builds after integration.
Each reports files, tests, unverified edge cases. Tests must cover real runtime output,
not just that YAML includes the word resonance.
