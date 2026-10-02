import { type SkippedFile, uploadFolderFiles } from "./api";

// Mirrors ALLOWED_FILE_TYPES in study-app-backend/src/utils/validators.py.
export const ACCEPTED_UPLOAD_EXTENSIONS = [
  "pdf", "docx", "txt", "md", "html", "htm", "pptx",
  "py", "js", "ts", "tsx", "jsx", "java", "c", "cpp", "h", "hpp", "cs", "go", "rs", "swift", "kt",
  "ml", "mli", "scala", "rb", "php", "sql", "json", "xml", "yaml", "yml", "ipynb",
];
export const ACCEPTED_UPLOAD_ATTR = ACCEPTED_UPLOAD_EXTENSIONS.map((ext) => `.${ext}`).join(",");

// Server limits (validators.py): 40 MB per file, 120 MB per folder.
export const MAX_UPLOAD_FILE_SIZE_MB = 40;
export const MAX_FOLDER_UPLOAD_MB = 120;

export function isAcceptedUpload(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.name.includes(".") && ACCEPTED_UPLOAD_EXTENSIONS.includes(ext);
}

export type FolderUploadResult = {
  // Folder file ids to use, in the order the files were given. An exact copy of
  // a file already in the folder resolves to that existing file.
  fileIds: number[];
  skipped: SkippedFile[];
};

/**
 * Upload files through the folder pipeline (POST /folders/{id}/files), one
 * request per file so no single request nears the server's body limit. Text
 * extraction then runs on the server; callers that need the text (test
 * creation) wait for it server-side, so this returns as soon as the bytes land.
 */
export async function uploadToFolder(
  folderId: number,
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<FolderUploadResult> {
  const fileIds: number[] = [];
  const skipped: SkippedFile[] = [];
  for (const [index, file] of files.entries()) {
    onProgress?.(index, files.length);
    const result = await uploadFolderFiles(folderId, [file]);
    for (const uploaded of result.uploaded) fileIds.push(uploaded.id);
    for (const skip of result.skipped) {
      if (skip.existing_file_id != null) fileIds.push(skip.existing_file_id);
      else skipped.push(skip);
    }
  }
  onProgress?.(files.length, files.length);
  return { fileIds: Array.from(new Set(fileIds)), skipped };
}
