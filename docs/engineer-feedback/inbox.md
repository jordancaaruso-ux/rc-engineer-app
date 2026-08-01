# Engineer feedback inbox

Generated: 2026-07-31T00:04:44.033Z

Agent-readable rollup of founder (admin) 0–10 ratings. Canonical source is the database; regenerate via Settings → Export feedback or `npm run engineer:export-feedback`.

**Partial export — filtered to rated on or after 2026-07-30T14:00:00.000Z.** This is not the full rating history; re-run without filters for everything.

## 2026-07-30T23:51:34.496Z — score 6/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cms860ipm002zk604ve6qfb03` · **Thread:** `cms860ip9002vk604po3ove6b`
- **KB sections:** upper-link-geometry (vehicle-dynamics/upper-link-geometry.md), under-hub (vehicle-dynamics/under-hub.md), damper-oil (vehicle-dynamics/damper-oil.md), under-lower-arm (vehicle-dynamics/under-lower-arm.md)
- **Prompt version:** `2026-07-30b+17619acd`

**Question:**

What setup changes should I have tried this weekend that I didn’t

**Answer:**

Yes — looking at the weekend as a whole, I’d have wanted **one clean rear-end grip / consistency test**, rather than more mixed packages.

You tried tyres, front ARB, camber/rear toe, a big Saturday geometry package, front spring/gap, both ARBs together, and rear caster. What I don’t see is a clean “rear support vs rear hold” A/B.

**1) First test I’d have tried: rear ARB 1.2 → 1.1.**  
Rear ARB — the bar linking the rear wheels in roll — was **1.2**, while the low-grip asphalt A800RR community median is **1.1** from 32 setups, and the IQR is basically sitting on 1.1. That makes your rear bar the standout stiffness outlier. Because Moorebank is tagged **fast + low grip**, I’d test less rear roll stiffness before chasing more geometry.  
**Prediction:** expect the rear to hold longer in loaded fast corners and make avg-15 pace less fragile; if the car just gets lazy in direction change or won’t rotate, the rear bar wasn’t the problem.

**2) If that helped but wasn’t enough: soften the rear spring rate one step.**  
Spring rate — the rear’s stiffness in both roll and heave — was **119.6 gf/mm**, which is **high** versus the low-grip median of **109.7 gf/mm** from 36 setups. This is a bigger platform change than the ARB because it affects bumps/heave too, so I’d try it second, not first.  
**Prediction:** feel for more rear hold and easier long-run consistency; if it starts rolling too much, feels dull, or loses the first 3–5 lap pace, go back.

**3) Only if the car felt bound-up on power: reduce rear toe gain.**  
Toe gain — rear toe-in that appears as the rear compresses — was at **2.5 mm shims**, while the low-grip median is **3.5 mm**. On this car, **fewer rear toe-gain shims = more toe-in gained in compression**, so your final setup had more dynamic rear toe than typical. I’d only test **2.5 → 3.5** if the car was safe but wouldn’t finish the corner or felt draggy on throttle.  
**Prediction:** expect freer exit and less loaded-corner scrub; if the rear starts stepping out on throttle, you needed that gained toe-in.

Tyre-wise, the weekend is noisy: several runs changed tyres and the final anchor was logged as tyre run 2, but there’s no tyre label or enough tyre-life history here to quantify drop-off. So I’d treat those as **setup tests to run**, not conclusions from the lap times alone.

**Note:**

: feel for more rear hold and easier long-run consistency; if it starts rolling too much, feels dull, or loses the first 3–5 lap pace, go back. Thats off kb, 3-5 lap pace??

---

## 2026-07-30T23:47:18.967Z — score 6/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cms85whya002qk604j4z8i5r0` · **Thread:** `cms82zvjr000vk604akmyiis1`
- **KB sections:** upper-link-geometry (vehicle-dynamics/upper-link-geometry.md), under-hub (vehicle-dynamics/under-hub.md), under-lower-arm (vehicle-dynamics/under-lower-arm.md), damper-oil (vehicle-dynamics/damper-oil.md)
- **Prompt version:** `2026-07-30b+17619acd`

**Question:**

How can I get more steering - balance is good on new tires but quickly goes away

**Answer:**

First thing I’d try: **reduce front camber** — camber is the tyre tilt — from **-3.0° to -2.5°**.

You’re quite aggressive there: current **-3.0°**, low-grip A800RR community median **-1.75°** with the field mostly inside about **0.8° IQR**, and your value is even past the low end of the uploaded range. More negative camber can give strong fresh-tyre peak, but if it’s past the tyre’s window the grip falls away sharply rather than holding.

