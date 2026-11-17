import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    fetchKojoConversation: vi.fn().mockResolvedValue({ messages: [] }),
    fetchProviderStatus: vi.fn().mockResolvedValue({}),
    kojoChatStream: vi.fn(),
    kojoChat: vi.fn(),
  };
});
const selectionSettings = vi.hoisted(() => ({ generationProvider: "auto", betaMode: false }));
vi.mock("../lib/useSettings", () => ({ useSettings: () => selectionSettings }));
vi.mock("../lib/useChatScroll", () => ({ useChatScroll: () => ({
  containerRef: { current: null }, endRef: { current: null }, atBottom: true, scrollToBottom: vi.fn(),
}) }));
vi.mock("./KojoMascot", () => ({ default: () => null }));
vi.mock("./MarkdownContent", () => ({ MarkdownContent: ({ content }: { content: string }) => <p>{content}</p> }));

import { KojoChat } from "./KojoChat";
import { SelectionKojoAssistant } from "./SelectionKojoAssistant";
import { KojoStreamError, kojoChat, kojoChatStream } from "../lib/api";

const message = "Kojo got tangled up, try again.";
afterEach(() => { selectionSettings.generationProvider = "auto"; cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

it("keeps the student's message and drops the assistant on a terminal error without retry", async () => {
  vi.mocked(kojoChatStream).mockRejectedValue(new KojoStreamError(message));
  const { container } = render(<KojoChat folderId={1} folderName="Math" onClose={() => {}} />);
  await screen.findByText("Hi, I'm Kojo");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Explain quadrature" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText(message);
  expect(screen.getByText("Explain quadrature")).toBeTruthy();
  expect(container.querySelector(".kojo-message--assistant")).toBeNull();
  expect(kojoChatStream).toHaveBeenCalledTimes(1);
  expect(kojoChat).not.toHaveBeenCalled();
});

it("does not restart a failed selection explanation when loading clears", async () => {
  vi.mocked(kojoChatStream).mockRejectedValue(new KojoStreamError(message));
  render(<SelectionKojoAssistant folderId={1} folderName="Math"><p>Quadrature notes</p></SelectionKojoAssistant>);
  const text = screen.getByText("Quadrature notes");
  const range = {
    commonAncestorContainer: text,
    getBoundingClientRect: () => ({ left: 100, top: 100, bottom: 130, width: 100, height: 30 }),
  };
  vi.spyOn(window, "getSelection").mockReturnValue({
    isCollapsed: false, toString: () => "Quadrature notes", rangeCount: 1, getRangeAt: () => range,
  } as unknown as Selection);
  fireEvent.mouseUp(text);
  fireEvent.click(await screen.findByRole("button", { name: "Ask Kojo" }));
  await screen.findByText(message);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  await waitFor(() => expect(kojoChatStream).toHaveBeenCalledTimes(1));
  expect(kojoChat).not.toHaveBeenCalled();
});


async function openPendingSelection(top = 100) {
  render(<SelectionKojoAssistant folderId={1} folderName="Math"><p>Conditional probability</p></SelectionKojoAssistant>);
  const text = screen.getByText("Conditional probability");
  vi.spyOn(window, "getSelection").mockReturnValue({
    isCollapsed: false, toString: () => "Conditional probability", rangeCount: 1,
    getRangeAt: () => ({ commonAncestorContainer: text,
      getBoundingClientRect: () => ({ left: 100, top, bottom: top + 30, width: 100, height: 30 }),
    }),
  } as unknown as Selection);
  fireEvent.mouseUp(text);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.click(screen.getByRole("button", { name: "Ask Kojo" }));
}

it("shows immediate waiting feedback and cancels without rendering late content", async () => {
  vi.useFakeTimers();
  let receive: ((text: string) => void) | undefined;
  let signal: AbortSignal | undefined;
  vi.mocked(kojoChatStream).mockImplementation((_folder, _prompt, handler, _provider, _strictness, _conversation, _instruction, abort) => {
    receive = handler as (text: string) => void;
    signal = abort;
    return new Promise(() => {});
  });
  selectionSettings.generationProvider = "groq";
  await openPendingSelection();
  expect(vi.mocked(kojoChatStream).mock.calls[0]?.[3]).toBe("groq");
  expect(screen.getByRole("status").textContent).toContain("Preparing your explanation");
  await act(async () => { await vi.advanceTimersByTimeAsync(11000); });
  expect(screen.getByRole("status").textContent).toContain("Still working");
  expect(kojoChatStream).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(signal?.aborted).toBe(true);
  act(() => receive?.("Late reply must not appear"));
  expect(screen.queryByText("Late reply must not appear")).toBeNull();
  expect(screen.queryByRole("dialog", { name: "Kojo explanation" })).toBeNull();
  expect(kojoChat).not.toHaveBeenCalled();
});

it("times out once, retries only on request, and ignores the old request's late error", async () => {
  vi.useFakeTimers();
  let rejectOld: ((err: Error) => void) | undefined;
  const signals: Array<AbortSignal | undefined> = [];
  vi.mocked(kojoChatStream).mockImplementation((_folder, _prompt, _handler, _provider, _strictness, _conversation, _instruction, signal) => {
    signals.push(signal);
    return new Promise((_resolve, reject) => { if (signals.length === 1) rejectOld = reject; });
  });
  await openPendingSelection();
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(signals[0]?.aborted).toBe(true);
  expect(screen.getByRole("alert").textContent).toContain("Kojo took too long");
  expect(kojoChatStream).toHaveBeenCalledTimes(1);
  expect(kojoChat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(kojoChatStream).toHaveBeenCalledTimes(2);
  expect(signals[1]?.aborted).toBe(false);
  await act(async () => { rejectOld?.(new Error("Old failure")); });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("Preparing your explanation");
});

it("renders streamed text immediately and keeps one request alive until completion", async () => {
  vi.useFakeTimers();
  let receive: ((text: string) => void) | undefined;
  let resolveReply: ((value: Awaited<ReturnType<typeof kojoChatStream>>) => void) | undefined;
  vi.mocked(kojoChatStream).mockImplementation((_folder, _prompt, handler) => {
    receive = handler as (text: string) => void;
    return new Promise((resolve) => { resolveReply = resolve; });
  });
  await openPendingSelection();
  act(() => receive?.("Condition on the remaining interval."));
  expect(screen.getByText("Condition on the remaining interval.")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  expect(kojoChatStream).toHaveBeenCalledTimes(1);
  await act(async () => { resolveReply?.({ response: "A complete explanation.", conversation_id: 1, message_id: 2, flagged_uncertain: false }); });
  expect(screen.getByText("A complete explanation.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
});


it("shows a retryable error for an empty successful response instead of a blank panel", async () => {
  vi.useFakeTimers();
  vi.mocked(kojoChatStream).mockResolvedValue({ response: "  ", conversation_id: 1, message_id: 2, flagged_uncertain: false });
  await openPendingSelection();
  await act(async () => {});
  expect(screen.getByRole("alert").textContent).toContain("empty explanation");
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  expect(kojoChatStream).toHaveBeenCalledTimes(1);
});


it("keeps the expanded explanation on screen for a selection near the bottom", async () => {
  vi.useFakeTimers();
  vi.mocked(kojoChatStream).mockImplementation(() => new Promise(() => {}));
  await openPendingSelection(window.innerHeight - 40);
  const panel = screen.getByRole("dialog", { name: "Kojo explanation" });
  const top = Number.parseFloat(panel.style.top);
  expect(top).toBeGreaterThanOrEqual(16);
  expect(top + Math.min(560, window.innerHeight - 48)).toBeLessThanOrEqual(window.innerHeight - 16);
  expect(screen.getByRole("status")).toBeTruthy();
});
