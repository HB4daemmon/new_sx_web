# V2 Reaction Prototype

> Historical iteration contract; current slots, save version and delivery rules
> are documented in `docs/shanhai/rework/V2_EXPERIMENT.md` and `AGENTS.md`.

2026-10-27. Experimental branch `feat/v2-build-engine` only. V1/main unchanged.
This supersedes the relevant behavior in V2_RESONANCE_CONTRACT.md, not the
untracked rejected V2_SYNERGY_CONTRACT.md. Do not use that draft as instructions.

## Scope

Keep four equipment slots, ten methods, 44 artifacts, current talents, 45 nodes
and approved character art. Make three behavior loops readable, let players
spend a limited resource to pursue a build, and give act-one bosses breakable
public preparations. No new dependencies, no manual combat, no free rewards.
This is a playable experiment, not a claim that fun or balance is established.

## Shared Runtime Interfaces (Root Owns types.ts)

- FighterView gains `summons?: {id:string,kind:'sword',count:number,max:number}[]`.
  These are persistent flying weapons, NOT targetable or living companions.
- BattleFrame gains optional `cue`:
  `{kind:'sword_volley'|'guard_counter'|'spring_bloom'|'enemy_charge'|'enemy_release',
    owner:Side, sourceId:string}`.
  A `reaction` frame carrying this cue begins a distinct playback beat.
  Damage following it belongs to that beat; it must not become an ordinary
  basic/rage animation. No false full-action labels or duplicated action income.
- Loadout gains `encounterId?:string` for actual authored enemy trial lookup.
  Validate the reference and use it on the enemy side only, never guess by name.
- RunState buildVersion becomes 3; new run/build/replay namespace is
  `-v2-reactions`. Old keys stay untouched, old raw state imports are rejected.
- ArtifactRewardFamily = `sword | guard | vitality | affliction`.
- RunCommand adds `{type:'seek_reward',family:ArtifactRewardFamily}`.
- RunState gains required `rewardSearches: RewardSearchRecord[]`, with
  `{act:number,step:number,family:ArtifactRewardFamily,cost:number,
    candidates:string[],resolved:boolean}`.
- Game exposes `rewardSearchPreview(family)` returning
  `{available:boolean,reason:string,cost:number,candidates:string[]}`.
  This is pure and deterministic. State validation must not mutate a save.

## Three Reaction Loops (Combat Worker)

All outputs use actual mitigation, side/source ownership and attribution.
Reserve/clear resources before damage. Never resurrect dead fighters, emit a
dead fighter's reaction, duplicate main-action rage, repeat preparation or echo.
Each completed living hostile MAIN action may cause one responding beat per
rule. Prepared attacks, DoT settlement, echoes and reactions cannot recursively
schedule hostile-action responses. A bounded synthetic context may allow the
existing hit-based artifacts to react; its budgets are shared across that beat,
and own rule output cannot feed itself. No full executeAction recursion.

1. RKF05 sword_array retains its existing intent/J2-A/J2-B semantics.
   Add authored params `opening_swords:1`, `flying_sword_cap:3`,
   `flying_sword_ratio:0.18`. Start with one sword. Each completed own main
   basic raises sword count by one up to cap. After a living hostile main
   action, all existing swords each attack once at that ratio. Swords persist
   within the battle. Publish the summon snapshot. Lower base basic from1.15
   to0.95 and rage1.70 to1.50 to fund it. This is not a new targetable unit.
2. RKF01 guard_pressure retains shield absorption storage and rage release,
   but gains `counter_threshold_hp_ratio:0.12`. After a hostile main action
   with real direct shield absorption, if stored pressure meets threshold OR
   that action broke a real shield, clear and release stored pressure in one
   independent counter beat. Zero stored pressure never fires. Existing rage
   can release the leftover only once; consumed pressure cannot repeat.
   Keep release_ratio1.0. Do not fake reflection from a plain damage event.
3. RKF03 spring_bloom keeps threshold0.20HP and burst0.12HP, but positive
   self-healing now banks spring energy instead of immediately exploding.
   Cap bank at TWO thresholds. After a living hostile main action, spend one
   threshold for one spring_bloom beat; remaining charge can wait. No repeat
   from each DoT layer or echo. Publish truthful spring charge counter.

## Public Boss Preparations (Content / Combat / Run / UI)

Only EN-A1-B1 and EN-A1-B2 gain optional authored `trial` objects. Reject trials
on other entities for this prototype and reject unknown/missing parameters.

