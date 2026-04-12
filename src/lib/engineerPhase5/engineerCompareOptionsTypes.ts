export type EngineerCompareOptionRow = {
  runId: string;
  sortIso: string;
  label: string;
  carName: string;
  trackName: string;
  owner: "me" | "teammate";
  teammateLabel: string | null;
};

export type EngineerCompareOptionsPayload = {
  mine: EngineerCompareOptionRow[];
  teammates: Array<{ peerUserId: string; displayName: string; runs: EngineerCompareOptionRow[] }>;
};
