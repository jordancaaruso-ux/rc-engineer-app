/**
 * What Report and Block take out of a driver's view. Pure and Prisma-free so the tests run offline;
 * the queries that feed it live in `blocks.ts` and `loadTeamFeed.ts`.
 */

/**
 * The other driver in every block row that touches the viewer, whichever side made it. A block
 * works both ways: the blocked driver stops seeing the blocker too, so the viewer's side of a row
 * never matters.
 */
export function blockedPeersFromRows(
  viewerId: string,
  rows: ReadonlyArray<{ blockerUserId: string; blockedUserId: string }>
): Set<string> {
  const peers = new Set<string>();
  for (const row of rows) {
    if (row.blockerUserId === viewerId) peers.add(row.blockedUserId);
    else if (row.blockedUserId === viewerId) peers.add(row.blockerUserId);
  }
  peers.delete(viewerId);
  return peers;
}

export type CommentForVisibility = { id: string; authorUserId: string; parentId: string | null };

/**
 * Which comments on a run the viewer sees, in their original order.
 *
 * A comment is hidden when its author is blocked either way, or when the viewer reported it.
 * A hidden reply simply goes. A hidden comment that starts a thread stays as a "hidden" line only
 * while someone else's reply under it is still shown, so that reply keeps its place; otherwise
 * the whole thread goes with it.
 */
export function applyCommentVisibility<T extends CommentForVisibility>(
  rows: readonly T[],
  hide: { authorIds: ReadonlySet<string>; commentIds: ReadonlySet<string> }
): Array<{ row: T; hidden: boolean }> {
  const isHidden = (c: T) => hide.authorIds.has(c.authorUserId) || hide.commentIds.has(c.id);

  const rootsWithShownReply = new Set<string>();
  for (const c of rows) {
    if (c.parentId && !isHidden(c)) rootsWithShownReply.add(c.parentId);
  }

  const out: Array<{ row: T; hidden: boolean }> = [];
  for (const c of rows) {
    const hidden = isHidden(c);
    if (c.parentId) {
      if (!hidden) out.push({ row: c, hidden: false });
      continue;
    }
    if (!hidden) out.push({ row: c, hidden: false });
    else if (rootsWithShownReply.has(c.id)) out.push({ row: c, hidden: true });
  }
  return out;
}