- B1 `{kind:tidal_charge,period:3,charges:3,attack_ratio_per_charge:0.45}`.
  At opening and after each release load three charges. Each effective hostile
  direct/derived hit removes one charge (DoT/reflect do not). At start of
  rounds 3,6,... release remaining charges as that many direct damage segments,
  then refill if alive. Zero charges produce an explicit broken-preparation
  cue with no damage. Releases do not repeat main-action income.
- B2 `{kind:reviving_mist,period:3,charges:3,heal_hp_ratio_per_charge:0.045}`.
  Same schedule; each own HP-damaging incoming poison/burn tick removes one
  charge. At release heal by remaining charges times that maxHP ratio.
  Shield-only DoT ticks do not count. Charge reduction is real, bounded and
  source-attributed. Direct damage does not pretend to break mist.
- Expose charge and countdown counters on enemy frames. Map/previews disclose
  period, preparation and actual ways to interrupt, without hidden immunity.
- Existing main actions remain. These are build questions, not blanket
  invulnerability or only-one-correct-build gates. Test both success and break.

## Seeking an Existing Reward (Run / Content / UI)

RULES.economy.reward_seeking authored configuration:
`{price:8,max_per_act:1,families:{sword:[...],guard:[...],
vitality:[...],affliction:[...]}}`.
Use explicit real artifact IDs. Families may overlap. Validate all references,
duplicates, exact family keys and positive integer price/max_per_act=1.
Prefer mechanism inputs, not an unaudited runtime substring/tag heuristic.

Only reward phase, after the guaranteed initial core offer (the offer itself
cannot be sought), acts1-4, one paid search per act. Preview can be inspected
for free, but payment is required to replace the original candidates.
For each rarity in original nonlegendary candidates, draw up to that many
distinct acquireable family artifacts of that SAME rarity, seeded by run,
act, step, family. Preserve already-offered legendary candidates unchanged.
Do not add reward slots, upgrade rarity, append a second reward or silently
fill exhausted families with unrelated items. Fewer than three is acceptable
and must be shown before payment. If list unchanged/empty, offer unavailable.

Use chargeCoins so actual spend enters the journey ledger. Check affordability
and all preconditions again atomically on command. On success save exact new
candidates and one record. Mark record resolved when reward chosen/declined.
Enforce one record/act, valid coordinates, family, exact config cost, bounded
unique candidate IDs and unresolved/current reward consistency. Historical
resolved records must remain valid after later inventory acquisitions.
Save/load/preview/back cannot regenerate or refund; failures roll back.

Fix frozen-map adjacent-repeat enemies by considering already-authored direct
parent combat nodes during generation. Do not re-roll a preview at entry,
alter a frozen map after back/load, or promise complete uniqueness in a pool
of four. Add route-path regression tests.

## Feedback (UI Worker)

Teach no new tutorial text. Use short names, tool icons, full rules in details.
Show persistent flying swords near their owner and a clear launch on volley;
use existing art/symbols, no fake game art. Independent reaction cues must
survive frame grouping; do not lump all three into generic "exchange".
Keep resource bars and characters readable at360/390/430/1440px.
Seeking is a collapsed reward action with explicit price/use state and family
menu, preview names and one confirm. No duplicate claim action or free search.
Preserve current per-source contribution integrity; highlight recent acquired
artifact/talent ONLY when it actually contributed, not as causal net gain.

## Module Ownership and Acceptance

- Combat: combat.ts, build-mechanics.ts if truly needed, NEW reaction combat
  tests only. No types/run/content/UI or legacy test edits. No build/browser.
- Run: run.ts, NEW seeking/route tests only. No types/persistence/content/UI
  or legacy tests. Include encounterId in actual enemy loadouts.
- Content: content/shanhai YAML/README, tools/content-kit source/tests,
  generated docs through tool. No runtime/tests outside content-kit.
- UI: app.ts, cartoon.css, battle-playback.ts, NEW reaction UI tests.
  No types/combat/run/content or legacy tests. Coordinate via this contract.
- Root: types/persistence, storage fixtures, baseline docs, assets/integration,
  legacy tests, independent acceptance, final Git.

Workers read exact code they change, no subagents, no commits, no dist builds.
Run available no-emit/type/content checks; root builds/tests after integration.
Report files, checks, uncertain boundaries. Do not claim player fun is proven.
