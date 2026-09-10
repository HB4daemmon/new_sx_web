# Gameplay V11 — Event & Causality Pass

V11 freezes the current Build model and moves development focus to events.

## Problems addressed

- Future event identities were selected at run creation, so they could not react to choices made later.
- Hidden nodes reused the ordinary event pool.
- Three base event templates were repeated across all four acts and often behaved like stat vending machines.
- Major decisions wrote facts, but later scenes rarely forced the player to confront those facts.
- Locked choices exposed only a generic “condition unmet” message.

## V11 rules

1. Ordinary/hidden event identity is resolved lazily when the node is entered, using an event-specific deterministic RNG stream.
2. Hidden events use a separate `hiddenOnly` pool. Each act has one authored hidden trial.
3. Events carry category, relevance, risk tone and delayed-consequence metadata. Relevant callbacks receive higher selection weight without breaking determinism.
4. Acts II–IV major nodes begin with a mandatory previous-act echo phase. The player may accept the tailored consequence or deliberately sever the echo before making the new major choice.
5. Shen Gongbao now forms a cross-act debt thread with deepen/watch/scheme/expose/burn/settlement states.
6. Echo events respond to every branch of the previous major decision, not one preferred branch.
7. Choice UI exposes risk type, explicit lock reason, public check probability, success/failure stakes and declared delayed consequence.
8. Story log records event ID, choice ID, category and declared consequence for audit/replay.

The event count remains 24; V11 improves identity and causality rather than inflating the pool.
