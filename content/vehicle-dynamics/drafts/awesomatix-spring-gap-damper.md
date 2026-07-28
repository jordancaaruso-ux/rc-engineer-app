> **AI-drafted baseline (unverified).** Written by the coding agent on 2026-07-07 from Jordan's platform-semantics interview + general damper physics. Not yet edited or approved by Jordan — reference theory, not founder ground truth.

## Spring gap (Awesomatix effective rate)

**Keys:** `spring_gap_front`, `spring_gap_rear` — Awesomatix-specific stiffness control. **Bigger gap = stiffer** (founder-confirmed). It is an **effective spring-rate adjustment**, not a preload or free-play setting.

Because spring gap is a rate control, **all spring-rate reasoning applies**: read the mechanisms from
[[spring-rate]] and its linked concepts — stiffer at an end means less roll there, load arriving
faster, and a bigger share of that end's lateral load transfer; softer is the mirror. Those strands do
not agree on an outcome, so compose them live rather than quoting a tendency. When comparing setups, treat a spring-gap change and a spring change as the same *family* of move — the sheet may carry both (`front_spring_rate_gf_mm`, `rear_spring_rate_gf_mm` alongside the gaps), so name **both** values when describing an end's stiffness.

## Damper percent (Awesomatix damping / pack)

**Keys:** `damper_percent_front`, `damper_percent_rear` — the Awesomatix damping setting; behaves like **piston size** on a conventional damper. **Higher percent = more damping** (founder-confirmed).

The piston-size character matters beyond simple more/less: **pack**. A smaller-piston-equivalent damper builds resistance **progressively with shaft speed** — gentle inputs feel similar, but fast suspension movements (bumps, kerb strikes, violent weight transfer) meet sharply rising force. A high-pack setting **controls the platform hard in big hits** but can make the car **harsh and skittish over repeated bumps**, because the damper doesn't let the wheel get out of the way fast enough.

Practical reading:

- Treat the **low-speed character** (steering response, roll/pitch feel) with the same language as oil viscosity — more damping = calmer, less reactive (see **damper-oil.md**).
- Treat the **high-speed character** (bumps, kerbs) through pack: more pack = more platform control, less bump compliance. Which way `damper_percent` moves pack on this platform should be verified before quoting it as a hard direction.
- Tune **damper percent together with oil and springs**, not in isolation — the three overlap heavily (per **damper-oil.md**: oil, pistons, and spring rate set the feel together).
