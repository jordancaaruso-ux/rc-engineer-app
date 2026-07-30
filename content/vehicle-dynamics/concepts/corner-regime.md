## Corner regime (steady-state vs transient)

**Concepts:** [[bite-hold]], [[roll-stiffness]], [[tyre-load-sensitivity]]

**Physics.** Stiffness changes act through two mechanisms that dominate in different kinds of
corner. Which one governs depends on whether the car reaches **steady state** — a constant roll
angle held under constant speed and radius — before the corner is over.

A corner is steady-state when both hold:

- **Enough time.** The chassis takes a roughly fixed time (a property of springs, dampers, and
  inertia) to finish rolling and hold its roll angle. The corner must last well beyond that.
- **Inputs hold.** Speed, radius, and therefore roll stay near-constant through the middle of the
  corner.

A long, fast sweeper passes both tests. A hairpin fails the second even though it lasts many
seconds: brake, apex, and throttle keep the loads moving, so the chassis never holds one state.
Chicanes and flicks fail the first — the direction change is over before the roll finishes.

**The two mechanisms.**

- **Steady-state — load-transfer share.** Once roll is constant, each axle carries a share of the
  total lateral load transfer proportional to its share of roll stiffness. The loaded outside tyre
  cannot convert extra load into equal extra grip ([[tyre-load-sensitivity]]), so the stiffer end
  gives up side grip. This is the classic chain: stiffer rear → less rear side grip → more mid/exit
  steering. The Xray setup book scopes exactly this claim to "long, high-speed corners".
- **Transient — load timing.** While roll is still developing, the stiffer end takes load — and
  therefore builds grip — sooner ([[bite-hold]]). A softer rear builds rear lateral force later in
  the direction change, so yaw develops while the rear is still loading: more rotation from entry
  to apex. A stiffer rear loads immediately and resists yaw from the first steering input.

The two mechanisms pull **opposite directions** for the same change. A stiffer rear frees the rear
in a steady-state sweeper but plants it in a hairpin flick; a softer rear supports the rear in steady
state but lets the car yaw in transients.

**Speed scales the regime.** Corner time is corner length divided by speed, while the chassis roll
time is fixed. The same corner is therefore more transient for a faster car and more steady-state
for a slower one — a slower car reaches its steady roll angle earlier relative to where it is in
the corner. Faster classes (modified) spend more of the lap in the transient regime than slower
classes (stock/blinky) on the same layout, so the same stiffness change can answer differently
between classes: advice tuned in a slower class leans steady-state, and can invert when carried
to a faster car on the same track. Anything that changes corner speed shifts the regime the same
way — grip coming up over a race day, a tyre change, or a layout rework all move which mechanism
a given corner samples ([[bite-hold]] describes what the early and late parts of the grip build
look like).

**Front/rear symmetry.** The regime split applies at either axle. Stiffer front: steering response
arrives sooner (transient authority, turn-in) but the front carries a bigger steady-state transfer
share, costing mid/exit steering. Softer front: slower initial response, more steady-state
steering. This matches the Xray table's front spring rows — "increases responsiveness" alongside
"increases mid-corner and corner-exit understeer".

**Low grip (tendency, not a law).** Low grip cuts cornering force, so there is less load transfer
for the steady-state mechanism to redistribute — its effect shrinks with grip. Low grip also slows
corners, giving the chassis more time to reach steady state. Net tendency: on low grip, stiffness
changes do less overall, and what remains is mostly the timing mechanism.

**Handling.** When reasoning about a spring or ARB change, first place the complaint in a corner
type. "Won't rotate in hairpins / tight corners" is a transient-regime problem — the timing
mechanism governs, so softening the rear tends to add rotation there, and stiffening the rear
tends to remove it. "Loose / free through fast corners" is a steady-state problem — the
load-transfer-share mechanism governs, with the opposite sign. Advice that quotes one mechanism
without naming the corner type will be right in one regime and wrong in the other.
