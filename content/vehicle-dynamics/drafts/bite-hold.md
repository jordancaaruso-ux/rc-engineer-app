> **AI-drafted baseline (unverified).** Written by the coding agent on 2026-07-29. The concept
> `[[bite-hold]]` is cited across 11 approved KB files but was defined nowhere; this drafts the
> definition from its approved-tier usages (under-hub's "higher RC → more bite / response, lower RC
> → more hold", spring-rate's "takes load faster") plus standard geometric-vs-elastic load-transfer
> theory. Not yet edited or approved by Jordan — reference theory, not founder ground truth.

## Bite vs hold (when grip arrives)

**Concepts:** [[corner-regime]], [[roll-center]], [[roll-stiffness]], [[on-in-track]]

**Physics.** Lateral load reaches the outside tyres through two channels that act on different
clocks:

- **Geometric transfer** passes through the suspension links and acts **immediately** — as soon as
  the tyres make lateral force, load pushes through the linkage. Its share grows as the roll
  centre rises ([[roll-center]]).
- **Elastic transfer** passes through the springs and ARBs and has to **wait for the chassis to
  roll** — load only arrives as the outside spring compresses. Its share grows as the roll centre
  drops, and how fast it arrives scales with stiffness ([[roll-stiffness]]) and is shaped in
  between by damping.

The mix of the two channels sets **when** an axle's grip arrives — and timing is not free of
magnitude: grip that arrives **earlier arrives with less roll taken**, so camber and alignment are
still nearer their static (usually best) values when the load peaks. An earlier peak therefore
tends to be a **higher** peak (founder-stated).

- **Bite** — grip arriving **early**, in step with the first steering input. More geometric share
  (higher RC) or a stiffer end front-loads the grip: at the front this is turn-in authority and
  response; at the rear it is immediate security against yaw.
- **Hold** — grip arriving **late and staying**, once the car is loaded and rolled. More elastic
  share (lower RC) or a softer end delays the grip build but supports the axle once load has
  fully arrived: sustained mid-corner grip.

The same axle cannot be moved toward bite without giving up some hold, and the reverse — the knobs
shift the timing, they do not add load. Which side of the trade the driver feels depends on the
corner: transient corners sample the early part of the grip build, steady-state corners sample the
late part — see [[corner-regime]].

**Knob map.**

- **Roll centre height** (under-hub, link geometry): shifts the geometric/elastic **split**.
  Higher RC moves grip earlier **and** trims how far the car rolls before it arrives, so the axle
  peaks while its geometry is better — timing and peak height move together, not timing alone.
- **Spring / ARB stiffness**: speeds or slows the **elastic** channel — but also changes that
  end's steady-state share of load transfer, so it moves both timing and steady balance at once.
- **Damping** (oil, damper percent): shapes only the **transition** — it acts while the suspension
  is moving and does nothing once roll is constant. A pure transient knob.

**Handling.** "The front bites then washes out" is bite without hold — grip arrives early
(geometric / stiff) but the axle gives up share once fully loaded. "Lazy turn-in but strong
mid-corner" is hold without bite — the mirror. Name which half of the corner the complaint lives
in before picking the knob: timing complaints point at RC height and damping; loaded-corner
complaints point at the steady-state share (springs, ARB).
