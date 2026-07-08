import {
  AlertCircle,
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  GraduationCap,
  Loader2,
  Lock,
  RefreshCcw,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmModal } from "../components/ConfirmModal";
import { createLearningTrack, deleteLearningTrack, fetchLearningTrack } from "../lib/api";
import { useSettings } from "../lib/useSettings";
import type { LearningTrack } from "../lib/types";

const POLL_MS = 2500;

// Track hub for a folder's Learning Modules: create/regenerate a track, watch
// it generate module by module (polling, same UX as streamed test generation),
// and open unlocked modules. Module N+1 unlocks when module N's quiz is passed.
export default function LearningModulesPage() {
  const { folderId } = useParams();
  const numericFolderId = folderId ? Number(folderId) : null;
  const { betaMode } = useSettings();

  const [track, setTrack] = useState<LearningTrack | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [moduleCount, setModuleCount] = useState(5);
  const [customInstructions, setCustomInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showRebuildModal, setShowRebuildModal] = useState(false);
  const pollRef = useRef<number | null>(null);

  const loadTrack = useCallback(async () => {
    if (numericFolderId == null) return;
    try {
      const data = await fetchLearningTrack(numericFolderId);
      setTrack(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the learning track.");
    } finally {
      setLoaded(true);
    }
  }, [numericFolderId]);

  useEffect(() => {
    void loadTrack();
  }, [loadTrack]);

  // Poll while generating so modules appear as the background job fills them in.
  useEffect(() => {
    if (track?.status !== "generating") return;
    pollRef.current = window.setInterval(() => void loadTrack(), POLL_MS);
    return () => {
      if (pollRef.current != null) window.clearInterval(pollRef.current);
    };
  }, [track?.status, loadTrack]);

  async function handleGenerate() {
    if (numericFolderId == null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createLearningTrack(numericFolderId, moduleCount, {
        customInstructions: customInstructions.trim() || undefined,
      });
      setTrack(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start generation.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(thenRebuild: boolean) {
    if (numericFolderId == null || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (thenRebuild) {
        // POST replaces the existing track server-side, no explicit delete
        // needed. Reuse the track's stored custom instructions.
        const created = await createLearningTrack(numericFolderId, track?.module_count ?? moduleCount, {
          customInstructions: track?.custom_instructions ?? undefined,
        });
        setTrack(created);
      } else {
        await deleteLearningTrack(numericFolderId);
        setTrack(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The action failed. Try again.");
    } finally {
      setBusy(false);
      setShowDeleteModal(false);
      setShowRebuildModal(false);
    }
  }

  if (numericFolderId == null) return <Navigate to="/flashcards" replace />;
  if (!betaMode) return <Navigate to={`/flashcards/${numericFolderId}`} replace />;

  if (!loaded) {
    return (
      <div className="page page-narrow">
        <div className="lm-loading">
          <Loader2 size={28} className="lm-spin" />
          <p className="muted">Loading your learning track.</p>
        </div>
      </div>
    );
  }

  // ── No track yet: setup screen ────────────────────────────────────────────
  if (track == null) {
    return (
      <div className="page page-narrow">
        <header className="page-header mode-header">
          <Link className="flash-back-btn" to={`/flashcards/${numericFolderId}`} aria-label="Back to modes" title="Back to modes">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <span className="eyebrow">Learning Modules</span>
            <h1>Build your track</h1>
            <p className="muted">
              Nosey turns this folder's notes into a sequence of short lessons, each read aloud and
              followed by a 5-question quiz. Pass a quiz to unlock the next module.
            </p>
          </div>
        </header>

        <Card className="lm-setup">
          <label className="lm-setup-label" htmlFor="lm-module-count">
            Number of modules
          </label>
          <div className="lm-count-row">
            <input
              id="lm-module-count"
              className="lm-count-slider"
              type="range"
              min={1}
              max={10}
              value={moduleCount}
              onChange={(e) => setModuleCount(Number(e.target.value))}
            />
            <span className="lm-count-value">{moduleCount}</span>
          </div>
          <p className="muted small">
            Built from the notes saved in this folder. More modules split the material into finer
            slices; 10 is the maximum.
          </p>
          <label className="lm-setup-label" htmlFor="lm-custom-instructions">
            Custom instructions <span className="muted lm-label-optional">(optional)</span>
          </label>
          <textarea
            id="lm-custom-instructions"
            className="lm-instructions-input"
            rows={3}
            maxLength={500}
            placeholder='e.g. "Focus on the proofs", "Use lots of real-world examples", "Assume I am new to this subject"'
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
          />
          <p className="muted small lm-char-count">{customInstructions.length}/500</p>
          {error ? <div className="form-error">{error}</div> : null}
          <div className="button-row">
            <Button icon={<GraduationCap size={18} />} onClick={() => void handleGenerate()} disabled={busy}>
              {busy ? "Starting…" : "Generate track"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const readyCount = track.modules.filter((m) => m.ready).length;
  const targetCount = track.status === "generating" ? track.module_count : track.modules.length;
  const firstLockedIndex = track.modules.findIndex((m) => !m.passed);
  const passedCount = track.modules.filter((m) => m.passed).length;

  return (
    <div className="page page-narrow">
      <header className="page-header mode-header">
        <Link className="flash-back-btn" to={`/flashcards/${numericFolderId}`} aria-label="Back to modes" title="Back to modes">
          <ArrowLeft size={18} />
        </Link>
        <div className="lm-header-main">
          <span className="eyebrow">Learning Modules</span>
          <h1>Your track</h1>
          <p className="muted">
            {track.status === "generating"
              ? `Building your lessons: ${readyCount} of ${targetCount} modules ready.`
              : `${passedCount} of ${track.modules.length} modules completed.`}
          </p>
        </div>
        {track.status !== "generating" ? (
          <div className="flash-header-actions">
            <button
              className="flash-icon-btn"
              onClick={() => setShowRebuildModal(true)}
              type="button"
              aria-label="Rebuild track"
              title="Rebuild track"
              disabled={busy}
            >
              <RefreshCcw size={17} />
            </button>
            <button
              className="flash-icon-btn flash-icon-btn--danger"
              onClick={() => setShowDeleteModal(true)}
              type="button"
              aria-label="Delete track"
              title="Delete track"
              disabled={busy}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ) : null}
      </header>

      {error ? <div className="form-error">{error}</div> : null}

      {track.status === "failed" ? (
        <Card className="lm-failed">
          <AlertCircle size={22} />
          <div>
            <strong>Generation failed.</strong>
            <p className="muted small">{track.error ?? "Something went wrong while building the track."}</p>
          </div>
          <Button variant="secondary" onClick={() => void handleGenerate()} disabled={busy}>
            Try again
          </Button>
        </Card>
      ) : null}

      {track.notes_stale ? (
        <Card className="lm-stale">
          <AlertCircle size={18} />
          <p>
            This folder's notes have changed since the track was built. Rebuild it to match the new
            material.
          </p>
          <Button variant="secondary" onClick={() => setShowRebuildModal(true)} disabled={busy}>
            Rebuild
          </Button>
        </Card>
      ) : null}

      {track.status === "generating" ? (
        <div className="lm-generating-bar">
          <Loader2 size={16} className="lm-spin" />
          <span>Writing lessons and quizzes. You can start module 1 as soon as it's ready.</span>
          <button
            className="lm-cancel-btn"
            type="button"
            onClick={() => {
              void (async () => {
                try {
                  await deleteLearningTrack(numericFolderId);
                  setTrack(null);
                } catch {
                  /* poll will reconcile */
                }
              })();
            }}
          >
            <X size={14} /> Cancel
          </button>
        </div>
      ) : null}

      <ol className="lm-module-list">
        {track.modules.map((module, index) => {
          const unlocked = index === 0 || (firstLockedIndex !== -1 ? index <= firstLockedIndex : true);
          const openable = module.ready && unlocked;
          const stateClass = module.passed
            ? "is-passed"
            : openable
              ? "is-open"
              : "is-locked";
          const inner = (
            <>
              <span className="lm-module-num">{index + 1}</span>
              <span className="lm-module-body">
                <span className="lm-module-title">{module.title}</span>
                {module.summary ? <span className="lm-module-summary muted">{module.summary}</span> : null}
              </span>
              <span className="lm-module-state">
                {module.passed ? (
                  <CheckCircle2 size={20} />
                ) : !module.ready ? (
                  <Loader2 size={18} className="lm-spin" />
                ) : openable ? (
                  <ChevronRight size={20} />
                ) : (
                  <Lock size={17} />
                )}
              </span>
            </>
          );
          return (
            <li key={module.id}>
              {openable ? (
                <Link className={`lm-module-row ${stateClass}`} to={`/flashcards/${numericFolderId}/modules/${module.id}`}>
                  {inner}
                </Link>
              ) : (
                <div className={`lm-module-row ${stateClass}`} aria-disabled="true">
                  {inner}
                </div>
              )}
            </li>
          );
        })}
        {track.status === "generating" &&
          Array.from({ length: Math.max(0, targetCount - track.modules.length) }).map((_, i) => (
            <li key={`pending-${i}`}>
              <div className="lm-module-row is-pending" aria-hidden="true">
                <span className="lm-module-num">{track.modules.length + i + 1}</span>
                <span className="lm-module-body">
                  <span className="lm-module-title lm-skeleton" />
                </span>
                <span className="lm-module-state">
                  <Loader2 size={18} className="lm-spin" />
                </span>
              </div>
            </li>
          ))}
      </ol>

      {track.status === "ready" && passedCount === track.modules.length && track.modules.length > 0 ? (
        <Card className="lm-done">
          <BookOpenCheck size={34} />
          <h2>Track complete</h2>
          <p className="muted">You worked through every module. Rebuild the track for a fresh pass.</p>
        </Card>
      ) : null}

      {showDeleteModal ? (
        <ConfirmModal
          title="Delete Learning Track"
          message="This removes the track, its lessons, and your quiz progress. This cannot be undone."
          confirmLabel={busy ? "Deleting…" : "Delete track"}
          danger
          onConfirm={() => void handleDelete(false)}
          onCancel={() => setShowDeleteModal(false)}
        />
      ) : null}
      {showRebuildModal ? (
        <ConfirmModal
          title="Rebuild Learning Track"
          message="This replaces the current track and quiz progress with a freshly generated one from the folder's notes."
          confirmLabel={busy ? "Rebuilding…" : "Rebuild"}
          onConfirm={() => void handleDelete(true)}
          onCancel={() => setShowRebuildModal(false)}
        />
      ) : null}
    </div>
  );
}
