import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    fetchFolderFiles: vi.fn(),
    uploadFolderFiles: vi.fn(),
    deleteFolderFile: vi.fn(),
    addFolderTextNote: vi.fn(),
  };
});

import { deleteFolderFile, fetchFolderFiles, type FolderFile, uploadFolderFiles } from "../lib/api";
import { FileManager } from "./FileManager";

const FOLDER_ID = 7;

function row(overrides: Partial<FolderFile>): FolderFile {
  return {
    id: 1,
    folder_id: FOLDER_ID,
    file_name: "notes.pdf",
    file_type: "pdf",
    size_bytes: 2048,
    upload_status: "ready",
    upload_error: null,
    upload_note: null,
    pages_done: null,
    pages_total: null,
    uploaded_at: "2026-09-29T12:00:00",
    ...overrides,
  };
}

const FAILED = row({ id: 11, file_name: "big.pdf", upload_status: "error", upload_error: "Upload interrupted. Please try again." });

beforeAll(() => {
  if (!window.matchMedia) {
    vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  }
});

beforeEach(() => {
  vi.mocked(deleteFolderFile).mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openWith(files: FolderFile[]) {
  vi.mocked(fetchFolderFiles).mockResolvedValue(files);
  render(<FileManager folderId={FOLDER_ID} onClose={() => {}} />);
  await screen.findByText(files[0].file_name);
}

function pickReplacement(name: string) {
  fireEvent.click(screen.getByRole("button", { name: `Re-upload ${FAILED.file_name}` }));
  const replacement = new File(["%PDF-1.4"], name, { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Replacement file"), { target: { files: [replacement] } });
  return replacement;
}

describe("FileManager recovery", () => {
  it("re-uploads a failed file and removes the failed row once the new one is accepted", async () => {
    await openWith([FAILED]);
    const uploaded = row({ id: 12, file_name: "big.pdf", upload_status: "processing" });
    vi.mocked(uploadFolderFiles).mockResolvedValue({ uploaded: [uploaded], skipped: [] });

    const replacement = pickReplacement("big.pdf");

    await waitFor(() => expect(deleteFolderFile).toHaveBeenCalledWith(FOLDER_ID, FAILED.id));
    expect(uploadFolderFiles).toHaveBeenCalledWith(FOLDER_ID, [replacement]);
    expect(await screen.findByText("Waiting to start…")).toBeTruthy();
    expect(screen.queryByText("Upload interrupted. Please try again.")).toBeNull();
  });

  it("keeps the failed row and shows why when the re-upload is skipped", async () => {
    await openWith([FAILED]);
    vi.mocked(uploadFolderFiles).mockResolvedValue({
      uploaded: [],
      skipped: [{ file_name: "big.pdf", reason: "Exceeds 40 MB per-file limit" }],
    });

    pickReplacement("big.pdf");

    expect(await screen.findByText(/Exceeds 40 MB per-file limit/)).toBeTruthy();
    expect(deleteFolderFile).not.toHaveBeenCalled();
    expect(screen.getByText("Upload interrupted. Please try again.")).toBeTruthy();
  });
});

describe("FileManager status lines", () => {
  it("shows page progress for a PDF being read", async () => {
    await openWith([row({ upload_status: "processing", pages_done: 41, pages_total: 300 })]);

    expect(screen.getByText("Reading page 42 of 300")).toBeTruthy();
  });

  it("shows the page-cap note on a ready file", async () => {
    await openWith([row({ upload_note: "Read the first 300 of 812 pages." })]);

    expect(screen.getByText("Read the first 300 of 812 pages.")).toBeTruthy();
  });
});

describe("FileManager long PDFs", () => {
  it("shows a ready textbook still reading more pages and keeps refreshing it", async () => {
    const reading = row({ id: 21, file_name: "textbook.pdf", pages_done: 419, pages_total: 812 });
    await openWith([reading]);

    expect(screen.getByText("Reading more: page 420 of 812")).toBeTruthy();
    vi.mocked(fetchFolderFiles).mockResolvedValue([{ ...reading, pages_done: 812, pages_total: 812 }]);
    await waitFor(() => expect(screen.queryByText(/Reading more/)).toBeNull(), { timeout: 4500 });
    expect(fetchFolderFiles).toHaveBeenCalledTimes(2);
  });
});
