This file covers the **linkage geometry between the wheel and the damper** — where the shock mounts, how far it leans, its length, and end-of-travel limiters. Different lever from the **spring** (its stiffness — **spring-rate.md**) and the **damper oil** (its fluid — **damper-oil.md**): the same spring and oil feel different at the wheel depending on this geometry. Platforms with a lever/pushrod damper (e.g. Awesomatix) reach these effects through **spring gap** and **damper percent** instead of physical shock position (**awesomatix-spring-gap-damper.md**); the physics below is the conventional-shock case.

Each section splits **Physics** (what the change does mechanically — stated with confidence) from **Handling** (what it *can* do to the car — situational, test to confirm).

## Motion ratio — mounting position and angle

**Keys:** `shock_angle_front`, `shock_angle_rear`, `shock_mount_arm_front`, `shock_mount_arm_rear`, `shock_position_front`, `shock_position_rear` — sheet labels vary (hole numbers on tower and arm); read the column.

**Physics.** The **motion ratio** is how far the shock compresses per unit of wheel travel. Two independent strands set it:

- **Lever — where the lower mount sits on the arm.** The mount moves with the arm, so shock travel scales with the mount's distance from the arm's **inner pivot**: further **outboard** (nearer the wheel) = more shock movement per unit wheel travel = higher motion ratio; further **inboard** = lower.
- **Angle — how far the shock leans.** Only the component of mount movement along the shock's axis compresses it, so the more the shock **leans** away from the mount's direction of travel, the lower the motion ratio — and because that angle changes through travel, a laid-down shock's effective rate **rises through compression**: a **progressive / rising-rate** curve. *(Direction founder-confirmed: laid down = softer + progressive; stood up = firmer + linear.)*

Effective wheel rate scales with the **square** of the motion ratio, and damping at the wheel falls with it the same way.

**A single mount move usually changes both strands at once, in opposite directions** — moving the lower mount inboard shortens the lever (softer) *and*, under a fixed tower top, typically stands the shock more upright (stiffer). Which strand wins is geometry-specific: compose them for the actual mounting points rather than quoting one net direction.

**Handling.** An end's roll stiffness scales with its wheel rate, so a softer position at one end **reduces roll resistance there** and shifts the roll-couple balance toward the other end (same balance logic as **spring-rate.md** / **arb.md**; distinct from [[roll-center]], which moves the roll axis, not the leverage). What a softer position nets out to on the car is not stored here — the stiffness strands pull opposite ways per [[corner-regime]].

## Bump stops, packing, and internal limiters

**Keys:** `bump_stop_front`, `bump_stop_rear`, `shock_limiter_front`, `shock_limiter_rear` — spacers, foam, o-rings, or shims that halt or ramp compression near the **end of the stroke**.

**Physics.** Unlike the spring, a bump stop does nothing until the suspension is deep in compression, then adds a **steep rate rise** at the end of travel. It is the **progressive** relative of the **upstop** hard cap (`drafts/upstop-compression-travel.md`): both govern the compressed end, the bump stop as a ramp, the upstop as a wall. It raises effective rate only in the last of the stroke, leaving the static and early-travel rate set by the spring.

**Handling.** Documented uses: **anti-bottoming**, holding chassis attitude and ride height under peak load (high grip, kerbs, and — off-road — jump landings), and protecting the **aero platform** from squatting into the track. End-of-travel effects only exist when the car actually uses that part of the stroke — the same packing does nothing on a car that never reaches it, which is grip- and track-dependent (founder has not tuned this by feel).

## Shock length and travel window

**Keys:** `shock_length_front`, `shock_length_rear` — length plus internal limiters set the **available travel window** (extension = droop, compression = up-travel).

**Physics.** Shock length and internal limiters bound how far the wheel can extend and compress. Setting **droop via the shock** is the **same mechanism** as the droop/downstop in **droop-downstop.md**; up-travel limiting overlaps with **bump stops** and **upstop** above. The shock hardware is simply *one way* to set that window.

**Handling.** Anchor length/droop questions to **droop-downstop.md** for the handling direction (more extension = tyre stays loaded over bumps and in roll vs a flatter, faster-transferring platform) — this file does not restate it.
