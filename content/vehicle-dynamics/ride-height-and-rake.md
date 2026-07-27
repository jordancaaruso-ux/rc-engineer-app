## Ride height (overall)

**Keys:** `ride_height_front`, `ride_height_rear` — measured chassis-to-ground at defined points, set with the car in race trim.

Ride height sets **CoG height**, and CoG height scales **every load transfer** in the car — lateral (roll), longitudinal (pitch), all of it. **Lower** ride height means **less load transfer** for the same cornering force, which keeps the tire pair on an axle more evenly loaded — **often** more total grip and a more planted platform, but **not always**: the full effect is genuinely complex, because ride height simultaneously moves suspension geometry (below) and interacts with grip level and surface. Treat "lower is faster" as a tendency to **verify**, not a law.

What a ride-height change also does:

- **Suspension geometry.** Ride height changes where the arms and links sit in their travel, which **lowers or raises the roll centres** with the chassis and shifts static **camber** (see **roll-centre**, **arm-angles-camber-gain**). A large ride-height change is never *only* a CoG change — re-check camber and re-read the balance.
- **Bottoming.** The chassis touching the track mid-corner or over bumps unloads tires abruptly — instant, unpredictable grip loss. Minimum usable height is set by track surface, kerbs, and how much the suspension travels (springs, oil, droop — see **spring-rate**, **droop-downstop**).
- **Traction rolling:** going **lower always helps against traction rolling** — the CoG drop directly reduces the roll moment that tips the car. Remember the same move lowers the roll centres too, so the balance can shift while the tipping risk falls.

Small changes matter: ride height works in **tenths of a millimetre**; ~0.2 mm is a typical meaningful step (community aggregation stats are the reference for what the field runs).

## Rake (front vs rear ride height)

**Rake** = the front/rear ride-height difference. It biases both **static attitude** and how the geometry sits at each end:

- **Rear higher than front (nose-down rake)** tends toward **more steering** — the front carries slightly more static load share, the CoG tips forward, and the rear's higher stance shifts its geometry in travel. Commonly reads as more **turn-in and mid-corner front** at the cost of some **rear security**.
- **Front higher than rear** is the mirror: tendency toward **more rear stability / less front bite**.

The direction is fairly reliable; the **magnitude** of feel per 0.5 mm of rake is car- and grip-dependent — hedge and verify on track.

## How to reason about a ride-height question

Separate the three effects before recommending: (1) **CoG / load transfer** (both ends), (2) **geometry shift** at the changed end (camber, roll centre), (3) **rake** (balance). A one-end change is always also a rake change — read it as a balance move, not just a height move.
