# Prototype Test Checklist

Use this checklist to accept or reject the first plug-in RC PWM logger prototype.

## 1. Visual And Continuity Inspection

- [ ] ESP32 is mounted on a non-conductive surface or inside an enclosure.
- [ ] Steering Y-lead is labeled `STEERING`.
- [ ] Throttle/brake Y-lead is labeled `THROTTLE`.
- [ ] GPIO4 wire is labeled `STEERING GPIO4`.
- [ ] GPIO5 wire is labeled `THROTTLE GPIO5`.
- [ ] All resistor legs and solder joints are insulated.
- [ ] Receiver positive rail cannot short to ESP32 GPIO, USB, or ground.
- [ ] Multimeter continuity confirms receiver ground and ESP32 ground are connected.
- [ ] Multimeter confirms no short between receiver positive and receiver ground.
- [ ] Multimeter confirms no short between GPIO4 and receiver positive.
- [ ] Multimeter confirms no short between GPIO5 and receiver positive.

## 2. Firmware Flash

From `firmware/rc-pwm-logger`:

```powershell
python -m platformio run
python -m platformio run -t upload
python -m platformio device monitor
```

Pass criteria:

- [ ] Firmware builds successfully.
- [ ] Firmware uploads successfully.
- [ ] Serial monitor opens at 115200 baud.
- [ ] Serial shows `rc-pwm-logger starting`.
- [ ] Serial shows `LittleFS ready`.
- [ ] Serial periodically prints status with `board=esp32-s3-devkit`.

## 3. BLE Smoke Test

Use nRF Connect or equivalent BLE scanner app.

Pass criteria:

- [ ] Device advertises as `RC PWM Logger`.
- [ ] BLE connection succeeds.
- [ ] Service UUID appears: `8f0d0001-2f4f-4d5c-9c6a-000000000001`.
- [ ] Status characteristic can be read or notifies:
  `8f0d0002-2f4f-4d5c-9c6a-000000000001`.
- [ ] Command characteristic accepts text writes:
  `8f0d0003-2f4f-4d5c-9c6a-000000000001`.
- [ ] Data characteristic can notify binary chunks:
  `8f0d0004-2f4f-4d5c-9c6a-000000000001`.

## 4. Bench PWM Capture

Use a servo tester, spare receiver, or signal generator.

Pass criteria:

- [ ] ESP32 is powered by USB.
- [ ] Servo tester/receiver ground is connected to ESP32 ground.
- [ ] Steering signal tap is connected through divider to GPIO4.
- [ ] Moving steering input changes `steering_us` in serial/BLE status.
- [ ] Throttle signal tap is connected through divider to GPIO5.
- [ ] Moving throttle/brake input changes `throttle_us` in serial/BLE status.
- [ ] Idle values are plausible, usually around 1000-2000 us and often near 1500 us at neutral.
- [ ] Values become stale or stop changing when PWM signal is removed.

## 5. Logging Flow

Using BLE command writes:

1. Write `CLEAR`.
2. Write `START`.
3. Move steering and throttle inputs for at least 30 seconds.
4. Write `STOP`.
5. Write `DUMP` while subscribed to data notifications.

Pass criteria:

- [ ] `CLEAR` resets stored record count/status.
- [ ] `START` changes status to `logging=1`.
- [ ] Record count increases while logging.
- [ ] `STOP` changes status to `logging=0`.
- [ ] `DUMP` emits binary data chunks.
- [ ] Downloaded data parses with `src/lib/rcPwmLogger/bleProtocol.ts`.
- [ ] Parsed records include changing `steeringUs` and `throttleUs`.

## 6. Passive Control-Path Test

This verifies the logger cannot add input lag.

With vehicle wheels off the ground:

- [ ] Steering servo works normally with logger disconnected.
- [ ] ESC/throttle works normally with logger disconnected.
- [ ] Steering servo works normally with logger connected but ESP32 unpowered.
- [ ] ESC/throttle works normally with logger connected but ESP32 unpowered.
- [ ] Steering servo works normally with ESP32 powered.
- [ ] ESC/throttle works normally with ESP32 powered.
- [ ] Steering servo works normally while firmware is logging.
- [ ] ESC/throttle works normally while firmware is logging.
- [ ] Steering servo works normally while BLE is connected.
- [ ] ESC/throttle works normally while BLE is connected.
- [ ] Steering servo works normally if ESP32 is reset/rebooted.
- [ ] ESC/throttle works normally if ESP32 is reset/rebooted.

Pass criteria:

- [ ] No visible change in steering behavior.
- [ ] No visible change in throttle/brake behavior.
- [ ] No failsafe, twitching, or delayed response caused by logger connection.

## 7. Optional Scope / Logic Analyzer Validation

If available:

- [ ] Measure receiver steering signal at receiver side.
- [ ] Measure steering signal at servo side.
- [ ] Confirm rising/falling edges align with logger disconnected.
- [ ] Confirm rising/falling edges align with logger connected and powered.
- [ ] Repeat for throttle/brake.

Pass criteria:

- [ ] Added delay is effectively 0 us because the signal path is passive.

## 8. Vehicle Run Test

Short first test only.

- [ ] Mount logger so no wires can touch drivetrain, battery, motor, or steering linkage.
- [ ] Use USB power bank or laptop power; do not power from receiver rail for first run.
- [ ] Start BLE logging.
- [ ] Drive slowly for 1-2 minutes.
- [ ] Stop logging.
- [ ] Dump log over BLE.
- [ ] Confirm steering and throttle data changed during run.
- [ ] Confirm no control issue occurred.

## Acceptance Summary

Prototype is accepted only if:

- [ ] BLE upload works.
- [ ] PWM capture works on both channels.
- [ ] Log data parses.
- [ ] Control path remains passive.
- [ ] Car remains controllable if logger is unpowered or rebooting.
- [ ] No exposed wiring or mechanical mounting risk remains for short test runs.
