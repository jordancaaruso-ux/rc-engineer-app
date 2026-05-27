# Fab gate (before JLCPCB order)

Complete **all** items; do not waive without writing the reason in [CHANGELOG.md](CHANGELOG.md).

## KiCad exports

- [ ] **ERC:** 0 errors (or each waiver documented).
- [ ] **DRC:** 0 errors against **JLC 2-layer** capabilities (clearance, drill, min track).
- [ ] **Gerber RS-274X** zip exported.
- [ ] **BOM CSV** exported.
- [ ] **Pick & Place (CPL)** exported for SMT if ordering assembly.

## External validation

- [ ] Upload Gerbers to a **viewer** (e.g. [tracespace.io](https://tracespace.io)) — inspect **each copper layer**, **mask**, **drills**, **outline**.
- [ ] Run **JLCPCB DFM** / pre-order checker on the same zip; fix flagged issues.

## BOM quality

- [ ] Every **SMT** line has **LCSC C** number (or is intentionally **hand-solder** with note).
- [ ] **ESP32-S3-WROOM-1** footprint matches **exact** module variant you will buy (pin 1, keepout).
- [ ] **SPI NOR** package and voltage match 3.3 V design.

## Golden checks

- [ ] [PINMUX.md](PINMUX.md) matches **schematic net labels** 1:1.
- [ ] **Strapping pins** re-read against current **Espressif** doc for your chip revision.

Made-with: Cursor
