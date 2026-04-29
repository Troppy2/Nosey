export function formatPercent(value?: number | null) {
  if (value === null || value === undefined) {
    return "No score";
  }
  return `${Math.round(value)}%`;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function scoreTone(score: number) {
  if (score >= 85) return "success";
  if (score >= 70) return "warning";
  return "error";
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
