#include <Arduino.h>
#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <LittleFS.h>

#include "board_pins.h"
#include "log_format.h"

namespace {

static constexpr char LOG_PATH[] = "/run.bin";
static constexpr size_t BLE_CHUNK_BYTES = 20;
static constexpr uint32_t STATUS_PERIOD_MS = 1000;
static constexpr uint32_t LOG_FLUSH_PERIOD_MS = 1000;

static constexpr char SERVICE_UUID[] = "8f0d0001-2f4f-4d5c-9c6a-000000000001";
static constexpr char STATUS_UUID[] = "8f0d0002-2f4f-4d5c-9c6a-000000000001";
static constexpr char COMMAND_UUID[] = "8f0d0003-2f4f-4d5c-9c6a-000000000001";
static constexpr char DATA_UUID[] = "8f0d0004-2f4f-4d5c-9c6a-000000000001";

struct PulseCapture {
  volatile uint32_t rising_us = 0;
  volatile uint32_t last_edge_us = 0;
  volatile uint16_t width_us = board::SERVO_DEFAULT_US;
  volatile bool seen = false;
};

PulseCapture steering;
PulseCapture throttle;

File log_file;
File upload_file;
BLECharacteristic* status_characteristic = nullptr;
BLECharacteristic* data_characteristic = nullptr;

bool ble_connected = false;
bool logging_active = false;
bool upload_active = false;
bool littlefs_ready = false;
uint32_t run_started_ms = 0;
uint32_t last_sample_ms = 0;
uint32_t last_status_ms = 0;
uint32_t last_flush_ms = 0;
uint32_t records_written = 0;
String pending_command;
bool command_pending = false;

void IRAM_ATTR capturePulse(PulseCapture& channel, uint8_t pin) {
  const uint32_t now = micros();
  if (digitalRead(pin) == HIGH) {
    channel.rising_us = now;
    channel.last_edge_us = now;
    return;
  }

  const uint32_t width = now - channel.rising_us;
  if (width >= board::SERVO_MIN_US && width <= board::SERVO_MAX_US) {
    channel.width_us = static_cast<uint16_t>(width);
    channel.seen = true;
  }
  channel.last_edge_us = now;
}

void IRAM_ATTR onSteeringChange() {
  capturePulse(steering, board::PWM_STEERING_PIN);
}

void IRAM_ATTR onThrottleChange() {
  capturePulse(throttle, board::PWM_THROTTLE_PIN);
}

uint16_t readPulseUs(const PulseCapture& channel) {
  noInterrupts();
  const uint16_t width = channel.width_us;
  interrupts();
  return width;
}

bool isPulseStale(const PulseCapture& channel) {
  noInterrupts();
  const bool seen = channel.seen;
  const uint32_t last_edge = channel.last_edge_us;
  interrupts();

  return !seen || (micros() - last_edge) > board::PWM_STALE_US;
}

String buildStatus() {
  String status;
  status.reserve(160);
  status += "board=";
  status += board::BOARD_NAME;
  status += ";logging=";
  status += logging_active ? "1" : "0";
  status += ";records=";
  status += records_written;
  status += ";steering_us=";
  status += readPulseUs(steering);
  status += ";throttle_us=";
  status += readPulseUs(throttle);
  status += ";storage_used=";
  status += littlefs_ready ? LittleFS.usedBytes() : 0;
  status += ";storage_total=";
  status += littlefs_ready ? LittleFS.totalBytes() : 0;
  return status;
}

void notifyStatus() {
  const String status = buildStatus();
  Serial.println(status);
  if (status_characteristic == nullptr) {
    return;
  }

  status_characteristic->setValue(status.c_str());
  if (ble_connected) {
    status_characteristic->notify();
  }
}

bool startLogging() {
  if (!littlefs_ready) {
    Serial.println("storage unavailable");
    return false;
  }

  if (log_file) {
    log_file.close();
  }
  if (upload_file) {
    upload_file.close();
  }
  upload_active = false;

  LittleFS.remove(LOG_PATH);
  log_file = LittleFS.open(LOG_PATH, FILE_WRITE);
  if (!log_file) {
    Serial.println("failed to open log file");
    return false;
  }

  const LogHeader header = {
      LOG_MAGIC,
      LOG_VERSION,
      sizeof(LogRecord),
      board::LOG_SAMPLE_HZ,
  };
  log_file.write(reinterpret_cast<const uint8_t*>(&header), sizeof(header));
  log_file.flush();

  records_written = 0;
  run_started_ms = millis();
  last_sample_ms = 0;
  last_flush_ms = millis();
  logging_active = true;
  Serial.println("logging started");
  notifyStatus();
  return true;
}

void stopLogging() {
  logging_active = false;
  if (log_file) {
    log_file.flush();
    log_file.close();
  }
  Serial.println("logging stopped");
  notifyStatus();
}

void clearLog() {
  stopLogging();
  if (upload_file) {
    upload_file.close();
  }
  upload_active = false;
  LittleFS.remove(LOG_PATH);
  records_written = 0;
  Serial.println("log cleared");
  notifyStatus();
}

void appendSampleIfDue() {
  if (!logging_active || !log_file) {
    return;
  }

  const uint32_t now = millis();
  const uint32_t interval_ms = 1000 / board::LOG_SAMPLE_HZ;
  if (last_sample_ms != 0 && (now - last_sample_ms) < interval_ms) {
    return;
  }
  last_sample_ms = now;

  uint8_t flags = 0;
  if (isPulseStale(steering)) {
    flags |= LOG_FLAG_STEERING_STALE;
  }
  if (isPulseStale(throttle)) {
    flags |= LOG_FLAG_THROTTLE_STALE;
  }

  const LogRecord record = {
      now - run_started_ms,
      readPulseUs(steering),
      readPulseUs(throttle),
      flags,
  };
  log_file.write(reinterpret_cast<const uint8_t*>(&record), sizeof(record));
  records_written++;

  if ((now - last_flush_ms) >= LOG_FLUSH_PERIOD_MS) {
    log_file.flush();
    last_flush_ms = now;
  }
}

void beginUpload() {
  if (logging_active) {
    stopLogging();
  }
  if (upload_file) {
    upload_file.close();
  }

  upload_file = LittleFS.open(LOG_PATH, FILE_READ);
  if (!upload_file) {
    Serial.println("no log to upload");
    upload_active = false;
    notifyStatus();
    return;
  }

  upload_active = true;
  Serial.println("upload started");
}

void sendUploadChunk() {
  if (!upload_active || !ble_connected || data_characteristic == nullptr) {
    return;
  }

  uint8_t buffer[BLE_CHUNK_BYTES];
  const size_t count = upload_file.read(buffer, sizeof(buffer));
  if (count == 0) {
    upload_file.close();
    upload_active = false;
    Serial.println("upload complete");
    notifyStatus();
    return;
  }

  data_characteristic->setValue(buffer, count);
  data_characteristic->notify();
  delay(8);
}

void handleCommand(const String& command) {
  String normalized = command;
  normalized.trim();
  normalized.toUpperCase();

  if (normalized == "START") {
    startLogging();
  } else if (normalized == "STOP") {
    stopLogging();
  } else if (normalized == "CLEAR") {
    clearLog();
  } else if (normalized == "DUMP") {
    beginUpload();
  } else if (normalized == "STATUS") {
    notifyStatus();
  } else {
    Serial.print("unknown command: ");
    Serial.println(command);
  }
}

class ServerCallbacks final : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    ble_connected = true;
    notifyStatus();
  }

  void onDisconnect(BLEServer* server) override {
    ble_connected = false;
    upload_active = false;
    if (upload_file) {
      upload_file.close();
    }
    server->startAdvertising();
  }
};

