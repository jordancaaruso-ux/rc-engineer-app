# Changelog — RC PWM logger hardware

## Unreleased

- **Rev A (planned):** Initial 2-layer board: S3, USB-C, SPI NOR, 2× PWM divider sense, passthrough headers + jumpers, BLE-friendly layout.

### 2026-05-12 — Phase 1 schematic (in progress)

- **`V1.kicad_sch`:** Added **Phase 1** blocks via KiCad MCP: **J1** `VIN_IN`, **F1** PTC, **D1** SS34 reverse-polarity, **U2** **TPS62132** synchronous **3.3 V** buck (+ **L1**, **C1–C4**), **U1** **ESP32-S3-WROOM-1**, **J2** USB-C **USB2.0 16P** with **5.1 kΩ** CC resistors **R3/R4**, **UART** test points **TP1–TP3**, local **C5/C6**, **R1** buck `EN`, **R2** `IO0` pull-up, **GND** / **`+3V3`** / **`PWR_FLAG`** symbols.
- **`PINMUX.md`:** Documented **Phase 1** GPIOs for **UART0** (36/37), **USB** (19/20), and **IO0** strap; noted **`EN` simplification** to review before fab.
- **Note:** KiCad **ERC is not yet clean** (unused **U1** pins need **no-connect** or routing in Phases 2–4). Run **`kicad-cli sch erc`** after each edit; **Save All** in KiCad before trusting MCP readback.

Document each spin: date, JLC order #, what changed, what failed bring-up.

Made-with: Cursor
