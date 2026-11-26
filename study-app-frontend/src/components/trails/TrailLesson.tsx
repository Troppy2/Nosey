import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../Button";
import { KojoLecture } from "../KojoWalkthrough";
import { MarkdownContent } from "../MarkdownContent";
import { CloseIcon } from "../../icons";
import type { PTPath } from "../../lib/types";

/**
 * Kojo's notes for a path that has no lecture video (or whose video would not
 * load): the summary, the cues that point at this pattern, and the template.
 * The "done" button sits at the end, so reaching it means the notes were read.
 */
function TrailNotes({
  path,
  busy,
  onDone,
  onClose,
}: {
  path: PTPath;
  busy: boolean;
  onDone: () => void;
  onClose: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const watched = path.lesson.watched;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);
  useEffect(() => {
    card.current?.querySelector<HTMLElement>("h2")?.focus();
  }, []);
  return createPortal(
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        ref={card}
        className="modal-card pt-notes"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pt-notes-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pt-notes-head">
          <div>
            <p className="pt-notes-kicker">Kojo's notes</p>
            <h2 id="pt-notes-title" tabIndex={-1}>
              {path.title}
            </h2>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close" disabled={busy}>
            <CloseIcon size={18} />
          </Button>
        </div>
        <div className="pt-notes-body">
          {path.summary ? <MarkdownContent content={path.summary} /> : null}
          {path.cues.length ? (
            <section>
              <h3>Cues that point here</h3>
              <ul className="pt-notes-cues">
                {path.cues.map((cue) => (
                  <li key={cue}>{cue}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {path.template_code.trim() ? (
            <section>
              <h3>The template</h3>
              <MarkdownContent content={"```python\n" + path.template_code.trimEnd() + "\n```"} />
            </section>
          ) : null}
        </div>
        <div className="button-row pt-notes-foot">
          {watched ? (
            <Button onClick={onClose}>Done</Button>
          ) : (
            <Button onClick={onDone} disabled={busy}>
              {busy ? "Opening step 1" : "Got it, open step 1"}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The lesson stop. Plays Kojo's lecture when the path links one; otherwise (or
 * when it fails to load) shows Kojo's written notes. Finishing either one
 * reports `onWatched` once.
 */
export function TrailLesson({
  path,
  busy,
  onWatched,
  onClose,
}: {
  path: PTPath;
  busy: boolean;
  onWatched: () => void;
  onClose: () => void;
}) {
  const [videoFailed, setVideoFailed] = useState(false);
  // The page ignores repeats while a save is in flight; a failed save can retry.
  const report = () => {
    if (!path.lesson.watched && !busy) onWatched();
  };
  if (path.lesson.lecture_slug && !videoFailed) {
    return (
      <KojoLecture
        slug={path.lesson.lecture_slug}
        onClose={onClose}
        onFinished={report}
        onLoadError={() => setVideoFailed(true)}
      />
    );
  }
  return <TrailNotes path={path} busy={busy} onDone={report} onClose={onClose} />;
}
