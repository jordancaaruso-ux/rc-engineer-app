# Team Associated B7.1 setup sheet: what the drawing boxes mean

Sheet: `sheets-v3/sheet_8c6b9b8f3a6183f6/blank.pdf`. It is byte-identical (md5 0ab4446e...) to PetitRC's
`B7.1_EditableSetupSheet.pdf`, and uses the same drawings and box set as Associated's own B7.1 editable
sheet. So Associated's filled sheets map onto it box for box. The two best filled examples are the
"Kit Setup" on page 24 of the B7.1 manual and the three B7.1 team sheets.

How the answers were settled: for every washer box, the kit value on the manual's p24 sheet was checked
against the washers shown in the build step. The same check was run on the older B7 manual, whose kit
used different washers (table below). Associated's own documents disagree in only two places: R3 on the
B7.1 (sheet 3mm, build 4mm) and S3 on the B7 (sheet 1mm, build shows no washer). Every other washer box
matched on both cars (S2 only under the bellcrank reading), which pins down which washer each box
means. Local copies of all PDFs are in `scratchpad/b71/`.

Hole rows: the leftmost printed number or letter (3, 4 or C) is the hole nearest the wheel.

## 1. Answers

| id | what the box records (racer's words) | source | confidence |
|---|---|---|---|
| F1 | Washers behind the **steering rack ballstud**: the 8mm ballstud in the end of the steering rack where the steering link (tie rod) starts. It is not a bellcrank ball. The picture is the rack end seen from above: a bearing boss where the bellcrank sits, then the ballstud pointing forward, with the leader ending at the washer. Kit 2mm (B7: 1mm). Associated says "Remove the steering rack washers for less steering". The B6-series manuals call this the Ackermann adjustment: removing washers increases Ackermann, "resulting in a more stable car on corner entry". | M71 p5 Bag1 Step1 (91048 + 31383 2mm x2), p24; M7 p5 (31382 1mm), p24; M64 p5 note (same rack part #91973); M63 p22 and M6 p21 "Ackermann" | high (the part); medium (the effect comes from B6-series manuals, same rack part) |
| F2 | Washers under the **inner front camber-link ballstud**, in the front ballstud mount. That mount sits on top of the chassis over the bulkhead and also carries the bellcranks and the front anti-roll bar. More washers = inner end of the camber link higher. Kit 1mm. | M71 p5 Bag1 Step2 (92586 mount, 91048 8mm + 31382 1mm x2), p24; M7 p5 + p24 (1mm) | high |
| F3 | Washers under the **outer front camber-link ballstud**, a 10mm heavy-duty ballstud on the caster block link mount on top of the caster block. Kit 3mm (a 1mm and a 2mm washer). Associated: "Vertical front outer ballstud allows fine tuning of roll center, camber gain, and link length". Munday: raising the outer ball raises the roll centre. | M71 p9 Bag3 Step2 (91049 + 31382 + 31383), p24; M7 p9 + p24 (2mm); M7 p2; RM-RC | high |
| F4 | **Upper front shock mounting holes** on the tower (3 outermost, 1 innermost). These are not camber-link holes: on the B7.1 the inner camber link sits on the ballstud mount. Kit hole 2. | M71 p8 Bag2 Step7 inset (shock bushing #92443 in hole 2); p18 Bag9 Step7 inset; p24 | high |
| F5 | Which of the **3 holes in the front ballstud mount** holds the inner camber-link ballstud. This sets front camber-link length: hole 3 (outermost) gives the shortest link, hole 1 the longest. Kit hole 2. Associated (B6.3): a shorter link or lower ball end gives "less roll and quicken[s] steering response"; a longer link gives more roll and slower response. Longer links for high grip. | M71 p5 Bag1 Step2 (3 holes per side on 92586), p24; effect M63 p22 | high (what it records); medium (effect text is B6.3) |
| F6 | **Lower front shock mounting holes** on the front arm (C outer, A inner). Kit C: "Use outer hole in front arm!" | M71 p18 Bag9 Step7; p24 | high |
| F7a Caster Block Link Mount | Which **bolt-on link mount** is on top of the caster block. It holds the outer camber-link ballstud. Kit "0" (#92467); options are +1 (#92466), FT -2 (#92469) and FT -3 (#92470, "decrease offset by -3mm"). Write the number. It changes front camber-link length. Avid's matching set: "+2mm lengthens your camber link"; longer link = lower roll centre, softer, less camber gain; shorter = the reverse. | M71 p9 Bag3 Step2; p24; Thielke sheet "#92467 0"; Due sheet "NA" (Due runs a #91985 B6-style caster block); AM-92470; AV-CB | high (what it records); medium (+ = longer is Avid's convention) |
| F7b Front Bulkhead Spacing | **Thickness of the shims between the chassis and the aluminium front bulkhead.** The bulkhead hangs under the chassis and holds the front arms' inner hinge pins, so more shim puts the pins lower. Kit 1mm. The FT carbon set #92438 has 0.5, 1 and 2mm shims; Thielke writes "#92438 3mm". Associated: "Height adjustable aluminum front bulkhead allows for further tuning of front roll center". Avid: "Lowering the front hinge pins allows the front end to roll more". | M71 p5 Bag2 Step1 (inset: chassis, shims, bulkhead, screws from below); p24; M7 p2; Thielke sheet; P1-92438; AV-RCS | high |
| F8 Steering Bellcrank Position | **Height of the bellcranks and steering rack.** Down = "(Low position) Bellcranks down, hat side on top". Up = "(High position) Bellcranks up, hat side on bottom" (the steering hat bushings are flipped). It keeps bump steer in range for the caster used. Associated's Kickup/Steering chart says Low when total caster is 27.5 deg or more, High below that. Kit is Up at 25 deg; Thielke (27.5 deg) and Due (30 deg) both tick Down. | M71 p5 Bag1 Step3 + chart in Step2; p24; M64 p2 "adjustable height steering bellcrank and rack system for optimized bumpsteer"; RM-BS; team sheets | high |
| S1 | The **spacer between the two rod ends of the servo link**. The servo link runs from the servo horn to a bellcrank; Associated calls it the "Steering Link": two rod ends (#92579) screwed onto an M3x12 set screw with an aluminium washer between them. This box is not the camber link or the tie rod. The leader ends on that washer band. A thicker spacer = a longer servo link. Kit 2mm (B7: 1mm). No source says why racers change it. | M71 p6 Bag2 Step3 (92579 x2, 81258, 31383 2mm), p24; M7 p6 (31382 1mm) + p24 (1mm) | high (what it records) |
| S2 | **Washers under the ballstud that the servo link's cup sits on.** Most likely this is the short ballstud on the bellcrank (#32042 on B7.1, #31283 on B7). The drawn ball points straight up above a stacked cylinder (bellcrank on rack boss). In the manual's top view (p15), the horn ball points forward and the bellcrank ball points up. The bellcrank stud has no washer on either kit, and both kit sheets say 0mm. The B7 servo-horn stud has a 1mm washer, yet the B7 sheet says 0mm, which argues against the horn. Kit 0mm. | M71 p5 Bag1 Step2 (32042), p6 Bag2 Step3 (32040), p15 Bag8 Step2 view, p24; M7 p5, p6 (31382 at horn), p24 | medium |
| S3 Bumpsteer Spacing | **Bump steer washers**: washers under the 8mm ballstud on the steering plate, at the outer end of the steering link. Kit 1mm (Thielke 1mm, Due 2.5mm). Munday (Team Associated): "Washers are used on the outer end of the steering to fine tune bumpsteer". About 1mm per 2.5 deg of caster change and 1mm per 1mm of axle height. Fewer washers make the wheel toe in under compression: "more mid corner steer but can be more edgy in bumpy corners". Change in 0.5mm steps. | M71 p8 Bag3 Step1 (71144 + 91048 + 31382 1mm), p24; RM-BS | high |
| S4 Position: Top / Bottom | Whether the **steering plate is bolted to the top or bottom face of the steering block arm**. Kit Top: "Mount plate on top face for Kit Setup". Bottom: "Steering plates can be mounted on bottom face of steering block for further bump steer adjustment". | M71 p8 Bag3 Step1 note; p9 Bag3 Step2 note; p24 | high |
| S5 Steering Plate | **Which steering plate (steering block arm) is fitted**, written as its offset or part. Kit "+1" = #71144 "Steering Block Arm, +1mm"; Thielke "HT1 +1"; Due "Kit". Associated describes its "+1" arms (B6 part #91680) as adding "more Ackermann than the #91679 stock steering plates". | M71 p8 Bag3 Step1, p24; team sheets; AE-91680 | high (what it records); medium (effect is from a B6 part) |
| R1 Camber Link Spacing | **Spacer washers between the rear hub and the rear hub link mount.** The link mount (#92441, +1mm) bolts on top of the hub and holds the outer rear camber-link ballstud, so more washers lift the whole mount and ball. Kit 1mm (B7: 2mm). Avid: "you always run a 1mm shim in this area at minimum"; without it the kit ballstud "will pinch the bearing on the molded hubs". | M71 p14 Bag7 Step1 (31382 x2 1mm under 92441), p24; M7 p14 (31383 x2 2mm) + p24; RRC-Avid | high |
| R2 Ball Stud Spacing (hub) | **Washers under the outer rear camber-link ballstud itself**: the 4mm heavy-duty ballstud screwed into the hub link mount. Kit 0mm (B7: 1mm). R1 and R2 both raise the outer ball; the difference is where the washers sit. | M71 p14 Bag7 Step1 (91051, no washer), p24; M7 p14 (91047 + 31382 1mm) + p24 | high |
| R3 Ball Stud Spacing (gearbox) | Washers under the **inner rear camber-link ballstud** on the aluminium rear ballstud mount (#92440) on top of the gearbox. Kit sheet 3mm, but the build step shows 2 x 2mm per stud (the B7 sheet says 4mm). The FT "+2mm" ballstud mount (#92477, in Thielke's notes) raises the studs so fewer washers are needed. Associated (B6.3): raising the rear inner ball end gives "more roll and more cornering grip"; lowering it lets the car "square up" better. | M71 p12 Bag6 Step3, p24; M7 p12 + p24; Thielke sheet; R1W; M63 p22 | high |
| R4 | **Upper rear shock mounting holes** on the rear tower (4 outermost, 1 innermost). Kit hole 2, on the -2mm "Gull Dropper" tower. | M71 p13 Bag6 Step5 inset; p18 Bag9 Step8 inset; p24 | high |
| R5 | Which of the **3 holes in the rear ballstud mount** holds the inner rear camber-link ballstud. This sets rear camber-link length: hole 3 is outermost and shortest, hole 1 innermost and longest. Kit hole 2. | M71 p12 (92440), p24; effect M63 p22 | high |
| R6 | **Lower rear shock mounting holes** on the rear arm (C outer, A inner). Kit B. | M71 p18 Bag9 Step8 inset; p24 | high |
| M1 C / D Mount circles | **C Mount = FRONT inner pivot of the rear arms**, bolted to the chassis; the B7.1 kit uses #92585 "Arm Mount, C, -1 Toe". **D Mount = REAR pivot**, under the gearbox with the rear bumper. Each mount takes eccentric pill inserts (#92014) whose hole is centred or offset 0.35mm ("0.5 deg") or 0.7mm ("1 deg"). The 5x5 circles are every pin position, one grid per side. **A tick = where the hinge pin sits.** Moving C against D changes toe-in and anti-squat. Moving both together changes pin height ("Higher pin = Higher roll center") and pin width. Kit is all centre: "Toe-In 2 deg, Anti-Squat 1 deg". Note p22 prints 3 deg toe / 2 deg anti-squat for the centred "standard position". | M71 p9 Bag4 Step1, p10 Bag4 Step2, p12 Bag6 Step3, p22 pill chart, p24; AE pill chart (B6) | high |
| M2 rear Axle Height | **Which way the eccentric rear-hub insert (#92179) is turned.** Each row says which printed number points up and the result: down-0/up-3 = +3, down-1/up-2 = +2, up-1/down-2 = +1, up-0/down-3 = +0 mm. Kit +1 (B7: +2). The manual adds: "HRC allows for higher axle heights (+2 positions)". Associated: axle height keeps roll centres similar across ride heights; high axle heights go with low ride heights. Munday: one step higher raises the roll centre by about 3mm. | M71 p14 Bag7 Step1 chart; p24; M63 p22; RM-RC | high |
| T1a Caster Block Insert 0/+2.5/+5 | **The insert in the caster block that sets its caster.** It adds to kick-up: total caster = bulkhead + chassis 22.5 deg + insert. "+2.5 deg is the standard insert used. Tab up = adds caster, Tab down = removes caster." Associated: "For less entry steering and more exit steering, try 0 deg caster block angle". | M71 p9 Bag3 Step2; p5 chart; p23 | high |
| T1b Caster Block Spacing Fwd/Back | Where the caster block sits front-to-back on the outer hinge pin, set by the caster block shim (#92416) on the other side. The kit ticks **Back** with 3-trail steering blocks. The build says "When using 3 Trail steering blocks, shim goes in front of caster block". So Back most likely means the block is spaced rearward with the shim in front. No source states it outright. (The B7 kit, with different steering blocks, ticked Fwd.) | M71 p9 Bag3 Step3; p24; M7 p24 | medium |
| T1c Ballstud Mount Standard/-2mm | **Which front ballstud mount is fitted.** The kit includes both ("NEW -2mm Front Ballstud Mount included along with updated Top Plate and Standard Ballstud Mount"); kit uses -2mm. By its name, the -2mm mount carries the inner camber-link ballstuds 2mm lower. Associated (B6.3): lowering the ball end gives less front roll and quicker steering. Munday: lowering the inner stud raises the roll centre. | M71 p5 Bag1 Step2 (92586 "-2mm"), p24; AE-NEWS; M63 p22; RM-RC | high (what it records); medium (effect) |
| T1d Steering Stop Spacing | **How far the steering stop screw is set.** It is the M2.5x6 screw (#31520) in the caster block, and it limits steering lock. B7.1 manual: "1.2mm measured from top of screw to perpendicular face on caster block" (kit 1.2mm). B7 manual: "Set flush with caster block to start". | M71 p9 Bag3 Step2; p24; M7 p9 | high |
| T1e Kick-Up Angle -2.5/0/+2.5 | **Which front bulkhead angle is fitted**: the 0 deg bulkhead (#92436, kit), or the 2.5 deg bulkhead (#92437) turned to add or remove 2.5 deg. This sits on top of the chassis' 22.5 deg. On the B6.4 the "arrows on the 2.5 deg bulkhead should point forward for the desired setting". Associated (B6): more kick-up gives more corner-entry steering. | M71 p5 Bag2 Step1 + chart; p24; M64 p5; M63 p22 | high |

### Kit values cross-check (sheet value = washers in the build step)

| box | B7.1 sheet (M71 p24) | B7.1 build | B7 sheet (M7 p24) | B7 build |
|---|---|---|---|---|
| F1 rack ballstud | 2mm | 31383 2mm (p5) | 1mm | 31382 1mm (p5) |
| F2 ballstud-mount stud | 1mm | 31382 1mm (p5) | 1mm | 31382 1mm (p5) |
| F3 caster-block stud | 3mm | 1mm + 2mm (p9) | 2mm | 31383 2mm (p9) |
| S1 servo-link spacer | 2mm | 31383 2mm (p6) | 1mm | 31382 1mm (p6) |
| S2 stud under servo link | 0mm | bellcrank stud: none; horn stud: none | 0mm | bellcrank stud: none; horn stud: 1mm |
| S3 steering-plate stud | 1mm | 31382 1mm (p8) | 1mm | none (p8): sheet/build mismatch |
| R1 hub link mount | 1mm | 31382 x2 1mm (p14) | 2mm | 31383 x2 2mm (p14) |
| R2 hub ballstud | 0mm | none (p14) | 1mm | 31382 1mm (p14) |
| R3 rear ballstud-mount stud | 3mm | 2 x 2mm (p12) | 4mm | 2 x 2mm (p12) |

### Sources (keys used above)

- **M71**: RC10B7.1 Team Kit manual (1/22/2026): https://img2c.associatedelectrics.com/pdf/cars_and_trucks/RC10B7.1/Team_Kit/90046_RC10B71_Carpet_Manual_1_22_2026.pdf (PDF page = printed page; kit setup sheet p24, pill chart p22, tuning p23)
- **M7**: RC10B7 Team Kit manual V2: https://img2c.associatedelectrics.com/pdf/cars_and_trucks/RC10B7/Team/RC10B7-Carpet-Manual-V2-8-22-2024.pdf (features p2, kit sheet p24)
- **M64**: RC10B6.4 manual: https://img2.associatedelectrics.com/pdf/cars_and_trucks/RC10B6.4/Team/B6.4-Manual-6-21-2023.pdf (p2 features, p5 rack-washer note + bulkhead note)
- **M63**: RC10B6.3 manual: https://img2.associatedelectrics.com/pdf/cars_and_trucks/RC10B6.3/Team/B6.3-Manual-4-14-2021.pdf (p22 Tuning Tips: camber links, Ackermann, kickup, axle height)
- **M6**: RC10B6 manual: https://img2c.associatedelectrics.com/pdf/cars_and_trucks/RC10B6/Team/90011_RC10B6_manual-2017.pdf (p21 Ackermann)
- Team sheets (B7.1): Thielke https://img2c.associatedelectrics.com/pdf/cars_and_trucks/RC10B7.1/setup_sheets/B7_1_2026_Thielke_Desert_Classic.pdf ; Due https://img2c.associatedelectrics.com/pdf/cars_and_trucks/RC10B7.1/setup_sheets/B7_1_2026_Due_ONS_2.pdf ; Carrico https://img2c.associatedelectrics.com/pdf/cars_and_trucks/RC10B7.1/setup_sheets/B7_1_2026_Carrico_JC_INS_RC_ONE.pdf
- **RM-RC**: Ray Munday, Roll Centre Tuning Quick Reference Guide (B6/B74 model): https://site.petitrc.com/setup/associated/RayMunday_RollCentreTuningQuickReferenceGuide/
- **RM-BS**: Ray Munday, B6.4 Bump Steer Guide (text + chart image): https://www.sodialed.com/rc-setup-tips/team-associated-b6-4-d-bump-steer-guide
- **AE-NEWS**: https://www.associatedelectrics.com/news/latest_products/3014-new-rc10b71-amp-rc10b71d-team-kits/
- **AE-91680**: https://60years.associatedelectrics.com/rc10b6-ft-steering-block-arms-1/
- **AE pill chart (B6)**: https://img2c.associatedelectrics.com/pdf/cars_and_trucks/RC10B6/B6_B6D_Pill-Chart.pdf
- **AM-92470**: https://www.amainhobbies.com/team-associated-rc10b7-factory-team-caster-block-link-mounts-3mm-2-asc92470/p1539620
- **AV-CB**: https://www.avidrc.com/product/p/4155/B7-Caster-Block-Link-Mount-2mm and https://www.avidrc.com/product/5/accessories/4161/B7-Caster-Block-Link-Mount-Set-AV10138-SET-accessories.html
- **AV-RCS**: https://www.avidrc.com/product/p/4289/B7-Front-Roll-Center-Adjustment-Shims
- **P1-92438**: https://pick1up.com/products/ft-rc10b7-carbon-fiber-front-bulkhead-shims
- **RRC-Avid**: https://www.redrc.net/2024/10/avid-b7-11mm-hub-link-mount/
- **R1W**: https://r1wurks.com/products/r1wurks-b7-rear-ballstud-mount-2-aluminum
- JConcepts B7 rack ("mimicking the standard adjustment of moving the bellcranks up or down"): https://www.liverc.com/news/new-jconcepts-b7-steering-rack/

## 2. How the B7.1 front and rear geometry works

Front (page numbers are M71 unless marked)
- The front arms hinge on inner pins held in an aluminium bulkhead bolted UNDER the chassis. Shims between chassis and bulkhead ("Front Bulkhead Spacing") drop the bulkhead and pins lower [p5 Bag2 Step1]. Associated says this tunes front roll centre [M7 p2]; Avid says lower pins mean more front roll [AV-RCS].
- The bulkhead's own angle is the Kick-Up row: the 0 deg part, or the 2.5 deg part fitted either way. The chassis adds 22.5 deg, and the caster-block insert adds 0, 2.5 or 5 deg to give total caster [p5 chart].
- On top of the chassis sits the front ballstud mount (Standard or -2mm; kit -2mm). It holds the two INNER camber-link ballstuds (3 holes per side = the low "3 2 1" row; washers = middle Ball Stud Spacing), both steering bellcranks, and the front anti-roll bar [p5 Bag1 Steps 2-3].
- The bellcranks ride on the steering rack. Flipping the steering hat bushings sets bellcranks and rack High (Up) or Low (Down) [p5 Step3]. The chart says Low at 27.5 deg total caster or more [p5].
- Each end of the rack carries an 8mm ballstud on washers (kit 2mm): the INNER end of each steering link. Fewer washers = "less steering" / more Ackermann [M64 p5; M63 p22].
- The servo link (two rod ends on a set screw, spacer between; kit 2mm) joins the servo horn ball, which points forward, to a short upright ballstud on one bellcrank [p5 Step2; p6 Bag2 Step3; p15 top view].
- Outboard, the caster block pivots on the arm's outer hinge pin. The caster-block shim goes in front of it or behind it (Fwd/Back). An insert sets its caster: "Tab up = adds caster" [p9 Steps 2-3].
- A bolt-on caster block link mount (kit 0; +1, -2, -3 options) on top of the caster block holds the OUTER camber-link ballstud (10mm, kit 3mm of washers). The mount changes link length; the washers change outer-ball height [p9 Step2; AV-CB].
- The steering block turns in the caster block on caster hat bushings (kit "Top: 1mm, Bottom: 2mm") [p9 Step3]. The steering stop screw in the caster block limits lock (kit 1.2mm) [p9 Step2].
- The steering plate (kit #71144 "+1mm") bolts to the top or bottom face of the steering block arm. Its 8mm ballstud on washers (Bumpsteer Spacing, kit 1mm) is the OUTER end of the steering link [p8 Bag3 Step1].
- Bump steer therefore has three controls: rack height (Up/Down), plate Top/Bottom, and washers under the plate ballstud. Guide: 1mm of washer per 2.5 deg of caster or per 1mm of axle height, changed in 0.5mm steps [RM-BS].
- Front shocks: tower holes 3-2-1 (kit 2), arm holes C-B-A (kit C, outer) [p8 Bag2 Step7; p18].

Rear
- Each rear arm swings on one inner hinge pin through two aluminium mounts. C is in front, on the chassis; the B7.1 kit uses the "-1 Toe" C mount. D is behind, under the gearbox with the bumper [p9 Bag4 Step1; p12 Bag6 Step3].
- Both mounts take eccentric pill inserts (hole centred, or 0.35/0.7mm off). The sheet's 5x5 circles are every pin position. C against D sets toe-in and anti-squat; both together set pin height (roll centre) and width. Kit is centre [p10; p22].
- The INNER rear camber-link ballstuds sit in the aluminium rear ballstud mount on the gearbox: 3 holes per side (kit 2), washers under them [p12; p24]. The FT +2mm mount replaces washers [Thielke notes; R1W].
- For the OUTER end, a rear hub link mount (+1mm) bolts on top of each hub. Spacer washers under it are "Camber Link Spacing" (kit 1mm). The 4mm ballstud screws into it, and washers under that stud are "Ball Stud Spacing" (kit 0) [p14 Bag7 Step1].
- Rear axle height comes from an eccentric insert in the hub, turned for +0 to +3mm (kit +1); HRC hubs allow higher positions [p14].
- Rear shocks: tower holes 4-3-2-1 (kit 2), arm holes C-B-A (kit B) [p13 Bag6 Step5; p18].

What the height changes do (Munday's B6/B74 model; for B7.1 treat as direction only) [RM-RC]
- Raising the outer ballstud 1mm raises the roll centre about 1.9mm. Raising the inner ballstud 1mm lowers it about 1.9mm. One pill step up (0.7mm) raises it about 2.2mm. Axle height +1 raises it about 3mm. Ride height 1mm lower drops it about 1.2mm.
- A low roll centre feels softer with more grip; a high one feels stiffer and more direct. A longer upper link gives less camber gain.
- Associated [M63 p22]: a shorter camber link or lower ball end means less roll (front: quicker steering; rear: "square up" on power). Longer or higher means more roll and cornering grip. Long links suit high grip.

## 3. Questions for a buggy racer

1. S2: On the servo link, is the lower "Ball Stud Spacing" the washers under the ball on the bellcrank, or on the servo horn?
2. S1: Why change the spacer between the two servo-link rod ends: just to centre the steering, or as a tuning change?
3. T1b: "Caster Block Spacing: Back": does the caster block sit back (shim in front), or does the shim go behind it?
4. T1c: Does the -2mm ballstud mount lower only the inner camber-link balls, or the bellcranks and rack too?
5. F7a: On caster block link mounts, does "+" put the ball further out (longer camber link) and "-" further in?
6. R1/R2: To raise the rear outer ball, do you add washers under the hub link mount or under the ballstud? Is there a reason to prefer one?
7. M1: On the C and D Mount grids, is the left grid the car's left side, looking from behind?
8. (Not asked, but on the sheet) Front Axle Height +0 to +3: is it set by swapping the top/bottom caster hat bushings (kit top 1mm / bottom 2mm = +2)?
