/** Dev-only timing helper for hot-path profiling. Set DEBUG_PERF=1 in .env.local. */
const enabled =
  process.env.NODE_ENV === "development" && process.env.DEBUG_PERF === "1";

export async function perfSpan<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!enabled) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const ms = Math.round(performance.now() - start);
    console.log(`[perf] ${label}: ${ms}ms`);
  }
}

export function perfMark(label: string): void {
  if (!enabled) return;
  console.log(`[perf] ${label}`);
}
