export function batteryDisplayLabel(battery: { label: string; packNumber?: number | null }): string {
  return `${battery.label}${battery.packNumber != null ? ` #${battery.packNumber}` : ""}`;
}
