# Cursor review checklist (after each KiCad phase)

Paste **KiCad version**, **phase name**, and **ERC/DRC text or screenshot** into Cursor. Ask explicitly: *“Review for fatal flaws only.”*

## Power / `VIN`

- [ ] **Reverse polarity** or **ideal diode** path cannot back-feed USB host dangerously (understand **ORing** if dual inputs).
- [ ] **Max `VIN`** on caps and regulator **≥** worst-case car voltage (e.g. fresh 2S if users tap pack).
- [ ] **Regulator** can supply **peak** current (ESP32 TX/Radio + SPI flash burst); bulk caps placed **close** to S3 and flash.

## ESP32-S3 strapping / boot

- [ ] **GPIO0**, **GPIO3**, **GPIO45**, **GPIO46** (and any other straps) match **datasheet** for **SPI boot** / **download mode** / your UART bridge.
- [ ] **EN** RC network and **auto-reset** do not hold chip in reset.
- [ ] **No 5 V** on any S3 GPIO (including **USB** level shifters if any).

## USB

- [ ] **CC** resistors present for **UFP** device.
- [ ] **D+/D−** pair **matched length** / **impedance** reasonable for 2-layer (or use chip vendor layout note).
- [ ] **ESD** optional but nice on USB lines to connector.

## PWM sense

- [ ] Divider **cannot** exceed **3.3 V** (or 3.6 V abs max per spec) at **worst-case high** PWM voltage.
- [ ] **Common ground**: RX/servo GND must tie to logger GND at harness (single reference).
- [ ] If you ever use **FET inverter** instead of divider: firmware **polarity** documented.

## SPI flash

- [ ] **CS/CLK/MOSI/MISO** do not steal **strapping** or **USB** pins.
- [ ] Not conflicting with **module internal QSPI** pins (do not route external lines to **forbidden** module pins).

## BLE / RF

- [ ] **No copper** / **no components** under **antenna keepout** per **WROOM** drawing.
- [ ] **GND pour** and **stitching vias** near module; avoid long skinny GND returns from S3 to USB.

## Mechanical

- [ ] **Connector** orientation and **strain relief** holes if servo headers.
- [ ] **Silkscreen** readable: `VIN`, `GND`, `PWM1`, `PWM2`, `USB`.

Made-with: Cursor