**Prediction:** expect a touch less razor bite on the first laps, but steering should stay more consistent as the tyres come in / fade; if it just feels lazy immediately and still loses steering later, camber wasn’t the main issue.

Second option, only if the loss is mainly **mid-corner / loaded corner**: soften the **front ARB** — the anti-roll bar, which only adds roll stiffness — from **1.2 to 1.1**. You’re at **1.2**, above the low-grip median **1.1**.  
**Prediction:** expect more front hold through the middle, but if the car loses turn-in bite or becomes vague in direction changes, put the 1.2 back.

One caveat: the rear is also on the stiff side — **rear ARB 1.3 vs 1.1 median**, rear damper percent **80 vs 60 median** — so if the car is actually rotating less because the rear tyre is fading or sliding first, don’t chase only front grip. But from your “new tyres good, steering goes away” description, I’d start with front camber.

**Note:**

Is the camber info kb grounded? ‘If car is rotating less because rear tire is sliding first’ that would increase rotation

---

## 2026-07-30T23:37:59.596Z — score 6/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cms85k9x20025k604jpswauk1` · **Thread:** `cms82zvjr000vk604akmyiis1`
- **KB sections:** upper-link-geometry (vehicle-dynamics/upper-link-geometry.md), under-hub (vehicle-dynamics/under-hub.md), anti-dive-anti-squat (vehicle-dynamics/anti-dive-anti-squat.md), damper-oil (vehicle-dynamics/damper-oil.md), under-lower-arm (vehicle-dynamics/under-lower-arm.md), arb (vehicle-dynamics/arb.md), droop-downstop (vehicle-dynamics/droop-downstop.md), spring-rate (vehicle-dynamics/spring-rate.md), toe (vehicle-dynamics/toe.md), camber (vehicle-dynamics/camber.md), roll-center (vehicle-dynamics/concepts/roll-center.md), camber-gain (vehicle-dynamics/concepts/camber-gain.md), bite-hold (vehicle-dynamics/concepts/bite-hold.md), on-in-track (vehicle-dynamics/concepts/on-in-track.md), load-transfer (vehicle-dynamics/concepts/load-transfer.md), bump-compliance (vehicle-dynamics/concepts/bump-compliance.md)
- **Prompt version:** `2026-07-30b+17619acd`

**Question:**

How will a stiffer rim / wheel affect handling

**Answer:**

A **stiffer rim/wheel** reduces compliance between the hub and tyre contact patch: the tyre carcass is held more firmly, so load and slip-angle changes reach the tyre faster.

- It can give more **bite**: sharper initial response, more precise feel, but a narrower grip window.
- It can reduce **hold / bump compliance**: on bumps or high grip it may make the tyre load spike more, so the car can become harder to lean on.

This is general vehicle-dynamics theory, not something confirmed on every touring car; tyre, insert, additive, and track grip decide how much you actually feel.

**Note:**

Is this actually general vd knowledge? We could include the stuff we spoke about (unsprung transfer?)

---

## 2026-07-30T23:35:57.599Z — score 7/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cms85h9je001yk604e1zcv9l7` · **Thread:** `cms82zvjr000vk604akmyiis1`
- **KB sections:** upper-link-geometry (vehicle-dynamics/upper-link-geometry.md), under-lower-arm (vehicle-dynamics/under-lower-arm.md), under-hub (vehicle-dynamics/under-hub.md), anti-dive-anti-squat (vehicle-dynamics/anti-dive-anti-squat.md), damper-oil (vehicle-dynamics/damper-oil.md), arb (vehicle-dynamics/arb.md), droop-downstop (vehicle-dynamics/droop-downstop.md), spring-rate (vehicle-dynamics/spring-rate.md), camber (vehicle-dynamics/camber.md), toe (vehicle-dynamics/toe.md), roll-center (vehicle-dynamics/concepts/roll-center.md), camber-gain (vehicle-dynamics/concepts/camber-gain.md), bite-hold (vehicle-dynamics/concepts/bite-hold.md), on-in-track (vehicle-dynamics/concepts/on-in-track.md), load-transfer (vehicle-dynamics/concepts/load-transfer.md), bump-compliance (vehicle-dynamics/concepts/bump-compliance.md)
- **Prompt version:** `2026-07-30b+17619acd`

**Question:**

My car is amazing in low grip - when grip comes up it becomes a little hard to drive and loses rotation

**Answer:**

When grip comes up, the car makes more cornering force, so **roll-centre support and chassis stiffness show up harder**. A setup that feels great in low grip can become over-supported: lots of bite, narrow window, harder to lean on.

