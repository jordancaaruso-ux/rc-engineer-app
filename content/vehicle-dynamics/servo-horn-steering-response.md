## Servo horn height (steering response)

**Keys:** `servo_horn_height` — the length of the servo horn the steering linkage attaches to.

**Answer it when asked; never offer it** (founder, 2026-08-28). This is not a setup change to
suggest for a handling problem, alone or as an alternative — a driver who asks about the horn or
about how fast the steering answers their hand gets this page; everyone else gets the chassis.

**It effectively changes the speed of the servo: a shorter servo horn is smoother** (founder-confirmed). Mechanism: the horn is the lever between servo rotation and steering-rack movement — a **shorter horn moves the rack less per degree of servo rotation**, so steering inputs arrive slower and finer-grained; a **taller horn** delivers more rack movement per degree — faster, more aggressive steering response.

This is a **driver-interface lever, not suspension kinematics** — it changes how the driver's input reaches the tires, not what the geometry does through travel. Do **not** confuse it with `bump_steer_shims_front` (steering-link angle through suspension travel — see **bump-steer-toe-gain.md**): the servo horn shapes response to the *driver's hand*; bump-steer shims shape steering that happens *without* the driver, as the suspension moves.

Mechanical consequences:

- It changes **input scaling only** — the same chassis, geometry, and grip sit underneath; what moves is how much steering the driver's hand commands per degree of stick. The electronic rate/expo settings scale the same channel; the horn is the mechanical version.
- **Steering throw** (**Keys:** `steer_travel_out`) interacts: horn length changes total rack travel for full servo travel, so end-point settings need re-checking after a horn change.
