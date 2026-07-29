# Engineer feedback inbox

Generated: 2026-07-29T11:02:37.915Z

Agent-readable rollup of founder (admin) 0–10 ratings. Canonical source is the database; regenerate via Settings → Export feedback or `npm run engineer:export-feedback`.

> Trimmed by hand to the most recent post-rework responses. The next export from the database
> will rewrite this file with the full history.

## 2026-07-29 (pasted in chat) — score not captured

- **User:** jordancaaruso@gmail.com
- **Message / Thread / Rating ids:** not captured — pasted into chat, not exported from the database
- **KB sections:** not captured

**Question:**

Not captured — a weekend-review style question about Bayside (answer is a full weekend recap).

**Answer:**

Your weekend had a pretty clear shape: **you found the window by late Friday / early Saturday, peaked in Saturday qualifying, then chased small setup changes on Sunday and gave a little of the sharp pace away.**

### Performance arc

- **Fri 9:10 Practice:** baseline was slow — **16.353 best / 16.489 avg top 5**, car **6/10**.
- **Fri 10:53 Practice:** big jump after a large setup change group — best dropped to **16.095**, then the next run hit a **15.294 best** with car **8/10**. That 15.294 looks like the fastest single lap of the weekend, but the avg top 5 was **15.8568**, so I’d treat it as a strong flyer rather than the main pace marker.
- **Fri 3:21 Practice:** best was slower at **15.653**, but avg top 5 improved to **15.7574** and rating stayed **8/10** — that looks like the car became more usable.
- **Saturday qualifying was the best sustained form.**
  The key run was **Sat 12:48 Qualifying: 15.591 best / 15.6912 avg top 5, car 8/10**. That was your best clean combination of pace and consistency.
- The later Saturday rear-toe runs stayed good but didn’t clearly improve it: **15.690 / 15.7364**, then **15.653 / 15.7322**, then **15.641 / 15.7604**. So the car remained in the window, but the early Q setup was probably the sharper one.
- Sunday / race pace was still decent, but not at Saturday peak:
  **Sun Race:** 15.823 / 15.8514, car 7/10.
  **Final race run:** 15.773 / 15.8952, car 7/10.
  In the final linked session you were still strong on usable pace: **avg top 10 was 15.9959, only +0.036s slower than the field mean and ranked 2/10**. So the car was not bad — it just wasn’t as sharp as your best Saturday version.

### Important setup story

The biggest positive phase was **Friday into early Saturday**. You made a large setup step early Friday, then worked on **rear spring gap / rear spring rate**, then **ride height and front spring gap**. That sequence took the car from a 6/10 and 16.3s pace into the 15.6–15.8s window with 8/10 ratings.

The most important single-session marker was **Sat 12:48 Qualifying**, after the **front toe** change. Static toe changes how much slip/scrub the front tyres carry before steering input; that run produced your best realistic qualifying pace: **15.591 best / 15.691 avg top 5**.

The **rear toe experiments** after that did not obviously pay back. They kept the car acceptable, but avg top 5 drifted from **15.691** to the **15.73–15.76** range. That’s not a collapse, but it suggests the car was already close and the extra rear-toe tuning may have been more about feel than pace.

The Sunday change group looks like the one I’d be most suspicious of. From the Saturday evening Q run into Sunday practice you changed **rear toe, rear damper oil, front spring gap, front spring rate**. Thicker rear damper oil means more damping force — the rear resists fast suspension movement more — and the front stiffness changes also affect how quickly/supportively the front takes load. Because several keys moved together, I wouldn’t blame one knob alone, but that group coincided with the car dropping from **8/10 to 6/10** and avg top 5 slipping by about **0.05s** from the previous Q run.

The final race geometry change — **under lower arm shims FF/FR/RF/+1 more** — was a bigger chassis move than the toe-only tweaks. Under-lower-arm shims affect lower-arm pickup height, which changes roll-centre/support behaviour; the pickup split also affects anti-dive / anti-squat side-view geometry. It didn’t ruin the car, but it didn’t recover the Saturday Q sharpness either: best improved versus the first race, but avg top 5 was slower.

### My takeaway

Your best baseline from the weekend is **Sat 12:48 Qualifying**, not the final race setup. The Saturday Q car had the best balance of speed, rating, and repeatability. Sunday/final changes look more like chasing than finding.