Two direct levers:

- **Lower roll centre at the end that feels too “on the track”** — less geometric support, more rolled-in hold, calmer at higher grip. Which end depends on where the rotation is missing.

- **Add flex at the end that feels too sharp / locked** — it softens the effective roll stiffness and slows load arrival, usually making the car easier to drive as grip rises.

If you mean your logged car specifically, switch this chat onto a run with the subject bar and I can tie it to the actual setup.  
[[choices: Entry | Mid-corner | Exit | Everywhere]]

**Note:**

Roll center comment is good - flex I would argue should go the other way

---

## 2026-07-30T23:30:49.279Z — score 7/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cms858tpt001rk604htc9975v` · **Thread:** `cms82zvjr000vk604akmyiis1`
- **KB sections:** upper-link-geometry (vehicle-dynamics/upper-link-geometry.md), Toe gain (rear) (vehicle-dynamics/bump-steer-toe-gain.md), droop-downstop (vehicle-dynamics/droop-downstop.md), toe (vehicle-dynamics/toe.md), arb (vehicle-dynamics/arb.md), under-hub (vehicle-dynamics/under-hub.md), damper-oil (vehicle-dynamics/damper-oil.md), camber (vehicle-dynamics/camber.md), Rear caster (vehicle-dynamics/caster.md), spring-rate (vehicle-dynamics/spring-rate.md), roll-center (vehicle-dynamics/concepts/roll-center.md), camber-gain (vehicle-dynamics/concepts/camber-gain.md), bite-hold (vehicle-dynamics/concepts/bite-hold.md), on-in-track (vehicle-dynamics/concepts/on-in-track.md), toe-and-scrub (vehicle-dynamics/concepts/toe-and-scrub.md), bump-compliance (vehicle-dynamics/concepts/bump-compliance.md)
- **Prompt version:** `2026-07-30b+17619acd`

**Question:**

What should stiffer rear flex do to balance

**Answer:**

**Stiffer rear flex = less rear chassis twist**, so the rear suspension’s roll stiffness acts more directly.

- In **hairpins / quick direction changes**, it tends to make the rear take a set sooner, giving more rear bite and **less rotation**.
- In **long steady corners**, it can shift more load transfer onto the rear pair, so the rear has less hold and the car can **rotate more / feel freer**.

So it can go either way — the deciding factor is whether the corner is mostly **transient** or **steady-state**. It also gives up some bump compliance at the rear.

**Note:**

The answer is good, I agree with the balance opinion. The wording again could be better ( similar to previous response)

---

## 2026-07-30T23:27:13.192Z — score 5/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cms83eujk001kk604hmrpmryx` · **Thread:** `cms82zvjr000vk604akmyiis1`
- **KB sections:** upper-link-geometry (vehicle-dynamics/upper-link-geometry.md), droop-downstop (vehicle-dynamics/droop-downstop.md), under-hub (vehicle-dynamics/under-hub.md), toe (vehicle-dynamics/toe.md), arb (vehicle-dynamics/arb.md), damper-oil (vehicle-dynamics/damper-oil.md), camber (vehicle-dynamics/camber.md), spring-rate (vehicle-dynamics/spring-rate.md), under-lower-arm (vehicle-dynamics/under-lower-arm.md), Bump steer (front) (vehicle-dynamics/bump-steer-toe-gain.md), roll-center (vehicle-dynamics/concepts/roll-center.md), camber-gain (vehicle-dynamics/concepts/camber-gain.md), bite-hold (vehicle-dynamics/concepts/bite-hold.md), on-in-track (vehicle-dynamics/concepts/on-in-track.md), bump-compliance (vehicle-dynamics/concepts/bump-compliance.md), load-transfer (vehicle-dynamics/concepts/load-transfer.md)
- **Prompt version:** `2026-07-30b+17619acd`

**Question:**

How does flex work - what does it do to a touring car generally front and rear

**Answer:**

Chassis flex is the car’s **extra spring**: the plate/top deck twists before the suspension takes all the load. More flex effectively **softens that area of the car**, adds bump compliance, and makes load arrive a little slower.

- **More front flex**: softens the front’s effective roll stiffness, so front bite usually builds less sharply and the car can feel more rolled-in / forgiving. In longer corners it can help the front pair share load better, but it may also make initial steering less precise.

- **More rear flex**: softens the rear’s effective roll stiffness, so rear load builds later. In tight/transient corners that can let the car rotate more before the rear fully takes a set; in long steady corners it can also give the rear more hold.

