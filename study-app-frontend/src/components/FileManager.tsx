import { FileText, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { type FolderFile, deleteFolderFile, fetchFolderFiles, uploadFolderFiles } from "../lib/api";

const MAX_FILES = 30;
const MAX_FILE_SIZE_MB = 10;
const ALLOWED_TYPES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchFolderFiles(folderId).then((data) => {
      setFiles(data);
      setIsLoading(false);
    });
  }, [folderId]);

  async function handleUpload(selected: FileList | null) {
    if (!selected || selected.length === 0) return;
    const current = files ?? [];
    const valid: File[] = [];
    const errs: string[] = [];

    Array.from(selected).forEach((f) => {
      const allowed =
        ALLOWED_TYPES.includes(f.type) || /\.(pdf|txt|md|docx)$/i.test(f.name);
      if (!allowed) { errs.push(`${f.name}: unsupported type`); return; }
      if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) { errs.push(`${f.name}: exceeds ${MAX_FILE_SIZE_MB} MB`); return; }
      valid.push(f);
    });

    if (current.length + valid.length > MAX_FILES) {
      setError(`Cannot exceed ${MAX_FILES} files in a folder.`);
      return;
    }
    if (errs.length > 0) { setError(errs.join(" · ")); return; }
    if (valid.length === 0) return;

    setError(null);
    setIsUploading(true);
    try {
      const created = await uploadFolderFiles(folderId, valid);
      setFiles((prev) => [...created, ...(prev ?? [])]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = "";
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

        <p className="muted" style={{ marginTop: 0, marginBottom: 16, fontSize: "0.875rem" }}>
          Upload notes files (PDF, DOCX, TXT, Markdown) to this folder — up to {MAX_FILES} files, {MAX_FILE_SIZE_MB} MB each.
          These files are available when generating tests.
        </p>

        {/* Upload area */}
        <label
          className="file-manager-upload-zone"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            border: "1.5px dashed var(--green-light-mid)",
            borderRadius: 8,
            cursor: isUploading ? "not-allowed" : "pointer",
            background: "var(--green-lightest)",
            marginBottom: 16,
            opacity: isUploading ? 0.6 : 1,
          }}
        >
          <Upload size={16} style={{ color: "var(--green-dark)", flexShrink: 0 }} />
          <span style={{ fontSize: "0.875rem", color: "var(--green-dark)", fontWeight: 600 }}>
            {isUploading ? "Uploading…" : "Choose files to upload"}
          </span>
          <span className="muted" style={{ fontSize: "0.8rem", marginLeft: "auto" }}>
            {(files ?? []).length}/{MAX_FILES} files used
          </span>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.txt,.md"
            multiple
            disabled={isUploading}
            style={{ display: "none" }}
            onChange={(e) => handleUpload(e.target.files)}
          />
        </label>

        {error && (
          <div className="form-error" style={{ marginBottom: 12 }}>
            {error}
          </div>
        )}

        {/* File list */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {isLoading ? (
            <div className="centered-block"><span className="loader" /></div>
          ) : (files ?? []).length === 0 ? (
            <div style={{ textAlign: "center", padding: "32px 0", color: "var(--muted)" }}>
              <FileText size={32} style={{ opacity: 0.3, marginBottom: 8 }} />
              <p style={{ margin: 0, fontSize: "0.875rem" }}>No files uploaded yet.</p>
            </div>
          ) : (
            <div className="file-manager-list">
              {(files ?? []).map((f) => (
                <div key={f.id} className="file-manager-row">
                  <FileText size={16} style={{ color: "var(--green-dark)", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: "0.875rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.file_name}
                    </p>
                    <p className="muted" style={{ margin: 0, fontSize: "0.75rem" }}>
                      {f.file_type.toUpperCase()} · {formatBytes(f.size_bytes)} · {formatDate(f.uploaded_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="row-action-btn"
                    aria-label={`Delete ${f.file_name}`}
                    disabled={deletingId === f.id}
                    onClick={() => handleDelete(f.id)}
                    style={{ color: "var(--red, #e53e3e)", opacity: deletingId === f.id ? 0.4 : 1 }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