If you were going back to Bayside on Vaulk 36SK, I’d start from the **Sat 12:48 Q setup** and only make one change at a time from there. **Expect the car to feel sharper and closer to the 15.69 avg-top-5 window; if it still runs Sunday-style 15.85–15.90 pace on similar tyres/track, then the loss was more tyre/track state than setup.**

**Note:**

overall this was very good - but it needed to reference specific setup changes a little bit more

---

## 2026-07-29T11:02:37.796Z — score 7/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cms5z39gx00u3vl7csiuhsah2` · **Thread:** `cms5z39ek00tzvl7cozi5mkji`
- **Run:** `cmqx5hna80003ky04tbsyyrhl`
- **KB sections:** upper-link-geometry (vehicle-dynamics/upper-link-geometry.md), under-hub (vehicle-dynamics/under-hub.md), Toe gain (rear) (vehicle-dynamics/bump-steer-toe-gain.md), droop-downstop (vehicle-dynamics/droop-downstop.md)

**Question:**

how can i get some more rotation - feel like im missing some pace and the others' cars rotate more while still having rear grip

**Answer:**

I’d start by **freeing the front, not taking rear grip away**.

Your car was decent and consistent, but you said it needed precision. Also your **front damper oil** — the silicone oil controlling how fast the front suspension moves — is **450 cSt**, while the A800RR low-grip asphalt community median is **300 cSt**. That’s a long way stiff on damping.

**Try front damper oil 450 → 400 cSt first**.  
Lighter oil means less damping force, so the front can move and take a set faster. The goal is to make the car rotate from the front rather than loosening the rear.  
**Expect:** more willingness to point into/through the apex while keeping rear grip; if it just gets darty on entry or no better through mid-corner, front damping wasn’t the limiter.

If that helps but not enough, then I’d go to the rear-stability lever:

**Rear toe — static rear wheel angle — reduce 4.0 → 3.5.**  
You’re at **4.0**, while the low-grip A800RR median is **2.5**, so you’re carrying a lot of rear security. A small reduction should free the car to rotate without throwing away all the rear grip.  
**Expect:** more rotation mid-corner and less “stuck” feeling on exit; if it starts stepping out on power or feels loose on corner entry, go back to 4.0.

I would **not** make a big rear spring / ARB change yet. Your rear spring side is already on the firm/high side — rear spring rate **119.6 vs 109.7 median**, rear spring gap **3.2 vs 2.5 median** — so chasing rotation by stiffening the rear further is a bigger-risk move for losing the rear grip you’re trying to keep.

So my order would be:

1. **Front oil 450 → 400**  
2. If still not rotating: **rear toe 4.0 → 3.5**  
3. Only after that, look at more aggressive balance changes.

**Note:**

pretty good - he still likes saying stiffening rear spring adds rotation - which in touring car it doesnt.  I feel like generally the response is a little long and dragged out - if it were me id want a little less fluff - if i want more info i can ask, or perhaps after each response from the engineer it prompts 'dig deeper' oir something like that

---

## 2026-07-29T07:00:17.261Z — score 6/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cms5qi4de01ccvls4giswyglg` · **Thread:** `cms5qi4bg01c8vls4501ee8zh`
- **KB sections:** [draft] Upstop (compression-travel limit) (vehicle-dynamics/drafts/upstop-compression-travel.md), [draft] Damper percent (Awesomatix damping / pack) (vehicle-dynamics/drafts/awesomatix-spring-gap-damper.md), [draft] Servo horn height (steering response) (vehicle-dynamics/drafts/servo-horn-steering-response.md), [draft] Motion ratio — mounting position and angle (vehicle-dynamics/drafts/shock-geometry.md)

**Question:**

how can i get the tire to work harder

**Answer:**

If you mean **make the tyre build more load/heat instead of feeling lazy**, I’d start with **front toe-out** — toe is the wheel pointing slightly outward/inward at ride height, and more toe makes the tyre run a small slip angle all the time, so it scrubs and works harder.

**Try front toe from -1.2 to about -1.4** — assuming negative on your sheet is toe-out. You’re currently **-1.2**, and the low-grip A800RR community median is about **-1.0** from 36 setups, so this is a small move, not a huge drift.  
**Expect:** tyre to come in a bit harder and the car to feel more awake on initial steering; if it just gets draggy, nervous, or loses speed down the straight, back it out.

