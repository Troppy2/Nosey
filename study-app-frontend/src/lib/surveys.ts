import { scopeKey } from "./api";
import type { SurveyFeature } from "./types";

// Post-feature surveys are sampled and rate-limited so users are not nagged:
// at most one prompt per COOLDOWN window per feature, and only a fraction of
// otherwise-eligible completions actually prompt. Tuned to be low-friction.
const COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const SAMPLE_RATE = 0.34; // ~1 in 3 eligible completions

function surveyKey(feature: SurveyFeature): string {
  return scopeKey(`nosey_survey_${feature}`);
}

// Decide whether to prompt after a qualifying feature completion. Returns false
// while inside the cooldown for that feature; otherwise samples at SAMPLE_RATE.
export function shouldShowSurvey(feature: SurveyFeature): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(surveyKey(feature));
    if (raw) {
      const parsed = JSON.parse(raw) as { lastShownAt?: number };
      if (typeof parsed.lastShownAt === "number" && Date.now() - parsed.lastShownAt < COOLDOWN_MS) {
        return false;
      }
    }
  } catch {
    // Corrupt/unreadable value: treat as eligible.
  }
  return Math.random() < SAMPLE_RATE;
}

// Start the cooldown for a feature. Call exactly when the prompt is shown, so a
// dismissed prompt still counts and the user is not re-asked immediately.
export function recordSurveyShown(feature: SurveyFeature): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(surveyKey(feature), JSON.stringify({ lastShownAt: Date.now() }));
  } catch {
    // Ignore quota/serialization errors: the survey is best-effort.
  }
}
