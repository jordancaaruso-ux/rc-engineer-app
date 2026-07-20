# Ordering the carrier board — click-by-click (JLCPCB)

Everything you upload lives in `output/jlcpcb/`:

| File | What it is |
|---|---|
| `carrier-gerbers.zip` | The board artwork + drill files |
| `carrier-bom.csv` | Parts list (what to solder) |
| `carrier-cpl.csv` | Placement list (where each part goes) |

Time: ~15 minutes. Cost: roughly **$60–90 for 5 boards, all parts soldered**, delivered AU.

---

## Steps

1. **jlcpcb.com** → sign in (create account with any email) → big **"Add gerber file"** button → upload `carrier-gerbers.zip`.
2. It detects a 2-layer 72×47mm board. Leave every option at default (Qty 5, 1.6mm, green, HASL). Nothing here needs changing.
3. Toggle **PCB Assembly** ON →
   - Assembly side: **Top side**
   - Economic assembly
   - Qty: 2 or 5 (2 assembled + 3 bare boards is cheapest; 5 assembled ≈ $15 more)
4. **Next** → upload `carrier-bom.csv` and `carrier-cpl.csv`.
5. **Parts matching page.** Rows with an LCSC number auto-match. Four rows are left for you to pick (I couldn't verify live stock — their picker makes this a 30-second search each):
   - **15k resistor** → search `15k 0603 1%` → pick the **Basic** part (usually first result)
   - **PTC fuse** → search `1812 PTC 1.1A` → pick any ≥16V hold-1.1A part
   - **Pin header** → search `pin header 2.54 1x3` → pick a vertical male header ("Extended" is fine)
   - **Socket 1x22** → search `female header 2.54 1x22` → pick one; **if nothing 1x22 exists**, search `1x22` variants or message me — fallback is they ship the board without sockets and any local repair/hobby shop solders 2 strips in 5 minutes
6. **Component placement preview.** Sanity-check with the render `output/board-top.png` open beside it:
   - Diodes **D1, D2**: the stripe (cathode) faces **east** (toward the right board edge)
   - **U2** (6-pin chip): pin-1 dot at top-left
   - If anything looks rotated, use their rotate buttons — JLC's reviewer also fixes obvious polarity errors, but don't rely on it
7. **Save to cart** → pay. Pick a courier (DHL/FedEx ~1 week to AU; economy saves ~$10, adds ~2 weeks).

## While it ships (separate orders, do today)

- **ESP32-S3-DevKitC-1 N8** ×2 — [Core Electronics](https://core-electronics.com.au/esp32-s3-devkitc-1-development-board.html) (~$25 ea)
- **Servo Y-leads ×2 + extension leads** — links in `../rc-pwm-logger/PROTOTYPE_BOM.csv` rows 2–3 (~$15)

## When the box arrives

1. Push the dev board into the sockets — USB connectors face the **west** edge (matches the white outline on the silkscreen; the antenna end overhangs the east edge).
2. Plug USB-C into the dev board, and we flash `firmware/rc-pwm-logger` (I'll drive; PlatformIO is already set up on this machine).
3. Bench test per `../rc-pwm-logger/PROTOTYPE_TEST_CHECKLIST.md` — servo tester or spare receiver before it ever touches the car.

## Safety reminder

The logger is a **listener**: servo Y-leads at the receiver, logger on the spare branch.
The car must drive identically with the logger present, absent, or dead — that's
test section 6/7 in the checklist and it gates any car use.
