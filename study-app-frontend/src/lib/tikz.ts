// KaTeX cannot draw TikZ, so an answer key or feedback holding a
// \begin{tikzpicture} printed as a wall of source code (GH #156). New grading
// sends graphs as chart data; this covers anything already stored. Code
// fences are left alone: TikZ shown as code is meant to be read.
export const TIKZ_FALLBACK = "*(A graph goes here, but it was written in a drawing format Nosey can't display.)*";

const TIKZ_RE = /\$*\\begin\{(tikzpicture|pgfpicture)\}[\s\S]*?\\end\{\1\}\$*|\$*\\begin\{tikzpicture\}[\s\S]*$/g;

export function replaceTikz(text: string): string {
  if (!text || !text.includes("\\begin{")) return text;
  return text
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((part) => (part.startsWith("```") ? part : part.replace(TIKZ_RE, TIKZ_FALLBACK)))
    .join("");
}
