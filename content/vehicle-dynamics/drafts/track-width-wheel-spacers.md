> **AI-drafted baseline (unverified).** Researched and written by the coding agent from general vehicle-dynamics knowledge on 2026-07-07. Not yet edited or approved by Jordan — reference theory, not founder ground truth.
> **Claim-checked by Jordan 2026-07-07:** all claims marked unsure — he has not tested track-width changes on track. Treat everything below as **experimental theory**: when advising, promote it as a test to run, never as an expected outcome.

## Track width (wheel spacers / offset)

**Keys:** `wheel_spacer_front`, `wheel_spacer_rear` — spacers (or wheel offset) push the wheels outboard, widening the track at that end. Class rules cap overall width; the tuning space is usually the **front/rear split** within the legal maximum.

**Mechanism.** For a given CoG height, an axle's **lateral load transfer is inversely proportional to its track width**.

## What the mechanism pushes

Widening an end lowers that end's share of lateral load transfer, so its tyre pair carries load more
evenly — and a pair sharing load makes more total grip than a pair with one tyre overloaded
([[tyre-load-sensitivity]]). Narrowing does the mirror. That is the whole push, and it is the same
family of lever as the roll-stiffness split ([[roll-stiffness]]), reached through geometry instead of
stiffness.

What that **nets out to** on the car is not stored here and should not be predicted: track width also
moves scrub radius, camber at the contact patch, and the total roll moment, and the founder has not
tested it on track. Magnitude per millimetre is small. Frame any track-width change as a test with
something specific to feel for — never as an expected outcome.

## Secondary effects worth naming

- **Front spacers change scrub radius.** Pushing the front wheels out moves the contact patch further from the steering axis, which increases steering torque, kickback over bumps, and how much the car self-steers on one-wheel bumps or under braking. A front-width change can alter steering *feel* noticeably even when grip barely changes.
- **Overall (both ends) wider** lowers body-roll sensitivity slightly and resists **traction rolling** on very high grip; overall narrower does the opposite.
- Changing width moves the wheel relative to the arc the suspension describes, so **camber** at the contact patch shifts slightly — re-check camber after a width change (see **camber**).
