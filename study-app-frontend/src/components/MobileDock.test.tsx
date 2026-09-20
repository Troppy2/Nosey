import { describe, expect, it } from "vitest";
import { isImmersiveRoute } from "./MobileDock";

// An immersive route renders NO mobile nav dock (Sidebar.tsx), so the page is
// responsible for its own way out. Getting one of these patterns wrong strands
// a phone user with no navigation at all, which is why the boundaries are
// pinned here rather than eyeballed.
describe("isImmersiveRoute", () => {
  it("treats the article lesson as immersive so its audio player owns the bottom edge", () => {
    expect(isImmersiveRoute("/flashcards/7/modules/42")).toBe(true);
  });

  it("leaves the module hub navigable", () => {
    // One segment shorter than the lesson route. This is where the lesson's
    // own back button sends you, so hiding the dock here would strand a phone
    // user with no navigation at all.
    expect(isImmersiveRoute("/flashcards/7/modules")).toBe(false);
  });

  it("does not swallow deeper or adjacent flashcard routes", () => {
    expect(isImmersiveRoute("/flashcards/7")).toBe(false);
    expect(isImmersiveRoute("/flashcards/7/modules/42/extra")).toBe(false);
    expect(isImmersiveRoute("/flashcards/7/manage")).toBe(false);
  });

  it("keeps the routes that were already immersive", () => {
    expect(isImmersiveRoute("/flashcards/7/episode/42")).toBe(true);
    expect(isImmersiveRoute("/flashcards/7/review")).toBe(true);
    expect(isImmersiveRoute("/flashcards/7/matching")).toBe(true);
    expect(isImmersiveRoute("/test/12")).toBe(true);
    expect(isImmersiveRoute("/kojo/chat")).toBe(true);
    expect(isImmersiveRoute("/leetcode")).toBe(true);
  });

  it("leaves ordinary pages navigable", () => {
    expect(isImmersiveRoute("/dashboard")).toBe(false);
    expect(isImmersiveRoute("/folders")).toBe(false);
    expect(isImmersiveRoute("/settings")).toBe(false);
    expect(isImmersiveRoute("/create-test")).toBe(false);
  });
});
