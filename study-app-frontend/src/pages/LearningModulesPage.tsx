import {
  AlertCircle,
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  ChevronRight,
  FileText,
  GraduationCap,
  Loader2,
  Lock,
  RefreshCcw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmModal } from "../components/ConfirmModal";
import { ProgressBar } from "../components/Progress";
import { SkeletonList } from "../components/Skeletons";
import {
  createLearningTrack,
  deleteLearningTrack,
  fetchFolderFiles,
  fetchLearningTrack,
  uploadFolderFiles,
} from "../lib/api";
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

  // Direct upload on the setup screen: files are saved into the folder (same
  // pipeline as everywhere else), so they also benefit tests and flashcards.
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [genPhase, setGenPhase] = useState<"idle" | "uploading" | "extracting" | "starting">("idle");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function addPendingFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    setPendingFiles((prev) => {
      // Dedupe by name+size so re-picking the same file is a no-op.
      const seen = new Set(prev.map((f) => `${f.name}|${f.size}`));
      return [...prev, ...incoming.filter((f) => !seen.has(`${f.name}|${f.size}`))];
    });
  }

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
      if (pendingFiles.length > 0) {
        setGenPhase("uploading");
        const result = await uploadFolderFiles(numericFolderId, pendingFiles);
        if (result.uploaded.length === 0) {
          throw new Error(result.skipped[0]?.reason ?? "No files could be uploaded.");
        }

        // Text extraction runs server-side in the background; wait for it so
        // the track build actually sees the new notes.
        setGenPhase("extracting");
        const ids = new Set(result.uploaded.map((f) => f.id));
        const deadline = Date.now() + 120_000;
        for (;;) {
          const mine = (await fetchFolderFiles(numericFolderId)).filter((f) => ids.has(f.id));
          if (!mine.some((f) => f.upload_status === "processing")) {
            const failed = mine.filter((f) => f.upload_status === "error");
            if (mine.length > 0 && failed.length === mine.length) {
              throw new Error(failed[0]?.upload_error ?? "Your files could not be read.");
            }
            break;
          }
          if (Date.now() > deadline) {
            throw new Error("Reading your files is taking too long. Try again in a moment.");
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        setPendingFiles([]);
      }

      setGenPhase("starting");
      const created = await createLearningTrack(numericFolderId, moduleCount, {
        customInstructions: customInstructions.trim() || undefined,
      });
      setTrack(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start generation.");
    } finally {
      setBusy(false);
      setGenPhase("idle");
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
        <SkeletonList rows={4} label="Loading your learning track" />
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
              max={20}
              value={moduleCount}
              onChange={(e) => setModuleCount(Number(e.target.value))}
            />
            <span className="lm-count-value">{moduleCount}</span>
          </div>
          <p className="muted small">
            Built from the notes saved in this folder. More modules split the material into finer
            slices; 20 is the maximum.
          </p>
          {moduleCount > 10 ? (
            <p className="muted small lm-count-warning">
              Heads up: big tracks take a while. Each module is written one at a time, so{" "}
              {moduleCount} modules can take several minutes to finish. You can start module 1 as
              soon as it's ready.
            </p>
          ) : null}
          <label className="lm-setup-label" htmlFor="lm-file-input">
            Add notes <span className="muted lm-label-optional">(optional)</span>
          </label>
          <p className="muted small">
            Upload files here and they're saved into this folder before the track is built, exactly
            like uploading for a test. PDF, DOCX, TXT, MD, HTML, and PPTX are supported.
          </p>
          <input
            id="lm-file-input"
            ref={fileInputRef}
            className="lm-file-input"
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.html,.pptx"
            onChange={(e) => {
              addPendingFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="button-row">
            <Button
              variant="secondary"
              icon={<Upload size={16} />}
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
            >
              Choose files
            </Button>
          </div>
          {pendingFiles.length > 0 ? (
            <ul className="lm-file-list">
              {pendingFiles.map((file) => (
                <li key={`${file.name}|${file.size}`} className="lm-file-item">
                  <FileText size={15} />
                  <span className="lm-file-name">{file.name}</span>
                  <button
                    type="button"
                    className="lm-file-remove"
                    aria-label={`Remove ${file.name}`}
                    title="Remove"
                    disabled={busy}
                    onClick={() =>
                      setPendingFiles((prev) =>
                        prev.filter((f) => `${f.name}|${f.size}` !== `${file.name}|${file.size}`),
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="lm-setup-label" htmlFor="lm-custom-instructions">
            Custom instructions <span className="muted lm-label-optional">(optional)</span>
          </label>
          <textarea
            id="lm-custom-instructions"
            className="lm-instructions-input"
            rows={3}
            maxLength={10000}
            placeholder='e.g. "Focus on the proofs", "Use lots of real-world examples", "Assume I am new to this subject"'
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
          />
          {error ? <div className="form-error">{error}</div> : null}
          <div className="button-row">
            <Button icon={<GraduationCap size={18} />} onClick={() => void handleGenerate()} disabled={busy}>
              {genPhase === "uploading"
                ? "Uploading notes…"
                : genPhase === "extracting"
                  ? "Reading your files…"
                  : busy
                    ? "Starting…"
                    : "Generate track"}
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
        <div className="lm-generating-bar lm-generating-bar--progress">
          <ProgressBar
            value={readyCount}
            max={targetCount}
            label="Writing lessons and quizzes"
            detail={`${readyCount} of ${targetCount} ready`}
          />
          <span>You can start module 1 as soon as it's ready.</span>
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
