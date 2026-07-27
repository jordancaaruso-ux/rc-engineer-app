## Camber gain (camber in roll)
**Physics.** Camber gain is how much **negative camber the wheel gains as the suspension compresses in
roll**. As the car leans in a corner the linkage tips the outside wheel to keep its contact patch
flatter to the road instead of rolling onto its outer edge. It's set by the **link and roll-centre
package on that end** — static camber (`camber_front` / `camber_rear`) only sets the starting angle,
not how much is gained.
- **Flatter** upper link → **less** camber gain.
- **More angled** upper link → **more** camber gain.
- **Higher** RC from inner-lower / under-hub shims → **more** gain (combined with the upper-link state).

**More gain is generally desirable:** it adds negative camber only *while cornering*, so the loaded
wheel carries a more useful camber when it matters — without the straight-line and braking penalty of
running that angle statically.

**Works with:** static camber [[camber]] — that sets the start angle, gain is the dynamic part.
**Moved by:** upper-link geometry (inner + outer shims), inner-lower-arm & under-hub shims [[roll-center]].
