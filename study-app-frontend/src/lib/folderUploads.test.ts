import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, uploadFolderFiles: vi.fn() };
});

import { type FolderFile, uploadFolderFiles } from "./api";
import { isAcceptedUpload, uploadToFolder } from "./folderUploads";

const upload = vi.mocked(uploadFolderFiles);

function row(id: number, file_name: string): FolderFile {
  return {
    id,
    folder_id: 3,
    file_name,
    file_type: "pdf",
    size_bytes: 10,
    upload_status: "processing",
    upload_error: null,
    upload_note: null,
    pages_done: null,
    pages_total: null,
    uploaded_at: "2026-10-01T12:00:00",
  };
}

function file(name: string): File {
  return new File(["x"], name);
}

beforeEach(() => {
  upload.mockReset();
});

describe("isAcceptedUpload", () => {
  it("accepts every type the picker offers, by extension", () => {
    for (const name of ["a.pdf", "b.PPTX", "c.py", "d.ipynb", "e.md"]) {
      expect(isAcceptedUpload(file(name))).toBe(true);
    }
  });

  it("rejects unknown and extensionless files", () => {
    expect(isAcceptedUpload(file("photo.png"))).toBe(false);
    expect(isAcceptedUpload(file("pdf"))).toBe(false);
  });
});

describe("uploadToFolder", () => {
  it("sends one request per file and returns the new ids in order", async () => {
    upload
      .mockResolvedValueOnce({ uploaded: [row(5, "a.pdf")], skipped: [] })
      .mockResolvedValueOnce({ uploaded: [row(6, "b.pdf")], skipped: [] });

    const result = await uploadToFolder(3, [file("a.pdf"), file("b.pdf")]);

    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls.map(([, files]) => files.map((f) => f.name))).toEqual([["a.pdf"], ["b.pdf"]]);
    expect(result).toEqual({ fileIds: [5, 6], skipped: [] });
  });

  it("uses the existing file when the upload is an exact copy", async () => {
    upload.mockResolvedValueOnce({
      uploaded: [],
      skipped: [{ file_name: "a.pdf", reason: "Identical file already exists as 'old.pdf'", existing_file_id: 2 }],
    });

    const result = await uploadToFolder(3, [file("a.pdf")]);

    expect(result).toEqual({ fileIds: [2], skipped: [] });
  });

  it("reports files the server refused", async () => {
    const refused = { file_name: "big.pdf", reason: "Exceeds 40 MB per-file limit" };
    upload.mockResolvedValueOnce({ uploaded: [], skipped: [refused] });

    const result = await uploadToFolder(3, [file("big.pdf")]);

    expect(result).toEqual({ fileIds: [], skipped: [refused] });
  });
});
