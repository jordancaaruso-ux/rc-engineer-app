> **AI-drafted baseline (unverified).** Researched and written by the coding agent from general vehicle-dynamics knowledge on 2026-07-08, with one direction confirmed in a founder interview (noted inline). Not yet edited or approved by Jordan — reference theory, not founder ground truth.

This file covers the **linkage geometry between the wheel and the damper** — where the shock mounts, how far it leans, its length, and end-of-travel limiters. Different lever from the **spring** (its stiffness — **spring-rate.md**) and the **damper oil** (its fluid — **damper-oil.md**): the same spring and oil feel different at the wheel depending on this geometry. Platforms with a lever/pushrod damper (e.g. Awesomatix) reach these effects through **spring gap** and **damper percent** instead of physical shock position (`drafts/awesomatix-spring-gap-damper.md`); the physics below is the conventional-shock case.

Each section splits **Physics** (what the change does mechanically — stated with confidence) from **Handling** (what it *can* do to the car — situational, test to confirm).

## Motion ratio — mounting position and angle

**Keys:** `shock_angle_front`, `shock_angle_rear`, `shock_mount_arm_front`, `shock_mount_arm_rear`, `shock_position_front`, `shock_position_rear` — sheet labels vary (hole numbers on tower and arm); read the column.

**Physics.** The **motion ratio** is how far the shock compresses per unit of wheel travel. **Laying the shock down** (more angle off vertical) or moving its **lower mount inboard** on the arm *lowers* the motion ratio — the wheel moves more than the shock. Three consequences follow mechanically: the same spring gives a **softer effective wheel rate** (rate falls with the square of the motion ratio); the same oil gives **less damping at the wheel**; and because the shock's angle changes through travel, the effective rate **rises through compression** — a **progressive / rising-rate** curve. **Standing the shock up** or moving the mount **outboard** raises the motion ratio toward 1:1 → **firmer, more linear, more damping**. *(Direction founder-confirmed: laid down = softer + progressive; stood up = firmer + linear. Magnitudes are general theory.)*

**Handling.** An end's roll stiffness scales with its wheel rate, so a softer position at one end **reduces roll resistance there** and shifts the roll-couple balance toward the other end (same balance logic as **spring-rate.md** / **arb.md**; distinct from [[roll-center]], which moves the roll axis, not the leverage). Whether a softer position reads as **more mechanical grip** or as **too much roll / not enough support** depends on grip level, tyre, and what is limiting the car — *general theory, not founder-verified; treat as a test, state what to feel for.*

## Bump stops, packing, and internal limiters

**Keys:** `bump_stop_front`, `bump_stop_rear`, `shock_limiter_front`, `shock_limiter_rear` — spacers, foam, o-rings, or shims that halt or ramp compression near the **end of the stroke**.

**Physics.** Unlike the spring, a bump stop does nothing until the suspension is deep in compression, then adds a **steep rate rise** at the end of travel. It is the **progressive** relative of the **upstop** hard cap (`drafts/upstop-compression-travel.md`): both govern the compressed end, the bump stop as a ramp, the upstop as a wall. It raises effective rate only in the last of the stroke, leaving the static and early-travel rate set by the spring.

**Handling.** Documented uses: **anti-bottoming**, holding chassis attitude and ride height under peak load (high grip, kerbs, and — off-road — jump landings), and protecting the **aero platform** from squatting into the track. *General theory (founder has not tuned this by feel): end-of-travel effects are complex and grip-dependent — the same packing reads differently depending on how much travel the car uses. Advise as a test, not a prediction.*

## Shock length and travel window

**Keys:** `shock_length_front`, `shock_length_rear` — length plus internal limiters set the **available travel window** (extension = droop, compression = up-travel).

**Physics.** Shock length and internal limiters bound how far the wheel can extend and compress. Setting **droop via the shock** is the **same mechanism** as the droop/downstop in **droop-downstop.md**; up-travel limiting overlaps with **bump stops** and **upstop** above. The shock hardware is simply *one way* to set that window.

**Handling.** Anchor length/droop questions to **droop-downstop.md** for the handling direction (more extension = tyre stays loaded over bumps and in roll vs a flatter, faster-transferring platform) — this file does not restate it.
