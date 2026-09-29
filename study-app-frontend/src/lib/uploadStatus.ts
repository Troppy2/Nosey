import type { FolderFile } from "./api";

type UploadState = Pick<FolderFile, "upload_status" | "upload_error" | "upload_note" | "pages_done" | "pages_total">;

/**
 * One line saying where an upload is. The server parses one file at a time and
 * reports pages as it goes: `pages_done` stays null while the file waits for the
 * parse slot, and `pages_total` is only set for files with pages (PDFs).
 * Returns null for a ready file with nothing to add.
 */
export function describeUploadStatus(file: UploadState): string | null {
  if (file.upload_status === "processing") {
    if (file.pages_done == null) return "Waiting to start…";
    if (file.pages_total) {
      // pages_done counts finished pages, so the one being read is the next.
      return `Reading page ${Math.min(file.pages_done + 1, file.pages_total)} of ${file.pages_total}`;
    }
    return "Extracting text…";
  }
  if (file.upload_status === "error") return file.upload_error ?? "Upload failed";
  if (isReadingMore(file)) {
    return `Reading more: page ${Math.min(file.pages_done! + 1, file.pages_total!)} of ${file.pages_total}`;
  }
  return file.upload_note ?? null;
}

/**
 * Long PDFs turn ready after their first batch of pages; the server keeps reading
 * the rest into the same file while pages_done is below pages_total.
 */
export function isReadingMore(file: UploadState): boolean {
  return (
    file.upload_status === "ready" &&
    file.pages_done != null &&
    file.pages_total != null &&
    file.pages_done < file.pages_total
  );
}

/** The server is still working on this file, so its row should keep refreshing. */
export function isUploadActive(file: UploadState): boolean {
  return file.upload_status === "processing" || isReadingMore(file);
}

/**
 * Progress for a wait on several uploads at once (Learning Modules): the file
 * being read right now, named when there is more than one.
 */
export function extractingProgressLabel(rows: FolderFile[]): string | null {
  const processing = rows.filter((f) => f.upload_status === "processing");
  const active = processing.find((f) => f.pages_done != null) ?? processing[0];
  if (!active) return null;
  const label = describeUploadStatus(active);
  return rows.length > 1 ? `${active.file_name}: ${label}` : label;
}
