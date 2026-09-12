import { X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type FolderFileContent, fetchFolderFileContent } from "../lib/api";
import { InlineLoading } from "./Loaders";
import { MarkdownContent } from "./MarkdownContent";

// Code files keep their exact whitespace; markdown rendering would mangle them.
const CODE_FILE_TYPES = new Set([
  "py", "js", "ts", "tsx", "jsx", "java", "c", "cpp", "h", "hpp",
  "cs", "go", "rs", "swift", "kt", "ml", "mli", "scala", "rb", "php", "sql", "json", "xml", "yaml", "yml",
]);

interface Props {
  folderId: number;
  fileId: number;
  fileName: string;
  onClose: () => void;
}

/** Shows the text Nosey extracted from an uploaded file, so users can confirm it parsed correctly. */
export function FileContentModal({ folderId, fileId, fileName, onClose }: Props) {
  const [data, setData] = useState<FolderFileContent | null>(null);
  const [error, setError] = useState<string | null>(null);

  // FileManager re-renders every few seconds while other files process, and
  // passes a fresh onClose each time. A ref keeps the key listener stable.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    let cancelled = false;
    fetchFolderFileContent(folderId, fileId)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load file content");
      });
    return () => { cancelled = true; };
  }, [folderId, fileId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Parsing up to 200K chars of markdown is expensive; only redo it when the data changes.
  const body = useMemo(() => {
    // Inline, not FormError: on mobile FormError toasts, and toasts sit under modals.
    if (error) return <div className="form-error">{error}</div>;
    if (!data) return <InlineLoading label="Loading parsed text" />;
    if (!data.content.trim()) return <p className="muted">No text was extracted from this file.</p>;
    if (CODE_FILE_TYPES.has(data.file_type.toLowerCase())) {
      return <pre className="file-view-code">{data.content}</pre>;
    }
    return <MarkdownContent content={data.content} />;
  }, [data, error]);

  return (
    <div
      className="modal-backdrop file-view-backdrop"
      // Stop the event so the File Manager backdrop underneath does not close too.
      onMouseDown={(e) => { e.stopPropagation(); onClose(); }}
    >
      <div
        className="modal-card file-view-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Parsed text of ${fileName}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="file-view-header">
          <div style={{ minWidth: 0 }}>
            <p className="eyebrow" style={{ margin: 0 }}>Parsed text</p>
            <h2 className="file-view-title">{fileName}</h2>
          </div>
          <button type="button" className="kojo-header-btn" onClick={onClose} aria-label="Close file view">
            <X size={18} />
          </button>
        </div>

        <div className="file-view-body">{body}</div>

        {data?.truncated ? (
          <p className="muted small file-view-note">
            Showing first {data.shown_chars.toLocaleString()} of {data.total_chars.toLocaleString()} characters.
          </p>
        ) : null}
      </div>
    </div>
  );
}
