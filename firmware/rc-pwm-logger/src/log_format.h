#pragma once

#include <stdint.h>

static constexpr uint32_t LOG_MAGIC = 0x52435057;  // "RCPW"
static constexpr uint16_t LOG_VERSION = 1;

struct __attribute__((packed)) LogHeader {
  uint32_t magic;
  uint16_t version;
  uint16_t record_size;
  uint32_t sample_hz;
};

struct __attribute__((packed)) LogRecord {
  uint32_t t_ms;
  uint16_t steering_us;
  uint16_t throttle_us;
  uint8_t flags;
};

static constexpr uint8_t LOG_FLAG_STEERING_STALE = 1 << 0;
static constexpr uint8_t LOG_FLAG_THROTTLE_STALE = 1 << 1;

static_assert(sizeof(LogHeader) == 12, "Unexpected log header size");
static_assert(sizeof(LogRecord) == 9, "Unexpected log record size");
