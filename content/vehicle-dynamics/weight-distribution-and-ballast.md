## Static weight distribution (front %)
**Keys:** `weight_balance_front_percent`, `total_weight`
**Concepts:** [[load-transfer]], [[tyre-load-sensitivity]], [[polar-moment]]

**Physics.** Sets the **front/rear share** of the car's weight — the static load each axle carries before
transfer ([[load-transfer]]). Grip rises **less than proportionally** with load ([[tyre-load-sensitivity]]),
so moving the split changes how well each end converts its load; shifting mass fore/aft also moves the
[[polar-moment]].

## Ballast placement
**Keys:** `motor_lateral_shift`
**Concepts:** [[load-transfer]], [[polar-moment]]

**Physics.** Rules set a minimum weight; ballast is where you place the rest. **Height** sets **CoG**,
scaling the **total** load transfer ([[load-transfer]]); **distance from centre** (fore/aft or lateral)
sets the [[polar-moment]]; **left/right** trims lateral balance. Moving a battery or motor shifts several
at once — re-scale after.
