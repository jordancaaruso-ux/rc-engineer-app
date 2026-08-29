## Ackermann (steering-link position)
**Keys:** `inner_steering_angle`
**Concepts:** [[loaded-wheel]], [[toe-and-scrub]], [[steering-response]], [[bite-hold]]

**Physics.** In a corner the **inside** front runs a **tighter** radius, so rolling without scrub asks
it to take **more** steering angle. Ackermann sets how inner vs outer angles develop as you steer:
**more ackermann** points each front closer to its own arc; **less** (toward parallel) makes them take
up more similar angles, loading the pair harder — [[toe-and-scrub]] across steering, not travel.

That is a **kinematic** setting — it decides which angles avoid scrub. Side force is a separate
question: the **outer** front makes most of it ([[loaded-wheel]]), and ackermann moves the **inner**
wheel's angle relative to it. The angle difference the arc asks for scales with roughly **1/radius²**
— on a 1/10 touring car (190 mm track, 257 mm wheelbase) about **1.2°** on a 1.5 m hairpin against
**0.04°** on an 8 m sweeper, so the setting has far more to act on in tight corners than fast ones.

## Steering throw
**Keys:** `steer_travel_out`
**Concepts:** [[bite-hold]]

**Physics.** Caps the **maximum** steering angle — more throw = tighter minimum radius but coarser
proportional control. It doesn't change the ackermann relationship, only how much of it you can reach.
