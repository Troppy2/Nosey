import { Star, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { submitSurvey } from "../lib/api";
import { recordSurveyShown, shouldShowSurvey } from "../lib/surveys";
import type { SurveyFeature } from "../lib/types";

const FEATURE_LABELS: Record<SurveyFeature, string> = {
  flashcards: "studying these flashcards",
  testing: "this test",
  kojo: "chatting with Kojo",
};

interface FeatureSurveyProps {
  feature: SurveyFeature;
  // Rising-edge trigger. When this flips from false to true, the component
  // decides (sampling + cooldown) whether to actually show the prompt.
  trigger: boolean;
  // Fires once the prompt is resolved: submitted, dismissed, or skipped because
  // it was not sampled. Lets a caller defer a follow-up action (e.g. Kojo
  // closing its chat) until the survey is out of the way.
  onResolved?: () => void;
}

export function FeatureSurvey({ feature, trigger, onResolved }: FeatureSurveyProps) {
  const [visible, setVisible] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const firedRef = useRef(false);

  useEffect(() => {
    if (!trigger) {
      firedRef.current = false;
      return;
    }
    if (firedRef.current) return;
    firedRef.current = true;
    if (shouldShowSurvey(feature)) {
      recordSurveyShown(feature);
      setVisible(true);
    } else {
      onResolved?.();
    }
  }, [trigger, feature, onResolved]);

  function resolve() {
    setVisible(false);
    onResolved?.();
  }

  async function handleSubmit() {
    if (rating < 1) return;
    setSubmitting(true);
    try {
      await submitSurvey({ feature, rating, comment: comment.trim() || undefined });
    } catch {
      // Best-effort: never block the user on a failed survey submit.
    } finally {
      setSubmitting(false);
      resolve();
    }
  }

  if (!visible) return null;

  return (
    <div className="modal-backdrop" onMouseDown={resolve}>
      <div
        className="modal-card survey-card"
        role="dialog"
        aria-modal="true"
        aria-label="Feedback survey"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="privacy-modal-close" onClick={resolve} aria-label="Close">
          <X size={18} />
        </button>
        <h2>Quick question</h2>
        <p className="muted small">How was {FEATURE_LABELS[feature]}? Your rating helps us improve Nosey.</p>

        <div className="survey-stars" role="radiogroup" aria-label="Rating out of 5">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={`survey-star${n <= (hover || rating) ? " survey-star--on" : ""}`}
              onClick={() => setRating(n)}
              onMouseEnter={() => setHover(n)}
              onMouseLeave={() => setHover(0)}
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              aria-pressed={rating === n}
            >
              <Star size={30} />
            </button>
          ))}
        </div>

        <textarea
          className="survey-comment"
          placeholder="Anything else? (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
          rows={3}
        />

        <div className="survey-actions">
          <button type="button" className="survey-dismiss" onClick={resolve}>
            Not now
          </button>
          <button
            type="button"
            className="survey-submit"
            onClick={handleSubmit}
            disabled={rating < 1 || submitting}
          >
            {submitting ? "Sending…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
