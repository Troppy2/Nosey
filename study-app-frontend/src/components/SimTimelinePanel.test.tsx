import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import SimTimelinePanel from "./SimTimelinePanel";
import type { SimEvent } from "../lib/sdHarness";

afterEach(() => {
  cleanup();
});

const EVENTS: SimEvent[] = [
  { t: 1, kind: "cache_miss", payload: { key: "a" } },
  { t: 2, kind: "cache_hit", payload: { key: "a" } },
  { t: 3, kind: "cache_hit", payload: { key: "b" } },
  { t: 4, kind: "snapshot", payload: { label: "cache", keys: ["a", "b"] } },
];

describe("SimTimelinePanel", () => {
  it("renders an empty state with the sim.record hint when there are no events", () => {
    render(<SimTimelinePanel events={[]} />);
    expect(screen.getByTestId("sd-timeline-empty")).toBeTruthy();
    expect(screen.getByText(/sim\.record/)).toBeTruthy();
  });

  it("renders one row per event, in t order", () => {
    render(<SimTimelinePanel events={EVENTS} />);
    const rows = screen.getAllByTestId("sd-timeline-row");
    expect(rows).toHaveLength(EVENTS.length);
    expect(rows.map((row) => row.dataset.kind)).toEqual([
      "cache_miss",
      "cache_hit",
      "cache_hit",
      "snapshot",
    ]);
  });

  it("renders the event kind as a chip and the payload as key/value pairs", () => {
    render(<SimTimelinePanel events={[EVENTS[0]]} />);
    const row = screen.getByTestId("sd-timeline-row");
    expect(within(row).getByTestId("sd-timeline-kind").textContent).toBe("cache_miss");
    expect(within(row).getByText("key").textContent).toBe("key");
    expect(within(row).getByText('"a"')).toBeTruthy();
  });

  it("renders a snapshot event as a distinct state block with its label", () => {
    render(<SimTimelinePanel events={[EVENTS[3]]} />);
    const row = screen.getByTestId("sd-timeline-row");
    expect(row.dataset.snapshot).toBe("true");
    expect(within(row).getByTestId("sd-timeline-snapshot-label").textContent).toBe("cache");
  });

  it("counts events by kind in the summary strip", () => {
    render(<SimTimelinePanel events={EVENTS} />);
    const summary = screen.getByTestId("sd-timeline-summary");
    const counts = within(summary)
      .getAllByTestId("sd-timeline-count")
      .map((node) => node.getAttribute("data-count-for") + ":" + node.dataset.count);
    expect(counts).toContain("cache_hit:2");
    expect(counts).toContain("cache_miss:1");
    expect(counts).toContain("snapshot:1");
  });

  it("renders the last snapshot large", () => {
    render(
      <SimTimelinePanel
        events={[
          { t: 1, kind: "snapshot", payload: { label: "cache", keys: ["a"] } },
          { t: 5, kind: "snapshot", payload: { label: "cache", keys: ["a", "b"] } },
        ]}
      />,
    );
    const featured = screen.getByTestId("sd-timeline-final-snapshot");
    expect(within(featured).getByText('["a","b"]')).toBeTruthy();
  });

  it("does not crash on payload values of an unexpected type", () => {
    render(
      <SimTimelinePanel
        events={[
          {
            t: 1,
            kind: "odd",
            payload: {
              nested: { a: [1, 2, { b: 3 }] },
              nothing: null,
              flag: true,
              long: "x".repeat(5000),
            },
          },
        ]}
      />,
    );
    expect(screen.getAllByTestId("sd-timeline-row")).toHaveLength(1);
    expect(screen.getByText("nested")).toBeTruthy();
    expect(screen.getByText("null")).toBeTruthy();
    expect(screen.getByText("true")).toBeTruthy();
  });

  it("renders payload strings as text and never as HTML", () => {
    render(
      <SimTimelinePanel
        events={[{ t: 1, kind: "xss", payload: { key: "<img src=x onerror=alert(1)>" } }]}
      />,
    );
    const row = screen.getByTestId("sd-timeline-row");
    expect(row.querySelector("img")).toBeNull();
    expect(row.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
