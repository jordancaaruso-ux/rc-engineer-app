# RC PWM Logger — Product Specification

## Purpose

Battery-powered logger that samples **steering** and **throttle/brake** (or equivalent) **PWM** from a surface RC **receiver**, stores compact binary sessions on device, and later transfers data to a **custom phone app** over **Bluetooth** (no live streaming required). The phone app can export CSV after download.

## Electrical environment

- **Connection:** Device is **only** intended to be powered and signaled from the **receiver servo bus** (same class of rail as **servos**, **ESC BEC-fed RX**, and typical **small RX accessories** / transponders). Not designed for **direct LiPo pack** as normal use.
- **Nominal rail:** **~6.0 V** or **~7.4 V** BEC settings (Hobbywing-class racing ESCs and similar). Expect **load-induced sag**, **BEC ripple**, and brief dips when servos stall or step load—same as other RX loads.
- **Reverse polarity:** **Required** on the logger’s **input harness** (user can miswire relative to the PCB).
- **PWM inputs:** **Two channels**, **common ground** with the receiver. Decode **standard RC PWM** (baseline **~50 Hz** frame period); log at **≥100 Hz** effective sample rate per product goal (implementation may oversample internally).
- **Control-path latency:** The logger must be a passive listener. Receiver PWM must reach the ESC/servo through a direct harness or copper pass-through, not through ESP32 firmware. The car must remain controllable if the logger is unpowered or rebooting.

## Harness / connectors

- **One integrated harness** that **fans out** to the receiver: **power + ground** from the RX rail and **two PWM signal** connections (e.g. steer + throttle), using the **0.1″ / 2.54 mm servo (JR/Futaba-style)** ecosystem for compatibility with **Flysky**, **Futaba**, and typical surface receivers.
- **Strain relief** at the logger enclosure; clear **silkscreen / wiring diagram** for **signal vs power** on each leg.

### On-board field connector `J1` (`Connector_Generic:Conn_01x04`, value `RX_TAP_HARNESS`)

Pin numbering follows the KiCad **Conn_01x04** geometry for the placed symbol (single row, **pin 1 = largest Y** on the schematic instance):

| J1 pin | Net (target) | Function |
|--------|----------------|----------|
| 1 | `CH1_RX` → divider → **`PWM_CH1`** | **Steering** PWM tap from RX |
| 2 | `VIN` (after `F1` / protection chain) | **+RX rail** (BEC) |
| 3 | `GND` | **Ground** (common with RX) |
| 4 | `CH2_RX` → divider → **`PWM_CH2`** | **Throttle / brake** PWM tap from RX |

Firmware / app copy should treat **CH1** / **CH2** as configurable labels if users swap plugs on the car.

### PWM level shifting (5 V RX → 3.3 V ESP32)

- **`R6` / `R8`:** **10 kΩ** series from `J1` pins **1** and **4** toward the divider tap.
- **`R7` / `R9`:** **15 kΩ** from each tap to **`GND`** (≈3.0 V when the RX output is ~5.0 V; adjust after measurement if your receivers run closer to 3.3 V logic).
- MCU nets are global labels **`PWM_CH1`** and **`PWM_CH2`**, routed to **`U1` `IO15` / `IO16`** (symbol pins **8** and **9**).

### Strapping / reset

- Global net **`EN_CPU`**: **`R5`** (10 kΩ) ties the module **EN** pin network for predictable bring-up (see schematic instance).

### Optional / DNP microSD `J4` (SPI to `U1`)

Rev A defaults to internal ESP32 flash plus BLE upload. `J4` is marked DNP/optional in the schematic and should not be treated as required for the first testable product.

| SD function | Schematic net (global) | `U1` signal | `U1` symbol pin | Notes |
|-------------|------------------------|-------------|-----------------|--------|
| CLK | `SD_CLK` | `IO12` | 20 | SPI SCK |
| CMD (MOSI) | `SD_CMD` | `IO11` | 19 | SPI MOSI |
| DAT0 (MISO) | `SD_MISO` | `IO13` | 21 | SPI MISO |
| DAT3 / CS | `SD_CS` | `IO10` | 18 | SPI CS (DAT3 pin in SPI mode) |
| VDD / VSS | `+3V3` / `GND` | `+3V3` / `GND` | 40 / `TP3` | 3.3 V socket supply |

`DAT1` / `DAT2` / `DET` / shield still need footprint-specific treatment (`no_connect`, pull-ups, card-detect GPIO, shield tie)—finish when the exact microSD socket symbol/footprint is locked before PCB sync.

## Data & sessions

- **Format on device:** compact binary records; app may convert to **CSV** for user export.
- **Timebase:** **Relative** timestamps acceptable (monotonic ms/µs since session start or boot).
- **Max single session:** **~1 hour** of logging must be supported at the chosen sample rate and column set.
- **Retention:** Store **multiple** sessions between uploads if flash capacity allows; prefer onboard ESP32 flash first, with microSD/external flash only if measured run capacity requires it.

## Wireless & host

- **Upload path:** **Bluetooth** to a **custom** mobile app (session list, download, delete/ack). USB may exist for **bench / development** but is not the primary field story.

## Mechanical & environmental

- **Target placement:** **Thin** profile suitable for **double-sided tape** mounting **under** a **1/10 touring** receiver or **neatly around** it.
- **Indicators:** At least one **LED** (or RGB) for **power / logging / BLE / fault** states (exact UX TBD).
- **Environmental goal:** **Splash-resistant** where practical; operating ambient up to **~60 °C** (treat as design class; formal IP rating TBD).

## Regulatory / productization

- **Phase 1:** Internal / hobby use.
- **Future:** Possible **low-volume sales** (order-of **hundreds/year**). When approaching retail: emissions (e.g. **BLE**), labeling, instructions, and LiPo safety copy become relevant.

## Milestone (hardware + firmware alignment)

Logger **captures two PWM channels**, **records to nonvolatile storage**, and can **export** the same data to the **custom app** via **Bluetooth**—**no** requirement for **live** telemetry streaming.
