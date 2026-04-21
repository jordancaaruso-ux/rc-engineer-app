## Grip, load transfer, and balance

**Grip** is limited by how much **lateral (or longitudinal) force** each tire can produce. **Load transfer** moves vertical load between tires; **unequally loaded tires** cannot add force in proportion to load at every instant, so the axle’s **usable** grip depends on how load is shared.

**Suspension and geometry stiffness** (roll stiffness, anti geometry, chassis flex where relevant) set how **fast** load moves when the driver steers or the car rolls: **stiffer** paths usually mean **less roll** and **faster load transfer**; **softer** paths mean **more roll** and **slower load transfer**.

**Front–rear balance** of **response** vs **sustained grip** (see next section) is what tends to move the car toward **understeer** or **oversteer** at the limit: if one end **dominates** lateral capacity in a phase of the corner, the other end can be **overpowered** and slide first.

Low-grip surfaces often reward a slightly **freer** car so the tire is not overloaded in quick transitions. High-grip tracks often tolerate **more** spring and damping to keep the **platform** stable through direction changes—**tire, surface, and layout** still matter.

## Response versus sustained grip

**Response** here means **lateral bite tied to quick load transfer** right after a steering input or as roll starts: the car **reacts** soon, with a **strong early peak** of side force if the tire and geometry allow it.

**Sustained grip** here means **lateral force that holds later** in the same corner maneuver—through mid-corner roll and steady curvature—often with a **smoother**, **more rolled-in** feel at the limit.

**Stiffer** roll control (springs, ARBs, geometry that speeds transfer) often **adds response**: load moves quickly, so the car **bites** soon after input. **Softer** roll control often **adds sustained grip** in many setups: the tire stays in a **usable slip window longer** through the movement, at the cost of a **slower** or **less aggressive** early reaction.

Not every change splits **response** and **sustained grip** clearly—**stiffness** (springs, bars, damping that changes roll rate), **roll centre**, and **flex** are the usual levers that **do**; other adjustments are better read from their own KB sections.

For **trim** between these two tendencies on one axle (hub height, RC balance), see **`roll-centre.md`** and **`response-vs-sustained-grip.md`**.

## Mid-corner understeer

First separate **corner type** and **phase**: **hairpin / low-speed** vs **high-speed**, and whether the problem is truly **mid-corner** or partly **lack of response on entry** that the driver **reads** as push through the whole corner.

**Hairpins — sustained front limit:** If the front **stops building steering** mid-corner after a reasonable turn-in, the front may lack **sustained grip** relative to what the corner asks—often linked to the front being **too stiff** in roll for that tire and surface, so the tire **peaks early** and then **won’t add** side force as roll continues. Think in terms of **more sustained front grip** (softer front roll path, geometry that supports it—see **`spring-rate.md`**, **`droop-downstop-arb.md`**, **`roll-centre.md`**) before large rear-only changes.

**Hairpins — rear limiting rotation:** If the rear **will not roll and rotate** through the corner, it may be **too stiff** in roll for low speed, so the car **cannot use rear roll** to help yaw. The **opposite** case also happens: the rear has **so much sustained grip** relative to the front that it **stays planted** while the front is already past its peak—**mid-corner push** from **rear grip bias**, not front lack alone. **Context** (which end changed, tire, droop) picks between these.

**Response vs sustained misread:** **Weak response** on entry (front bites late after steering) can feel like **continuous understeer** into mid-corner even when the **sustained** balance is different. **More front stiffness** can **feel** like more steering in some corners, but in **tight hairpins** **more sustained front grip** is often what adds **real mid-corner steering**. Sort **entry** vs **true mid** before choosing levers.

**High-speed mid-corner** overlaps the same ideas but **response** matters over a **longer effective entry**: approach speed makes the **early phase** of the corner large in time and distance. Lack of **response** is a **common** cause of “high-speed push”; lack of **sustained** front grip **also** happens—use tire marks, steering trace, and whether the front **keeps working** after the first third of the corner to tell them apart.

## High-speed understeer and aero

At **high sustained lateral** load, **aero balance** matters strongly: if the **front aero** is weak **relative to the rear** for the speed and wing setup, the car can feel as if **mechanical balance changes barely move** the push—**more front downforce relative to the rear** (within rules and practicality) is often required for **more high-speed steering**, not only softer front springs.

**Damping** and **nose pitch** still matter (keeping the front loaded in long corners); see **`damper-oil.md`** before jumping to large spring-only changes when the issue is clearly **speed-dependent** and **aero-limited**.
