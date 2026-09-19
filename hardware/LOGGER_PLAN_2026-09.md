# Receiver logger - rough plan forward

Written 2026-09-19 from a discussion with Jordan. This is a rough plan, not a spec. Nothing in it
has been started. The evidence behind the input design lives in `RECEIVER_SIGNALS_2026-09.md`
(same folder). `docs/PRODUCT_NORTH_STAR.md` still lists the logger as a later bet; the Engineer
launch on 1 October 2026 comes first.

## What it is

A small box that sits beside the receiver, listens to the steering and throttle signals without
ever being in their path, records them, and hands the recording to the phone over Bluetooth after
the run. The app matches the recording to the run by time.

Safety rule, inherited and non-negotiable: **listener only.** The car must drive identically with
the logger present, absent, unpowered or rebooting.

## Decided (Jordan, 2026-09-19)

- **Phone link: Bluetooth through the iOS app.** Not the Safari/PWA version (Safari has no
  Bluetooth). Not USB-stick mode.
- **As small as possible.** It sits beside the receiver.
- **His own car first** (Flysky Noble NB4 + FGr4). Selling it is a later question. We still keep
  the radio-approved brain module and the three any-radio ports, because they cost nothing and
  keep that door open.
- **Fully custom board is the direction** - meaning our own board with a ready-made, radio-approved
  brain module soldered on by the factory. Never a bare chip with our own antenna.
- He **still has the ESP32-S3 dev board** from the first attempt.

## Still to decide (needed before board layout)

- Motion sensor on the board: yes or no. Advice given: yes, record it raw, promise nothing in the
  app yet. It reads g-force in three directions and rotation speed in three directions. It cannot
  read speed or position.
- USB-C socket on the board, or a clip-on programming cable (smaller, but fiddlier to rescue a bad
  update).
- Raised 2026-09-19, not decided: a second listen-only tap on the **motor sensor cable** to read
  motor speed. With the turning-speed sensor that would give a speed trace and an approximate
  driven line with no camera. Costs one more small connector. Cheap to try at step 1.

## The steps

Each step has a "done when". Nothing moves to the next step until the one before it passes.

**Before 1 October - nothing gets built.** Optional prep only:
- Install KiCad and PlatformIO (both free). Checked 2026-09-19: neither is on this PC.
- About $15 of leads: one servo Y-lead, one male-to-male servo lead, plug-in jumper wires, a small
  plug-in breadboard. No soldering.
- One multimeter reading on the FGr4 signal pin (settles the 3.3 volt question).

**Step 1 - bench proof on the dev board he owns.**
Rewrite the chip software: time every pulse in hardware, start recording on its own when the
receiver wakes, store raw numbers. Car on a stand, dev board plugged into the receiver with the
jumper wires.
Done when: a graph of his real steering and throttle is on the laptop.

**Step 2 - phone link, still on the dev board.**
Add Bluetooth to the iOS app (no Bluetooth plugin or permission text exists in the app today) plus
a plain hidden screen only he sees: find the logger, pull the recording, show the graph. Needs a
TestFlight build and his iPhone; Bluetooth cannot be tested without real hardware.
Done when: a recording lands on his phone in a few seconds, and the phone has set the logger's clock.

**Step 3 - design the board (alongside step 2, only after step 1 passes).**
1. Check for the smallest brain module that can still time the pulses properly.
2. Schematic, layout, error checks, pictures for Jordan to look over.
3. Print the board at real size on paper and hold a real servo plug against it. (The first board
   failed on a hole size nobody checked against the real pin.)
4. Order five from JLCPCB, fully assembled.
Target size roughly 16 x 30 mm with parts on both sides. Receiver-style three-pin servo ports laid
flat along one edge; power comes up the servo lead; antenna end kept clear of carbon fibre.
Done when: a board arrives, programs, and repeats step 1's graph.

**Step 4 - attach recordings to runs.**
Match each recording to the right run by time, visible to him only. Where it sits on the run page
is a design conversation first.

**Step 5 - first track day.**
Tape it beside the receiver, log a whole day, pull each run in the pits.
Then decide whether the data earns its place: what the Engineer does with it, whether to sell it.
Deliberately not planned yet.

## Money and time

- Leads: about $15.
- Each board round: roughly US$100-150 and two weeks. Plan on two rounds.
- All up: about US$250-300.

## Risks, plainly

- Steps 2 and 5 move at Jordan's pace - he is the hands for anything involving the phone or the car.
- A second board round is likely.
- The north star says hold this for a year or more. Steps 1 and 2 cost almost nothing and undo
  cleanly; the board order is the first real money and gets a fresh decision at that point.

## Lessons from the first board (rev A, July 2026)

- The 44 socket holes were drilled 0.8 mm from a vendor footprint; the real pins need about 1.0 mm.
  It never fitted.
- The input resistors assumed a 5 volt signal. The FGr4 speaks 3.3 volts, so it would have recorded
  nothing even if it had fitted.
- Both were checking failures, not difficulty. Every footprint gets checked against the maker's
  drawing and a real part before anything is ordered.
