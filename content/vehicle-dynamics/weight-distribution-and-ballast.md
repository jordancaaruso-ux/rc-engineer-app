## Static weight distribution (front %)

**Keys:** `weight_balance_front_percent`, `total_weight` — front axle share of total weight, measured on scales in race trim.

**Founder-verified direction:** **more weight forward generally means less steering.** The heavier front reduces the car's **pendulum effect** — its willingness to swing into rotation — and the front tires carry more load than they can convert to extra grip (tire **load sensitivity**: grip rises **sub-linearly** with load, so overloading an end costs relative performance there). The naive textbook read ("more front load = more front grip = more steering") gets the on-track outcome **backwards** on a touring car.

- **More front %** → **less steering**, a lazier, more stable car into and through corners.
- **More rear %** → the car rotates more willingly; rear traction picks up its static share, but the balance moves toward a pointier front.

Weight placement is a foundational balance setting rather than a per-run trim — it interacts with everything above it (springs, geometry, tires).

## Ballast placement and polar moment (theory — not yet founder-verified)

Class rules set a **minimum total weight**; ballast is where you place the difference.

- **Low** placement lowers CoG → less load transfer everywhere → more usable grip. No real trade — always preferred.
- **Central** placement (near the CoG) minimizes **yaw inertia / polar moment** → the car starts and stops rotating more eagerly — quicker direction changes, livelier in chicanes, but less "flywheel" steadiness mid-corner.
- **Distributed toward the ends** raises polar moment → **slower, steadier yaw** — resists rotation; can read as stability in fast corners and laziness in tight ones.

Treat the agile-vs-steady preference as a judgment call; direction plausible, magnitude untested here.

## Left/right and lateral offsets (theory — not yet founder-verified)

**Keys:** `motor_lateral_shift` — moving the heaviest components laterally trims **left/right balance**. On circuits with both corner directions, symmetric left/right weight is the standard goal so the car behaves the same both ways; a car consistently stronger in one corner direction is a hint to check lateral balance before reaching for chassis tuning. Battery/motor moves shift **both** lateral balance and front/rear split at once — re-scale after moving components.
