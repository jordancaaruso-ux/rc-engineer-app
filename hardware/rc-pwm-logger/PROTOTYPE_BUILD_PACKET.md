# RC PWM Logger Prototype Build Packet

This packet describes the fastest practical prototype: an **ESP32-S3 dev-board logger** that passively taps two RC receiver PWM channels and uploads logged data over BLE after a run.

The prototype is intentionally **not** a custom PCB. It is a boxed wiring harness that proves the product behavior before paying for assembled PCBs.

## Build Goal

Build one plug-in prototype that can:

1. Tap **steering** PWM from an RC receiver.
2. Tap **throttle/brake** PWM from an RC receiver.
3. Leave the receiver-to-servo/ESC control path passive and unchanged.
4. Log compact binary samples to ESP32 onboard flash.
5. Upload the log over BLE as `RC PWM Logger`.

## Non-Negotiable Safety Rule

The logger must be a **listener only**.

Do **not** route the steering servo or ESC signal through ESP32 firmware, an active buffer, a relay, a microcontroller output, or any circuit that can add delay or fail closed/open. The normal receiver signal must still reach the servo/ESC if the logger is:

- unplugged,
- unpowered,
- crashed,
- rebooting,
- being reflashed.

Use either:

- two normal servo Y-leads, or
- a direct copper pass-through harness where the logger only taps the signal.

## Prototype Architecture

```text
Receiver steering output ── Y-lead ── Steering servo
                         └─ passive divider tap ── ESP32 GPIO4

Receiver throttle output ── Y-lead ── ESC throttle input
                          └─ passive divider tap ── ESP32 GPIO5

Receiver GND ───────────────────────── ESP32 GND
ESP32 power ────────────────────────── USB laptop or USB power bank
```

For the first prototype, power the ESP32 over **USB**, not from the receiver/BEC rail. This avoids regulator and brownout questions while proving signal capture, flash logging, and BLE upload.

## Firmware Assumptions

Firmware path:

```text
firmware/rc-pwm-logger
```

Default dev-board pins from `src/board_pins.h`:

| Function | ESP32-S3 dev board pin |
|----------|------------------------|
| Steering PWM input | GPIO4 |
| Throttle/brake PWM input | GPIO5 |
| Ground reference | GND |
| Power | USB |

BLE device name:

```text
RC PWM Logger
```

BLE command strings:

```text
START
STOP
STATUS
DUMP
CLEAR
```

## Builder Skill Required

The builder should be comfortable with:

- basic soldering,
- identifying RC servo lead signal / positive / ground wires,
- using heatshrink,
- using a multimeter continuity mode,
- flashing an ESP32 with PlatformIO,
- using a BLE scanner app such as nRF Connect.

## Assembly Steps

### 1. Prepare the ESP32-S3

1. Install PlatformIO.
2. Connect the ESP32-S3 dev board over USB.
3. Build the firmware:

   ```powershell
   cd C:\Users\Jordan\Documents\rc-engineer-app\firmware\rc-pwm-logger
   python -m platformio run
   ```

4. Upload firmware:

   ```powershell
   python -m platformio run -t upload
   ```

5. Open serial monitor:

   ```powershell
   python -m platformio device monitor
   ```

6. Expected startup:

   ```text
   rc-pwm-logger starting
   LittleFS ready
   board=esp32-s3-devkit;logging=0;...
   ```

### 2. Build Two Signal Divider Taps

Build one divider for steering and one for throttle/brake.

Per channel:

```text
Receiver signal tap ── 10 kΩ ── ESP32 GPIO input
                              │
                              15 kΩ
                              │
                             GND
```

This scales a 5.0 V receiver signal to about 3.0 V at the ESP32 input.

Recommended prototype construction:

1. Cut or expose only the **signal** and **ground** conductors on the logger branch of each Y-lead.
2. Solder the 10 kΩ resistor in series from the signal tap to the ESP32 GPIO jumper.
3. Solder the 15 kΩ resistor from the ESP32 GPIO side of the 10 kΩ resistor to ground.
4. Heatshrink each divider so no resistor leg can short to the receiver positive rail.

### 3. Wire Channels

| RC channel | Receiver/vehicle connection | ESP32 connection |
|------------|-----------------------------|------------------|
| Steering | Receiver steering output through Y-lead to steering servo | Divider output to GPIO4 |
| Throttle/brake | Receiver throttle output through Y-lead to ESC | Divider output to GPIO5 |
| Ground | Receiver ground from either Y-lead | ESP32 GND |

The receiver positive wire is **not required** for the first USB-powered prototype.

### 4. Package the Prototype

Minimum acceptable package:

- ESP32 on insulating foam or 3D-printed plate,
- resistor dividers heatshrunk,
- Y-leads strain-relieved,
- no exposed conductor near servo positive or battery/BEC rail.

Good package:

- small plastic enclosure,
- holes or grommets for two Y-leads and USB cable,
- labels for `STEERING`, `THROTTLE`, `USB`, and `GND`.

## Bench Bring-Up

Use a servo tester before plugging into the car if possible.

1. Power ESP32 from USB.
2. Power servo tester/receiver normally.
3. Connect grounds together.
4. Feed the tester signal into the steering divider.
5. Watch serial status for changing `steering_us`.
6. Repeat for throttle/brake on GPIO5.
7. Verify BLE advertises as `RC PWM Logger`.

## Vehicle Bring-Up

1. Turn vehicle off.
2. Insert steering Y-lead between receiver steering output and steering servo.
3. Insert throttle Y-lead between receiver throttle output and ESC.
4. Connect logger ground to receiver ground through the Y-lead tap.
5. Power ESP32 from USB power bank/laptop.
6. Turn vehicle on with wheels off the ground.
7. Confirm steering and throttle behave normally before starting logging.
8. Start logging over BLE.

## Handoff Acceptance

The prototype is complete when every item in `PROTOTYPE_TEST_CHECKLIST.md` passes.

## Related Files

- Firmware: `firmware/rc-pwm-logger`
- Firmware pins: `firmware/rc-pwm-logger/src/board_pins.h`
- BLE protocol parser: `src/lib/rcPwmLogger/bleProtocol.ts`
- BOM: `hardware/rc-pwm-logger/PROTOTYPE_BOM.csv`
- Wiring diagram: `hardware/rc-pwm-logger/PROTOTYPE_WIRING.md`
- Test checklist: `hardware/rc-pwm-logger/PROTOTYPE_TEST_CHECKLIST.md`
