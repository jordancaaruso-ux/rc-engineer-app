> **AI-drafted baseline (unverified).** Researched and written by the coding agent from general vehicle-dynamics knowledge on 2026-07-07. Not yet edited or approved by Jordan — reference theory, not founder ground truth.
> **Claim-checked by Jordan 2026-07-07:** all claims marked unsure — he has not tested track-width changes on track. Treat everything below as **experimental theory**: when advising, promote it as a test to run, never as an expected outcome.

## Track width (wheel spacers / offset)

**Keys:** `wheel_spacer_front`, `wheel_spacer_rear` — spacers (or wheel offset) push the wheels outboard, widening the track at that end. Class rules cap overall width; the tuning space is usually the **front/rear split** within the legal maximum.

**Mechanism.** For a given CoG height, an axle's **lateral load transfer is inversely proportional to its track width**. Widening one end reduces how much load shifts from inner to outer tire at that end in a corner — the tire pair stays more evenly loaded, and since tires give more total grip when evenly loaded, the widened end gains **cornering grip**. Front/rear track split is therefore a **balance lever**, the same family as roll-stiffness split (springs/ARBs — see **spring-rate**, **arb**) but achieved through geometry instead of stiffness.

## Handling tendencies

- **Wider front** → **more front grip** through the corner: stronger mid-corner steering, more confidence holding a line. Often slightly **calmer initial response**, because the same steering input now has to move a wider footprint.
- **Wider rear** → **more rear grip / stability**, particularly mid-corner to exit; the car gives up some rotation.
- **Narrower** at an end is the mirror: that end gives up grip, gains a touch of reactiveness.

Direction is reliable; magnitude per millimetre is small — spacers are a **trim** lever, useful when springs/ARBs are already where you want them and the balance needs a nudge without changing platform stiffness.

## Secondary effects worth naming

- **Front spacers change scrub radius.** Pushing the front wheels out moves the contact patch further from the steering axis, which increases steering torque, kickback over bumps, and how much the car self-steers on one-wheel bumps or under braking. A front-width change can alter steering *feel* noticeably even when grip barely changes.
- **Overall (both ends) wider** lowers body-roll sensitivity slightly and resists **traction rolling** on very high grip; overall narrower does the opposite.
- Changing width moves the wheel relative to the arc the suspension describes, so **camber** at the contact patch shifts slightly — re-check camber after a width change (see **camber**).
