# Engineer feedback inbox

Generated: 2026-07-29T07:00:17.386Z

Agent-readable rollup of founder (admin) 0–10 ratings. Canonical source is the database; regenerate via Settings → Export feedback or `npm run engineer:export-feedback`.

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

## 2026-07-22T12:16:18.990Z — score 2/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cmrw1ngvw000bl504mjsrq17g` · **Thread:** `cmrw1mx0u0001l504hqioe49c`

**Question:**

I'm going to tftr in a few days - what are some things i could test based on how the previous day there went

**Answer:**

I couldn't find a track matching "how the previous day there went" for meeting prep. Try the exact track name or LiveRC slug.

**Note:**

same

---

## 2026-07-22T12:16:11.283Z — score 2/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cmrw1mx1l0005l504q9imxc2g` · **Thread:** `cmrw1mx0u0001l504hqioe49c`

**Question:**

I'm going to tftr in a few days - what are some things i could test based on how the previous day there went

**Answer:**

I couldn't find a track matching "how the previous day there went" for meeting prep. Try the exact track name or LiveRC slug.

**Note:**

whats he trying to do?

---

## 2026-07-11T12:23:15.737Z — score 9/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cmrfxrhbe0005la04eheu4ov9` · **Thread:** `cmrfxrhax0001la04gg664iow`
- **KB sections:** Ride height (overall) (vehicle-dynamics/ride-height-and-rake.md), Toe gain (rear) (vehicle-dynamics/bump-steer-toe-gain.md), Rear toe (vehicle-dynamics/camber-caster-toe.md), Gear diff oil (rear) (vehicle-dynamics/diff-and-driveline.md)

**Question:**

Oi mi car ain’t goin fast

**Answer:**

Oi — funny thing is, the stopwatch says the car **was** fast.

Latest Boronia race:
- **Best lap:** 17.398 vs 17.518 before — **0.120s quicker**
- **Avg top 10:** 17.559 vs 17.739 — **0.180s quicker**
- In the imported session you were **rank 1/4 on avg top 10**, about **0.492s faster than the session field average**
- You rated it **8/10**, and the feel chip was **similar**, so it looks more like “not exciting” than actually slow.

I’d **bank this setup as a known-good baseline** before chasing changes. The only recorded chassis change was **rear C45 installed**, and you said you didn’t really notice it — plus the tire run index stepped up on the same set, so I wouldn’t credit/blame that change too hard.

If it *feels* slow, I need to know what kind of slow:
- **No punch / straight-line speed** → gearing, motor, battery, driveline, rollout.
- **Won’t rotate / lazy in corners** → setup/steering balance.
- **Can’t carry mid-corner speed** → grip/platform issue.
- **Slow off corner** → rear support/diff/throttle drive.

Where does it feel slow?  
[[choices: Straight line | Corner entry | Mid-corner | Corner exit | Everywhere]]

**Note:**

Really good - asking questions is perfext

---

## 2026-07-09T09:44:18.590Z — score 6/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cmrc4o0y5000vlb04k8ui3sa4` · **Thread:** `cmrc4hpmh000flb04frbvcus8`
- **KB sections:** Under-hub shims — trimming response versus sustained grip (vehicle-dynamics/response-vs-sustained-grip.md), Anti-dive and anti-squat (side-view geometry) (vehicle-dynamics/anti-dive-anti-squat.md), Droop and downstop (wheel travel) (vehicle-dynamics/droop-downstop-arb.md), Axle height (under hub — outer lower shims) (vehicle-dynamics/roll-centre.md)

**Question:**

How can I get more hairpin steering - it’s really only

**Answer:**

For **more hairpin steering**, I’d first separate it into **entry vs true mid-corner**:

- **Turns in okay, then pushes at apex / won’t keep rotating** → chase **sustained front steering / low-speed rotation**.
- **Won’t point when you first turn the wheel** → chase **initial bite / steering authority**.

