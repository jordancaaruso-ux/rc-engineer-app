export type TireSetApiRow = {
  id: string;
  label: string;
  setNumber?: number;
  initialRunCount?: number;
  insertLabel?: string | null;
  wheelLabel?: string | null;
  specificModel?: string | null;
  tireTypeId?: string | null;
  tireType?: { id: string; displayName: string; modelCode: string } | null;
};

export type BatteryApiRow = {
  id: string;
  label: string;
  packNumber?: number;
  initialRunCount?: number;
  notes?: string | null;
};

async function parseJsonError(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return (data as { error?: string })?.error || `Request failed (${res.status})`;
}

export async function createTireSetApi(input: {
  tireTypeId: string;
  setNumber: number;
  initialRunCount?: number;
  specificModel?: string | null;
  insertLabel?: string | null;
  wheelLabel?: string | null;
  notes?: string | null;
}): Promise<TireSetApiRow> {
  const res = await fetch("/api/tire-sets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await parseJsonError(res));
  }
  const data = (await res.json()) as { tireSet?: TireSetApiRow };
  if (!data.tireSet?.id) {
    throw new Error("Invalid response: tire set not returned.");
  }
  return data.tireSet;
}

export async function createBatteryApi(input: {
  label: string;
  packNumber?: number;
  initialRunCount?: number;
  notes?: string | null;
}): Promise<BatteryApiRow> {
  const res = await fetch("/api/batteries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await parseJsonError(res));
  }
  const data = (await res.json()) as { battery?: BatteryApiRow };
  if (!data.battery?.id) {
    throw new Error("Invalid response: battery not returned.");
  }
  return data.battery;
}

export async function deleteTireSetApi(tireSetId: string): Promise<void> {
  const res = await fetch(`/api/tire-sets/${encodeURIComponent(tireSetId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(await parseJsonError(res));
  }
}

export async function deleteBatteryApi(batteryId: string): Promise<void> {
  const res = await fetch(`/api/batteries/${encodeURIComponent(batteryId)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(await parseJsonError(res));
  }
}
