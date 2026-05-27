# RC PWM logger (hardware)

In-car logger for **receiver PWM driver inputs**: **steering** and **throttle/brake** (two servo-style channels; throttle/brake is typically **one** ESC channel on surface cars).

KiCad is the **source of truth** for schematic and PCB. This folder holds the KiCad project (`.kicad_pro`, `.kicad_sch`, `.kicad_pcb`) once created, plus human-readable specs for Cursor reviews.

## Frozen decisions (rev A baseline)

| Topic | Choice |
|--------|--------|
| MCU | **ESP32-S3-WROOM-1** (or **N8** / **N8R2** variant per stock); **KiCad 10.x** |
| `VIN` (BEC / RX rail) | **5.5 V–8.5 V** recommended operating; design for **6–8.4 V** typical; include **fuse or PTC** + **reverse-polarity protection** |
| 3.3 V rail | **Synchronous buck** preferred (BLE + flash peaks); **LDO-only** acceptable only if thermal headroom verified |
| USB | **USB-C** (UFP); **5.1 kΩ** CC pulldowns; **Native USB-Serial/JTAG** on S3 if used, **or** **CH340C** UART bridge (pick one in schematic—do not orphan unused USB pins) |
| PWM sense | **High-impedance passive tap** from receiver PWM through a divider/protection network to **≤3.3 V** ESP32-safe levels (**non-inverted**); document divider ratio in `PINMUX.md` after calc |
| Passthrough | **2×** channels: receiver signal must reach ESC/servo by **direct copper pass-through or external Y harness**; the ESP32 must never regenerate or gate the control signal |
| Storage | **ESP32 module flash / LittleFS** as the rev A log buffer; **no microSD** on rev A (reduces mech + FAT risk; BLE offload to phone). Add external NOR only if flash capacity or endurance testing requires it |
| Sample rate target | **200 Hz** logged effective per channel (firmware); informs SPI burst / BLE chunk sizing later |
| BLE | **Phone offload after run** (buffer on device, bulk transfer); layout: **module antenna keepout** per Espressif datasheet |
| Fab | **2-layer**, **0603** passives default, **JLCPCB** + **LCSC** MPNs on BOM where possible |

## No-lag control requirement

The logger is a **listener**, not a controller. Throttle and steering PWM must still pass normally if the logger is unpowered, crashed, rebooting, or being reflashed. Validate the prototype by comparing receiver-to-ESC/servo pulse timing with and without the logger attached; a passive tap should add effectively **0 us** of delay.

## KiCad project setup

1. **File → New Project** → save **into this directory** (`hardware/rc-pwm-logger/`) so paths align with git.
2. Follow build order in [KICAD_PHASES.md](KICAD_PHASES.md).
3. After each phase: run ERC; paste errors or screenshots into Cursor with [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md).
4. Before order: [FAB_CHECKLIST.md](FAB_CHECKLIST.md).

## Optional automation

See [OPTIONAL_MCP.md](OPTIONAL_MCP.md) for KiCad MCP (Cursor) — **optional**, not required for rev A.

## Firmware

Application code lives in [`firmware/rc-pwm-logger/`](../../firmware/rc-pwm-logger/) (PlatformIO skeleton). Hardware bring-up can proceed before firmware is complete.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

Made-with: Cursor
