## Gear diff oil (rear)

**Keys:** `diff_oil` — silicone oil viscosity (cSt) in the rear gear differential on a typical touring car layout.

A differential lets the inner and outer tires turn at different speeds through a corner. The oil's viscosity sets how strongly the diff **couples** the two wheels when a speed difference tries to develop:

- **Thicker diff oil** = more coupling. It **can** give **more forward traction** on exit (both tires driven harder together), and in **certain conditions** more on-power stability — but **normally it adds on-throttle oversteer**: on power in a corner the coupled axle forces the inner and outer tires toward the same speed, over-driving the loaded rear pair against the arc the corner demands, and the rear steps out under throttle.
- **Thinner diff oil** = freer. The rear axle absorbs the corner's speed difference instead of fighting it — typically a **calmer, more manageable rear on throttle** — at the cost of less coupled forward drive.

**Grip relationship (founder-corrected):** when **grip is low**, run **thinner** — the tires cannot support the coupled axle's aggression and thick oil breaks the rear loose on throttle. As **grip comes up**, the tires can carry more coupling and you can run **thicker** for the forward-drive benefit. Where the crossover sits depends on tire, surface, and layout — judge from conditions and **test**.

## Front driveline: spool

Touring cars run a **spool (solid axle)** at the front — standard practice, effectively always.

Because the spool locks both front wheels to the same speed while steering demands a speed difference, **steering geometry choices (ackermann, toe) interact strongly with the spool** — see `steering-geometry-ackermann.md`. General theory attributes tight-corner on-power push to the spool fighting the front speed difference; treat that as unverified theory — with no alternative front option in class racing it is background, not a tuning lever.

## Final drive ratio (context only)

**Keys:** `final_drive_ratio`, `pinion`, `spur` — gearing sets where the motor operates, not how the chassis handles. Shorter gearing sharpens throttle response and acceleration out of slow corners; taller gearing smooths delivery and top end. Treat gearing questions as **powertrain**, not chassis balance — but remember a much sharper throttle can *expose* a marginal rear on exit that the setup previously masked, and with thick diff oil it feeds the on-throttle-oversteer tendency sooner.
