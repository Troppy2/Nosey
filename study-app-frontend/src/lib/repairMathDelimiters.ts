// Repairs maths whose LaTeX environment was deleted before it was stored.
//
// This runs inside MarkdownContent, so it applies to EVERY surface that
// renders markdown: Kojo chat, lessons, flashcards, tests, results, LeetCode
// feedback, system design notes. It is not tied to any one page, and there is
// no button: content that was damaged before it reached the database renders
// correctly from now on wherever it appears.
//
// The damage. The backend's normalize_latex used to rewrite
// \begin{env}...\end{env} to $$...$$. It ran even on maths that was already
// delimited, and it DELETED the environment rather than wrapping it:
//
//   $$\mathbf{c} = \begin{bmatrix} 1 \\ 2 \\ 3 \end{bmatrix}$$
//     ->  $$\mathbf{c} = $$ 1 \\ 2 \\ 3 $$$$
//     ->  $$\mathbf{c} = $$ 1 \\ 2 \\ 3 $$      (its "$$$$" -> "$$" cleanup)
//
// leaving an orphaned run of three delimiters and a bare environment body.
// That is fixed at the source now, but the damaged text is already stored.
//
// What cannot be recovered: the environment NAME. It was deleted outright, so
// bmatrix, pmatrix, cases and array are indistinguishable in the stored text.
// This module assumes bmatrix, which is what the reported articles used and
// what models overwhelmingly emit for vectors and matrices, and aligned when
// the body aligns on a relation (&=, &\leq). Square brackets on what was once
// a pmatrix is a far smaller error than the paragraph of red KaTeX error text
// the damage produces today.

// Code is content and is never touched.
const CODE_RE = /```[\s\S]*?```|`[^`\n]*`/g;

// An orphaned run: $$ head $$ body $$. Neither part may contain a lone $, so
// this can never span the inline maths in the prose between two real blocks.
const ORPHANED_RUN_RE = /\$\$([^$]*?)\$\$([^$]*?)\$\$/g;

// A balanced block that lost its wrapper: $$ body $$ with no environment. Only
// repaired when the body contains &, which outside an environment is a hard
// KaTeX error ("Expected 'EOF', got '&'") rather than a matter of taste.
const UNWRAPPED_BLOCK_RE = /\$\$([^$]*?)\$\$/g;

// An environment body is rows of cells, not a sentence. Three or more English
// words of four letters or more means this is prose sitting between two real
// display blocks, not a matrix that lost its wrapper.
function looksLikeProse(text: string): boolean {
  const stripped = text
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}^_()[\]&$*=+\-/<>|\\]/g, " ");
  return (stripped.match(/[a-zA-Z]{4,}/g) ?? []).length >= 3;
}

// Rows separated by \\, or cells separated by &, and no environment already.
function isEnvironmentBody(body: string, requireRowSeparator: boolean): boolean {
  if (body.includes("\\begin{") || body.includes("\\end{")) return false;
  if (/\n[ \t]*\n/.test(body)) return false;
  if (/^[ \t]*#{1,6} /m.test(body)) return false;
  if (looksLikeProse(body)) return false;
  if (requireRowSeparator && !/\\\\/.test(body)) return false;
  return /\\\\/.test(body) || body.includes("&");
}

// aligned when the cells align on a relation, bmatrix otherwise. See the note
// at the top of this file: the real name is unrecoverable.
function environmentFor(body: string): string {
  return /&\s*[=<>\\]/.test(body) ? "aligned" : "bmatrix";
}

function wrap(body: string): string {
  const env = environmentFor(body);
  return `\\begin{${env}}${body}\\end{${env}}`;
}

function repairSegment(segment: string): string {
  // Orphaned runs first, so the block pass below sees their output as already
  // carrying an environment and leaves it alone.
  let out = segment.replace(ORPHANED_RUN_RE, (whole, head: string, body: string) => {
    if (head.includes("\\begin{") || looksLikeProse(head)) return whole;
    if (/\n[ \t]*\n/.test(head)) return whole;
    if (!isEnvironmentBody(body, true)) return whole;
    return `$$${head}${wrap(body)}$$`;
  });

  out = out.replace(UNWRAPPED_BLOCK_RE, (whole, body: string) => {
    if (!body.includes("&")) return whole;
    if (!isEnvironmentBody(body, false)) return whole;
    return `$$${wrap(body)}$$`;
  });

  return out;
}

/**
 * Restores the LaTeX environment on maths that was stored with it deleted.
 * A no-op on undamaged content, and idempotent.
 */
export function repairMathDelimiters(source: string): string {
  if (!source || !source.includes("$$")) return source;

  let out = "";
  let last = 0;
  CODE_RE.lastIndex = 0;

  for (let m = CODE_RE.exec(source); m !== null; m = CODE_RE.exec(source)) {
    out += repairSegment(source.slice(last, m.index));
    out += m[0];
    last = m.index + m[0].length;
  }

  return out + repairSegment(source.slice(last));
}