class CommandCallbacks final : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* characteristic) override {
    const auto value = characteristic->getValue();
    pending_command = value.c_str();
    command_pending = true;
  }
};

void setupBle() {
  BLEDevice::init(board::BLE_DEVICE_NAME);
  BLEServer* server = BLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  BLEService* service = server->createService(SERVICE_UUID);
  status_characteristic = service->createCharacteristic(
      STATUS_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  status_characteristic->addDescriptor(new BLE2902());

  BLECharacteristic* command_characteristic = service->createCharacteristic(
      COMMAND_UUID,
      BLECharacteristic::PROPERTY_WRITE);
  command_characteristic->setCallbacks(new CommandCallbacks());

  data_characteristic = service->createCharacteristic(
      DATA_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  data_characteristic->addDescriptor(new BLE2902());

  service->start();
  server->getAdvertising()->addServiceUUID(SERVICE_UUID);
  server->getAdvertising()->start();
}

}  // namespace

void setup() {
  Serial.begin(board::SERIAL_BAUD);
  delay(500);
  Serial.println("rc-pwm-logger starting");

  pinMode(board::PWM_STEERING_PIN, INPUT);
  pinMode(board::PWM_THROTTLE_PIN, INPUT);
  attachInterrupt(digitalPinToInterrupt(board::PWM_STEERING_PIN), onSteeringChange, CHANGE);
  attachInterrupt(digitalPinToInterrupt(board::PWM_THROTTLE_PIN), onThrottleChange, CHANGE);

  littlefs_ready = LittleFS.begin(true);
  Serial.println(littlefs_ready ? "LittleFS ready" : "LittleFS unavailable");

  setupBle();
  notifyStatus();
}

void loop() {
  if (command_pending) {
    command_pending = false;
    handleCommand(pending_command);
  }

  appendSampleIfDue();
  sendUploadChunk();

  const uint32_t now = millis();
  if ((now - last_status_ms) >= STATUS_PERIOD_MS) {
    last_status_ms = now;
    notifyStatus();
  }

  delay(1);
}
