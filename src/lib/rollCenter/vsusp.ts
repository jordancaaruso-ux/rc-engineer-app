/**
 * VSUSP share-URL parser — the platform-pack authoring path.
 *
 * vsusp.com encodes a full front-view suspension project in the URL fragment.
 * Every numeric value is mm×1000 (microns) — INCLUDING `tires.compression`
 * (125 → 0.125mm of squash, not a percent; misreading this cost 0.3mm of RC
 * during validation, see docs/ROLL_CENTER_NORTH_STAR.md).
 */
import type { AxleGeometry } from "./engine";

export type VsuspProject = {
  name: string;
  front: AxleGeometry;
  rear: AxleGeometry;
};

function parseBlock(fragment: string, blockName: string): Record<string, number> | null {
  const m = fragment.match(new RegExp(`${blockName}\\{([^}]*)\\}`));
  if (!m) return null;
  const out: Record<string, number> = {};
  for (const kv of m[1].split("|")) {
    const i = kv.indexOf(":");
    if (i > 0) out[kv.slice(0, i)] = Number.parseFloat(kv.slice(i + 1));
  }
  return out;
}

function toAxleGeometry(block: Record<string, number>): AxleGeometry {
  const mm = (key: string): number => {
    const v = block[key];
    if (v === undefined || Number.isNaN(v)) throw new Error(`VSUSP block missing ${key}`);
    return v / 1000;
  };
  return {
    frameBottom: mm("frame.bottom_y"),
    upperInnerX: mm("frame.center_to_upper_mount_x"),
    upperInnerZrel: mm("frame.bottom_to_upper_mount_y"),
    lowerInnerX: mm("frame.center_to_lower_mount_x"),
    lowerInnerZrel: mm("frame.bottom_to_lower_mount_y"),
    upperLen: mm("control_arms.upper_length"),
    lowerLen: mm("control_arms.lower_length"),
    hubToUpperX: mm("knuckles.hub_to_upper_x"),
    hubToUpperY: mm("knuckles.hub_to_upper_y"),
    hubToLowerX: mm("knuckles.hub_to_lower_x"),
    hubToLowerY: mm("knuckles.hub_to_lower_y"),
    wheelOffset: mm("wheels.offset"),
    tireDia: mm("tires.diameter_expl"),
    tireCompMm: (block["tires.compression"] ?? 0) / 1000,
  };
}

/** Parse a vsusp.com share URL into a pack payload. Null on anything malformed. */
export function parseVsuspUrl(url: string): VsuspProject | null {
  const hashIdx = url.indexOf("#");
  if (hashIdx < 0) return null;
  let fragment: string;
  try {
    fragment = decodeURIComponent(url.slice(hashIdx + 1));
  } catch {
    return null;
  }
  const frontBlock = parseBlock(fragment, "front");
  const rearBlock = parseBlock(fragment, "rear");
  if (!frontBlock || !rearBlock) return null;
  try {
    const nameMatch = fragment.match(/project_name:([^&]*)/);
    return {
      name: nameMatch ? nameMatch[1].trim() : "",
      front: toAxleGeometry(frontBlock),
      rear: toAxleGeometry(rearBlock),
    };
  } catch {
    return null;
  }
}
