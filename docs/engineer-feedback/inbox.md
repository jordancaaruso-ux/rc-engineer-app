# Engineer feedback inbox

Generated: 2026-07-30T00:31:50.022Z

Agent-readable rollup of founder (admin) 0–10 ratings. Canonical source is the database; regenerate via Settings → Export feedback or `npm run engineer:export-feedback`.

**Partial export — filtered to 4 most recent.** This is not the full rating history; re-run without filters for everything.

## 2026-07-29T22:46:24.784Z — score 6/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cms6o9kpp000wl404b04xxyia` · **Thread:** `cms6o9kpd000sl404en7ypylz`
- **Run:** `cmrm0ji520003ku0a6ggur2mh`
- **KB sections:** upper-link-geometry (vehicle-dynamics/upper-link-geometry.md), under-hub (vehicle-dynamics/under-hub.md), Toe gain (rear) (vehicle-dynamics/bump-steer-toe-gain.md), under-lower-arm (vehicle-dynamics/under-lower-arm.md)

**Question:**

How can I get more steering into/ rotation without losing rear grip. Low grip track many hairpins &lots of direction changes

**Answer:**

I’d chase this from the **front**, not by freeing the rear more.

**Try first: raise front spring gap** — spring gap is the Awesomatix effective spring-rate adjuster; **bigger gap = stiffer effective front**. You’re at **front gap 0** with **68.4 gf/mm front spring**, while the low-grip asphalt community median is about **3.1 gap** and **72.8 gf/mm**. I’d make a conservative step to **0.6–1.0 front gap**, leave the rear alone.

**Prediction:** expect the nose to take a set earlier in hairpins and direction changes, giving more “into-corner” steering without taking rear toe or rear roll support away; if it becomes pointy on entry then washes/pushes from apex out, the front got too bitey and you’ve traded away too much hold.

Why this one first: your rear is already on the stiff/supportive side — **rear spring gap 3.2 vs 2.5 median**, **rear spring 119.6 vs 109.7 median**, and **rear ARB 1.3 vs 1.1 median**. So I would not start by removing more rear toe or stiffening the rear to make it rotate; that’s the easy way to get rotation, but also the easy way to lose rear grip.

Second option if it still won’t turn at steering lock: **add front caster slightly**, say **4° → 4.5°**. Caster adds camber as you steer, so it mainly helps when the wheels are actually turned — good fit for hairpins. Current is **4°**, right on the low-grip median, so this is not a crazy move.

**Prediction:** expect more front bite at lock and a car that finishes tight corners better; if it just makes the steering heavier/self-centering without more rotation, go back.

I’d avoid “more steering lock” as the first answer unless you’re physically hitting full lock. Your steering geometry number is already high-ish — **28 vs 25 median** — so if the car won’t rotate, it’s more likely a front bite/platform issue than simply not enough throw.

**Note:**

Spring gap is misleading - just use spring rate. Still suggesting stiffer rear spring for rotation - even through a long corner

---

## 2026-07-29T22:41:59.735Z — score 6/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cms6o546a000nl404vsoqo09w` · **Thread:** `cms6o3py3000cl40414gtmx9i`
- **KB sections:** upper-link-geometry (vehicle-dynamics/upper-link-geometry.md), Toe gain (rear) (vehicle-dynamics/bump-steer-toe-gain.md), under-hub (vehicle-dynamics/under-hub.md), damper-oil (vehicle-dynamics/damper-oil.md)

**Question:**

Nervous/loose

**Answer:**

For **nervous/loose in higher grip**, I’d start by undoing the damper-percent move.

**Try damper % 100 → 80 front and rear.** Damper percent is the Awesomatix damping setting — higher number = more damping. You’re currently at **100% both ends**, while the low-grip A800RR asphalt median is **60%**; rear is even **above typical**, and the last 80 → 100 run felt “more punch” without really improving avg top 10.  
**Expect:** the car should feel less sharp/skippy and give you more time when it starts to rotate. **If it just becomes lazy and still loose once loaded, damping wasn’t the main issue.**

I’d do that before adding front spring gap now. Your front spring gap is very low (**0 vs 3.1 mm median**), but with a nervous/loose complaint, stiffening the front could make the first response even sharper if the car is already too reactive.

If the damper reset calms entry but the rear still won’t stay with you mid-corner, second test would be **soften the rear support slightly**: rear spring gap **3.2 → 2.8 mm**. Rear gap is high versus the **2.5 mm median**, and rear spring rate is also high (**119.6 vs 109.7 gf/mm**).  
**Expect:** more rear hold once the car is loaded. **If it rotates even earlier on direction change, put it back — that means the transient timing got worse.**

