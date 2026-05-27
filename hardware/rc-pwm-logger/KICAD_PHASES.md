# KiCad build phases (PWM logger)

Do **not** start PCB routing until the **current phase schematic passes ERC** with zero unexplained errors.

## Phase 1 — Power + programming + minimal MCU

- [x] `VIN`: connector **J1**, **PTC F1**, **series Schottky D1** (SS34-class) reverse-polarity, bulk **C1**/**C2** on `VIN`.
- [x] **3.3 V** synchronous buck **U2 = TPS62132** (fixed 3.3 V); **L1**, **C3**/**C4** output network; **R1** pulls `EN` to `VIN`.
- [x] **ESP32-S3-WROOM-1** **U1** + local decoupling **C5**/**C6**; common **GND** return to buck + USB shell.
- [~] **EN** / **IO0**: **IO0** has **R2 10 kΩ** to `+3V3`. **`EN` is currently tied to `+3V3` in the schematic for bring-up** — refine to **RC + reset** per Espressif reference before fab if desired (native USB, no CH340).
- [x] **USB-C** **J2** (`USB_C_Receptacle_USB2.0_16P`): **GND**/`VBUS` handling per USB2 footprint; **CC1/CC2** **R3/R4 = 5.1 kΩ** to **GND**; **D+/D−** to S3 **GPIO20/19**; **SBU**/**VBUS** unused nets marked **no-connect** at connector for rev A.
- [x] **UART test pads** **TP1**/**TP2**/**TP3** (`U0TX` / `U0RX` / `GND`).

**Exit:** Run **ERC**; fix all errors; export **PDF schematic** of this sheet for Cursor review. **Status (2026-05-12):** schematic captured in **`V1.kicad_sch`** via KiCad MCP; **ERC still reports many unconnected MCU pins** — add **no-connect** markers (or intentional nets) for all unused **U1** IOs in KiCad until **0 errors**, then export PDF.

## Phase 2 — SPI NOR flash (logging buffer)

- [ ] **W25Q128JV** (or chosen LCSC part) on **SPI** bus: `CLK`, `MOSI`, `MISO`, `CS`; verify pins do not conflict with **USB**, **strapping**, or **internal flash** pins on module.
- [ ] Decoupling on flash VCC; short traces.

**Exit:** ERC clean; update [PINMUX.md](PINMUX.md) with real GPIO numbers.

## Phase 3 — 2× PWM passthrough + sense

- [ ] Headers: **GND**, **SIG** (`PWMx_IN` / `PWMx_OUT` per harness doc), **`VIN` tap** only if you truly need pin 3 power passthrough—match Open RC pattern if used.
- [ ] **Solder jumpers** `JP1`/`JP2` (or net ties) for **IN↔OUT** bypass.
- [ ] **Resistor dividers** only (per README): `PWMx` → node → `PWMx_SNS` to MCU; **no 5 V** on MCU pins.

**Exit:** ERC clean; annotate **max servo voltage** on silk.

## Phase 4 — UI

- [ ] Tact **button** (with debounce RC or firmware-debounced input).
- [ ] **LED** + series resistor on chosen GPIO (not a strapping pin).

**Exit:** ERC clean full hierarchical schematic.

## Phase 5 — PCB layout

- [ ] Board outline, **mounting holes**, **keepout** under **ESP32 antenna** (per module drawing).
- [ ] Place **USB** near edge; **short** USB diff pairs; reference ground pour under S3.
- [ ] **DRC** against JLC rules (clearance, trace width, drill).
- [ ] **Courtyard** spacing; **fiducials** if JLC assembly.

**Exit:** DRC 0 errors; export Gerber + BOM + CPL; run [FAB_CHECKLIST.md](FAB_CHECKLIST.md).

Made-with: Cursor
