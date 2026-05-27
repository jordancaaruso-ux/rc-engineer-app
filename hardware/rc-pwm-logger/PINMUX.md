# ESP32-S3 pinmux (draft — fill after schematic lock)

**Module:** ESP32-S3-WROOM-1 (**N8** class BOM on rev A schematic `V1.kicad_sch`; update if you stock **N8R2** or other flash/PSRAM variants).

Update this table so every routed net matches KiCad. **Do not leave strapping pins floating or mis-driven.**

## Rules of thumb (verify against [ESP32-S3 datasheet](https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf))

- **SPI flash** is **internal** to the module; do not use **GPIO26–37** for external circuits on typical WROOM modules (flash/PSRAM).
- **USB-Serial/JTAG** uses **GPIO19 (D-)** and **GPIO20 (D+)** for native USB (if you use USB device mode).
- **Strapping:** **GPIO0**, **GPIO3**, **GPIO45**, **GPIO46** have boot / ROM strap requirements — follow datasheet Table “Strapping pins”.
- **PWM capture:** use input-only firmware behavior on RMT/interrupt-capable GPIOs. The logger is only a high-impedance tap; receiver PWM must not pass through ESP32 firmware or any active re-driver.

## Pin assignment table (Phase 1 routed — rest TBD until Phases 2–4)

Values below match **`V1.kicad_sch` as of 2026-05-12** (native USB, no CH340). Re-verify strapping against the **exact** module ordering you assemble.

| Net / function | ESP32-S3 GPIO | Peripheral | Notes |
|----------------|---------------|------------|--------|
| `UART0_TX` | **37** (`TXD0`) | UART0 | Test pad **TP1** (`U0TX`); no CH340 on rev A |
| `UART0_RX` | **36** (`RXD0`) | UART0 | Test pad **TP2** (`U0RX`) |
| `USB_DM` / `USB_D-` | **19** | USB OTG | From **J2** through symbol pins `USB_D-` / `IO19` |
| `USB_DP` / `USB_D+` | **20** | USB OTG | From **J2** through symbol pins `USB_D+` / `IO20` |
| `LOG_FLASH` | internal module flash | LittleFS | Primary rev A storage; no microSD/external flash by default |
| `PWM_CH1` / `PWM1_SNS` | **15** | GPIO interrupt / RMT candidate | Steering PWM after high-impedance divider tap |
| `PWM_CH2` / `PWM2_SNS` | **16** | GPIO interrupt / RMT candidate | Throttle/brake PWM after high-impedance divider tap |
| `BUTTON` | TBD | GPIO in | **Phase 4** |
| `LED_STATUS` | TBD | GPIO out | **Phase 4** |
| `EN` | EN (pad) | — | **Bring-up note:** schematic ties **module `EN` to `+3V3`** for early ERC closure; replace with **Espressif-style RC + optional reset** before fab if you want stricter reset behaviour. |
| `IO0` / boot strap | **0** | — | **R2 = 10 kΩ** to `+3V3` on **IO0** (module pin **27** on KiCad `RF_Module:ESP32-S3-WROOM-1` symbol) |

## Divider math (placeholder)

For **5 V** max servo high into **3.0 V** max at MCU pin (conservative under 3.3 V):

- Example: **R_top = 10 kΩ** (PWM → node), **R_bottom = 15 kΩ** (node → GND) → **V_node ≈ 3.0 V** at 5 V in.

Recompute for your chosen **high** voltage (some radios go slightly over 5 V) and **ESP32 Vih**; update values here and match schematic **exactly**.

Made-with: Cursor
