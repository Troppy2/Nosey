import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MarkdownContent, safeHttpUrl } from "./MarkdownContent";

afterEach(cleanup);

const renderOb = (content: string) => render(<MarkdownContent content={content} obsidian />).container;

describe("MarkdownContent obsidian flavor", () => {
  it("renders highlight, strike and http links", () => {
    const c = renderOb("A ==key idea== and ~~wrong~~ see [docs](https://example.com/a) or https://example.org/b.");
    expect(c.querySelector("mark")?.textContent).toBe("key idea");
    expect(c.querySelector("del")?.textContent).toBe("wrong");
    const links = [...c.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://example.com/a", "https://example.org/b"]);
    for (const a of links) {
      expect(a.getAttribute("rel")).toContain("noopener");
      expect(a.getAttribute("target")).toBe("_blank");
    }
  });

  it("never turns script, javascript: or data: links into live markup", () => {
    const c = renderOb(
      '<script>alert(1)</script> <img src=x onerror="alert(2)"> [x](javascript:alert(3)) [y](data:text/html,hi) [[Wiki]]',
    );
    expect(c.querySelector("script, img, a, iframe")).toBeNull();
    expect(c.textContent).toContain("<script>alert(1)</script>");
    expect(c.textContent).toContain("[[Wiki]]");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeHttpUrl("https://ok.test/")).toBe("https://ok.test/");
  });

  it("shows visual fences as plain code instead of rendering them", () => {
    const c = renderOb('```mermaid\ngraph TD; A-->B\n```\n\n```json\n{"type":"chart"}\n```');
    expect(c.querySelectorAll("pre.kojo-code-block")).toHaveLength(2);
    expect(c.textContent).toContain("A-->B");
  });

  it("renders callouts, folding callouts and plain quotes", () => {
    const c = renderOb("> [!tip] Chain rule\n> Multiply the ==derivatives==\n\n> [!warning]- Careful\n> hidden\n\n> just a quote");
    const tip = c.querySelector(".md-callout--positive");
    expect(tip?.querySelector(".md-callout-title")?.textContent).toBe("Chain rule");
    expect(tip?.querySelector("mark")?.textContent).toBe("derivatives");
    const folded = c.querySelector("details.md-callout--caution") as HTMLDetailsElement | null;
    expect(folded?.open).toBe(false);
    expect(folded?.querySelector("summary")?.textContent).toBe("Careful");
    expect(c.querySelector("blockquote.md-quote")?.textContent).toBe("just a quote");
  });

  it("renders read-only task items and hides %% comments %%", () => {
    const c = renderOb("- [x] derive it\n- [ ] check units\n\nshown %%hidden note%% text");
    const boxes = [...c.querySelectorAll<HTMLInputElement>(".md-task input")];
    expect(boxes.map((b) => b.checked)).toEqual([true, false]);
    expect(boxes.every((b) => b.disabled)).toBe(true);
    expect(c.textContent).not.toContain("hidden note");
    expect(c.textContent).toContain("shown");
  });

  it("leaves the default flavor unchanged", () => {
    const c = render(<MarkdownContent content="a ==b== [c](https://x.test) > [!tip]" />).container;
    expect(c.querySelector("mark, a, .md-callout")).toBeNull();
    expect(c.textContent).toContain("==b==");
  });
});
