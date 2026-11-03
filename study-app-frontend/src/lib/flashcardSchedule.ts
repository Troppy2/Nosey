export type FlashcardRating = "hard" | "medium" | "easy";

export interface CardScheduleState {
  ease: number;
  interval_days: number;
  reps: number;
  lapses: number;
  due_at: string | null;
  last_reviewed_at: string | null;
  difficulty: number;
}

const DAY_MS = 86400 * 1000;

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function schedule(
  cardState: Partial<CardScheduleState>,
  rating: FlashcardRating,
  now: Date
): CardScheduleState {
  let ease = cardState.ease ?? 2.5;
  let interval = cardState.interval_days ?? 0;
  let reps = cardState.reps ?? 0;
  let lapses = cardState.lapses ?? 0;

  let due: Date;

  if (rating === "hard") {
    lapses += 1;
    reps = 0;
    interval = 0;
    due = new Date(now.getTime() + 10 * 60 * 1000);
    ease = roundTo2(Math.max(1.3, ease - 0.2));
  } else if (rating === "medium") {
    reps += 1;
    if (reps === 1) {
      interval = 1;
    } else {
      interval = Math.max(interval + 1, Math.round(interval * 1.2));
    }
    interval = Math.min(365, interval);
    ease = roundTo2(Math.max(1.3, ease - 0.05));
    due = new Date(now.getTime() + interval * DAY_MS);
  } else {
    reps += 1;
    if (reps === 1) {
      interval = 1;
    } else if (reps === 2) {
      interval = 4;
    } else {
      interval = Math.round(interval * ease);
    }
    interval = Math.min(365, interval);
    ease = roundTo2(ease + 0.1);
    due = new Date(now.getTime() + interval * DAY_MS);
  }

  const rawDiff = 1 + lapses + (2.5 - ease) * 4;
  const difficulty = Math.max(1, Math.min(5, Math.round(rawDiff)));

  return {
    ease,
    interval_days: interval,
    reps,
    lapses,
    due_at: due.toISOString(),
    last_reviewed_at: now.toISOString(),
    difficulty,
  };
}

export function formatNextInterval(
  cardState: Partial<CardScheduleState>,
  rating: FlashcardRating,
  now: Date = new Date()
): string {
  if (rating === "hard") return "10m";
  const next = schedule(cardState, rating, now);
  return `${next.interval_days}d`;
}
