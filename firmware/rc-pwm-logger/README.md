# RC PWM logger — firmware

PlatformIO project targeting **ESP32-S3** (default: `esp32-s3-devkitc-1`; change `board` in `platformio.ini` if needed).

## Build

```bash
cd firmware/rc-pwm-logger
pio run
pio run -t upload
pio device monitor
```

## Current prototype

- **PWM capture:** two passive input taps, default dev-kit pins in `src/board_pins.h`.
- **Storage:** compact binary run log in onboard flash via LittleFS, no microSD required for the first prototype.
- **BLE:** advertises as `RC PWM Logger` and exposes command/status/data characteristics for post-run upload.
- **Safety:** firmware never generates, buffers, or re-drives servo/ESC PWM. The hardware signal path must stay passive so control keeps working if the logger is off or crashed.

## BLE prototype contract

Service UUID: `8f0d0001-2f4f-4d5c-9c6a-000000000001`

| Characteristic | UUID | Direction | Payload |
|----------------|------|-----------|---------|
| Status | `8f0d0002-2f4f-4d5c-9c6a-000000000001` | read / notify | ASCII key-value status |
| Command | `8f0d0003-2f4f-4d5c-9c6a-000000000001` | write | `START`, `STOP`, `STATUS`, `DUMP`, `CLEAR` |
| Data | `8f0d0004-2f4f-4d5c-9c6a-000000000001` | read / notify | binary upload chunks |

The log starts with `LogHeader`, followed by packed `LogRecord` entries from `src/log_format.h`. The phone app can export CSV after download.

The matching TypeScript constants and binary parser live in [`src/lib/rcPwmLogger/bleProtocol.ts`](../../src/lib/rcPwmLogger/bleProtocol.ts).

Coordinate GPIOs with [hardware/rc-pwm-logger/PINMUX.md](../../hardware/rc-pwm-logger/PINMUX.md).

Made-with: Cursor
