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
- `under_lower_arm_shims_*` → **RC UP** (~1.1 mm), **less** camber gain
- `under_hub_shims_*` → **RC UP** (~1.05 mm), **less** camber gain
- Higher ride height → RC up (~0.6 mm per 0.5 mm); a wheel spacer is negligible (~0.04 mm)

**Removing** shims reverses each. The two upper-link ends run **opposite senses** and are **equal in
strength** (~0.5 mm of RC each); the **under-lower-arm and under-hub shims are about twice as
strong** as either upper-link end.

Directions hold for normal double-wishbone geometry; the magnitudes are this chassis
(solver-verified 2026-08-01, 0.5 mm perturbations from the pack baseline).

**Effects (context-dependent — confirm on track).**
- The effects are those of the RC and camber-gain change, working through the concepts — higher RC →
  more bite / response, more "on the track"; lower RC → more hold / "in the track". See [[roll-center]]
  (→ [[bite-hold]], [[on-in-track]]) and [[camber-gain]].
- Per axle: front and rear upper link set front vs rear RC and camber gain independently.
- Depends on: grip, tyres, and the rest of the geometry.
