import { describe, expect, it } from "vitest";
import type { FolderFile } from "./api";
import { describeUploadStatus, extractingProgressLabel } from "./uploadStatus";

function file(overrides: Partial<FolderFile>): FolderFile {
  return {
    id: 1,
    folder_id: 7,
    file_name: "notes.pdf",
    file_type: "pdf",
    size_bytes: 1024,
    upload_status: "ready",
    upload_error: null,
    upload_note: null,
    pages_done: null,
    pages_total: null,
    uploaded_at: "2026-09-29T12:00:00",
    ...overrides,
  };
}

describe("describeUploadStatus", () => {
  it("says a file is waiting while another file holds the parse slot", () => {
    expect(describeUploadStatus(file({ upload_status: "processing" }))).toBe("Waiting to start…");
  });

  it("shows the page being read once a PDF parse is running", () => {
    expect(describeUploadStatus(file({ upload_status: "processing", pages_done: 41, pages_total: 300 }))).toBe(
      "Reading page 42 of 300",
    );
  });

  it("never counts past the last page", () => {
    expect(describeUploadStatus(file({ upload_status: "processing", pages_done: 300, pages_total: 300 }))).toBe(
      "Reading page 300 of 300",
    );
  });

  it("falls back to a plain message for files without pages", () => {
    expect(describeUploadStatus(file({ upload_status: "processing", pages_done: 0, pages_total: null }))).toBe(
      "Extracting text…",
    );
  });

  it("shows the note on a ready file and nothing otherwise", () => {
    expect(describeUploadStatus(file({ upload_note: "Read the first 300 of 812 pages." }))).toBe(
      "Read the first 300 of 812 pages.",
    );
    expect(describeUploadStatus(file({}))).toBeNull();
  });

  it("shows the error for a failed file", () => {
    expect(describeUploadStatus(file({ upload_status: "error", upload_error: "Upload interrupted. Please try again." }))).toBe(
      "Upload interrupted. Please try again.",
    );
    expect(describeUploadStatus(file({ upload_status: "error" }))).toBe("Upload failed");
  });
});

describe("extractingProgressLabel", () => {
  it("shows the running file's progress", () => {
    expect(extractingProgressLabel([file({ upload_status: "processing", pages_done: 41, pages_total: 300 })])).toBe(
      "Reading page 42 of 300",
    );
  });

  it("names the file being read when several are waiting", () => {
    const rows = [
      file({ id: 1, file_name: "a.pdf", upload_status: "processing" }),
      file({ id: 2, file_name: "b.pdf", upload_status: "processing", pages_done: 2, pages_total: 10 }),
    ];
    expect(extractingProgressLabel(rows)).toBe("b.pdf: Reading page 3 of 10");
  });

  it("is empty when nothing is processing", () => {
    expect(extractingProgressLabel([file({})])).toBeNull();
  });
});
