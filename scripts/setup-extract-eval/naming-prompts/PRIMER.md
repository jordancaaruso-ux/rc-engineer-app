# How to read an RC setup-sheet drawing

Most boxes that print a real word ("RIDE HEIGHT", "SPRING") name themselves. The hard boxes print only
a generic word — "SHIMS", "mm", "g", "HEIGHT", "°", a part number — or nothing at all, and sit on or
beside a drawing of the car. Those boxes are named by **what their leader line points at**.

## Following a callout

- **Trace the leader line** (dashed, dotted or solid; often blue, grey or black) from the box to where
  it ENDS. Ignore where it starts; the end is the answer. Lines bend: follow every elbow.
- The end usually sits on a **highlighted part** (a coloured or filled rectangle), an **arrow**, or a
  **dimension line**. A coloured rectangle on the drawing is a shim or spacer stack.
- **Read the stack's orientation.** A flat bar lying across the part in a side, front or rear view is
  shims stacked vertically (under a ball stud, under a mount) — it sets a HEIGHT. A tall narrow bar
  standing beside a hub or on a hinge pin in a side view is spacers along a fore-aft pin — it moves
  something forward or back (wheelbase). A bar between a wheel and its hub is track-width (hex) shims.
- A **double-headed arrow** is a measurement (height, gap, length). "+" and "−" marks give the sign.
- A box beside a drawn **screw or hole** with FIX / REMOVE or YES / NO is whether that screw is fitted.
- Several boxes around one drawing usually name **several different points on the same part**
  (the front and rear pivot of one arm, the inner and outer end of one link). Name them as a set:
  decide what each one is by comparing where their lines land, then give each a distinct name.

**Name what the box SETS or MEASURES, never where the box sits on the paper.**
"Front upper inner shims, rear link" — not "front shims, top row, 2nd box". A positional name is a
last resort for a box whose line you truly cannot follow, and it must carry confidence 0.4 or less.

## Views and which way the car faces

- **Side view**: work out which end of the drawing is the front of the car — the bumper, the steering
  links and servo, a FRONT/REAR word at that end, the belt or pulley layout. Forward of the axle is
  toward the front. The same sheet often draws the front corner and the rear corner side by side.
- **Front or rear view** (looking along the car): the wheel and hub at one side, the chassis centre at
  the other. The upper arm / camber link runs from the top of the hub inward to the tower or bulkhead.
- **Top view** (plan): the front is usually left or up; the steering and bumper are at the front.
- **Droop view**: one arm on a setup board, an arrow from the arm or axle down to the board.

## Touring car (1/10 on-road) anatomy

This section and the shim table below describe a TOURING car. Buggies, trucks and 1/8 cars put the
steering and the links in different places: never carry a touring position over to another car type
(see the off-road section for how those differ).

- **Lower arm** (wishbone): pivots on two inner pins or balls held by **suspension mounts**
  (blocks) or the **bulkhead**, which sit on the chassis. Its outer end carries the hub carrier.
- **FF, FR, RF, RR**: first letter = axle (Front / Rear), second letter = the forward (F) or rearward
  (R) pivot of that axle's arm. FF = front axle, front pivot. FR = front axle, rear pivot. RF = rear
  axle, front pivot. RR = rear axle, rear pivot. The same four letters label anything at those
  pivots: mount inserts, shims under mounts, and the two inner links of an upper A-arm.
- **Upper arm / camber link** (a turnbuckle): from the top of the hub carrier inward to a ball stud on
  the shock tower, bulkhead or upper deck. Some cars use an **upper A-arm with two links**, a front and
  a rear one, each with its own inner ball stud.
- **Hub carrier**: upright, C-hub, caster block; at the front it carries the **steering block**
  (knuckle) with a steering arm; at the rear it is the **rear hub** (rear toe is set by its link).
- **Steering**: servo, servo saver, bell crank(s) on posts, the **steering link** (tie rod) from the
  bell crank to the steering arm, Ackermann holes or plate.
- **Shock**: tower, top ball, body, spring, lower mount on the arm; **anti-roll bar** with its holders
  and links; **up-stop** (limits upward travel) and **downstop** (droop) screws.
