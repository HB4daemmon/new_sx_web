# V2 Experimental Contract

> Historical first-iteration contract. Slot counts, save versions and branch
> restrictions below describe that iteration; current rules are in
> `docs/shanhai/rework/V2_EXPERIMENT.md` and repository collaboration in `AGENTS.md`.

V1 is frozen at tag `V1` (`2f08f08`). Work only on `feat/v2-build-engine`.
Do not merge the experiment into main. Do not edit the formal checkout's UI experiments.

## Experience Priority

The primary acceptance principle is fun, satisfying power, and replay appeal.
Slot limits and route commitment must earn their complexity through meaningful choices.
Core pickups should change the next battle, and coherent builds may become exceptionally
strong. Do not flatten every successful synergy to satisfy an average win-rate target.
Automated correctness and successful runs do not certify these experience goals.
See `docs/shanhai/rework/V2_EXPERIMENT.md` for the implemented scope and playtest gates.

## Shared Interfaces

- Keep the ten methods, 44 artifact IDs, existing story/events, and four acts plus final.
- `Entity.equipment_role` is `core` or `support` for every artifact.
- Core IDs: RC09, RC10, RC11, RC12, RC14, RC15, RL01-RL05.
- All other artifacts are support. A player can equip one core and three supports.
- `RunState.equipment: { core: string | null; support: string[] }`.
- Inventory remains `state.artifacts`; only equipped inventory stacks enter player loadout
  and node-entry travel snapshots. No unequipped stats or travel benefits.
- `game.equippedArtifacts(): ArtifactStack[]`, `game.canChangeEquipment(): boolean`.
- Commands: `{ type: 'equip', id: string, replace?: string }`,
  `{ type: 'unequip', id: string }`.
- Equipment can change on map, reward, shop, rest and transition, not inside an event,
  battle or encounter preview. Empty compatible slots auto-fill on acquisition.
- Equip/unequip never heals, refreshes a node or resets encounter RNG.
- A first ordinary reward offers three common core candidates if no core is owned.
- Early core acquisition replaces a normal reward opportunity, never adds a node.

## Core Rules

Optional artifact `core_rule` is data, not arbitrary code. Only an equipped core applies.
Existing artifact effects remain and are not repeated by these rules.

| Artifact | kind | Parameters and behavior |
| --- | --- | --- |
| RC09 | basic_echo | ratio: 0.45, rage_damage_ratio: 0.65; one derived basic follow-up, weaker rage base damage |
| RC10 | rage_gambit | rage_refund: 20, incoming_damage_ratio: 1.12; refund on rage completion, greater incoming direct damage |
| RC11 | shield_burst | opening_shield_ratio: 0.12, shield_ratio: 0.5, damage_ratio: 1.4; starting shield, consume actual shield on rage for damage |
| RC12 | healing_guard | heal_ratio: 0.04, shield_ratio: 0.6, direct_damage_ratio: 0.8; basic self-heal, effective healing to shield, weaker direct damage |
| RC14 | poison_detonation | poison_stacks: 1, damage_ratio: 1.1; basic applies poison, rage consumes own poison on enemy and deals damage based on remaining ticks |
| RC15 | burn_siphon | burn_stacks: 1, heal_ratio: 0.25, rage_damage_ratio: 0.8; basic applies burn, actual burn HP damage heals, weaker rage base damage |

Core rules trigger once per appropriate action/round; do not multiply rule parameters
by item stacks. Respect death, shield caps, actual resource consumption and provenance.
Shield self-consumption does not trigger enemy shield-break rewards. Derived attacks
do not recursively generate more primary attacks. Existing legendary outlets remain
their core identity; do not add a second parallel effect system for old and new saves.

## Random Breakthroughs

- `rules.insights`: 12 shared talent records, three per tier, IDs `V2-J1-A` through
  `V2-J4-C`; fields id/tier/branch/name/quick/category/effects match normal talents.
- Shared effects are `always/modify_stat`, `battle_start/shield`,
  `round_end/rage_gain`, and `action_end/heal` or `action_end/shield`.
- They may be selected by any method. Combat/run validators resolve local OR shared
  talents and still allow one selection per tier.
- Each earned choice freezes two sampled local talents and one sampled shared talent.
- `state.talentDrafts: Record<string, string[]>`, key `${method}:${tier}:${generation}`.
  Generation changes only on paid reset, not reload, inspect, or method switching.
- Only offered IDs can be chosen; validate frozen candidates on load.

## Isolation and Routes

- V2 content version: `shanhai-content-0.2`; schema shape version remains 1.
- Save/build keys use `suishi-shanhai-run-v2` / `suishi-shanhai-build-v2`.
- V1 saves must not be overwritten or silently migrated.
- Route topology: after the start, commit within three-node lane segments:
  depths 1-3, 4-6, 7-9, with cross-lane choices only at segment boundaries.
- Preserve reachability of both services individually, bypassable elites, core spacing,
  and three ordinary battles on every complete path. Adjust service lane placement
  to satisfy the new topology rather than relaxing the constraints.
- New core and equipment rules apply to enemy authored loadouts too; enemy equipment
  must use at most one core and three supports.

## Ownership

- Run worker: run.ts, types.ts, persistence.ts, equipment/draft helpers and focused tests.
- Combat worker: combat.ts, core-rule helper if needed, focused combat tests.
- Content worker: content/shanhai/**, tools/content-kit/**, generated content pages.
- Route worker: route-map.ts, route-profiles.ts, focused topology tests.
- UI worker: app.ts, style.css, cartoon.css, localization/ui helpers and UI tests.
- Root: integration, simulation policies, browser/full-run acceptance, release notes.

No workers commit or push. Use apply_patch, retain other workers' changes. Do not spawn
child agents. Do not weaken validation just to make tests pass; explain intentional V1
contract changes in focused regression tests. This is an experimental V2, not a claim
that the V1 win-rate targets have been achieved under the new rules.