Given your latest Boronia setup was already **8/10 and quickest in the session**, I’d keep this conservative: one change, one run.

The first thing I’d try is:

- **Softer front ARB: 1.2 → 1.1**. You’re currently **1.2**, community low-grip median is **1.1** with IQR about **0.10** from 32 uploads, so you’re just above typical. Per `droop-downstop-arb.md`, a **softer front ARB often adds mid-corner steering, especially in hairpins**, and can make the front smoother / less grabby.  
  **Expected feel:** more apex steering and less “front stops building angle” in tight corners.  
  **If it fails:** the car will feel lazier on entry or roll too much / feel vague, especially in fast direction changes.  
  Caveat from your history: you previously tried **front ARB 1.2 → 1.0** and marked the outcome negative, but that was low-confidence and bundled with other context. That’s why I’d only go to **1.1**, not straight to 1.0.

Also check the rear, because a hairpin push is not always a front problem. Your rear is quite “secure” versus the low-grip field:

- **Rear toe is 3.5°**, median **2.5°**, IQR **0.75** from 36 uploads. More rear toe usually adds rear grip and makes the car safer/easier **mid-corner to exit**, but it costs rotation (`camber-caster-toe.md`). If the car feels planted but won’t rotate, a small test like **3.5 → 3.2 / 3.3** could free hairpin rotation.  
  **Expected feel:** car rotates more around the apex and exits less “stuck straight.”  
  **If it fails:** rear becomes nervous on throttle or you lose drive off the hairpin.

If the issue is more **initial point-in** than apex steering:

- **Less ackermann / move toward the field setting:** your `inner_steering_angle` is **28**, community median **25**, IQR **3** from 28 uploads. Per `steering-geometry-ackermann.md`, **less ackermann gives more steering**, and tight layouts often use reduced ackermann for extra rotation. Only do this if **28 → 25** is the direction that reduces ackermann on your sheet.  
  **Expected feel:** more steering authority in tight corners.  
  **If it fails:** front gets too aggressive or scrubs speed.

I would **not** add more front camber as the first answer right now: you’re already at **-3° front**, while the low-grip median is **-1.75°** with IQR **0.8** from 36 uploads. More negative camber can help peak lateral grip, but past the tire’s window it can cost braking/drive and make the car less progressive (`camber-caster-toe.md`).

My order would be: **front ARB 1.2 → 1.1 first**. If that gives apex steering without hurting response, bank it. If the car still won’t rotate but feels safe/planted, then look at **rear toe down slightly**.

**Note:**

The Ackerman thing is weird - it’s relating steering lock directly to ackermann

---

## 2026-07-08T13:40:34.115Z — score 6/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cmrc4jsgq000plb046nvcv9fi` · **Thread:** `cmrc4hpmh000flb04frbvcus8`
- **KB sections:** Final drive ratio (context only) (vehicle-dynamics/diff-and-driveline.md), How to reason about a ride-height question (vehicle-dynamics/ride-height-and-rake.md), Ackermann (steering-link position on the rack) (vehicle-dynamics/steering-geometry-ackermann.md), Interactions (vehicle-dynamics/steering-geometry-ackermann.md)

**Question:**

How

**Answer:**

To understand how more negative camber helps, consider these mechanical principles:

1. **Tire Contact Patch**: When a car corners, the body rolls, and the outside tires experience increased lateral load. More negative camber tilts the tire inward at the top, which helps maintain a better contact patch with the road during this roll.

2. **Optimal Angle**: Tires have an optimal camber angle where they generate the most grip. By increasing negative camber, you can keep the tire closer to this optimal angle as the car rolls, allowing for better grip and handling.

3. **Slip Angle**: As the tire rolls, it develops a slip angle, which is the angle between the direction the tire is pointing and the direction it is actually moving. More negative camber can help align the tire's slip angle with the road surface, improving cornering performance.

4. **Heat Management**: More camber can help distribute heat more evenly across the tire, which can be beneficial in maintaining grip, especially in cooler conditions like those logged at Boronia.

