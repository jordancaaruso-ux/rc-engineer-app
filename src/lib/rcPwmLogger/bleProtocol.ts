export const RC_PWM_LOGGER_BLE = {
  deviceName: "RC PWM Logger",
  serviceUuid: "8f0d0001-2f4f-4d5c-9c6a-000000000001",
  statusUuid: "8f0d0002-2f4f-4d5c-9c6a-000000000001",
  commandUuid: "8f0d0003-2f4f-4d5c-9c6a-000000000001",
  dataUuid: "8f0d0004-2f4f-4d5c-9c6a-000000000001",
} as const;

export const RC_PWM_LOGGER_COMMANDS = {
  start: "START",
  stop: "STOP",
  status: "STATUS",
  dump: "DUMP",
  clear: "CLEAR",
} as const;

export type RcPwmLoggerCommand =
  (typeof RC_PWM_LOGGER_COMMANDS)[keyof typeof RC_PWM_LOGGER_COMMANDS];

export interface RcPwmLogHeader {
  magic: number;
  version: number;
  recordSize: number;
  sampleHz: number;
}

export interface RcPwmLogRecord {
  timeMs: number;
  steeringUs: number;
  throttleUs: number;
  steeringStale: boolean;
  throttleStale: boolean;
}

export interface RcPwmLoggerStatus {
  board?: string;
  logging?: boolean;
  records?: number;
  steeringUs?: number;
  throttleUs?: number;
  storageUsed?: number;
  storageTotal?: number;
  raw: string;
}

const LOG_MAGIC = 0x52435057;
const LOG_HEADER_BYTES = 12;
const LOG_RECORD_BYTES = 9;
const FLAG_STEERING_STALE = 1 << 0;
const FLAG_THROTTLE_STALE = 1 << 1;

export function encodeRcPwmLoggerCommand(command: RcPwmLoggerCommand): Uint8Array {
  return new TextEncoder().encode(command);
}

export function parseRcPwmLoggerStatus(raw: string): RcPwmLoggerStatus {
  const pairs = new Map<string, string>();

  for (const part of raw.split(";")) {
    const [key, ...valueParts] = part.split("=");
    if (!key || valueParts.length === 0) {
      continue;
    }
    pairs.set(key, valueParts.join("="));
  }

  return {
    board: pairs.get("board"),
    logging: parseBoolean(pairs.get("logging")),
    records: parseNumber(pairs.get("records")),
    steeringUs: parseNumber(pairs.get("steering_us")),
    throttleUs: parseNumber(pairs.get("throttle_us")),
    storageUsed: parseNumber(pairs.get("storage_used")),
    storageTotal: parseNumber(pairs.get("storage_total")),
    raw,
  };
}

export function parseRcPwmLog(bytes: Uint8Array): {
  header: RcPwmLogHeader;
  records: RcPwmLogRecord[];
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = parseHeader(view);
  const records: RcPwmLogRecord[] = [];

  let offset = LOG_HEADER_BYTES;
  while (offset + header.recordSize <= bytes.byteLength) {
    records.push(parseRecord(view, offset));
    offset += header.recordSize;
  }

  return { header, records };
}

export function normalizeServoPulse(
  pulseUs: number,
  neutralUs = 1500,
  spanUs = 500,
): number {
  if (spanUs <= 0) {
    return 0;
  }

  const normalized = (pulseUs - neutralUs) / spanUs;
  return Math.max(-1, Math.min(1, normalized));
}

function parseHeader(view: DataView): RcPwmLogHeader {
  if (view.byteLength < LOG_HEADER_BYTES) {
    throw new Error("RC PWM log is missing its header");
  }

  const header = {
    magic: view.getUint32(0, true),
    version: view.getUint16(4, true),
    recordSize: view.getUint16(6, true),
    sampleHz: view.getUint32(8, true),
  };

  if (header.magic !== LOG_MAGIC) {
    throw new Error("RC PWM log magic does not match");
  }

  if (header.recordSize !== LOG_RECORD_BYTES) {
    throw new Error(`Unsupported RC PWM record size: ${header.recordSize}`);
  }

  return header;
}

function parseRecord(view: DataView, offset: number): RcPwmLogRecord {
  const flags = view.getUint8(offset + 8);

  return {
    timeMs: view.getUint32(offset, true),
    steeringUs: view.getUint16(offset + 4, true),
    throttleUs: view.getUint16(offset + 6, true),
    steeringStale: (flags & FLAG_STEERING_STALE) !== 0,
    throttleStale: (flags & FLAG_THROTTLE_STALE) !== 0,
  };
}

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value === "1" || value.toLowerCase() === "true";
}

function parseNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
