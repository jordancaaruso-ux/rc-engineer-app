## The grip curve — where the car is on it, and what moves it
**Concepts:** [[bite-hold]], [[corner-regime]], [[load-transfer]], [[roll-center]], [[roll-stiffness]], [[damping]], [[tyre-load-sensitivity]]

*(Founder framework, 2026-08-28. This is the one picture the rest of the knowledge base hangs on;
it is described here once, and every other file only says how its lever moves the car on it.)*

**The curve.** Across the bottom is **how hard the tyre is being asked** — the load on it and the
slip it is running. Up the side is **grip**. The line rises as the tyre is asked more, reaches a
**peak**, and falls away past it. Every tyre on every day has this shape; what differs is how tall
the peak is, how sharp, and how far along the axis it sits.

**The car's point travels along it through the corner.** At turn-in the point is at the left —
little load has reached the outside tyres yet. As load arrives it climbs the curve. Where it is at
any moment in the corner is set by two things:

- **How fast it climbs** — the speed at which load reaches the tyre ([[load-transfer]]). The
  timing levers set this: roll-centre height ([[roll-center]]), spring and bar stiffness
  ([[roll-stiffness]]), chassis flex ([[chassis-flex]]), and damping ([[damping]]) — with the
  difference that damping changes the speed of the climb without changing where it ends.
- **How long it has** — the corner's clock ([[corner-regime]]). A slow, long corner gives the
  point time to reach the peak and sit there; a quick corner or a direction change ends before it
  has climbed far, so in a fast car more of the lap is spent on the way up than at the top.

**Grip level scales the curve** (founder, 2026-08-28). On a high-grip day the peak is taller and
sharper and is reached sooner along the axis; on a low-grip day it is lower and broader and further
out. So the same climb rate that reaches the peak and holds there on one day overshoots it on a
higher-grip day and never reaches it on a lower-grip one, with nothing on the car changed. This is
the window in [[bite-hold]] moving with grip, drawn as geometry.

**The two ways it goes wrong.**
- **The point never reaches the peak** — the climb was too slow for the corner, or the corner too
  short for the climb. The driver reads this as grip that is never there, numb, imprecise; in a
  quick corner it is the whole corner. The lever is a faster climb: load sooner.
- **The point overshoots the peak** — the climb was too fast for today's curve. The driver reads
  this as grip that arrives and then goes: the car bites, then lets go, with little warning the
  sharper the peak. The lever is a slower climb: load later.

Between them is the window: the point reaches the peak and stays near it for the part of the corner
that matters. **Bite** and **hold** are the two ends of that window — a climb that reaches the peak
sooner and sharper, or later and broader ([[bite-hold]]).

**Two points, not one.** Front and rear each have their own point on their own curve, and the
balance is the difference between them: the end whose point is nearer its peak has the grip. A
change at one end moves that end's point; the same change at both ends moves both together and
leaves the difference where it was ([[corner-regime]]).

**What this page does not do.** It places the car; it does not compute anything. "Left of the peak",
"at it", "past it" are the only positions, and which one the car is in comes from what the driver
says and what the run shows, not from the setting. A tyre that is not in its working range sits low
on a low curve whatever the chassis does, which is why the tyre and the track are checked before the
car is blamed.
