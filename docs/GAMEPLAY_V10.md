# Gameplay V10 — Destiny Pivots

V10 makes fate and major mythic rewards part of the same build language as the eight-slot board.

## Fate as a route signal

Every fate now declares `resonanceBias` in JSON. A fate contributes one virtual resonance count to exactly one of the four existing schools. It does not consume a slot, but it can make a two-piece route come online sooner and therefore changes reward-role classification from the beginning of a run.

The eight fates also gain small typed combat hooks so they are no longer passive stat cards only.

## Mythic pivots

- 乾坤圈: rage -> break momentum; hits and rage casts recycle rage while rage casts add break.
- 番天印: guard -> break/control; opens with defense-scaled shield and rage casts apply stun + break.
- 定海神珠: burn -> guard; round-end and rage-cast effects generate shield while adding burn.

All three are authored as `keystone` mechanic-role pieces.

## Major-choice readability

Major event choices preview mythic rewards before commitment, and the fate panel shows the current destiny route.

Content/rules version: 2.7.0.
