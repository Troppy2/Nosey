import { describe, expect, it } from "vitest";

import { SD_CONCEPTS, SD_MOCK_PACKAGES, getConcept } from "./index";

// Mirrors the backend's shape check in system_design_schema.py. Bundled content
// that broke this would produce a 400 from every progress call.
const CONCEPT_ID_PATTERN = /^[a-z0-9-]{1,80}$/;

describe("the System Design concept registry", () => {
  it("ships at least one concept", () => {
    expect(SD_CONCEPTS.length).toBeGreaterThan(0);
  });

  it("is sorted by order", () => {
    const orders = SD_CONCEPTS.map((concept) => concept.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("has unique concept ids", () => {
    const ids = SD_CONCEPTS.map((concept) => concept.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has unique orders", () => {
    const orders = SD_CONCEPTS.map((concept) => concept.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it("gives every concept an id the backend accepts", () => {
    for (const concept of SD_CONCEPTS) {
      expect(concept.id).toMatch(CONCEPT_ID_PATTERN);
    }
  });

  it("resolves a known id through getConcept", () => {
    expect(getConcept(SD_CONCEPTS[0].id)).toBe(SD_CONCEPTS[0]);
  });

  it("returns null from getConcept for an unknown id", () => {
    expect(getConcept("not-a-concept")).toBeNull();
  });

  it("resolves every mockPackages id an exercise references", () => {
    for (const concept of SD_CONCEPTS) {
      for (const exercise of [concept.visualizer, concept.project]) {
        for (const packageId of exercise.mockPackages) {
          expect(SD_MOCK_PACKAGES[packageId], `${concept.id}/${exercise.kind}: ${packageId}`)
            .toBeTypeOf("string");
        }
      }
    }
  });

  it("always provides the sim package", () => {
    expect(SD_MOCK_PACKAGES.sim).toContain("def record(");
  });
});
