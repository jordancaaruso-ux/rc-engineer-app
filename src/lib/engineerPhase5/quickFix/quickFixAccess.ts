export function evaluateQuickFixAccess(params: {
  viewerId: string;
  runUserId: string;
  shareWithTeam: boolean | null;
  canViewPeer: boolean;
  teamOnly: boolean;
}): boolean {
  if (params.runUserId === params.viewerId) return true;
  if (!params.canViewPeer) return false;
  if (params.teamOnly) {
    return params.shareWithTeam !== false;
  }
  return true;
}
