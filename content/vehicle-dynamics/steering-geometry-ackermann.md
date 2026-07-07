## Ackermann (steering-link position on the rack)

**Keys:** `inner_steering_angle` — on a setup sheet this is normally thought of as the **ackermann position**: where the **inner points of the steering links mount to the steering rack**. Moving the mounting position changes how the inner vs outer wheel angles develop as steering is applied.

**Mechanism.** In a corner the inside front tire runs a **tighter radius** than the outside one. **More ackermann** points each front tire closer to its own natural arc — the pair works less aggressively against the road. **Less ackermann (toward parallel)** makes the fronts work at more similar angles, loading the pair harder as steering is applied.

## Handling tendencies (founder-verified direction)

- **More ackermann** → **less steering overall** — less aggressive response, generally an **easier car to drive**. A calmer front end through the whole steering range.
- **Less ackermann** → **more steering** — a more aggressive front end.
- **Layout practice:** **reduce ackermann for tight layouts** — the extra steering authority is worth having where the car must rotate hard in slow corners; run more ackermann where the layout rewards an easy, stable front end.

Treat magnitude as car- and grip-dependent; the direction above is how it reads on a touring car in practice.

## Interactions

- **Front toe** (see **camber-caster-toe**) shifts the steering picture around centre; ackermann shapes how it develops **with steering angle**. Read them together: a static-toe change and an ackermann change can produce similar early-corner impressions but different mid-corner behaviour.
- The **spool front end** (see `diff-and-driveline.md`) locks both front wheels to the same speed, so front-tire path mismatch is always present — part of why ackermann position is a meaningful tuning lever on a touring car.
- **Steering throw / travel** (**Keys:** `steer_travel_out`) caps maximum steering angle: more throw = tighter minimum radius but coarser proportional control; it does not change the ackermann relationship itself, only how much of it gets used.
