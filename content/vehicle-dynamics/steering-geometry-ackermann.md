## Ackermann (steering-link position)
**Keys:** `inner_steering_angle`
**Concepts:** [[toe-and-scrub]], [[bite-hold]]

**Physics.** In a corner the **inside** front runs a **tighter** radius, so it needs **more** steering
angle. Ackermann sets how inner vs outer angles develop as you steer: **more ackermann** points each
front closer to its own arc; **less** (toward parallel) makes them take up more similar angles, loading
the pair harder — [[toe-and-scrub]] across steering, not travel.

## Steering throw
**Keys:** `steer_travel_out`
**Concepts:** [[bite-hold]]

**Physics.** Caps the **maximum** steering angle — more throw = tighter minimum radius but coarser
proportional control. It doesn't change the ackermann relationship, only how much of it you can reach.
