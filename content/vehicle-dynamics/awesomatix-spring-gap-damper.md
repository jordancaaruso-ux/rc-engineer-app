## Spring gap (Awesomatix effective rate)

**Keys:** `spring_gap_front`, `spring_gap_rear` — Awesomatix-specific stiffness control. **Bigger gap = stiffer** (founder-confirmed). It is an **effective spring-rate adjustment**, not a preload or free-play setting.

Because spring gap is a rate control, **all spring-rate reasoning applies**: read the mechanisms from
[[spring-rate]] and its linked concepts — stiffer at an end means less roll there, load arriving
faster, and a bigger share of that end's lateral load transfer; softer is the mirror. Those strands do
not agree on an outcome, so compose them live rather than quoting a tendency. When comparing setups, treat a spring-gap change and a spring change as the same *family* of move — the sheet may carry both (`front_spring_rate_gf_mm`, `rear_spring_rate_gf_mm` alongside the gaps), so name **both** values when describing an end's stiffness.

## Damper percent (Awesomatix damping / pack)

**Keys:** `damper_percent_front`, `damper_percent_rear` — the Awesomatix damping setting; behaves like **piston size** on a conventional damper. **Higher percent = more damping** (founder-confirmed).

The piston-size character carries a second variable beyond simple more/less: **pack** — resistance that rises **progressively with shaft speed**, so gentle inputs meet similar force while fast movements (bumps, kerb strikes) meet sharply rising force. For the **low-speed** character (steering response, roll/pitch rate) reason with the same mechanisms as oil viscosity (**damper-oil.md**, [[damping]]). For the **high-speed** character, pack sets the trade between platform control and [[bump-compliance]]. **Higher percent = fewer holes = more pack** (founder-confirmed 2026-07-30, Awesomatix-specific): fewer holes leave less flow area, so damping force rises faster with shaft speed — the same setting that adds overall damping also steepens how it arrives.
