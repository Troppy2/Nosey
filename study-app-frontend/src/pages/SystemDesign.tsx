import {
  ArrowLeft,
  BookOpen,
  Check,
  ClipboardCheck,
  Hammer,
  PlayCircle,
  Radar,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";

import { SD_CONCEPTS } from "../data/systemDesign";
import { getSystemDesignProgress } from "../lib/api";
import { useSettings } from "../lib/useSettings";
import type { SystemDesignProgressEntry, SystemDesignSubModule } from "../lib/types";

export const SD_SUB_MODULES: Array<{
  key: SystemDesignSubModule;
  label: string;
  icon: typeof BookOpen;
}> = [
  { key: "notes", label: "Notes", icon: BookOpen },
  { key: "video", label: "Video", icon: PlayCircle },
  { key: "visualizer", label: "Visualizer", icon: Radar },
  { key: "project", label: "Project", icon: Hammer },
  { key: "quiz", label: "Quiz", icon: ClipboardCheck },
];

export const SD_EMPTY_PROGRESS: SystemDesignProgressEntry = {
  notesDone: false,
  videoDone: false,
  visualizerDone: false,
  projectDone: false,
  quizDone: false,
  quizBestScore: null,
  completedAt: null,
};

export function isSubModuleDone(
  entry: SystemDesignProgressEntry,
  key: SystemDesignSubModule,
): boolean {
  switch (key) {
    case "notes":
      return entry.notesDone;
    case "video":
      return entry.videoDone;
    case "visualizer":
      return entry.visualizerDone;
    case "project":
      return entry.projectDone;
    case "quiz":
      return entry.quizDone;
    default:
      return false;
  }
}

export function doneCount(entry: SystemDesignProgressEntry): number {
  return SD_SUB_MODULES.filter((subModule) => isSubModuleDone(entry, subModule.key)).length;
}

/** The next thing to do in a concept, used for the card's call to action. */
function nextSubModule(entry: SystemDesignProgressEntry) {
  return SD_SUB_MODULES.find((subModule) => !isSubModuleDone(entry, subModule.key)) ?? null;
}

export default function SystemDesign() {
  const { betaMode } = useSettings();
  const [progress, setProgress] = useState<Record<string, SystemDesignProgressEntry>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!betaMode) return;
    let cancelled = false;
    getSystemDesignProgress()
      .then((result) => {
        if (!cancelled) setProgress(result.concepts ?? {});
      })
      .catch((err: unknown) => {
        // The track itself is bundled content, so a progress outage costs the
        // user their checkmarks, not the page.
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load your progress.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [betaMode]);

  if (!betaMode) return <Navigate to="/leetcode" replace />;

  return (
    <div className="page page-narrow sd-page">
      <header className="page-header mode-header">
        <Link className="flash-back-btn" to="/leetcode" aria-label="Back to KojoCode" title="Back to KojoCode">
          <ArrowLeft size={18} />
        </Link>
        <div className="sd-header-main">
          <span className="eyebrow">KojoCode</span>
          <h1>System Design</h1>
          <p className="muted sd-lede">
            One concept at a time: read it, watch it, build it twice, then prove you have it.
          </p>
        </div>
      </header>

      {error ? (
        <div className="sd-banner sd-banner--warn" role="status">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="sd-skeleton" data-testid="sd-track-loading">
          Loading your progress...
        </div>
      ) : null}

      <ol className="sd-track">
        {SD_CONCEPTS.map((concept) => {
          const entry = progress[concept.id] ?? SD_EMPTY_PROGRESS;
          const done = doneCount(entry);
          const next = nextSubModule(entry);
          return (
            <li key={concept.id} className="sd-track-item">
              <Link to={`/system-design/${concept.id}`} className="sd-card">
                <div className="sd-card-head">
                  <h2 className="sd-card-title" data-testid="sd-concept-title">
                    {concept.title}
                  </h2>
                  <span className={`sd-card-count${done === SD_SUB_MODULES.length ? " is-complete" : ""}`}>
                    {done === SD_SUB_MODULES.length ? (
                      <>
                        <Check size={14} />
                        Complete
                      </>
                    ) : (
                      `${done} of ${SD_SUB_MODULES.length} done`
                    )}
                  </span>
                </div>
                <p className="sd-card-blurb">{concept.blurb}</p>
                <ul className="sd-chips">
                  {SD_SUB_MODULES.map((subModule) => {
                    const Icon = subModule.icon;
                    const isDone = isSubModuleDone(entry, subModule.key);
                    return (
                      <li
                        key={subModule.key}
                        className={`sd-chip${isDone ? " is-done" : ""}`}
                        data-testid={`sd-chip-${concept.id}`}
                        data-sub-module={subModule.key}
                        data-done={isDone ? "true" : "false"}
                      >
                        {isDone ? <Check size={14} /> : <Icon size={14} />}
                        {subModule.label}
                      </li>
                    );
                  })}
                </ul>
                <span className="sd-card-cta">
                  {next ? `Continue with ${next.label.toLowerCase()}` : "Review this concept"}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      <p className="muted small sd-track-note">
        More concepts are being written. Each one lands with its notes, both exercises and its quiz
        at the same time.
      </p>
    </div>
  );
}
