# Gameplay V4 — readable combat logs and build resonance

This revision keeps the V3 deterministic auto-battle/event architecture and deepens two areas.

## Combat log modes

- Simple log is the default. It renders only damage and status changes.
- Player and enemy rows have separate visual identity and badges.
- Detailed log is opt-in from Settings and is stored in browser preferences, not the run save.
- Detailed mode retains action frames, hit/miss information, HP/shield/rage deltas and the complete damage pipeline, now including the build-modifier stage.
- Log mode never changes simulation, RNG, replay or settlement.

## Build depth

`buildProfile()` is derived from the eight equipped slots and is not persisted.

Four two-tier resonances are supported:

1. Rage/Burst — start rage, then rage-skill refund.
2. Fire/Burn — stronger burn ticks, then extra burn application.
3. Shield/Counter — opening shield, then bonus damage while shielded.
4. Break/Sword — extra break stacks, then bonus damage against broken targets.

The Strategy slot is now a keystone. Sharing its tags with 3/5 other equipped abilities activates Strategy Alignment for +10%/+18% outgoing damage.

Reward and shop ability rolls are weighted by the current board's existing tags as well as origin affinity, so a run increasingly expresses the build the player has actually assembled.

Because these rules change deterministic combat results, content/rules version is 2.1.0.
