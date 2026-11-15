import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BookIcon, CloseIcon, UploadIcon } from "../icons";
import { deleteSavedResume, getSavedResume, saveResume } from "../lib/api";
import { toast } from "../lib/toast";
import type { SavedResume } from "../lib/types";
import { ConfirmModal } from "./ConfirmModal";

const ACCEPT = ".pdf,.docx,.doc,.txt,.md,.tex";

export function formatSavedDate(iso: string | null): string {
  if (!iso) return "";
  // The server stores naive UTC; read it as UTC so the day does not slip.
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The one resume a user keeps for mock interviews, on the interview home. The
 * resume screen reads it every run, so it is uploaded once instead of per loop.
 */
export function SavedResumeCard() {
  const [saved, setSaved] = useState<SavedResume | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    getSavedResume()
      .then((row) => {
        if (!cancelled) setSaved(row);
      })
      .catch(() => {
        // Not fatal: the card offers an upload, and the resume screen still works.
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setBusy("upload");
    try {
      const row = await saveResume({ file });
      setSaved(row);
      toast.success(saved ? "Resume replaced" : "Resume saved", "The resume screen will use it from now on.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not read that file. Try a PDF or DOCX.");
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove() {
    setBusy("remove");
    try {
      await deleteSavedResume();
      setSaved(null);
      setConfirmRemove(false);
      toast.success("Resume removed");
    } catch (err: unknown) {
      setConfirmRemove(false);
      setError(err instanceof Error ? err.message : "Could not remove the resume.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="setup2-section" aria-labelledby="setup2-cv-title">
      <div className="setup2-rounds-head">
        <h2 id="setup2-cv-title">Your resume</h2>
        <span>The resume screen scans it every run. PDF or DOCX.</span>
      </div>

      <div className="setup2-cv-slot">
        {!loaded ? null : saved ? (
          <div className="setup2-cv">
            <span className="setup2-cv-icon" aria-hidden>
              <BookIcon size={18} />
            </span>
            <span className="setup2-cv-text">
              <span className="setup2-cv-name">{saved.file_name ?? "Pasted resume"}</span>
              <span className="setup2-cv-meta">
                Saved {formatSavedDate(saved.updated_at)}
              </span>
            </span>
            <button
              type="button"
              className="setup2-cv-replace"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy !== null}
            >
              {busy === "upload" ? <Loader2 size={15} className="spin" /> : <UploadIcon size={15} />}
              {busy === "upload" ? "Reading" : "Replace"}
            </button>
            <button
              type="button"
              className="setup2-cv-remove"
              onClick={() => setConfirmRemove(true)}
              disabled={busy !== null}
              aria-label="Remove saved resume"
              title="Remove saved resume"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="setup2-pill setup2-pill-dashed setup2-cv-add"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy !== null}
          >
            {busy === "upload" ? <Loader2 size={16} className="spin" /> : <UploadIcon size={16} />}
            {busy === "upload" ? "Reading your resume" : "Add your resume"}
          </button>
        )}
      </div>
      <input ref={fileInputRef} type="file" accept={ACCEPT} onChange={handleFile} hidden />
      {error && <p className="mock-setup-error">{error}</p>}

      {confirmRemove && (
        <ConfirmModal
          title="Remove your saved resume?"
          message="The resume screen will ask for an upload again. Past interviews keep their scans."
          confirmLabel="Remove"
          danger
          busy={busy === "remove"}
          busyLabel="Removing"
          onConfirm={() => void handleRemove()}
          onCancel={() => setConfirmRemove(false)}
        />
      )}
    </section>
  );
}
