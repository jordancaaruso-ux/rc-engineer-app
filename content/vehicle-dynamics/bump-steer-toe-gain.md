## Bump steer (front)
**Keys:** `bump_steer_shims_front`
**Concepts:** [[toe-and-scrub]], [[steering-response]], [[bite-hold]]

**Physics.** Sets how **front toe changes through travel** — the toe-link angle decides whether a wheel
gains toe-in or toe-out as it compresses (and the reverse on extension); shims change that angle. It's
[[toe-and-scrub]] made dynamic: the loaded (compressed) front runs a different toe than its static
value. Shim count isn't a fixed number — measure toe at ride height vs full compression.

**Sign (this sheet — Awesomatix):** **more** `bump_steer_shims_front` = more bump-in (front toes in
as it compresses); fewer = more bump-out (founder-confirmed 2026-07-30). Note this is the
**opposite sense to the rear toe-gain shims** below, and platform-specific — other cars can run
the opposite.

## Toe gain (rear)
**Keys:** `toe_gain_shims_rear`
**Concepts:** [[toe-and-scrub]]

**Physics.** The rear version of the same mechanism: the toe-link angle sets how **rear toe changes
through travel**, so the loaded (compressed) outer rear runs a different toe than static. Shims set the
curve, not the static toe. What separates gained toe from static rear toe is **when it exists**: static
toe is always there; gained toe-in appears only as the wheel compresses — under roll, and as the rear
squats on power — so it arrives exactly when the outer rear is loaded ([[toe-and-scrub]] made dynamic).

**Sign (this sheet — Awesomatix):** **fewer** `toe_gain_shims_rear` = **more** toe gain (more toe-in
gained in compression); more shims = less (founder-confirmed 2026-07-30). Platform-specific — other
cars can run the opposite sign, so never carry this direction to a different chassis.