5. **Cornering Stability**: Increased negative camber can enhance cornering stability by reducing the tendency of the outside tire to roll over onto its sidewall, which can lead to a loss of grip.

In summary, more negative camber can help by improving the tire's contact with the road during cornering, optimizing the slip angle, and enhancing overall stability and grip. However, it's essential to find the right balance, as too much camber can negatively affect performance in other areas, like braking and acceleration.

**Note:**

Not sure - doesn’t feel kb based which couldBe okay in this scenario but ideally all info is in kb and used

---

## 2026-07-08T13:39:03.516Z — score 9/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cmrc4hpmt000jlb040doai19g` · **Thread:** `cmrc4hpmh000flb04frbvcus8`
- **KB sections:** Camber (vehicle-dynamics/camber-caster-toe.md), Interactions (vehicle-dynamics/steering-geometry-ackermann.md), Camber in roll (camber gain) (vehicle-dynamics/arm-angles-camber-gain.md), Front toe (vehicle-dynamics/camber-caster-toe.md)

**Question:**

Why did more camber help

**Answer:**

If by “more camber” you mean **more negative camber** — e.g. going from around **-2.0° toward -2.5° / -3.0°** — it likely helped because the outside tire was working better once the car rolled into the corner.

Mechanically:

- In a corner, the chassis rolls and the outside tire tends to lose its ideal contact angle.
- **More negative static camber** starts the tire with the top leaned further inward.
- Under lateral load, that can leave the outside tire closer to its best working angle, so the contact patch can make **more peak lateral force**. That is the core reason more camber can add grip, especially **mid-corner** when lateral load is highest. (`camber-caster-toe.md`)

Why it may have been noticeable at Boronia:

- The track was logged as **very low / low grip** and very cold, so the tire probably needed all the help it could get to build side bite.
- If the car had been sliding the front or rear across the surface, more negative camber may have put the loaded tire into a better slip/camber window rather than rolling onto the outside edge.
- If the improvement felt mostly **mid-corner**, that matches the KB direction best: camber tends to show up when lateral load is high. (`camber-caster-toe.md`)

The caveat: more camber is not free. Past the tire’s useful window, grip can drop off sharply, and under heavy braking or hard acceleration it can cost some longitudinal contact patch efficiency. So if you go too far, the car may feel good mid-corner but worse on brake release or drive-off. (`camber-caster-toe.md`)

Also, for the latest logged run vs the previous one, the setup diff only shows **rear C45 installed** changed, not camber, so the lap improvement there does **not** prove camber was the cause. But if you tested camber separately and it helped, the likely explanation is: **the outside tire was happier at peak lateral load.**

**Note:**

Very good overall, maybe a little too technical for a novice - still using **

---

## 2026-07-08T13:36:22.297Z — score 9/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cmrc4a4fk000blb04eyure828` · **Thread:** `cmrc46v7u0001lb04ku3lcx63`
- **KB sections:** One axle upper link changes — balance vs the other end (vehicle-dynamics/roll-centre.md), [draft] Servo horn height (steering response) (vehicle-dynamics/drafts/servo-horn-steering-response.md), Camber (vehicle-dynamics/camber-caster-toe.md), Front toe (vehicle-dynamics/camber-caster-toe.md)

**Question:**

What other changes could I make to help

**Answer:**

Given the latest car was **8/10**, felt **similar**, and the pace improved, I’d be careful not to throw a big bundle at it. I’d bank this as a **known-good Boronia / very-low-grip / cool-weather baseline** and make **one test at a time**.

Community figures below are from the **Awesomatix A800RR · asphalt · low-grip** pool, not split by Volante 28R specifically or class, so treat them as a reference, not a target.

If you want more pace, these are the changes I’d consider:

- **Don’t add more camber yet — if anything, test slightly less negative.**  
  You’re at **front -3° / rear -3°**, while the low-grip community medians are about **front -1.75° IQR 0.8** and **rear -1.8° IQR 1.0**. That means you’re already a long way more negative than typical. A test back to **-2.5° front and rear** could give a more progressive tire and better braking/drive contact; if the car loses mid-corner peak grip, go back to -3° (`camber-caster-toe.md`).

