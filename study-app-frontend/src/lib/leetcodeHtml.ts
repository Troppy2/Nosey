import type { LeetCodeProblemData } from "./types";

// Strips a LeetCode problem statement down to a safe subset of tags before it is
// rendered with dangerouslySetInnerHTML. Shared by LeetCode mode and the Mock
// Interview OA so both surfaces sanitize identically.
export function sanitizeLeetCodeHtml(html: string): string {
  if (typeof window === "undefined") return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const allowed = new Set(["p", "pre", "code", "strong", "em", "ul", "ol", "li", "sup", "sub"]);

  const clean = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const tag = element.tagName.toLowerCase();
      if (!allowed.has(tag)) {
        const fragment = document.createDocumentFragment();
        while (element.firstChild) fragment.appendChild(element.firstChild);
        element.replaceWith(fragment);
        return;
      }
      Array.from(element.attributes).forEach((attribute) => element.removeAttribute(attribute.name));
    }
    Array.from(node.childNodes).forEach(clean);
  };

  Array.from(doc.body.childNodes).forEach(clean);
  return doc.body.innerHTML;
}

// A problem can be executed in-app only when it ships a Python Solution stub and
// at least one worked example to test against.
export function isLeetCodeRunnable(problemData?: LeetCodeProblemData | null): boolean {
  const snippet = problemData?.python_snippet ?? "";
  return snippet.includes("class Solution") && !!problemData?.examples.length;
}
