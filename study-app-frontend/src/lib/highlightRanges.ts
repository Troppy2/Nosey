// Persistent text highlighting for Take Test tools (beta).
//
// Uses the CSS Custom Highlight API (CSS.highlights + Highlight + Range) so we
// paint highlights over text ranges WITHOUT mutating the DOM that React owns.
// Mutating React-rendered nodes directly (wrapping text in <mark>) risks the
// classic "removeChild on Node" crash during reconciliation, so we avoid it.
//
// Highlights are stored as plain text snippets per question. On each render we
// rebuild the ranges by searching the question's rendered text nodes for those
// snippets. Snippets that span multiple text nodes (e.g. across a bold span) are
// not re-applied. That is an acceptable beta limitation: most highlights land
// inside a single text node.

const HIGHLIGHT_NAME = "nosey-test-highlight";

type HighlightCtor = new (...ranges: Range[]) => {
  add(range: Range): void;
};

interface HighlightRegistry {
  set(name: string, highlight: object): void;
  delete(name: string): void;
}

function getHighlightCtor(): HighlightCtor | null {
  const ctor = (window as unknown as { Highlight?: HighlightCtor }).Highlight;
  return ctor ?? null;
}

function getRegistry(): HighlightRegistry | null {
  const css = (window as unknown as { CSS?: { highlights?: HighlightRegistry } }).CSS;
  return css?.highlights ?? null;
}

// True when the browser supports the CSS Custom Highlight API.
export const HIGHLIGHT_SUPPORTED = getHighlightCtor() !== null && getRegistry() !== null;

// Returns the trimmed selected text if the current selection is non-empty and
// fully contained inside `container`, otherwise null.
export function getContainedSelectionText(container: HTMLElement): string | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const text = selection.toString().trim();
  return text.length > 0 ? text : null;
}

// Rebuilds the highlight ranges for `container` from `snippets`. Replaces any
// previously registered highlight. Skips text inside KaTeX math so we never
// split rendered equations.
export function applyTextHighlights(container: HTMLElement, snippets: string[]): void {
  const HighlightImpl = getHighlightCtor();
  const registry = getRegistry();
  if (!HighlightImpl || !registry) return;

  const highlight = new HighlightImpl();

  if (snippets.length > 0) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (parent && parent.closest(".katex, .math-inline, .math-block")) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode()) !== null) {
      textNodes.push(node as Text);
    }

    for (const snippet of snippets) {
      const needle = snippet.toLowerCase();
      if (!needle) continue;
      for (const textNode of textNodes) {
        const haystack = (textNode.textContent ?? "").toLowerCase();
        let from = haystack.indexOf(needle);
        while (from !== -1) {
          const range = document.createRange();
          range.setStart(textNode, from);
          range.setEnd(textNode, from + snippet.length);
          highlight.add(range);
          from = haystack.indexOf(needle, from + snippet.length);
        }
      }
    }
  }

  registry.set(HIGHLIGHT_NAME, highlight);
}

// Removes the registered highlight (e.g. on unmount or question change).
export function clearTextHighlights(): void {
  const registry = getRegistry();
  if (!registry) return;
  registry.delete(HIGHLIGHT_NAME);
}
