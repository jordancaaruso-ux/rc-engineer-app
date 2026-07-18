/**
 * Prefetch the Log Run form chunk on user intent (hover / touch), not on idle.
 * Pair with `router.prefetch` of `/runs/new` or `/runs/[id]/edit`.
 */
export function warmNewRunForm(): void {
  void import("@/components/runs/NewRunForm");
}
