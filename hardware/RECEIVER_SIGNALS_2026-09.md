# Receiver signals across radio brands, and what the logger's input must be

Research digest, 2026-09-11. Scope: what a passive in-car logger sees on the receiver's servo ports for
Sanwa, Futaba and Flysky (primary) and KO Propo and Spektrum (secondary), and the input design that
covers all of them. Nothing here is built. The rev A carrier in `rc-pwm-carrier/` was fabbed and never
tested; its two design faults are recorded at the end so they are not repeated.

Status tags: **CONFIRMED** = quoted from an official manual or spec; **INFERRED** = third-party
measurement, emulator source, or forum snippet; **UNKNOWN** = searched, not found.

## 1. The signal envelope

| Brand, mode | Wire signal | Frame period | Pulse width | Per channel? | CH3/CH4 |
|---|---|---|---|---|---|
| Sanwa NOR | PWM | ~10.5 ms (~100 Hz) | 1000–2000 µs, 1500 centre | yes, set at bind | NOR/SHR only |
| Sanwa SHR | PWM | 2.6 ms (~385 Hz) | 1000–2000 µs | yes | NOR/SHR only |
| Sanwa SSR | PWM | 2.6 ms | ~130–470 µs, 300–340 centre (CONFIRMED scope + emulator) | yes | NOR/SHR only |
| Sanwa SUR | PWM | ~1.25 ms (INFERRED, emulator) | same compressed range | yes | NOR/SHR only |
| Sanwa SXR (M17/M17S + RX-49x) | PWM | ~0.63 ms (INFERRED, emulator) | same ~300 µs centre | yes | NOR/SHR only |
| Sanwa SSL | serial, not on a CH port | ~2.6 ms | UART 115200 8N1, 10-byte frame `0x01` + 4×16-bit µs + checksum (INFERRED, reverse-engineered 2024) | – | CODE AUX consumes AUX1/AUX2 |
| Futaba T-FHSS normal | PWM | ~15 ms analog, 3 ms digital (333 Hz) | 1000–2000 µs | – | plain PWM; S.BUS2 port streams all channels ~15 ms |
| Futaba T-FHSS SR (R334SBS) | PWM | ~1–1.2 ms (~830 Hz, INFERRED) | ~760 µs centre (INFERRED) | yes, ON/OFF per channel | OFF channels stay normal; **S.BUS2 port is battery-only in SR** |
| Futaba F-4G UR (10PX/6PV + R404SBS) | PWM | UNKNOWN | UNKNOWN | yes, per port | S.BUS2 stays live with telemetry |
| Flysky AFHDS 3 standard | PWM | 50–400 Hz custom; 380 Hz default | 1000–2000 µs | receiver-wide | plain PWM; i-BUS/S.BUS on the serial port **only after** RX Interface Protocol is set |
| Flysky SR / SFR (enhanced RX: FGr4B, FGr8B, FGr4D) | PWM | 1.2 ms / 1.0 ms (833 / 1000 Hz) | "pulse range is changed"; ~760 µs centre (INFERRED) | receiver-wide | – |
| KO EX-NEXT NORM/MILD | PWM | ~300 Hz | 1500 centre | yes (TLMY RF mode only) | TWIN SERVO / 4WS mirror |
| KO EX-NEXT HCS | PWM | ~300 Hz | 375 µs centre, range compressed to ¼ | yes | – |
| Spektrum DSMR | PWM | 5.5 / 11 / 22 ms | 1000–2000 µs (INFERRED) | – | SRXL2 3.3 V 115200 8N1 half-duplex if exposed (UNKNOWN on surface RX) |

**Signal HIGH voltage:** UNKNOWN for Sanwa, Futaba, Flysky and KO PWM outputs (no manual states it,
no measurement found). Futaba S.BUS2 and Spektrum SRXL2 are documented 3.3 V. Design the input for
anything from 3.3 V to the receiver rail (up to 8.4 V).

