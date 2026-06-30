export const INTERVAL_OPTIONS = [
  { value: 15, label: "Every 15 minutes" },
  { value: 30, label: "Every 30 minutes" },
  { value: 60, label: "Hourly" },
  { value: 360, label: "Every 6 hours" },
  { value: 1440, label: "Daily" },
];

export function intervalLabel(minutes: number): string {
  return (
    INTERVAL_OPTIONS.find((o) => o.value === minutes)?.label ?? `${minutes} min`
  );
}
