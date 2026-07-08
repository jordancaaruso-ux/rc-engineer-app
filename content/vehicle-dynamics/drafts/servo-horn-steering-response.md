> **AI-drafted baseline (unverified).** Written by the coding agent on 2026-07-07 from Jordan's platform-semantics interview. Not yet edited or approved by Jordan — reference theory, not founder ground truth.

## Servo horn height (steering response)

**Keys:** `servo_horn_height` — the length of the servo horn the steering linkage attaches to.

**It effectively changes the speed of the servo: a shorter servo horn is smoother** (founder-confirmed). Mechanism: the horn is the lever between servo rotation and steering-rack movement — a **shorter horn moves the rack less per degree of servo rotation**, so steering inputs arrive slower and finer-grained; a **taller horn** delivers more rack movement per degree — faster, more aggressive steering response.

This is a **driver-interface lever, not suspension kinematics** — it changes how the driver's input reaches the tires, not what the geometry does through travel. Do **not** confuse it with `bump_steer_shims_front` (steering-link angle through suspension travel — see **bump-steer-toe-gain.md**): the servo horn shapes response to the *driver's hand*; bump-steer shims shape steering that happens *without* the driver, as the suspension moves.

Practical reading:

- Car feels **darty / oversensitive around centre**, driver over-correcting → a **shorter horn** calms the whole steering channel without touching chassis balance. Pairs naturally with electronic settings (rates/expo) — the horn is the mechanical version.
- Car feels **slow to respond** despite good grip balance → a taller horn adds immediacy.
- **Steering throw** (**Keys:** `steer_travel_out`) interacts: changing horn length changes total rack travel for full servo travel, so end-point settings usually need re-checking after a horn change.
- Because it reshapes how *every* input lands, change it **on its own**, not bundled with chassis changes — otherwise it contaminates the read on the chassis move.