## 2. Design rules that fall out of the table

1. **Never assume 1000–2000 µs at 50 Hz.** Store raw pulse width and frame period per sample. Classify
   the band from the measured neutral (≈1500, ≈760, ≈300–375 µs) so the app knows which family it is
   in, then calibrate end points in the app from the driver's full-left / full-right / full-throttle /
   full-brake, or from observed extremes.
2. **Time-stamp edges in hardware.** Sanwa SXR pulses are ~130–470 µs at ~1.6 kHz. A GPIO interrupt
   reading `micros()` has microsecond-class jitter and stalls during flash writes. The ESP32-S3 MCPWM
   capture module gives six channels at 12.5 ns resolution; RMT receive is the fallback.
3. **Input stage, per port:** series 2.2 kΩ → BAT54 clamp to +3V3 → 74LVC1G17 Schmitt buffer → GPIO.
   The LVC input tolerates 5.5 V and switches at ≤1.9 V, so 3.3 V and 5 V signals both read; the clamp
   covers a rail-level signal; the buffer's hysteresis cleans ringing on long servo leads. Load on the
   receiver line is ~5 pF and microamps. No pull-ups, nothing driven. **Rev A's 10 k/15 k divider fails
   on a 3.3 V receiver** (2.0 V is below the S3's 2.5 V threshold).
4. **Three identical 3-pin ports (S, +, −).** Same conditioning on each. Firmware decides per port:
   periodic pulses → PWM capture; dense byte-shaped edges → try UART 115200 8N1 (i-BUS header
   `0x20 0x40`, SRXL2 `0xA6`, Sanwa SSL `0x01`), then 100000 8E2 inverted (S.BUS `0x0F`). The S3 UART
   inverts RX and does 8E2 in hardware. Any port can be steering, throttle, a third channel, or a bus.
5. **Power from the + pin of any port:** PTC 1.1 A → SS34 → AP63205 5 V buck → SS34 → module 5 V pin.
   The XIAO's 5 V pin feeds a 5.5 V-max buck, so raw 6–8.4 V would kill it.
6. **Log by itself.** Start when a signal appears, split sessions on silence, flush continuously; a
   power cut must lose well under a second. Add rail voltage (two resistors) as a channel.
7. **Clock.** RV-3028-C7 RTC with a 0.1 F supercap or CR1220, set by the phone at every connect.
   App-side fallback: align the throttle pattern to the lap times already in the app.

## 3. What the driver plugs in, by brand

**Sanwa (M17/M17S, MT-R, MT-5, MT-44; RX-493/493i/492/492i/491/482/472).**
- NOR or SHR on CH1/CH2: JR-style Y-leads (the Sanwa "Z" housing matches JR/Hitec pinout; do not force a
  Futaba-tab plug into a Sanwa receiver).
- SSR/SUR/SXR on CH1/CH2: still PWM; the hardware capture reads the compressed pulses directly. Simpler
  alternative: mirror ST onto AUX via 4WS and TH onto AUX via MOA / AUX MIX / C-MIX, because CH3/CH4 only
  run NOR or SHR and so always carry 1–2 ms PWM. Not available when CODE AUX (SSL programming) is in
  use, since it consumes AUX1/AUX2.
- SSL users: the Super Vortex plugs into the BATT/SSL port, so the CH2 port is physically free. Plugging
  the logger's throttle tap straight into CH2 should work (CH2 is the documented port for non-SSL ESCs);
  **verify CH2 is live with an SSL ESC connected**. Never tap the BATT/BIND/SSL port itself: it carries
  battery and 115200 serial. The SSL frame is decodable in principle (experimental only).
- Sanwa FH5 receivers take no sensors; RPM/temp come from the ESC. SXR needs M17 fw ≥ 1.01.06.

**Futaba (10PX/10PXR, 6PV, 7PX, 4PM Plus, 3PV; R334SBS/-E, R404SBS/-E, R304SB, R314SB, R324SBS).**
- Normal T-FHSS / S-FHSS: one lead on the S.BUS2 port gives every channel (~15 ms frames, inverted
  100 kbaud), or Y-leads on CH1/CH2 (up to 333 Hz digital).
- SR ON (R334SBS): the S.BUS2 port becomes battery-only. Tap CH1/CH2 PWM (~760 µs centre, ~1 ms frame),
  or use Prog Mix (MST ST → SLV CH3, MST TH → SLV CH4) on channels left in normal mode.
- UR (F-4G): S.BUS2 stays live with telemetry, so the serial read works; UR pulse timing is unpublished,
  so capture and measure before promising PWM on UR channels.
- Sensors on S.BUS2 answer in slots after each frame; a listener still sees the `0x0F` servo frames.

**Flysky (NB4, NB4+, NB4 Pro/Pro+, Noble Mix due late 2026; FGr4, FGr4B, FGr4P, FGr4S, FGr8B).**
- PWM taps on CH1/CH2 at whatever servo frequency is set (95 / 380 / custom 50–400 Hz; 833 / 1000 Hz
  SR/SFR on enhanced receivers with a compressed pulse range).
- One-lead option: [RX SET] → [RX Interface Protocol] → i-BUS out (classic FGr4 has a separate serial
  port; on FGr4B/FGr8B it costs one CH port). Off by default. i-BUS frame rate under AFHDS 3 is UNKNOWN
  (7 ms on AFHDS 2A). Jordan's own kit is NB4 + FGr4: default 380 Hz PWM, i-BUS available via the menu.
- BVD (battery voltage) is a Flysky telemetry feature to the transmitter only; not useful to the logger.

**KO Propo (EX-NEXT family; KR-420XT/242XT/243XT).** PWM taps; HCS channels read as 375 µs-centre
compressed pulses; TWIN SERVO / 4WS mirrors ST onto CH3/CH4. The B/S port ICS serial is undocumented;
avoid.

**Spektrum (DX5 Pro discontinued, DX6C/DX3; SR6100AT/6110AT/315/2100).** PWM taps at 5.5 / 11 ms
frames. SRXL2 is an open 3.3 V 115200 protocol but its presence on surface receivers is UNKNOWN.

## 4. Who else does this (why the gap is real)

| Product | Logs | To phone? | Notes |
|---|---|---|---|
| Hobbywing XR10 Pro G2/G2S/G3 + OTA + HW Link app (2025) | throttle %, RPM, V, A, temps over time | BLE, local file | ESC-side throttle only; no steering; Hobbywing ESCs only |
| Tekin HotWire 3.0 | throttle PWM, V, ripple, temps, RPM | USB/BLE | Tekin ESCs only; 6–8 min memory |
| Sanwa M17 DATA-LOG / Futaba 10PX log | sensor telemetry to microSD, CSV | no | not the driver's inputs |
| TestLogger Collector Mini (€159) | 2 receiver channels, wheel speed, RPM, IMU | no, microSD to laptop | closest existing product |
| Open RC Spotter (open source, $169) | 3 PWM + GPS + IMU | SD / WiFi web app | GPS-heavy |
| Flysky FS-iBTA01 ($20, 2025) | receiver channel data every 20 ms to TXT | no, microSD | Flysky only |

Nobody hands steering + throttle traces to a phone tied to lap times and setup, brand-agnostic.
That is the slot. Video trace work (`docs/VIDEO_TRACE_NORTH_STAR.md`) is the other half of the same bet.

## 5. Open unknowns and how to close them on the first board

- PWM HIGH voltage: meter/scope on the FGr4 signal pin (Jordan's car), then any club member's Sanwa
  RX-493 and Futaba R334SBS. Design already covers 3.3–8.4 V, so this only confirms margins.
- Sanwa SUR/SXR and Futaba SR/UR pulse and frame timing: capture with the logger itself on a
  borrowed car; the raw-microsecond log is the measurement.
- i-BUS rate under AFHDS 3: read from the FGr4 serial port once enabled.
- Whether an SSL-connected RX-493 still outputs throttle PWM on the empty CH2 port.
- USB-stick mode (TinyUSB MSC, FAT) readable by an iPhone: try it; treat as bonus.

## 6. Rev B in one paragraph, and the rev A lessons

Carrier ~35×25 mm, JLCPCB Economic assembly, all top-side: Seeed XIAO ESP32S3 (21×17.8 mm, 8 MB flash,
order **pre-soldered headers**) in two 1×7 2.54 mm female sockets; three buffered 3-pin ports as in §2;
AP63205 buck + SS34 + PTC; RV-3028-C7 + supercap; optional LSM6DSO IMU (yaw rate + lateral G turn
driver inputs into car response; scope call). Sessions in module flash; offload by BLE through the
Capacitor plugin (iOS Safari still has no Web Bluetooth as of iOS 26.6), ~0.2–0.4 MB per 10-minute
session, 5–10 s on an iPhone. Volume upgrade later: bare ESP32-S3-MINI-1 on a custom board (Standard
assembly only, RF/USB layout owned by us).

Rev A lessons: (1) the 44 socket holes were drilled 0.8 mm from Espressif's footprint; 0.64 mm-square
header pins need ~1.0–1.1 mm — **check every through-hole drill and the socket row spacing against the
physical module before ordering** (XIAO rows are nominally 15.24 mm apart; confirm on Seeed's drawing);
(2) the 10 k/15 k divider assumed a 5 V receiver.

## Sources (fetched 2026-09-11)

Sanwa: sanwa-denshi.com receiver pages (RX-493i, RX-492i, RX-49T, RX-491, RX-482, RX-472), RX-492i and
RX-49T manuals, M17 manual (pp. 49–56, 79) and M17S manual (2024), SGS-02 gyro manual ("AUX response mode
is only available with NOR or SHR"), SV Stock SSL manual, RX/SX/ESC compatibility table; tsunekichi.blog.jp
scope captures (2019); rockcrawler.de SSL reverse-engineering thread (2024); TheDIYGuy999/Servotester_Deluxe
`servoModes.h`; AGFRC GY04M gyro spec. Futaba: T10PX manual (2021) and V2.0 update note (UR), R334SBS,
R304SB, R404SBS manuals, 4PM Plus manual (2022, "In SR mode, the S.BUS 2 port cannot be used other than
battery input"), 7PX manual (2018), futaba.uk radio-protocols page, BrushlessPower/SBUS2-Telemetry,
sigrok S.BUS decoder. Flysky: Noble NB4 Pro+ manual (©2024, §7.4, §7.6, §7.8, §7.13), FGr4 spec page,
FGr4B manual, flysky-cn.com sensor guide (2020), rcmart Noble Mix news (2026), FS-iBTA01 manual (2025).
KO Propo: EX-NEXT series manual (2021, pp. 18, 23, 34, 38, 63), kopropo.co.jp product pages. Spektrum:
SRXL2 Specification Rev K (github.com/SpektrumRC/SRXL2), SR6100AT manual, surface transmitter/receiver
charts. Parts: Nexperia 74LVC1G17 datasheet (Rev 16.1, 2024), TI SN74LVC1G17 (2025), ESP32-S3 datasheet
v2.2 (2026), ESP-IDF MCPWM/RMT/UART/spi_flash docs, Seeed XIAO ESP32S3 wiki + schematic v1.1 (SGM6029
buck, 1.95–5.5 V), Micro Crystal RV-3028-C7 datasheet, LCSC/JLCPCB part pages, caniuse Web Bluetooth,
capacitor-community/bluetooth-le changelog (8.3.0, 2026-08-13). Competitors: Hobbywing Data Record manual
(2025-07-28), teamtekin.com/datalogging, testlogger.com, github.com/jwachlin/open-rc-spotter.