- **If it feels too safe / too locked-in mid-corner, reduce rear toe a step.**  
  Current **rear toe 3.5°**, low-grip median **2.5° IQR 0.75**, so you’re on the high/stable side. Try **3.5° → 3.0°**. Expected: more rotation and maybe better minimum speed; if the rear starts moving on power or becomes harder to drive, 3.5° was helping (`camber-caster-toe.md`).

- **If the car feels dull or slow to react, test lighter oil — probably rear first or both small.**  
  Current **front oil 450 cSt** vs median **300 cSt IQR 50**, and **rear oil 500 cSt** vs median **350 cSt IQR 100**. You’re quite thick. Thicker oil calms the car and removes rotation; lighter oil gives more bite/reaction but can get edgier. A conservative test would be **rear 500 → 450**, or **front 450 → 400** if the front feels lazy. If it becomes nervous over bumps or too sharp in the first steering input, revert (`damper-oil.md`).

- **If it pushes in tight hairpins, test the front bar back toward the field.**  
  Current **front ARB 1.2**, low-grip median **1.1 IQR 0.1**. Softer front ARB often gives more mid-corner steering in hairpins and smooths the front, but can reduce the first bite. Test **1.2 → 1.1** only if the issue is true mid-corner push, not entry laziness. Caveat: your history has a low-confidence negative note from a previous front ARB decrease, so I’d A/B this carefully (`droop-downstop-arb.md`).

- **If it is loose on throttle, go thinner in the diff before adding more rear toe.**  
  Current **diff oil 6K**, low-grip median about **7K IQR 3**, so you’re already in the normal window. On very low grip, thinner diff oil usually makes the rear calmer on power; thicker can improve drive only once grip can support it. Try **6K → 5K** if exit oversteer is the problem. If it loses forward drive and feels lazy off the corner, 6K was better (`diff-and-driveline.md`).

My pick without more symptoms: **do one more verification run unchanged**, then if you want a safe pace experiment, try **rear toe 3.5° → 3.0°**. That’s the cleanest “free up corner speed” test from where your setup sits now.

**Note:**

This was a great response. I think suggesting less camber after it just improved the car is a little weird, and it suggesting a 0.2 split in arb when 0.1 is very very standard which is maybe a little weird, but overall great response. Actually - realizing the ** are weird and doesn’t need to state ‘median and iqr’ every time, it feels like a lot of info

---

## 2026-06-20T07:41:30.115Z — score 2/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cmqm1tr83000rl204qzgokidh` · **Thread:** `cmqm1tr7r000nl2042epzj1x5`
- **KB sections:** Under-hub shims — trimming response versus sustained grip (vehicle-dynamics/response-vs-sustained-grip.md), Droop and downstop (wheel travel) (vehicle-dynamics/droop-downstop-arb.md), Axle height (under hub — outer lower shims) (vehicle-dynamics/roll-centre.md), Camber (vehicle-dynamics/camber-caster-toe.md)

**Question:**

What will happen if I raise lower arms front and rear equally

**Answer:**

Raising the lower arms front and rear equally will generally affect the car's roll center and handling characteristics. Specifically, it can lead to:

1. **Increased Roll Center Height**: This can improve cornering stability but may reduce overall grip, especially in high-speed corners.
2. **Altered Weight Transfer**: It may change how weight is transferred during cornering, potentially leading to less responsive steering.
3. **Changes in Ride Height**: This adjustment can affect the car's center of gravity, impacting handling dynamics.

For a more tailored analysis, consider how this change interacts with your current setup and track conditions. If you're looking for specific effects based on your recent runs, I can help analyze that further.

---

