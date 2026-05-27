# Prototype Wiring Diagram

This prototype uses **two passive Y-lead taps**. The receiver-to-servo/ESC path remains normal RC wiring. The ESP32 only observes the signal through resistor dividers.

## Servo Lead Pinout

Most JR/Futaba-style servo leads use:

| Wire | Typical color | Function |
|------|---------------|----------|
| Signal | white / yellow / orange | PWM signal |
| Positive | red | BEC/RX positive rail |
| Ground | black / brown | Ground |

Verify your exact cable before soldering. Do not trust colors blindly.

## Top-Level Wiring

```text
                         ┌─────────────────────┐
                         │ ESP32-S3 Dev Board  │
                         │                     │
Steering divider output ─┤ GPIO4               │
Throttle divider output ─┤ GPIO5               │
Receiver ground ─────────┤ GND                 │
USB power/data ──────────┤ USB                 │
                         └─────────────────────┘
```

## Steering Channel

```text
Receiver steering output
        │
        ├─────────────── normal Y-lead path ─────────────── Steering servo
        │
        └── signal tap ── 10 kΩ ──┬── GPIO4 on ESP32
                                  │
                                  15 kΩ
                                  │
Receiver ground ─────────────────┴── GND on ESP32
```

## Throttle / Brake Channel

```text
Receiver throttle output
        │
        ├─────────────── normal Y-lead path ─────────────── ESC throttle input
        │
        └── signal tap ── 10 kΩ ──┬── GPIO5 on ESP32
                                  │
                                  15 kΩ
                                  │
Receiver ground ─────────────────┴── GND on ESP32
```

## Divider Math

For a 5.0 V receiver PWM high:

```text
Vgpio = 5.0 V * 15 kΩ / (10 kΩ + 15 kΩ)
Vgpio = 3.0 V
```

This is safe for a 3.3 V ESP32 GPIO and should still be read as logic high.

If your receiver outputs 3.3 V PWM, the divider output is about 2.0 V. That should normally still read high on ESP32, but verify during bench test.

## First Prototype Power

Recommended first prototype:

```text
ESP32 powered by USB laptop or USB power bank.
Receiver/servo/ESC powered normally.
Ground shared between ESP32 and receiver.
Receiver positive rail not connected to ESP32 power.
```

Do not power the ESP32 dev board from a 7.4 V receiver/BEC rail unless the builder has confirmed the dev board's regulator input rating and thermal behavior.

## Wiring Checklist

Before powering anything:

- Steering servo still plugs into receiver through the Y-lead.
- ESC throttle still plugs into receiver through the Y-lead.
- ESP32 does not sit in series with either control signal.
- Receiver ground connects to ESP32 ground.
- Receiver positive rail does not touch GPIO4, GPIO5, USB 5 V, or ESP32 3.3 V.
- Each signal tap goes through a 10 kΩ resistor before the ESP32 GPIO.
- Each ESP32 GPIO tap node has a 15 kΩ resistor to ground.
- All solder joints are insulated with heatshrink.

## Expected Signals

Typical surface RC PWM:

| State | Approximate pulse width |
|-------|--------------------------|
| Minimum / full brake / full left | ~1000 us |
| Neutral / center | ~1500 us |
| Maximum / full throttle / full right | ~2000 us |

Exact endpoints depend on transmitter calibration, receiver, ESC, and steering setup.

## No-Lag Validation

With a scope or logic analyzer:

1. Probe receiver signal at the receiver output.
2. Probe the servo/ESC signal at the Y-lead output.
3. Confirm edges align with and without the logger connected.

For a passive Y-lead tap, added delay should be effectively **0 us**. The ESP32 must not be required for the servo/ESC signal to exist.
