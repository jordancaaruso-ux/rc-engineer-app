const DEFAULT_UA =
  "RC-Engineer/1.0 (+https://github.com) Lap timing import; contact app owner";

export type FetchTextResult =
  | { ok: true; text: string; contentType: string; finalUrl: string }
  | { ok: false; error: string; status?: number };

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 18_000;

export async function fetchUrlText(url: string): Promise<FetchTextResult> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": process.env.LAP_IMPORT_USER_AGENT?.trim() || DEFAULT_UA,
        Accept: "text/html,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.1",
      },
    });
    const ct = res.headers.get("content-type") ?? "";
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) {
      return { ok: false, error: "Page too large to import (max ~1.5 MB).", status: res.status };
    }
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status} from server`, status: res.status };
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buf);
    return { ok: true, text, contentType: ct, finalUrl: res.url };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, error: "Request timed out." };
    }
    return { ok: false, error: e instanceof Error ? e.message : "Fetch failed" };
  } finally {
    clearTimeout(t);
  }
}
