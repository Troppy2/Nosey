import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchMcpConnections: vi.fn(),
  revokeMcpConnection: vi.fn(),
}));

vi.mock("../lib/api", () => ({ API_BASE_URL: "https://api.example.com", ...api }));
vi.mock("../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ConnectedApps } from "./ConnectedApps";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConnectedApps (Settings)", () => {
  it("shows the connector link and each app, and disconnects one", async () => {
    api.fetchMcpConnections.mockResolvedValue([
      { id: 1, client_name: "Claude", connected_at: "2026-10-14T12:00:00", last_used_at: null },
      { id: 2, client_name: "ChatGPT", connected_at: "2026-10-13T09:00:00", last_used_at: "2026-10-14T11:00:00" },
    ]);
    api.revokeMcpConnection.mockResolvedValue(undefined);

    render(<ConnectedApps />);
    fireEvent.click(screen.getByText("Connected apps"));

    expect(screen.getByText("https://api.example.com/mcp")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Claude")).toBeTruthy());
    expect(screen.getByText(/Not used yet/)).toBeTruthy();

    fireEvent.click(screen.getAllByText("Disconnect")[0]);
    await waitFor(() => expect(screen.queryByText("Claude")).toBeNull());
    expect(api.revokeMcpConnection).toHaveBeenCalledWith(1);
    expect(screen.getByText("ChatGPT")).toBeTruthy();
  });

  it("says so when nothing is connected", async () => {
    api.fetchMcpConnections.mockResolvedValue([]);
    render(<ConnectedApps />);
    fireEvent.click(screen.getByText("Connected apps"));
    await waitFor(() => expect(screen.getByText("No apps connected.")).toBeTruthy());
  });
});
