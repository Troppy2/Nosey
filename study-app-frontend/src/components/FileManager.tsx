import { AlertCircle, Check, Eye, FileText, Loader2, Minus, StickyNote, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type FolderFile, type SkippedFile, addFolderTextNote, deleteFolderFile, fetchFolderFiles, uploadFolderFiles } from "../lib/api";
import { Button } from "./Button";
import { ConfirmModal } from "./ConfirmModal";
import { FileContentModal } from "./FileContentModal";
import { FormError } from "./FormError";
import { InlineLoading } from "./Loaders";
import { ProgressBar } from "./Progress";
import { SkeletonList } from "./Skeletons";

const MAX_FILE_SIZE_MB = 100;
const MAX_TOTAL_SIZE_MB = 300;
// How long the "N files deleted , Undo" window stays open before the deletes
// are actually sent to the server. Nothing leaves the client until it elapses.
const UNDO_WINDOW_MS = 6000;
const ALLOWED_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface Props {
  folderId: number;
  onClose: () => void;
}

export function FileManager({ folderId, onClose }: Props) {
  const [files, setFiles] = useState<FolderFile[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skippedFiles, setSkippedFiles] = useState<SkippedFile[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<FolderFile | null>(null);
  const [viewingFile, setViewingFile] = useState<FolderFile | null>(null);
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Bulk select + deferred ("undo"-able) delete. `selectedIds` is the checkbox
  // selection; `pendingDelete` holds the ids scheduled for deletion and the
  // timer that will fire the actual DELETE calls once the undo window closes.
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [pendingIds, setPendingIds] = useState<number[]>([]);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchFolderFiles(folderId).then((data) => {
      setFiles(data);
      setIsLoading(false);
    });
  }, [folderId]);

  // Poll while any file is still processing
  useEffect(() => {
    const hasProcessing = (files ?? []).some((f) => f.upload_status === "processing");
    if (!hasProcessing) return;
    const id = setInterval(() => {
      fetchFolderFiles(folderId).then((data) => setFiles(data));
    }, 3000);
    return () => clearInterval(id);
  }, [folderId, files]);

  async function handleUpload(selected: FileList | null) {
    if (!selected || selected.length === 0) return;
    const current = files ?? [];
    const valid: File[] = [];
    const errs: string[] = [];

    Array.from(selected).forEach((f) => {
      const allowed =
        ALLOWED_TYPES.includes(f.type) || /\.(pdf|txt|md|docx|pptx)$/i.test(f.name);
      if (!allowed) { errs.push(`${f.name}: unsupported type`); return; }
      if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) { errs.push(`${f.name}: exceeds ${MAX_FILE_SIZE_MB} MB`); return; }
      valid.push(f);
    });

    const currentTotalBytes = current.reduce((sum, file) => sum + file.size_bytes, 0);
    const pendingTotalBytes = valid.reduce((sum, file) => sum + file.size, 0);
    if (currentTotalBytes + pendingTotalBytes > MAX_TOTAL_SIZE_MB * 1024 * 1024) {
      setError(`Combined folder materials exceed ${MAX_TOTAL_SIZE_MB} MB.`);
      return;
    }
    if (errs.length > 0) { setError(errs.join(" · ")); return; }
    if (valid.length === 0) return;

    setError(null);
    setSkippedFiles([]);
    setIsUploading(true);
    try {
      const result = await uploadFolderFiles(folderId, valid);
      if (result.uploaded.length > 0) {
        setFiles((prev) => [...result.uploaded, ...(prev ?? [])]);
      }
      if (result.skipped.length > 0) {
        setSkippedFiles(result.skipped);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleSaveNote() {
    const content = noteContent.trim();
    if (!content) { setError("Note text cannot be empty."); return; }
    setError(null);
    setSkippedFiles([]);
    setIsSavingNote(true);
    try {
      const created = await addFolderTextNote(folderId, noteTitle.trim(), content);
      setFiles((prev) => [created, ...(prev ?? [])]);
      setNoteTitle("");
      setNoteContent("");
      setMode("upload");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save note.");
    } finally {
      setIsSavingNote(false);
    }
  }

  async function handleDelete(fileId: number) {
    setDeletingId(fileId);
    try {
      await deleteFolderFile(folderId, fileId);
      setFiles((prev) => (prev ?? []).filter((f) => f.id !== fileId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  }

  // Only "ready" files can be bulk-selected: files still extracting text or in an
  // error state are left out so Select All never sweeps up an in-flight upload.
  const readyFiles = (files ?? []).filter((f) => f.upload_status === "ready");
  // Rows hidden from the list while their undo window is open.
  const pendingSet = new Set(pendingIds);
  const visibleFiles = (files ?? []).filter((f) => !pendingSet.has(f.id));
  const selectableIds = readyFiles.filter((f) => !pendingSet.has(f.id)).map((f) => f.id);
  const selectedCount = selectableIds.filter((id) => selectedIds.has(id)).length;
  const allSelected = selectableIds.length > 0 && selectedCount === selectableIds.length;
  const someSelected = selectedCount > 0;

  function toggleOne(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      if (selectableIds.every((id) => prev.has(id))) return new Set();
      return new Set(selectableIds);
    });
  }

  function commitPending(ids: number[]) {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    setPendingIds([]);
    if (ids.length === 0) return;
    Promise.allSettled(ids.map((id) => deleteFolderFile(folderId, id))).then((results) => {
      const failed = results.filter((r) => r.status === "rejected").length;
      setFiles((prev) => (prev ?? []).filter((f) => !ids.includes(f.id)));
      if (failed > 0) {
        setError(`${failed} file${failed === 1 ? "" : "s"} could not be deleted. Refresh and try again.`);
        fetchFolderFiles(folderId).then(setFiles).catch(() => {});
      }
    });
  }

  function startBulkDelete() {
    const ids = selectableIds.filter((id) => selectedIds.has(id));
    if (ids.length === 0) return;
    // Flush any earlier pending batch first so its rows do not resurface.
    if (pendingIds.length > 0) commitPending(pendingIds);
    setSelectedIds(new Set());
    setPendingIds(ids);
    pendingTimerRef.current = setTimeout(() => commitPending(ids), UNDO_WINDOW_MS);
  }

  function undoBulkDelete() {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    setPendingIds([]);
  }

  // On unmount (modal close), send any still-pending deletes immediately rather
  // than dropping them on the floor.
  const pendingRef = useRef<number[]>([]);
  pendingRef.current = pendingIds;
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      const ids = pendingRef.current;
      if (ids.length > 0) {
        Promise.allSettled(ids.map((id) => deleteFolderFile(folderId, id)));
      }
    };
  }, [folderId]);

  const usedBytes = visibleFiles.reduce((sum, file) => sum + file.size_bytes, 0);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal-card file-manager-modal"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: "min(600px, 96vw)", maxHeight: "80vh", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Folder Files</h2>
          <button
            type="button"
            className="kojo-header-btn"
            onClick={onClose}
            aria-label="Close file manager"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="file-manager-tabs">
          <button
            type="button"
            className={`file-manager-tab${mode === "upload" ? " file-manager-tab--active" : ""}`}
            onClick={() => { setMode("upload"); setError(null); }}
          >
            <Upload size={15} />
            Upload Files
          </button>
          <button
            type="button"
            className={`file-manager-tab${mode === "paste" ? " file-manager-tab--active" : ""}`}
            onClick={() => { setMode("paste"); setError(null); setSkippedFiles([]); }}
          >
            <StickyNote size={15} />
            Paste Text
          </button>
        </div>

        {/* Upload area */}
        {mode === "upload" ? (
        <label
          className="file-manager-upload-zone"
          style={{ cursor: isUploading ? "not-allowed" : "pointer", opacity: isUploading ? 0.6 : 1 }}
        >
          <Upload size={16} style={{ color: "var(--green-dark)", flexShrink: 0 }} />
          <span className="file-manager-upload-label">
            {isUploading ? "Uploading…" : "Choose files to upload"}
          </span>
          <span className="muted file-manager-upload-meta">
            {`${(usedBytes / (1024 * 1024)).toFixed(1)} / ${MAX_TOTAL_SIZE_MB} MB`}
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,.html,.htm,.pptx,.py,.js,.ts,.tsx,.jsx,.java,.c,.cpp,.h,.hpp,.cs,.go,.rs,.swift,.kt,.scala,.rb,.php,.sql,.json,.xml,.yaml,.yml"
            multiple
            disabled={isUploading}
            style={{ display: "none" }}
            onChange={(e) => handleUpload(e.target.files)}
          />
        </label>
        ) : null}

        {/* The upload is one fetch with no progress events, so the sweep is the
            honest shape: something is moving, we cannot say how far along. */}
        {mode === "upload" && isUploading ? (
          <ProgressBar label="Uploading, then extracting the text" />
        ) : null}

        {mode !== "upload" ? (
          <div className="file-manager-paste">
            <input
              type="text"
              className="file-manager-note-title"
              placeholder="Note title (optional)"
              value={noteTitle}
              maxLength={255}
              disabled={isSavingNote}
              onChange={(e) => setNoteTitle(e.target.value)}
            />
            <textarea
              className="file-manager-note-body"
              placeholder="Type or paste your notes here…"
              value={noteContent}
              disabled={isSavingNote}
              rows={6}
              onChange={(e) => setNoteContent(e.target.value)}
            />
            <div className="file-manager-paste-actions">
              <span className="muted small">
                {noteContent.trim().length.toLocaleString()} characters
              </span>
              <Button
                className="file-manager-save-note"
                disabled={isSavingNote || !noteContent.trim()}
                onClick={() => void handleSaveNote()}
              >
                {isSavingNote ? <InlineLoading label="Saving" /> : "Save note"}
              </Button>
            </div>
          </div>
        ) : null}
        <p className="muted small file-manager-hint">
          {mode === "upload"
            ? `PDF, DOCX, TXT, MD, PPTX and code files · ${MAX_FILE_SIZE_MB} MB per file`
            : "Saved as a text note, usable in tests and Kojo just like a file."}
        </p>

        <FormError message={error} style={{ marginBottom: 12 }} />

        {skippedFiles.length > 0 && (
          <div
            style={{
              marginBottom: 12,
              padding: "10px 14px",
              borderRadius: 8,
              background: "var(--yellow-lightest, #fffbeb)",
              border: "1.5px solid var(--yellow-mid, #f59e0b)",
              fontSize: "0.85rem",
              color: "var(--yellow-dark, #92400e)",
            }}
          >
            <strong>
              {skippedFiles.length === 1 ? "1 file was skipped:" : `${skippedFiles.length} files were skipped:`}
            </strong>
            <ul style={{ margin: "6px 0 0 0", paddingLeft: 18 }}>
              {skippedFiles.map((s) => (
                <li key={s.file_name}>
                  <strong>{s.file_name}</strong> , {s.reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Undo bar: shown while a bulk-delete batch is inside its undo window. */}
        {pendingIds.length > 0 && (
          <div className="file-manager-undo-bar">
            <span>
              {pendingIds.length} file{pendingIds.length === 1 ? "" : "s"} deleted
            </span>
            <button type="button" className="file-manager-undo-btn" onClick={undoBulkDelete}>
              Undo
            </button>
          </div>
        )}

        {/* Select-all controls: only rendered when there is something selectable. */}
        {!isLoading && selectableIds.length > 0 && (
          <div className="file-manager-select-bar">
            <button
              type="button"
              className="file-manager-select-toggle"
              data-active={someSelected ? "true" : "false"}
              aria-pressed={allSelected}
              onClick={toggleAll}
            >
              <span
                className={`fm-check${allSelected ? " is-checked" : someSelected ? " is-indeterminate" : ""}`}
                aria-hidden="true"
              >
                {allSelected ? <Check size={11} strokeWidth={3} /> : someSelected ? <Minus size={11} strokeWidth={3} /> : null}
              </span>
              {someSelected ? `${selectedCount} selected` : "Select all"}
            </button>
            {someSelected && (
              <Button
                variant="danger-outline"
                icon={<Trash2 size={14} />}
                className="file-manager-bulk-delete"
                onClick={startBulkDelete}
              >
                Delete selected
              </Button>
            )}
          </div>
        )}

        {/* File list */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {isLoading ? (
            <SkeletonList rows={3} label="Loading your files" />
          ) : visibleFiles.length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--muted)" }}>
              <FileText size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
              <p style={{ margin: 0, fontSize: "0.875rem" }}>No files uploaded yet.</p>
            </div>
          ) : (
            <div className="file-manager-list">
              {visibleFiles.map((f) => {
                const selectable = f.upload_status === "ready";
                return (
                <div key={f.id} className="file-manager-row">
                  {selectable ? (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(f.id)}
                      onChange={() => toggleOne(f.id)}
                      aria-label={`Select ${f.file_name}`}
                      style={{ flexShrink: 0, cursor: "pointer" }}
                    />
                  ) : (
                    <span style={{ width: 13, flexShrink: 0 }} />
                  )}
                  <FileText size={16} style={{ color: "var(--green-dark)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: "0.875rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.file_name}
                    </p>
                    <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
                      {f.upload_status === "processing" ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--green-dark)" }}>
                          <Loader2 size={11} className="spin" />
                          Extracting text…
                        </span>
                      ) : f.upload_status === "error" ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--red, #e53e3e)" }} title={f.upload_error ?? undefined}>
                          <AlertCircle size={11} />
                          {f.upload_error ?? "Upload failed"}
                        </span>
                      ) : (
                        <>{f.file_type.toUpperCase()} · {formatBytes(f.size_bytes)} · {formatDate(f.uploaded_at)}</>
                      )}
                    </p>
                  </div>
                  {selectable ? (
                    <button
                      type="button"
                      className="file-view-pill"
                      aria-label={`View parsed text of ${f.file_name}`}
                      onClick={() => setViewingFile(f)}
                    >
                      <Eye size={13} />
                      View
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="row-action-btn"
                    aria-label={`Delete ${f.file_name}`}
                    disabled={deletingId === f.id}
                    onClick={() => setConfirmDelete(f)}
                    style={{ color: "var(--red, #e53e3e)", opacity: deletingId === f.id ? 0.4 : 1 }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {confirmDelete ? (
        <ConfirmModal
          title="Delete File"
          message={<>Delete <strong>{confirmDelete.file_name}</strong>? This cannot be undone.</>}
          confirmLabel="Delete"
          danger
          onConfirm={() => { void handleDelete(confirmDelete.id); setConfirmDelete(null); }}
          onCancel={() => setConfirmDelete(null)}
        />
      ) : null}

      {viewingFile ? (
        <FileContentModal
          folderId={folderId}
          fileId={viewingFile.id}
          fileName={viewingFile.file_name}
          onClose={() => setViewingFile(null)}
        />
      ) : null}
    </div>
  );
}
