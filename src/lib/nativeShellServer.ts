import "server-only";

import { headers } from "next/headers";
import { isNativeShellUserAgent } from "@/lib/nativeShell";

/** True when the current request came from the Capacitor shell (iOS or Android). */
export async function isNativeShellRequest(): Promise<boolean> {
  try {
    const h = await headers();
    return isNativeShellUserAgent(h.get("user-agent"));
  } catch {
    return false;
  }
}
