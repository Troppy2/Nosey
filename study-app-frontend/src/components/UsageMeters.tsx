import { useEffect, useState } from "react";
import { fetchUsageLimits } from "../lib/api";
import type { UsageFeature, UsageLimits } from "../lib/types";

const FEATURE_COPY: Record<UsageFeature["feature"], { name: string; hint: string }> = {
  test: { name: "Practice tests", hint: "Creating or regenerating a test uses one." },
  flashcard: { name: "Flashcards", hint: "Each generated card counts." },
  kojo: { name: "Kojo", hint: "Longer chats and bigger notes use more." },
};

// Discrete pips read better than a bar when the cap is a handful of whole items.
const MAX_PIPS = 10;

function formatTokens(value: number): string {
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

function formatAmount(feature: UsageFeature, value: number): string {
  return feature.unit === "tokens" ? formatTokens(value) : String(value);
}

function formatReset(iso: string | null): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || at.getTime() <= Date.now()) return null;
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay = at.toDateString() === new Date().toDateString();
  return sameDay ? time : `${time} tomorrow`;
}

function level(ratio: number): "ok" | "near" | "full" {
  if (ratio >= 1) return "full";
  if (ratio >= 0.8) return "near";
  return "ok";
}

function UsageRow({ feature, exempt }: { feature: UsageFeature; exempt: boolean }) {
  const copy = FEATURE_COPY[feature.feature];
  const ratio = feature.limit > 0 ? Math.min(1, feature.used / feature.limit) : 0;
  const state = exempt ? "ok" : level(ratio);
  const reset = formatReset(feature.resets_at);
  const usePips = feature.unit === "tests" && feature.limit <= MAX_PIPS;

  let footnote: string;
  if (exempt) {
    footnote = feature.used > 0 ? `${formatAmount(feature, feature.used)} ${feature.unit} used recently.` : copy.hint;
  } else if (state === "full") {
    footnote = reset ? `Limit reached. More frees up at ${reset}.` : "Limit reached. More frees up soon.";
  } else if (feature.used > 0 && reset) {
    footnote = `${copy.hint} Your oldest use frees up at ${reset}.`;
  } else {
    footnote = copy.hint;
  }

  return (
    <li className={`usage-row usage-row--${state}`}>
      <div className="usage-row-head">
        <span className="usage-row-name">{copy.name}</span>
        <span className="usage-row-count">
          {exempt ? (
            <>{formatAmount(feature, feature.used)}</>
          ) : (
            <>
              {formatAmount(feature, feature.used)}
              <span className="usage-row-of"> of {formatAmount(feature, feature.limit)}</span>
            </>
          )}
          <span className="usage-row-unit"> {feature.unit}</span>
        </span>
      </div>

      {exempt ? null : usePips ? (
        <div className="usage-pips" role="img" aria-label={`${feature.used} of ${feature.limit} ${feature.unit} used`}>
          {Array.from({ length: feature.limit }, (_, index) => (
            <span key={index} className={`usage-pip${index < feature.used ? " usage-pip--used" : ""}`} />
          ))}
        </div>
      ) : (
        <div
          className="usage-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={feature.limit}
          aria-valuenow={Math.min(feature.used, feature.limit)}
          aria-label={`${copy.name} usage`}
        >
          <span className="usage-bar-fill" style={{ width: `${ratio * 100}%` }} />
        </div>
      )}

      <p className="usage-row-foot muted small">{footnote}</p>
    </li>
  );
}

export function UsageMeters() {
  const [usage, setUsage] = useState<UsageLimits | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchUsageLimits()
      .then((data) => {
        if (!cancelled) setUsage(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load usage.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="muted small">Usage could not be loaded. Refresh the page to try again.</p>;
  }
  if (!usage) {
    return <div className="usage-loading" aria-busy="true" />;
  }

  const exempt = usage.exempt || !usage.limits_enabled;

  return (
    <div className="usage-meters">
      <p className="muted small usage-intro">
        {exempt
          ? "Your account has no usage limits. This is what you've used in the last "
            + `${usage.window_hours} hours.`
          : `Limits cover the last ${usage.window_hours} hours and free up gradually as older use ages out.`}
      </p>
      {exempt ? <span className="pill usage-unlimited">Unlimited</span> : null}
      <ul className="usage-list">
        {usage.features.map((feature) => (
          <UsageRow key={feature.feature} feature={feature} exempt={exempt} />
        ))}
      </ul>
    </div>
  );
}
