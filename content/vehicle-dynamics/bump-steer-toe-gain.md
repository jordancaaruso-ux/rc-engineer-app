## Bump steer (front)

**Key:** `bump_steer_shims_front` — bump steer shimming on the **front** of the car.

**Convention (this platform):** **More shims → more bump-in** on compression. **Fewer shims → more bump-out** on compression. **Per-car setup sheets** document how many shims mean what for **your** chassis; do not assume the same count as another platform.

**Mechanics:** The **toe link** sets how toe changes with wheel travel. When the link is **angled more upward toward the wheel**, it **shortens more in compression** for a given bump stroke, pulling that side’s wheel **toward the car centerline**—**toe-in through bump** if that is the linkage layout’s sign. Shim stacks **change that angle**; the **magnitude and sign** of bump steer still depend on **instant centre**, **steering axis**, **ride height**, and **roll**, so **shim count alone does not equal** a fixed bump-in or bump-out number—**measure** toe at **ride height** vs **full compression** (toe per mm travel) when you need truth.

**On track — compression:** **More bump-in** on compression makes turn-in **more aggressive**: stronger **response on entry** and bite. **More bump-out** on compression makes steering inputs feel **calmer** and the car **slower to react** to quick direction changes. **More bump-in** tends to feel **harder over bumps** and more **nervous**; **more bump-out** on compression tends to feel **smoother and easier**, but can feel **lazy** if you need sharp attack. If the car was **very lazy**, a bit more bump-in can still feel **more precise**.

**Throttle / extension:** Behaviour **reverses** when load comes off the **outer** front. **Bump-in on compression** usually goes toward **bump-out on extension**, so the car can **want to go straighter off the corner** on throttle. **Bump-out on compression** can go toward **bump-in on extension**, which can feel like **more turn on throttle** off the corner.

**Baseline:** **Roughly neutral** measured bump is common; many cars run deliberate bump-in or bump-out for the balance they want.

## Toe gain (rear)

**Key:** `toe_gain_shims_rear` — toe gain shimming on the **rear** of the car.

**Convention (this platform):** **More shims → more bump-out / toe loss on compression**. **Fewer shims → more bump-in / toe gain on compression** (more rear **toe-in** as the wheel compresses). **Per-car setup sheets** define stack direction for your chassis.

**Mechanics:** Rear **toe gain** uses the same idea as front bump steer: the **toe link angle** sets how much the link **shortens or lengthens** in bump and therefore how **rear toe** moves with travel. **More toe gain** here means **more rear toe-in on compression** when the linkage is arranged that way. On **entry**, if the **rear** is **extending** (load transfer off the outer rear), toe typically **moves the other way** vs a compressed outer rear in mid-corner.

**On track:** **More toe gain** (more rear toe-in in bump) usually **adds rear grip**, mainly **mid-corner through exit**, when the **outer** rear is **compressed** and carries more dynamic toe-in. Drivers often report **more sustained rear grip**, a **more stable** and **easier** car, and a tendency toward **understeer** from **mid-corner to exit**, **especially on throttle** — platform and tires matter; **test on track**.

**Static vs bump:** Sign of **toe gain** vs **static** rear toe depends on **full link geometry**; shims describe the **bump curve**, not static toe at ride height alone.