I would **not** add rear toe first: your rear toe is already **3.2 vs a 2.5 median**, so the rear tyre is already being asked to scrub quite hard.

Second option, if the car feels too tied down rather than under-scrubbed: back off **damper %** slightly. You’re at **100 front / 100 rear**, while the low-grip median is around **60**, and the latest change to 100 didn’t really improve avg top 10.  
**Try 100 → 80 both ends** as a check. **Expect:** the car to move into the tyre more and feel less “held”; if it loses the punch you liked and gets lazy, 100 was helping.

So: **front toe-out first** if you want tyre energy; **damper % back to 80** if the issue is the car not leaning into the tyre.

**Note:**

I would probably consider ARB,. higher Roll center. the damping point is very subjective - not much evidence to back that. the front toe suggestion is okay, not amazing though

---

## 2026-07-29T06:32:48.340Z — score 8/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cms5pg6lv0007jj04cj7qq1m3` · **Thread:** `cms5pg6l80003jj04la58hpab`
- **KB sections:** upper-link-geometry (vehicle-dynamics/upper-link-geometry.md), under-hub (vehicle-dynamics/under-hub.md), under-lower-arm (vehicle-dynamics/under-lower-arm.md), anti-dive-anti-squat (vehicle-dynamics/anti-dive-anti-squat.md)

**Question:**

how can i get more mid corner rotation

**Answer:**

If you mean it **pushes or won’t yaw once the car is settled mid-corner**, I’d start with **less rear toe-in**.

1) **Rear toe-in — static angle of the rear wheels**: go **3.2 → 3.0°** if that’s your normal step. You’re currently **high** versus the low-grip A800RR asphalt pool: **3.2° vs 2.5° median**. More toe means more built-in slip/scrub; taking a little out should free the rear pair and let the car rotate more in the middle.  
**Expect:** more yaw from apex to mid-exit; **if it gets nervous on power or won’t track straight**, you went too far or toe wasn’t the limiter.

2) If that makes the rear too free, put toe back and try **front ARB — the bar linking the front wheels in roll**: **1.2 → 1.1**. You’re also above typical there: **1.2 vs 1.1 median**. Softening the front bar should give the front more mid-corner hold without changing heave ride.  
**Expect:** more steering once loaded; **if it just rolls more and feels lazy without turning better**, it wasn’t the right lever.

Do one at a time. I’d test rear toe first because it’s a clean rotation lever and you’re clearly on the high side already.

**Note:**

Very solid - I think its a bit odd to consider an arb change that results in a .2 split front to rear, pretty uncommon. dont necessarilty mean thats a valid reason not to do it, but i think its valid that the user would want to know its not that common

---

## 2026-07-22T12:16:50.515Z — score 6/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cmrw1ppd40005jl04xdl8ux7m` · **Thread:** `cmrw1mx0u0001l504hqioe49c`
- **KB sections:** Anti-dive and anti-squat (side-view geometry) (vehicle-dynamics/anti-dive-anti-squat.md), Under-hub shims — trimming response versus sustained grip (vehicle-dynamics/response-vs-sustained-grip.md), Camber (vehicle-dynamics/camber-caster-toe.md), Droop and downstop (wheel travel) (vehicle-dynamics/droop-downstop-arb.md)

**Question:**

how can i fix exit oversteer

**Answer:**

For **exit oversteer at TFTR**, I’d treat it as mostly an **on-power rear stability** problem first, not a general “more grip everywhere” problem. Your TFTR context is **cool / low–medium grip**, on **Vaulk 36SK**, and the community comparison is pooled for **A800RR · asphalt · low grip** — not tyre/class-specific — so use the medians as guardrails, not targets.

I’d test in this order:

1. **Rear diff oil slightly thinner**
   - You’re at **6K**, community median is about **7K** with **IQR ~3K**.
   - Per `diff-and-driveline.md`, thicker rear diff oil can give drive, but normally adds **on-throttle oversteer**, especially when grip is low; thinner oil usually gives a calmer rear on power.
   - **Test:** 6K → **5K**.
   - **Expect:** rear should stop stepping out as hard when you pick up throttle; car may give up a little punch/drive off the corner.  
   - **If wrong:** if it becomes lazy and won’t accelerate out, 6K was probably okay and the exit oversteer is more from rear platform / toe / damping.