- **Less flex / stiffer deck or more screws**: sharper load timing and cleaner response from that end, but less compliance over bumps and a narrower bite window if you go too far.

The big caution: flex is a broad lever. It changes effective stiffness and compliance together, so it’s powerful but less clean than a spring or ARB change.

**Note:**

Keep talking about ‘pair share load better’ sounds so confusing. Rework the wording. Also ‘rolled in’ isn’t a thing. ‘Rotate more before the rear fully takes a set’ sounds so confusing - could just be rotate for longer. ‘Sharper load timing / cleaner response’ all too vague - most people won’t connect with that ‘less clean’ should be ‘less predictable’

---

## 2026-07-30T22:34:23.074Z — score 5/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cms839t4n001dk604xj3xcsl2` · **Thread:** `cms82zvjr000vk604akmyiis1`
- **KB sections:** upper-link-geometry (vehicle-dynamics/upper-link-geometry.md), under-hub (vehicle-dynamics/under-hub.md), under-lower-arm (vehicle-dynamics/under-lower-arm.md), anti-dive-anti-squat (vehicle-dynamics/anti-dive-anti-squat.md), damper-oil (vehicle-dynamics/damper-oil.md), arb (vehicle-dynamics/arb.md), droop-downstop (vehicle-dynamics/droop-downstop.md), spring-rate (vehicle-dynamics/spring-rate.md), toe (vehicle-dynamics/toe.md), camber (vehicle-dynamics/camber.md), roll-center (vehicle-dynamics/concepts/roll-center.md), camber-gain (vehicle-dynamics/concepts/camber-gain.md), bite-hold (vehicle-dynamics/concepts/bite-hold.md), on-in-track (vehicle-dynamics/concepts/on-in-track.md), load-transfer (vehicle-dynamics/concepts/load-transfer.md), bump-compliance (vehicle-dynamics/concepts/bump-compliance.md)
- **Prompt version:** `2026-07-30b+17619acd`

**Question:**

Give me 5 levers for more hairpin steering

**Answer:**

For hairpins, think **transient steering**: the car needs to build front bite and/or let the rear rotate before the corner is over.

1. **More steering throw** — only if you’re physically running out of lock; it gives a tighter minimum radius but coarser control.

2. **More Ackermann** — gives the inside front more angle at high steering lock, which is directly relevant in tight corners.

3. **Slightly higher front roll centre** — more early/geometric front load transfer, so more front bite; too much can make the peak narrow and unforgiving.

4. **Less rear toe-in / less rear toe gain** — removes some rear stabilising scrub when the car is rolled or squatting, so it can rotate more easily.

5. **Stiffer front spring or front ARB** — can give earlier front authority in a hairpin, but can go the other way in longer steady corners, so judge it specifically in the tight stuff.

**Note:**

Think the ackermann is backwards - for hairpins you would want more steady state, not transient. Something about our steady / transient theory isn’t working together well

---

## 2026-07-30T22:21:34.663Z — score 5/10

- **User:** jordancaaruso@gmail.com
- **Message:** `cms82v3tx0005k604mix5zsu1` · **Thread:** `cms82t6id0003jt047mtfayyj`
- **Run:** `cmrlozh810003ho0a8or02khr`
- **KB sections:** upper-link-geometry (vehicle-dynamics/upper-link-geometry.md), Bump steer (front) (vehicle-dynamics/bump-steer-toe-gain.md), droop-downstop (vehicle-dynamics/droop-downstop.md), under-hub (vehicle-dynamics/under-hub.md)
- **Prompt version:** `2026-07-30b+17619acd`

**Question:**

How can I smoothen out initial steering

**Answer:**

Start with the **servo horn height** — the servo horn is the lever from the servo to the steering rack.

Try a **shorter horn than your current 17 mm** if you have one. The community median is also **17 mm**, so this is not “back toward typical”; it’s deliberately making the steering input softer than the common setup. A shorter horn moves the rack less per degree of servo movement, so the same hand input reaches the tyres more gently.  
**Prediction:** expect the first part of steering to feel smoother and less pointy; if the car just loses steering everywhere or won’t reach enough lock, revert it and reset endpoints.

If you want a smaller setup-sheet change instead, reduce front toe-out slightly: your **front toe is -1.2° vs -1.0° median**. Assuming your sheet uses negative as toe-out, try **-1.2° → -1.0°**.  
**Prediction:** expect less bite right at initial turn-in; if it becomes lazy but still snaps once loaded, toe wasn’t the main issue.

**Note:**

Servo horn height definitely not a first lever - front toe still going wrong direction, more negative is smoother

---
