## Camber gain (camber in roll)
**Physics.** Camber gain is how much **negative camber a wheel gains as its suspension compresses**.
As the car leans, the linkage adds negative camber to the compressing wheel, working against the lean
— how much is pure geometry. Static camber (`camber_front` / `camber_rear`) sets only the starting
angle, not the gain.

**Roll is what calls on it.** How far each wheel swings from static scales with how much the car
**rolls** ([[roll-stiffness]]); gain decides how much of that swing comes back. On a touring-car
double wishbone only a small part comes back, so both wheels end up well off static — the loaded one
**loses** negative camber and can pass vertical onto its outer shoulder, the unloaded one gains it, both further from their best ([[camber-grip]]).
Front and rear alike: it follows roll angle, not which end you're on.

**Works with:** static camber [[camber]] — that sets the start angle, gain is the dynamic part.
**Affected by:** [[roll-stiffness]] — roll angle sets how far the camber swings.
**Moved by:** upper-link geometry (inner + outer shims), inner-lower-arm & under-hub shims.
