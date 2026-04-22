## Camber

**Keys:** `camber_front`, `camber_rear` — camber is the **tilt of the tire relative to the ground** (angle in the wheel plane), usually measured static at ride height; **roll in cornering** changes the tire’s **effective** angle to the road.

**Mechanics:** **More negative camber** (top of tire inward) can help the **outside tire in roll** stay in a slightly **negative camber** attitude so the **contact patch** can produce **more peak lateral force** in many conditions. **Tire construction** dominates how much camber is optimal; the **best** camber for **maximum** grip **varies a lot** by tire. **Generally**, more camber tends toward **more peak lateral grip** until you pass the tire’s **usable window**, then **grip can fall off sharply**. **Less camber** often gives **less peak lateral force** but a **more progressive** slip curve.

**Corner phases:** Adding camber **to one end** tends to **add lateral grip at that end** when **lateral load** is highest — often clearest **mid-corner** when that axle is loaded. Under **heavy braking** or **hard acceleration**, the same tire is asked for **longitudinal** force; **more camber** can **reduce available longitudinal grip in theory** because the contact patch and stress state change—**balance can feel different** in those phases than in steady lateral load. **Tire and surface** matter most; **test**.

**Balance:** More camber at **one end** shifts **mechanical balance** toward that end in **lateral** phases; combine with the phase note above when you tune for **entry vs mid vs exit** vs **throttle**.

## Caster (front vs rear)

**Keys:** `caster_front`, `caster_rear` — **front and rear caster behave very differently**; do not treat them as the same knob.

**Front caster — mechanics:** Caster **angles the path** the wheel follows when steered. From the **side view**, with **zero caster** the wheel moves mostly **forward and back** in steer; with **caster**, the same steer adds a **small up-and-down** component to the wheel’s travel—how much depends on **kingpin / steering-axis geometry** on your car.

**Front caster — on track:** **More front caster** often **smooths response on entry** and can give **more steering mid-corner and on exit**, **particularly on throttle** (and the **reverse** when you reduce it). **More caster** can also make the car **harder to drive on throttle** in some setups — **tire, grip, and power** matter.

**Rear caster:** Often acts partly like a **small wheelbase** change (effective **distance between contact patches** shifts with the angle). It also **interacts with rear toe gain** — if you change rear caster, you may need to **re-trim toe / toe-gain shims** so the **bump toe curve** matches what you want. **More negative rear caster** (more negative in **your** sheet’s convention) often helps **faster rotation** when corners come **quickly** (e.g. **small tracks**); in **theory** it can also influence **forward traction on throttle**. **Flowing** tracks often move **toward less negative** rear caster for **stability** and drive off corners. **Net rotation** is an **outcome** of wheelbase, toe, and bump toe together—**verify**.

## Front toe

**Key:** `toe_front` — many **touring** setups are described with **front toe-out** (not toe-in). **Less toe-out** (closer to parallel, or “**more toe-in**” if you cross zero) tends to **increase response on turn-in**. **More toe-out** tends to **calm** or **delay** initial response. **Sheet numbers and signs differ by template** — confirm whether a **larger magnitude** on your sheet means **more** or **less** toe-out before comparing to other drivers.

**Bump steer** changes toe **through travel**; see **`bump-steer-toe-gain.md`** for `bump_steer_shims_front` and **measure** if static toe at ride height does not match on-track feel.

## Rear toe

**Key:** `toe_rear` — **more rear toe** (typically **more rear toe-in** in the usual convention) usually **increases rear grip** at the cost of **rotation** and often **corner speed** — a lot of rear toe can **hurt minimum corner speed** noticeably. It often feels **safer and easier**, especially **mid-corner to exit**. **Less rear toe** usually gives **more rotation** and **less rear grip**; the car is often **harder to drive** and less forgiving. **Extra rear toe** can add **tire heat** and, in **low-powered** classes, a little **mechanical drag** on straights—usually **secondary** to the handling tradeoff. Match changes to **tires**, **surface grip**, and whether you need **stability** or **rotation**.

**Static rear toe** vs **toe through bump** is set separately; see **`bump-steer-toe-gain.md`** for `toe_gain_shims_rear`.
