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

Downstop / droop (arrow from arm or axle to the board), up-stop, ride height, camber, toe (front
toe-out / toe-in, rear toe-in), caster, kick-up, anti-squat, Ackermann, maximum steering angle,
shock tower hole and arm hole positions (inner / outer, 1…n), anti-roll bar, axle height, diff height,
belt tension, top deck cuts, chassis flex screws fitted or removed, motor mount screw positions,
battery position, ballast weights (g) and where each sits, body post positions, bumper and arm parts
(part-number tick boxes: name the part, e.g. "Front arms: R158032 / R158034(H)").

## Off-road (buggy, truck) additions

Camber link inner position (tower holes) and outer position (hub holes), shock tower and arm holes,
roll-centre inserts / pills (inner and outer, front and rear), hub or pivot-ball spacers, kick-up,
anti-squat, rear toe-in blocks, wheelbase spacers, bump steer (steering block holes or shims),
Ackermann, slipper, wing angle and height. Same rule: follow the line, name the part.

## House words

"shock" not "damper"; "anti-roll bar"; "diff"; "ride height"; "downstop"; "up-stop"; "camber link";
"upright"; "hex width"; "top deck"; "motor mount"; "bump steer"; "Ackermann".

Different sheets use different words for the same thing. Name it in the words above, and put the
sheet's own word in `printedLabel`: droop = downstop; uptravel limit = up-stop; above hub shims =
upper outer shims; upper link height = upper inner shims (a height in mm); steering lock = maximum
steering angle; rod extension = shock length / rod end gap; ARB = anti-roll bar.

## Confidence

- The line lands clearly on a part you can name → 0.85 or higher, even with no word printed.
- It lands clearly but the part could be one of two things → pick the likelier, 0.55–0.75.
- You cannot follow it → positional name, 0.4 or less.
