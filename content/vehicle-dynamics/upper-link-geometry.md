## Upper-link geometry (inner + outer shims)
**Keys:** `upper_inner_shims_ff`, `upper_inner_shims_fr`, `upper_inner_shims_rf`, `upper_inner_shims_rr`, `upper_outer_shims_front`, `upper_outer_shims_rear`
**Concepts:** [[roll-center]], [[camber-gain]]

**Physics.** The upper link's angle relative to the lower arm (viewed from the front of the car) sets
roll centre and camber gain on that corner. The signs below are stated per key — read them there, not
from the angle.

Moving **both ends the same amount** (parallel) barely changes the angle: RC hardly moves, leaving a
near-pure **camber-gain** change. Don't confuse the **upper inner** (tower side of the *upper* link)
with the **inner lower arm** — different pickup, different key.

## Roll-centre direction per key (solver-checked, Awesomatix A800)

Read the sign here. Do not derive it from whether the link looks "flatter" or "more angled" — that
framing requires already knowing which end of the link sits higher, and it is exactly where the
direction gets inverted.

**Adding** shims (per 0.5 mm; front and rear behave the same):
- `upper_inner_shims_*` → **RC DOWN** (~0.5 mm), **less** camber gain
- `upper_outer_shims_*` → **RC UP** (~0.5 mm), **more** camber gain
- `under_lower_arm_shims_*` → **RC UP** (~1.1 mm), **more** camber gain
- `under_hub_shims_*` → **RC UP** (~1.05 mm), **more** camber gain
- Higher ride height → RC up (~0.6 mm per 0.5 mm) but **less** camber gain — the one move that
  splits the two; a wheel spacer is negligible (~0.04 mm)

Moving a pickup point moves RC and camber gain the same way, every time — so any shim change is also
a camber change and the static angle has to be re-checked against it. Ride height is the exception:
it moves RC without taking camber gain with it.

**Removing** shims reverses each. The two upper-link ends run **opposite senses** and are **equal in
strength** (~0.5 mm of RC each); the **under-lower-arm and under-hub shims move the roll centre
about twice as far** as either upper-link end. The upper links' near-1:1 is **this chassis's
coincidence, not a rule** (founder, 2026-09-01) — the shim-to-RC ratio changes car to car, and on
the other keys it is nowhere near 1:1 even here. So a move is **sized in shim millimetres and never
quoted as a roll-centre distance**: say what shim to change and which way the roll centre goes,
never how far it goes.

**What each key leans toward, relative to the others.** All four move camber gain by a similar
amount — −0.015 to −0.019° per mm of bump for a 0.5 mm shim (solver-verified 2026-08-27) — while
the roll-centre change differs by two to one. So measured against its own roll-centre change, an
upper-link shim carries relatively more camber-gain change than a lower-arm or hub shim does; and
measured against each other, the under-lower-arm and under-hub shims lean toward a roll-centre
change, the upper-link ends toward a camber-gain change. Every key moves both; the lean is relative,
not a split.

**Why an upper-link move is felt as more of a bite change** (founder-confirmed 2026-09-02). For the
same roll-centre move, an upper-link shim carries about twice the camber-gain change of a lower-arm
or hub shim (the numbers above). Camber gain is what holds the loaded tyre's camber nearer its best
as load arrives ([[camber-gain]] → [[camber-grip]]), so the grip that move makes arrives **sooner
and sharper** — on the first input and as the car leans — without there being **more** of it. That
is bite, not grip ([[bite-hold]]): the upper links change bite more than the other keys do, per
roll-centre millimetre, and the overall front-grip *feel* moves with them for the same reason.

Directions hold for normal double-wishbone geometry; the magnitudes are this chassis
(solver-verified 2026-08-01, 0.5 mm perturbations from the pack baseline).

**Effects (context-dependent — confirm on track).**
- The effects are those of the RC and camber-gain change, working through the concepts — higher RC →
  more bite / response, more "on the track"; lower RC → more hold / "in the track". See [[roll-center]]
  (→ [[bite-hold]], [[on-in-track]]) and [[camber-gain]].
- Per axle: front and rear upper link set front vs rear RC and camber gain independently.
- Depends on: grip, tyres, and the rest of the geometry.
