import { afterEach, expect, it, vi } from "vitest";
import { KojoStreamError, kojoChatStream } from "./api";

vi.mock("./backendStatus", () => ({
  reportBackendHttpFailure: vi.fn(),
  reportBackendNetworkFailure: vi.fn(),
}));
import { reportBackendNetworkFailure } from "./backendStatus";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it.each([false, true])("preserves terminal stream errors, with reasoning=%s", async (withReasoning) => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  const records = [
    ...(withReasoning ? [{ type: "reasoning", text: "A plan" }] : []),
    { type: "error", message: "Kojo got tangled up, try again." },
  ];
  const bytes = new TextEncoder().encode(records.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""));
  const fetchMock = vi.fn().mockResolvedValue(new Response(new ReadableStream({
    start(controller) {
      // Fragment the SSE record to cover the incremental parser as well.
      controller.enqueue(bytes.slice(0, 13));
      controller.enqueue(bytes.slice(13));
      controller.close();
    },
  }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const onDelta = vi.fn();
  const onReasoning = vi.fn();
  const error = await kojoChatStream(1, "Question", { onDelta, onReasoning }).catch((err) => err);
  expect(error).toBeInstanceOf(KojoStreamError);
  expect(error.message).toBe("Kojo got tangled up, try again.");
  expect(onDelta).not.toHaveBeenCalled();
  expect(onReasoning).toHaveBeenCalledTimes(withReasoning ? 1 : 0);
  expect(reportBackendNetworkFailure).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