One caveat: your **front ARB is also high** at **1.2 vs 1.1 median**, so the front may be contributing to the nervous feel too. I wouldn’t move it first because the damper change is the cleanest retest of the last change.

**Note:**

He did the ‘add punch’ again with damper - i think he’s suggesting damper such because it’s anchored to a run that changed dampers back and forth

---

## 2026-07-29T22:39:02.193Z — score 6/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cms6o12bb0007l40454mq0ynf` · **Thread:** `cms6o12ay0003l404nxqk89oa`
- **KB sections:** upper-link-geometry (vehicle-dynamics/upper-link-geometry.md), droop-downstop (vehicle-dynamics/droop-downstop.md), Toe gain (rear) (vehicle-dynamics/bump-steer-toe-gain.md), toe (vehicle-dynamics/toe.md)

**Question:**

How can I get my car to drive straighter off the corner when I pick up throttle - don’t want it to wander and oversteer

**Answer:**

I’d try **rear damper % down one step first**: your rear damper % is **100**, while the low-grip A800RR community median is **60**; I’d go **100 → 80 rear only** and leave the front alone for the test.

Damper % is the Awesomatix damping/pack setting — higher % means more damping resistance. On exit, if the rear is wandering or stepping when you pick up throttle, the rear may be too “packed up” and not following the track cleanly. This is general damping theory on this platform, so test it rather than treating it as guaranteed.

**Prediction:** expect the car to drive off the corner with a calmer rear and less little snap/wander as you squeeze throttle; if it just squats, feels lazy, or still oversteers the same, rear damper % was not the main cause.

I would **not add rear static toe first**: you’re already at **3.2° rear toe** versus a **2.5° median**, so more toe is pushing an already-high number further out.

Second option if the damper change helps but not enough: test **rear toe-gain shims 3.0 → 2.75 mm**. Toe-gain shims set how rear toe changes as the suspension compresses; on this car, **fewer rear toe-gain shims = more bump-in**, so the loaded rear can gain more toe-in on throttle/roll. Community median is **3.5 mm**, so 3.0 is already slightly below the field, but not extreme.  
**Prediction:** expect more rear guidance as the outside rear loads on exit; if it makes the car bind, push, or feel dead off the corner, go back.

Also worth noting: your **front damper % is also 100 vs 60 median** and front ARB is **1.2 vs 1.1 median**, so the front is on the aggressive/stiff side too. If the rear fix doesn’t solve it, the car may be being “pulled around” by too much front response rather than simply lacking rear grip.

**Note:**

He loves suggesting damper % - I’m not sure going down would help here.

---

## 2026-07-29T22:36:51.767Z — score 7/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cms6nyssa0007js04fjgrbuy9` · **Thread:** `cms6nysrn0003js04wv8siani`
- **KB sections:** upper-link-geometry (vehicle-dynamics/upper-link-geometry.md), under-hub (vehicle-dynamics/under-hub.md), under-lower-arm (vehicle-dynamics/under-lower-arm.md), anti-dive-anti-squat (vehicle-dynamics/anti-dive-anti-squat.md)

**Question:**

How can I get some more steering into the corner

**Answer:**

Try **front damper % down one step first**: you’re at **100% front**, while the low-grip A800RR community median is **60%**; I’d test **100 → 80% front only**.

Damper % is the Awesomatix damping/pack setting — higher = more damping, so the front resists taking a set more. Backing the **front** off should let the front move and load a bit more freely on the first steering input.

**Prediction:** expect the car to take the nose into the corner sooner and feel less “stuck on top” on entry; if it just gets lazy, rolls too much, or becomes vague mid-corner, then damping wasn’t the steering limiter.

I would **not** change steering throw first unless you’re physically running out of lock. More throw gives more maximum angle, but it won’t create front grip — it can just make you scrub the fronts harder.

Second option if the damper test doesn’t give enough: add a touch more **front toe-out**. You’re at **-1.2°**, median is about **-1.0°**, so you’re already slightly beyond typical but still inside the normal range. A small move like **-1.2 → -1.4°** is reasonable if you want more initial bite.  
**Prediction:** expect sharper entry response; if the car darts on the straight or loses speed through the middle, back it off.

**Note:**

First suggestion is great - more front toe out normally delays initial steering though

---
