import { expect, it } from "vitest";
import fixtureJson from "../../../study-app-backend/tests/fixtures/schedule_parity.json";
import { formatNextInterval, schedule, type CardScheduleState, type FlashcardRating } from "./flashcardSchedule";

interface FixtureRow {
  name: string;
  initial: Partial<CardScheduleState>;
  rating: FlashcardRating;
  now: string;
  expected: CardScheduleState;
}

const fixture = fixtureJson as FixtureRow[];

it("matches the python scheduler parity fixture exactly", () => {
  expect(fixture.length).toBeGreaterThan(0);
  for (const row of fixture) {
    const now = new Date(row.now);
    const result = schedule(row.initial, row.rating, now);
    const exp = row.expected;

    expect(result.ease).toBeCloseTo(exp.ease, 4);
    expect(result.interval_days).toBe(exp.interval_days);
    expect(result.reps).toBe(exp.reps);
    expect(result.lapses).toBe(exp.lapses);
    expect(result.difficulty).toBe(exp.difficulty);
    expect(new Date(result.due_at!).toISOString()).toBe(new Date(exp.due_at!).toISOString());
    expect(new Date(result.last_reviewed_at!).toISOString()).toBe(new Date(exp.last_reviewed_at!).toISOString());
  }
});

it("computes next-interval preview subtexts correctly", () => {
  const card: Partial<CardScheduleState> = { ease: 2.5, interval_days: 0, reps: 0, lapses: 0 };
  expect(formatNextInterval(card, "hard")).toBe("10m");
  expect(formatNextInterval(card, "medium")).toBe("1d");
  expect(formatNextInterval(card, "easy")).toBe("1d");

  const cardReps1: Partial<CardScheduleState> = { ease: 2.6, interval_days: 1, reps: 1, lapses: 0 };
  expect(formatNextInterval(cardReps1, "easy")).toBe("4d");
});