2. **Add rear toe gain by reducing rear toe-gain shims**
   - `toe_gain_shims_rear` is **3.0 mm**, community median **3.5 mm**, IQR **~1.06 mm**.
   - Important direction: on this platform, **fewer rear toe-gain shims = more bump-in / more rear toe-in on compression**, which usually adds rear grip **mid-corner to exit**, especially on throttle (`bump-steer-toe-gain.md`).
   - **Test:** 3.0 → **2.5 or 2.75 mm**.
   - **Expect:** more planted rear once the outside rear is loaded; exit should be easier to feed throttle.  
   - **If wrong:** if it just pushes from apex to exit or feels too safe/slow, you’ve added too much rear stability.

3. **Try a little more rear sustained-grip trim with rear under-hub shims**
   - `under_hub_shims_rear` is **0 mm**, community median **0 mm** with IQR **0** — so this is off the common TFTR-style value, but still a valid controlled test.
   - Per `response-vs-sustained-grip.md` / `roll-centre.md`, **higher rear under-hub stack → more sustained grip**, while lower stack gives more response.
   - **Test:** 0 → **0.5 mm** rear hub shim.
   - **Expect:** rear should hold longer through exit rather than giving a sharp yaw as throttle comes in.  
   - **If wrong:** if the car feels dull, won’t rotate, or fishtails lazily instead of driving straight, go back to 0.

4. **Do not start by adding more static rear toe**
   - Rear toe is already **3.2°**, community median **2.5°**, IQR **0.75°** — you’re already on the high/stable side.
   - More rear toe usually increases rear grip and makes the car safer mid–exit (`camber-caster-toe.md`), but from **3.2°** I’d only add more as a last resort because it can cost rotation and minimum speed.
   - **If you need a race-safe band-aid:** 3.2 → **3.4°** could calm it, but I’d rather try diff or toe-gain first.

5. **If the exit oversteer is over bumps / kerbs, re-test rear damper percent**
   - Rear damper percent is **100%**, community median **60%**, IQR **12.5%** — you’re well above typical. Also your last TFTR change was **80 → 100 front and rear**, and the pace was basically flat overall.
   - General Awesomatix damper-percent theory is only draft KB: higher percent = more damping, and high pack can control the platform but may make the car harsher/skittish over repeated bumps — draft `awesomatix-spring-gap-damper.md`; approved `damper-oil.md` also says more damping generally calms reaction, but oil/piston/spring must be tuned together.
   - **Test only if the rear is skipping rather than power-sliding:** rear percent **100 → 80 or 90**, leaving other changes alone.
   - **Expect:** more rear compliance over bumps on throttle.  
   - **If wrong:** if it becomes floaty or rolls onto the rear and keeps rotating, put the 100% back.

6. **Rear ARB / rear spring are second-line tests**
   - Rear ARB is **1.3**, community median **1.1**, IQR **0** — definitely high versus the field. A stiffer rear bar can add rotation under high load, especially on throttle, but rear ARB is hedged in the KB because softer can also change hairpin rotation depending on balance (`droop-downstop-arb.md`).
   - **Test:** 1.3 → **1.2 or 1.1** if the car is rotating under high load on exit.
   - Rear spring rate is **119.6 gf/mm**, community median **109.7**, IQR **9.8**, and rear spring gap is **3.2 mm**, median **2.5 mm**. Bigger Awesomatix spring gap = stiffer effective rate in draft `awesomatix-spring-gap-damper.md`; rear spring effects are not perfectly predictable per `spring-rate.md`.
   - **Test later:** rear gap **3.2 → 2.8/3.0** if the rear feels too stiff/skatey, not if it already feels lazy.

My first clean A/B would be:

**Run 1: diff 6K → 5K only.**  
If exit is calmer but drive is weak, go back to 6K and try **toe-gain shims 3.0 → 2.5/2.75** instead. If the oversteer is specifically over bumps or kerbs, I’d re-test **rear damper percent 100 → 80/90** before changing geometry.

**Note:**

decent

---
