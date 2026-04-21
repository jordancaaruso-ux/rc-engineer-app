## Roll centre basics

Roll centre (RC) height is a core geometry choice; the whole setup is built around it. A useful **first** split is **on the track** vs **in the track** (see below)—then use parameters to move between them.

## On the track vs in the track (driving style)

**On the track:** The car feels **responsive and reactive**, somewhat **high**, like it can **roll**; you often **calm** steering and throttle so it does not feel too nervous. Linked to **higher RC** and a **more angled** upper link (see **Flatter vs more angled**). You drive **within** the car a bit more.

**In the track:** The car feels **low**, **rolling down**, often **safer and smoother**; you can **push harder** and get on throttle with more confidence. Linked to **lower RC** and a **flatter** upper link. **Downside:** on **low grip**, it can feel **vague**, lack **precision**, and **fishtail** or not run straight on throttle.

**Upper link angle** is usually the strongest lever for this personality. Do not confuse **upper inner** (tower/bulkhead side of the **upper** link) with **inner lower arm** (chassis side of the **lower** link)—they are different pickups and different keys.

## Upper link: flatter vs more angled

**Flatter** upper link line (qualitatively closer to parallel with the lower link in side view): move toward **higher upper inner** *or* **lower upper outer**—either end can flatten the line.

**More angled** upper link: **lower upper inner** *or* **higher upper outer** (the opposite moves at each end).

Always judge **net** inner + outer together; do not treat one pair as the whole angle.

## Theory preface — upper link balance

The **next sections** are **theoretical**: they describe **what can or should** happen when you change **front vs rear** upper-link geometry and roll-centre balance. **Real feel does not always match**—grip, tires, bumps, dampers, and the rest of the car matter. **You must test on track**; use this as a map, not a guarantee.

## Upper link balance (front vs rear)

**Upper link balance** is the **relative** upper-link angle (and RC) **front vs rear**—many drivers treat it as the **fundamental** balance of the car. You adjust it by changing **front** upper link geometry **or** **rear**, **keeping the other end** similar, or moving **front and rear in opposite directions**. That shifts **roll-centre balance** between the axles—not just one corner in isolation.

## One axle upper link changes — balance vs the other end

If the diff changes **front** upper-link parameters (`upper_inner_shims_ff`/`fr` and/or `upper_outer_shims_front`) but **does not** change **rear** upper-link keys (`upper_inner_shims_rf`/`rr`, `upper_outer_shims_rear`), the **other** axle’s upper link is **unchanged vs compare**. You are moving **roll-centre balance**: the front’s RC and link angle **relative to** the rear—not only “what the front does” in isolation. Typical pattern when **raising front upper inner** (compare→primary): **lower front RC** on that end → often **less initial grip**, **smoother** turn-in and **over bumps**, grip that can **hold later** into the corner and **more mid-corner steering** tendency—while the **rear** still has the **same** upper-link geometry as before, so the **front vs rear** relationship follows the **upper link balance** and **per-end** theory sections above. The same logic applies **mirrored** if only the **rear** upper link changes.

When **both** ends appear in the diff, still judge **net** inner+outer **per axle**, then describe **balance** from the **relative** change front vs rear.

## Per end: flatter vs more angled (theory)

**The end with the less angled (flatter) link and lower RC** tends to: **less initial grip** on entry, **more grip mid-corner**; feels **more in the track** and often **handles bumps better**.

**The end with the more angled link and higher RC** tends to: **more initial grip** on entry, a **loss of grip mid-corner**, then **more again** as you **get on power** out of the corner; feels **stiffer, more on the track**, and often **worse on bumps**.

## Flatter front and opposite front/rear (theory)

A **flatter front** upper link often gives **smoother entry** and can **maintain grip later** into the corner. The **opposite** idea—**more angle / lower link at the front** and **flatter / higher at the rear**—can make the **front sharp into** the corner, then **give up a bit of front** mid / exit. If the balance goes **too far** that way and the **rear is too soft in roll**, you can **overload the rear** on throttle: **fishtail**, the car **won’t want to go straight** off the corner and may **keep turning** instead of driving away.

## Upper inner and upper outer shims — RC (canonical keys)

**Keys:** `upper_inner_shims_ff`, `upper_inner_shims_fr`, `upper_inner_shims_rf`, `upper_inner_shims_rr`, `upper_outer_shims_front`, `upper_outer_shims_rear`.

**This platform:** **Raising** the **upper inner** stack **lowers** RC on that corner (moves toward **in the track** in the sense above). **Lowering** **upper inner** **raises** RC (moves toward **on the track**). **Upper outer** changes the link line too—combine with inner for **net** flatter vs angled and **net** RC.

## Upper outer — raise vs lower (net with inner)

**Lowering** **upper outer** shims contributes to a **flatter** upper link at that end (see **Flatter vs more angled**). A **flatter** link there **tends toward lower RC** on that axle, not higher. **Raising** **upper outer** contributes to a **more angled** link and **tends toward higher RC**. Do not describe “flatter” as “higher roll centre”—that is backwards. On each end, state **net** inner + outer together before inferring handling.

## Lower arm — under lower arm shims (not upper inner)

**Keys:** `under_lower_arm_shims_ff` … `under_lower_arm_shims_rr`. These move the **inner pickup of the lower arm** (chassis side)—**not** the upper inner shims. They **raise or lower RC** on that corner by that lower pivot; state RC effects as **inner lower arm** or **under lower arm**, never as “inner” alone.

**Convention:** **Raising** this stack **raises** RC on that corner; **lowering** it **lowers** RC. Pair with upper-link changes when you change the whole triangle.

For **support** (how load is carried geometrically vs spring/ARB alone), **rear-biased** trade-offs, **soft at the limit** vs **over-support**, and **front** inner-lower tendencies (entry, mid–exit, bumps, understeer feel), see **`support-lower-inner.md`** in this folder.

## Axle height (under hub — outer lower shims)

**Keys:** `under_hub_shims_front`, `under_hub_shims_rear`. **Outer lower** = shims **under the hub**. Use for **initial vs overall** grip trim after upper link and inner lower arm. **Lower** hub stack → more **initial** grip; **higher** stack → more **overall** grip.

For **Step 4** — initial vs overall personality **by corner phase** (entry / mid / exit), see **`initial-vs-overall-grip.md`** in this folder.

## High roll centre — jacking and loose tracks

High RC adds **jacking** (car lifts in roll); overdriving can **jack up** or flip. On **loose** surfaces the extra bite can help **response**—with less margin if you overdrive.

## Low roll centre — lazy and fishtail caveat

Low RC is more **in the track** in feel; on **very low grip** the car can feel **lazy**; under power the rear may **fishtail** if the balance is too soft for the surface.

## Low front RC, high rear RC — handling

Smooth initial steering, good mid-corner rotation, rear **supports** on power while the front may **push** a little—often **forgiving**, lower flip risk.

## High front RC, low rear RC — handling

Sharp into the corner, less mid-corner steer, rotation from the **rear**; on power do not **overload** a soft rear—**fishtail** possible on **loose** tracks. Can be very fast but trickier.

## RC balance: order of adjustments

Tune **net** geometry: **upper inner + upper outer**, **under lower arm**, **under-hub** shims, link length. You mainly set **front/rear RC balance** with **upper link** and **inner lower arm** front and rear, then trim **initial vs overall** with hub and link length. You can later move **both** ends together to shift **on vs in the track** without changing the **front/rear relationship** as much.