- **Drivetrain**: front spool or diff, rear diff, belts, pulleys, eccentric hubs that set **axle
  height / diff height**, motor mount (screw positions), spur, pinion.
- **Chassis**: top deck (upper deck; cuts, screws, flex), chassis plate, bulkheads, battery holder,
  ballast weights, bumper, body posts.

## Shim and spacer positions — use these names

| Where the stack sits | Name it | universalParameterId |
|---|---|---|
| Under the lower arm's inner mount, block or bulkhead pivot (on the chassis) | "Under lower arm shims" + FF / FR / RF / RR (arm mount height) | under_lower_arm_shims_ff / _fr / _rf / _rr |
| Under the upper arm / camber link INNER ball stud (tower, bulkhead, upper deck) | "Upper inner shims" + end, + front/rear link (FF / FR / RF / RR) when the arm has two links | upper_inner_shims_ff / _fr / _rf / _rr |
| Under the upper arm / camber link OUTER ball stud, on top of the hub carrier | "Upper outer shims" + end | upper_outer_shims_front / _rear |
| Between the lower arm's outer end and the hub carrier (hub height) | "Under hub shims" + end | under_hub_shims_front / _rear |
| Under the steering link's ball stud on the steering block | "Bump steer shims" | bump_steer_shims_front |
| Under the rear toe link's ball stud / on a rear toe-gain link | "Rear toe gain shims" (or the sheet's own word, e.g. "ATS shims") | toe_gain_shims_rear |
| On the hinge pin in front of / behind the hub carrier (fore-aft) | "Wheelbase shims, front / rear of the hub" + end | — |
| Between the wheel hex and the hub | "Track width (hex) shims" + end | — |
| On the shock (under the spring, on the shaft, at the top ball) | "Shock spring / shaft / mount spacers" + end | — |
| Between the steering link end and the bell crank, or on the Ackermann plate | "Steering link / Ackermann shims" | — |

When an end has two lower-arm pivots or two upper links, work out which box is the forward one from
the side view and label FF vs FR (RF vs RR) explicitly — both passes of this job must agree.

## Icons that stand for a part

- A **hexagon** (six-sided, often with a hole or an off-centre circle) is the **wheel hex**. Values
  beside it such as -0.5 / 0 / +0.5 are **hex width** (track width offset) for that end.
- A circle with an **off-centre dot or hole**, or a dot that can sit high or low, is an **eccentric
  bushing or insert**: axle height, diff height, belt tension, or caster/camber on some cars. Read the
  words beside it to tell which.
- A **coil** is a spring; a **piston disc with holes** is a shock piston; a **ball on a post** is a
  ball stud (its height is set by shims under it).
- A tick column running **OUT (3mm) … IN (0mm)** in half-millimetre steps beside a shock-mount post
  or ball stud is a spacer position that moves the **lower shock mount** in or out — name it
  **shock angle / lower shock position** for that end, not an arm position.

## Other drawn boxes that print little

Downstop (arrow from the arm or chassis to the board) or droop (from the wheel, hub or axle; see House
words), up-stop, ride height, camber, toe (front
toe-out / toe-in, rear toe-in), caster, kick-up, anti-squat, Ackermann, maximum steering angle,
shock tower hole and arm hole positions (inner / outer, 1…n), anti-roll bar, axle height, diff height,
belt tension, top deck cuts, chassis flex screws fitted or removed, motor mount screw positions,
battery position, ballast weights (g) and where each sits, body post positions, bumper and arm parts
(part-number tick boxes: name the part, e.g. "Front arms: R158032 / R158034(H)").

## Off-road (buggy, truck) anatomy