## 2026-06-20T07:38:12.088Z — score 4/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cmqm1ntre000jl204i0tug6w0` · **Thread:** `cmqm1ntr5000fl204pxse0y6h`
- **KB sections:** Under-hub shims — trimming response versus sustained grip (vehicle-dynamics/response-vs-sustained-grip.md), Droop and downstop (wheel travel) (vehicle-dynamics/droop-downstop-arb.md), Camber (vehicle-dynamics/camber-caster-toe.md), damper-oil (vehicle-dynamics/damper-oil.md)

**Question:**

What will happen if I go to a stiffer rear spring

**Answer:**

Switching to a stiffer rear spring can have several effects on your car's handling:

1. **Mechanical Effect**: A stiffer rear spring increases the rear spring rate, which can lead to more rear geometric support. This means the rear of the car will resist compression more, potentially improving stability under acceleration and reducing rear-end squat.

2. **On-Track Impact**: This change might help in scenarios where you need more stability at the rear, especially during acceleration out of corners. It can also reduce body roll at the rear, which might help in maintaining a more consistent contact patch during cornering.

3. **Potential Downsides**: A stiffer rear spring can also lead to less overall grip at the rear if the surface is bumpy or lacks grip, as the rear tires may not maintain as much contact with the track. This can result in a looser rear end, especially in low-grip conditions.

4. **Alternatives and Next Steps**: If you're considering this change to address a specific handling issue, it might be worth testing in conjunction with other adjustments, such as damper settings or rear anti-roll bar changes, to fine-tune the balance. Always verify on track, as the effect can vary based on the specific track and tire conditions.

Given your current setup, your rear spring rate is at 127.7 gf/mm. If you're considering a stiffer spring, ensure it aligns with your handling goals and test the change to confirm its impact.

**Note:**

‘Which can lead to more geometric support’ don’t use ‘can’ when it’s a physical certainty. I think other inconsistencies with reality may be due to the current state of the kb

---

## 2026-06-20T07:36:08.592Z — score 6/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cmqm1lah0000bl204odcaxbqh` · **Thread:** `cmqm1kpu00001l20451u22ajw`

**Question:**

Yes

**Answer:**

Here's how your current setup compares to the community averages:

1. **Upper Link Index Front**: 
   - Your Value: -0.75 mm
   - Community Median: 0.875 mm (Position: Low)

2. **Upper Link Index Rear**: 
   - Your Value: -1.75 mm
   - Community Median: 0.25 mm (Position: Below Typical)

3. **Upper Link Stagger**: 
   - Your Value: 1.00 mm
   - Community Median: 0 mm (Position: High)

4. **Lower Link Index Front**: 
   - Your Value: 2.50 mm
   - Community Median: 2.25 mm (Position: Mid)

5. **Lower Link Index Rear**: 
   - Your Value: 3.00 mm
   - Community Median: 2.875 mm (Position: Mid)

6. **Lower Link Stagger**: 
   - Your Value: -0.50 mm
   - Community Median: -0.4375 mm (Position: Mid)

7. **ARB Front**: 
   - Your Value: 1.2
   - Community Median: 1.1 (Position: Above Typical)

8. **ARB Rear**: 
   - Your Value: 1.3
   - Community Median: 1.1 (Position: Above Typical)

9. **Front Spring Rate**: 
   - Your Value: 61.4 gf/mm
   - Community Median: 72.75 gf/mm (Position: Below Typical)

10. **Rear Spring Rate**: 
    - Your Value: 127.7 gf/mm
    - Community Median: 109.7 gf/mm (Position: Above Typical)

11. **Ride Height Front**: 
    - Your Value: 5 mm
    - Community Median: 5.05 mm (Position: Mid)

12. **Ride Height Rear**: 
    - Your Value: 5.2 mm
    - Community Median: 5.4 mm (Position: Mid)

This overview highlights areas where your setup is significantly different from the community averages. If you want to adjust your setup based on this data, let me know!

**Note:**

Decent. All the indexes need to be defined so any average user understand what it means. Should fetch the info instantly instead of needing to ask me twice

---
