#pragma once

#include <Arduino.h>

namespace board {

// The logger must only listen to receiver PWM. These pins are inputs only;
// the receiver-to-servo/ESC path must be a passive Y-harness or copper pass-through.
#if defined(BOARD_CUSTOM)
static constexpr uint8_t PWM_STEERING_PIN = 15;
static constexpr uint8_t PWM_THROTTLE_PIN = 16;
static constexpr char BOARD_NAME[] = "custom-v1";
#else
static constexpr uint8_t PWM_STEERING_PIN = 4;
static constexpr uint8_t PWM_THROTTLE_PIN = 5;
static constexpr char BOARD_NAME[] = "esp32-s3-devkit";
#endif

static constexpr uint32_t SERIAL_BAUD = 115200;
static constexpr uint16_t LOG_SAMPLE_HZ = 200;
static constexpr uint16_t SERVO_MIN_US = 750;
static constexpr uint16_t SERVO_MAX_US = 2250;
static constexpr uint16_t SERVO_DEFAULT_US = 1500;
static constexpr uint32_t PWM_STALE_US = 120000;

static constexpr char BLE_DEVICE_NAME[] = "RC PWM Logger";

}  // namespace board