Buggies put the links and the steering in different places from a touring car. Common layouts
(brands differ, so let the drawing and the sheet's words decide):

- **Front suspension**: the arms hinge on pins in a front bulkhead or arm mount on the chassis; its
  angle is the kick-up, and shims between chassis and bulkhead move the pins up or down. Outboard, a
  caster block (C-hub) pivots on the arm's outer pin and carries the steering block on a kingpin.
  Caster = kick-up + the caster block (often an insert: 0 / +2.5 / +5). Spacers on the outer pin in
  front of or behind the caster block move it fore-aft ("caster block spacing"). A steering stop
  screw in the caster block limits steering lock.
- **Camber links**: the INNER end sits in holes on the shock tower, or in a separate ballstud mount
  on the chassis over the front bulkhead / on the rear gearbox. A hole row there (1-2-3) is the
  camber link's inner position (its length). The OUTER end sits on the caster block (often on a
  bolt-on "link mount") or on the rear hub (often on a bolt-on hub link mount). Washers under a
  camber link ballstud raise that end ("ball stud spacing"); washers under a bolt-on link mount
  ("camber link spacing") raise the mount and its ball together. Name them "camber link inner /
  outer ballstud washers".
- **Steering**: servo → SERVO LINK → bellcrank(s) → rack or drag link → STEERING LINKS (tie rods) →
  steering blocks. The servo link is a short link from the servo horn to one bellcrank, often two
  rod ends on a set screw with a spacer between them (the spacer sets its length); it is not a
  suspension or steering link, and boxes on it name the servo link. The steering links' INNER
  ballstuds sit in the ends of the rack or on the bellcranks; washers there change Ackermann and bump
  steer ("steering rack ballstud washers"). Their OUTER ballstuds sit on the steering block's arm or a
  bolt-on steering plate: those washers are the bump steer washers. "Position: Top / Bottom" beside
  a steering plate = which face of the steering block arm the plate is bolted to. Bellcrank / rack
  height (Up / Down) also sets bump steer.
- **Shocks**: hole rows on a tower are the upper shock positions; rows on an arm (often lettered
  A-B-C) are the lower shock positions. Limiters (inside / outside) limit shock travel.
- **Rear arms**: each rear arm hinges on a pin through a front and a rear mount (Associated: C and D
  blocks; others: suspension holders, RF / RR) that take eccentric inserts (pills). A grid of circles
  on a mount drawing = every insert position; a tick records where the hinge pin sits (toe-in,
  anti-squat, roll centre). Some cars use separate toe-in and anti-squat blocks instead.
- **Rear hub**: axle height (+0 … +3) is usually an eccentric insert in the hub; hub spacers fore or
  aft of the hub set the wheelbase ("hub spacing"); arm spacing moves the arm along its pin.

On an off-road sheet, link a universalParameterId only for the plain settings (ride height, camber,
toe, anti-roll bar, springs, shock oil, bump steer washers). The shim ids in the touring table above
describe touring pivots: leave buggy ballstud washers unlinked.

## House words

"shock" not "damper"; "anti-roll bar"; "diff"; "ride height"; "downstop"; "up-stop"; "camber link";
"upright"; "hex width"; "top deck"; "motor mount"; "bump steer"; "Ackermann".

Different sheets use different words for the same thing. Name it in the words above, and put the
sheet's own word in `printedLabel`: uptravel limit = up-stop; above hub shims = upper outer shims;
upper link height = upper inner shims (a height in mm); steering lock = maximum steering angle; rod
extension = shock length / rod end gap; ARB = anti-roll bar.

**Droop and downstop are two different measurements**, whatever the sheet calls them. Downstop is
measured under the arm or chassis on a droop gauge (a few mm) and set by the downstop screws:
link it to `downstop_front` / `downstop_rear`. Droop is measured at the wheel, hub or axle (tens of
mm): link it to `droop_front` / `droop_rear`. Link by what the box measures, not by its word; if you
cannot tell which, leave it unlinked.

## Confidence

- The line lands clearly on a part you can name → 0.85 or higher, even with no word printed.
- It lands clearly but the part could be one of two things → pick the likelier, 0.55–0.75.
- The line lands on a ball stud, a spacer or a hole row, and the drawing does not show WHICH link
  (camber link, steering link, servo link, toe link…) runs from it → decide from the car-type
  section (where that car type mounts each link) and from which links the drawing's other boxes
  already account for. Confident only when that leaves one answer; if two links still fit, 0.6 or
  less. A ball stud near the bulkhead is a camber link on one car and a steering link on another.
- You cannot follow it → positional name, 0.4 or less.
