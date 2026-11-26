import katex from "katex";
import "katex/dist/katex.min.css";
import { CheckIcon, CopyIcon } from "../icons";
import React, { useState } from "react";

import { repairMathDelimiters } from "../lib/repairMathDelimiters";
import { VisualBlock, VisualPending, inferVisualLang, isVisualLang } from "./visuals/VisualBlock";
import { replaceTikz } from "../lib/tikz";
import "../styles/components/markdown-obsidian.css";

// ── KaTeX ─────────────────────────────────────────────────────────────────────

// Repairs for TeX that models commonly get wrong, which KaTeX otherwise shows
// as raw source in red. Only tried after a failed render, so valid TeX is
// never touched:
// - A bare # is a macro parameter and % starts a comment: "\text{# outcomes}",
//   "50%". Escape them.
// - A math-only command alone inside \text: "\text{\sum}" means the word
//   "sum". Drop the backslash.
export function repairTexForKatex(src: string): string {
  return src
    .replace(/\\text\{\\([a-zA-Z]+)\}/g, "\\text{$1}")
    .replace(/(?<!\\)[#%]/g, (ch) => `\\${ch}`);
}

// A matrix row break that lost one backslash ("4 & 2 \ 5 & 2") is a valid
// control space to KaTeX, so the matrix renders as one long row with no
// error. Stored scratch-pad reads have this (OCR cleanup bug fixed
// 2026-11-15), so it is repaired on every render, only inside row-based
// environments. A correct "\\" is never matched.
const ROW_ENV_RE =
  /(\\begin\{((?:[pbvBV]?matrix|smallmatrix|array|cases|aligned|gathered|split)\*?)\})([\s\S]*?)(\\end\{\2\})/g;
const LOST_ROW_BREAK_RE = /(?<!\\)\\(?=\s)/g;

export function repairMatrixRows(src: string): string {
  if (!src.includes("\\begin")) return src;
  return src.replace(
    ROW_ENV_RE,
    (_m, open: string, _env: string, body: string, close: string) =>
      open + body.replace(LOST_ROW_BREAK_RE, "\\\\") + close,
  );
}

function rkx(raw: string, display: boolean): string {
  const src = repairMatrixRows(raw);
  const render = (tex: string) =>
    katex.renderToString(tex, { displayMode: display, throwOnError: true, output: "html" });
  try {
    return render(src);
  } catch {
    try {
      return render(repairTexForKatex(src));
    } catch {
      return katex.renderToString(src, { displayMode: display, throwOnError: false, output: "html" });
    }
  }
}

// ── Math extraction ───────────────────────────────────────────────────────────
// Pull ALL math delimiters out BEFORE markdown parsing. This means $x$ inside
// *italic* or **bold** gets replaced with a placeholder, so the markdown
// tokenizer never sees the dollar signs. Placeholders are substituted back
// when rendering leaf text nodes.
//
// This is ONE left-to-right scan rather than a series of global replaces,
// because the order in which a stretch of text is claimed decides whether the
// result is right. Code has to be claimed before math (otherwise `echo $HOME
// and $USER` loses everything between the two dollars), and $$ has to be
// claimed before $ (otherwise a display block reads as two inline ones).

export interface MathEntry { display: boolean; src: string }

// Use ASCII control chars as delimiters , can't appear in LLM text output.
const PH_RE = /\x00M:(\d+):\x00/g;
const ph = (id: number) => `\x00M:${id}:\x00`;

// Alternatives are tried in this order at every position, so the list itself
// is the priority order described above.
//
// Inside math a backslash is consumed together with the character after it,
// so an escaped dollar never closes the span. Models write money as
// "$0.5 \times \$5000$"; without the pairing the span closed on the \$ and
// KaTeX was handed "0.5 \times \", which it renders as red error text.
const SCAN_RE = new RegExp(
  [
    "```[\\s\\S]*?```",                        // fenced code block
    "`[^`\\n]*`",                              // inline code span
    "\\\\\\$",                                 // escaped dollar
    "\\$\\$(?:\\\\[\\s\\S]|[^\\\\])*?\\$\\$",  // $$ ... $$
    "\\\\\\[[\\s\\S]*?\\\\\\]",                // \[ ... \]
    "\\\\\\([\\s\\S]*?\\\\\\)",                // \( ... \)
    "\\$(?:\\\\[^\\n]|[^$\\n\\\\])+\\$",       // $ ... $
  ].join("|"),
  "g",
);

// Display math is a single expression. A paragraph break, a markdown heading
// or a code fence inside one means the opening $$ never had a partner and got
// paired with an unrelated $$ further down, swallowing the prose in between.
// That is what turned a lesson into one red KaTeX error block, so refuse it.
//
// An unescaped $ inside is the same failure on a smaller scale: the equation
// was closed with one dollar ("$$ x $") and this capture ran on to the $$ that
// opens the next equation. KaTeX cannot render a bare $ in math mode, so the
// capture is always wrong. The exception is inline maths nested in a text
// group ("\text{if $x > 0$}"), which KaTeX does render, so those are
// removed before the check.
function isPlausibleDisplayMath(body: string): boolean {
  if (!body.trim()) return false;
  if (/\n[ \t]*\n/.test(body)) return false;
  if (/^[ \t]*#{1,6} /m.test(body)) return false;
  const outsideText = body.replace(/\\(?:text|mbox|textrm)\{[^{}]*\}/g, "").replace(/\\[\s\S]/g, "");
  if (outsideText.includes("$")) return false;
  return !body.includes("```");
}

// Real inline math is written tight ($x$) or evenly padded ($ x $). Two
// unrelated dollar amounts are neither: "costs $5 and the tax is $2" opens
// tight and closes on a space, so the padding is asymmetric.
function isPlausibleInlineMath(body: string): boolean {
  if (!body.trim()) return false;
  return /^\s/.test(body) === /\s$/.test(body);
}

// Exported so tests can assert on exactly what is handed to KaTeX. The
// rendered output is HTML only (no MathML annotation), so the extracted
// sources are not otherwise readable back off the DOM.
export function extractMath(raw: string): [string, MathEntry[]] {
  const reg: MathEntry[] = [];
  const add = (display: boolean, src: string): string => {
    const id = reg.length;
    reg.push({ display, src: src.trim() });
    return ph(id);
  };

  let out = "";
  let last = 0;
  SCAN_RE.lastIndex = 0;

  for (let m = SCAN_RE.exec(raw); m !== null; m = SCAN_RE.exec(raw)) {
    const tok = m[0];
    out += raw.slice(last, m.index);
    last = m.index + tok.length;

    // Code is content, not math, and passes through untouched.
    if (tok.startsWith("`")) { out += tok; continue; }
    // An escaped dollar was never a delimiter; emit the literal character.
    if (tok === "\\$") { out += "$"; continue; }

    const display = tok.startsWith("$$") || tok.startsWith("\\[");
    const openLen = tok.startsWith("$") ? (display ? 2 : 1) : 2;
    const body = tok.slice(openLen, tok.length - openLen);

    if (display ? isPlausibleDisplayMath(body) : isPlausibleInlineMath(body)) {
      out += add(display, body);
      continue;
    }

    // Not math after all. Emit just the opening delimiter and resume scanning
    // immediately after it, so a later delimiter can still find its real
    // partner instead of the whole run being lost.
    out += tok.slice(0, openLen);
    last = m.index + openLen;
    SCAN_RE.lastIndex = last;
  }

  return [out + raw.slice(last), reg];
}

// ── Auto-wrap: undelimited math lines ─────────────────────────────────────────
// Some LLMs output bare LaTeX without $$ delimiters. Detect lines that are
// clearly math expressions. Critically: skip lines that look like English prose
// with LaTeX mixed in , those caused the "Integrateusingthepowerrule" bug.

const LATEX_CMD_RE =
  /\\(?:frac|int|sum|prod|sqrt|left|right|partial|nabla|infty|cdot|times|div|pm|mp|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|nu|pi|rho|sigma|tau|phi|omega|hbar|ell|lim|sin|cos|tan|log|ln|exp|det|max|min|sup|inf|leq|geq|neq|approx|equiv|rightarrow|leftarrow|Rightarrow|Leftarrow|cdots|ldots|vec|hat|bar|widehat|overline)\b/;

function looksLikeProse(line: string): boolean {
  // Strip LaTeX commands (with optional braced arg) and math punctuation,
  // then count English words of 4+ characters.
  const stripped = line
    .replace(/\\[a-zA-Z]+(\{[^}]*\})?/g, " ")
    .replace(/[{}^_()\[\]$*=+\-/<>|]/g, " ");
  const words = stripped.match(/[a-zA-Z]{4,}/g) ?? [];
  // 3+ English words → this is a prose sentence, not a math expression
  return words.length >= 3;
}

function autoWrapMath(text: string, reg: MathEntry[]): string {
  let inFence = false;
  return text
    .split("\n")
    .map((line) => {
      if (line.startsWith("```")) {
        inFence = !inFence;
        return line;
      }
      // Code is content: a line of a code block is never auto-wrapped as math.
      if (inFence) return line;
      // Skip lines that already have math placeholders, are empty,
      // are markdown structural elements, or look like prose.
      if (
        line.includes("\x00M:") ||
        line.trim() === "" ||
        line.startsWith("#") ||
        /^[-*+] /.test(line) ||
        /^\d+\.\s/.test(line) ||
        line.startsWith("|")
      ) return line;

      const cmds = (line.match(/\\[a-zA-Z]+/g) ?? []).length;
      if (cmds < 2 || !LATEX_CMD_RE.test(line)) return line;

      // Final guard: don't wrap prose that happens to contain LaTeX commands
      if (looksLikeProse(line)) return line;

      const id = reg.length;
      reg.push({ display: true, src: line.trim() });
      return ph(id);
    })
    .join("\n");
}

// ── Inline tokenizer ──────────────────────────────────────────────────────────
// Scans markdown emphasis across the WHOLE line first, then resolves math
// placeholders inside each resulting text run.
//
// The order is the point. Splitting on placeholders first puts the ** that
// opens a run and the ** that closes it into two different chunks whenever
// there is math between them, so "**value $x^2$ matters**" never closes and
// renders its asterisks literally. A placeholder is an inert run of control
// characters and digits, so the emphasis scanner passes over it safely.

type Seg =
  | { k: "text"; v: string }
  | { k: "bold"; v: string }
  | { k: "italic"; v: string }
  | { k: "code"; v: string }
  | { k: "mark"; v: string }
  | { k: "strike"; v: string }
  | { k: "link"; v: string; href: string }
  | { k: "math"; entry: MathEntry };

// ── Obsidian flavor (student-written answers) ─────────────────────────────────
// Student text is untrusted. Nothing here ever produces raw HTML: every node is
// a React element, so typed <script> or <img onerror> shows as literal text.
// Links are the only way out of the page, and only http(s) URLs become anchors;
// javascript:, data:, vbscript: and anything unparseable stay plain text.
export function safeHttpUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// Bare URLs in prose, trailing punctuation left out so "see https://x.com." works.
const BARE_URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"\]])/g;

// Finds the closing two-character delimiter ("==" or "~~") for a run opened at `start`.
function findPairCloser(chunk: string, start: number, delim: string): number {
  const close = chunk.indexOf(delim, start);
  return close > start ? close : -1;
}

// Finds the closing delimiter for an emphasis run starting at `start`.
// For bold (**), a matching ** is preferred; if none exists, a lone * is
// accepted as a tolerant closer. LLMs frequently emit malformed bold like
// "**Step 3:*" (opened with **, closed with a single *) , without this the
// whole run fails to parse and the asterisks render literally.
function findEmphasisCloser(chunk: string, start: number, wantDouble: boolean): [number, number] {
  const isLoneStar = (j: number) => chunk[j] === "*" && chunk[j + 1] !== "*" && chunk[j - 1] !== "*";

  if (wantDouble) {
    const dbl = chunk.indexOf("**", start);
    if (dbl > start) return [dbl, 2];
    // Fallback: a malformed bold run closed by a single *.
    for (let j = start; j < chunk.length; j++) {
      if (j > start && isLoneStar(j)) return [j, 1];
    }
    return [-1, 0];
  }

  for (let j = start; j < chunk.length; j++) {
    if (j > start && isLoneStar(j)) return [j, 1];
  }
  return [-1, 0];
}

// Scans a non-math text chunk into bold / italic / code / text segments.
// A hand-rolled scanner (rather than one regex) so an unbalanced bold run can
// gracefully close on a single star instead of failing outright.
function scanEmphasis(chunk: string, obsidian = false): Seg[] {
  const out: Seg[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ k: "text", v: buf }); buf = ""; } };

  let i = 0;
  while (i < chunk.length) {
    const c = chunk[i];

    if (c === "`") {
      const end = chunk.indexOf("`", i + 1);
      if (end > i + 1) { flush(); out.push({ k: "code", v: chunk.slice(i + 1, end) }); i = end + 1; continue; }
    }

    if (obsidian) {
      // ==highlight== and ~~strike~~
      const pair = chunk.slice(i, i + 2);
      if ((pair === "==" || pair === "~~") && chunk[i + 2] !== undefined && chunk[i + 2] !== pair[0]) {
        const closeIdx = findPairCloser(chunk, i + 2, pair);
        if (closeIdx !== -1) {
          flush();
          out.push({ k: pair === "==" ? "mark" : "strike", v: chunk.slice(i + 2, closeIdx) });
          i = closeIdx + 2;
          continue;
        }
      }
      // [label](http(s) url). Anything else (including [[wikilinks]]) stays text.
      if (c === "[" && chunk[i + 1] !== "[") {
        const m = /^\[([^\]\n]+)\]\(([^()\s]+)\)/.exec(chunk.slice(i));
        const href = m ? safeHttpUrl(m[2]) : null;
        if (m && href) {
          flush();
          out.push({ k: "link", v: m[1], href });
          i += m[0].length;
          continue;
        }
      }
    }

    if (c === "*") {
      const isDouble = chunk[i + 1] === "*";
      const contentStart = i + (isDouble ? 2 : 1);
      const next = chunk[contentStart];
      // Valid opener: content follows and it isn't another star.
      if (next !== undefined && next !== "*") {
        const [closeIdx, closeLen] = findEmphasisCloser(chunk, contentStart, isDouble);
        if (closeIdx !== -1) {
          flush();
          out.push({ k: isDouble ? "bold" : "italic", v: chunk.slice(contentStart, closeIdx) });
          i = closeIdx + closeLen;
          continue;
        }
      }
    }

    buf += c;
    i++;
  }

  flush();
  return out;
}

// Splits plain text on bare http(s) URLs (Obsidian flavor only).
function autolink(text: string): Seg[] {
  const out: Seg[] = [];
  const parts = text.split(BARE_URL_RE);
  for (let i = 0; i < parts.length; i++) {
    if (!parts[i]) continue;
    const href = i % 2 === 1 ? safeHttpUrl(parts[i]) : null;
    out.push(href ? { k: "link", v: parts[i], href } : { k: "text", v: parts[i] });
  }
  return out;
}

function tokenizeInline(text: string, reg: MathEntry[], obsidian = false): Seg[] {
  const segs: Seg[] = [];

  for (const seg of scanEmphasis(text, obsidian)) {
    // Bold and italic runs are re-tokenized by Inline's recursion, and a code
    // span is literal by definition, so only plain text is split here.
    if (seg.k !== "text") {
      segs.push(seg);
      continue;
    }

    // split() on a regex with a capturing group interleaves matched IDs into the array
    const parts = seg.v.split(PH_RE);
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        const entry = reg[parseInt(parts[i], 10)];
        if (entry) segs.push({ k: "math", entry });
        continue;
      }
      if (!parts[i]) continue;
      if (obsidian) segs.push(...autolink(parts[i]));
      else segs.push({ k: "text", v: parts[i] });
    }
  }

  return segs;
}

// Bold/italic segments are rendered recursively so that any math or formatting
// nested inside them is also processed (e.g. *Distribute the $x$ term:*).
function Inline({ text, reg, pk, ob = false }: { text: string; reg: MathEntry[]; pk: string; ob?: boolean }) {
  return (
    <>
      {tokenizeInline(text, reg, ob).map((seg, i) => {
        const key = `${pk}-${i}`;
        if (seg.k === "math") {
          const html = rkx(seg.entry.src, seg.entry.display);
          // A <span> even for display maths, because this renders inside <p>,
          // <h4> and table cells. A <div> there is invalid nesting, and the
          // browser recovers by closing the <p> early and splitting the
          // paragraph around it, which visibly scrambles the article.
          // .math-block already carries display: block, so this looks the same.
          return seg.entry.display
            ? <span key={key} className="math-block" dangerouslySetInnerHTML={{ __html: html }} />
            : <span key={key} className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />;
        }
        if (seg.k === "bold") return <strong key={key}><Inline text={seg.v} reg={reg} pk={`${key}b`} ob={ob} /></strong>;
        if (seg.k === "italic") return <em key={key}><Inline text={seg.v} reg={reg} pk={`${key}i`} ob={ob} /></em>;
        if (seg.k === "code") return <code key={key} className="kojo-inline-code">{seg.v}</code>;
        if (seg.k === "mark") return <mark key={key} className="md-highlight"><Inline text={seg.v} reg={reg} pk={`${key}m`} ob={ob} /></mark>;
        if (seg.k === "strike") return <del key={key}><Inline text={seg.v} reg={reg} pk={`${key}s`} ob={ob} /></del>;
        if (seg.k === "link") {
          return (
            <a key={key} className="md-link" href={seg.href} target="_blank" rel="noopener noreferrer nofollow">
              {seg.v}
            </a>
          );
        }
        return <React.Fragment key={key}>{seg.v}</React.Fragment>;
      })}
    </>
  );
}

// ── Fence normalization ───────────────────────────────────────────────────────
// The block parser only recognizes a fenced code block when ``` sits at the
// START of a line. LLMs sometimes glue an opening fence onto prose
// ("implementation: ```java if (...)") and drop a stray closing ``` on its own
// line. That makes the code render as literal backticks while the stray fence
// gets misread as an opening fence, swallowing following text as code.
//
// This pass reflows every triple-backtick delimiter onto its own line and, for
// an opening fence, splits code that was glued after the language token onto the
// next line. Correctly formatted input (fences already on their own lines) is
// left effectively unchanged.
function normalizeFences(raw: string): string {
  if (!raw.includes("```")) return raw;

  let out = "";
  let rest = raw;
  let inFence = false;

  while (true) {
    const idx = rest.indexOf("```");
    if (idx === -1) {
      out += rest;
      break;
    }
    out += rest.slice(0, idx);
    rest = rest.slice(idx + 3);

    // Put the fence delimiter at the start of its own line.
    if (out.length > 0 && !out.endsWith("\n")) out += "\n";
    out += "```";

    if (!inFence) {
      // Opening fence: the info string (language) runs to the end of the line.
      // If code was glued after the language token, push it to the next line.
      const nl = rest.indexOf("\n");
      const firstLine = nl === -1 ? rest : rest.slice(0, nl);
      const glued = firstLine.match(/^([A-Za-z0-9+#_.-]*)[ \t]+(\S.*)$/);
      if (glued) {
        out += glued[1] + "\n" + glued[2];
        rest = nl === -1 ? "" : rest.slice(nl);
      }
      inFence = true;
    } else {
      // Closing fence: make sure following content starts on a fresh line.
      if (rest.length > 0 && !rest.startsWith("\n")) out += "\n";
      inFence = false;
    }
  }

  return out;
}

// ── Code block ──────────────────────────────────────────────────────────────
// A fenced code block with an optional language label and a copy button. The
// copy button is opt-in (enableCopy) so surfaces like test options stay
// unchanged; only the chat surface turns it on.
function CodeBlock({ lang, src, enableCopy }: { lang: string; src: string; enableCopy: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(src);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (insecure context or denied) , silently no-op */
    }
  }

  const showHead = enableCopy || !!lang;

  return (
    <pre className="kojo-code-block">
      {showHead && (
        <div className="kojo-code-head">
          {lang && <span className="kojo-code-lang">{lang}</span>}
          {enableCopy && (
            <button type="button" className="kojo-code-copy" onClick={copy} aria-label={copied ? "Copied" : "Copy code"}>
              {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>
      )}
      <code>{src}</code>
    </pre>
  );
}

// ── Block parser ──────────────────────────────────────────────────────────────

// ── Obsidian block pre-pass ───────────────────────────────────────────────────
// %%comments%% are hidden (outside code fences), and runs of "> " lines are
// split out as blockquotes / callouts so their bodies can be rendered
// recursively, before math extraction ever sees them.

export function stripObsidianComments(raw: string): string {
  return raw
    .split(/(```[\s\S]*?```)/g)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(/%%[\s\S]*?%%/g, "")))
    .join("");
}

type ObsidianBlock = { kind: "md"; text: string } | { kind: "quote"; lines: string[] };

export function splitObsidianQuotes(raw: string): ObsidianBlock[] {
  const blocks: ObsidianBlock[] = [];
  let md: string[] = [];
  let inFence = false;
  const lines = raw.split("\n");
  const flushMd = () => {
    if (md.length) blocks.push({ kind: "md", text: md.join("\n") });
    md = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    if (!inFence && /^\s{0,3}>/.test(line)) {
      flushMd();
      const quote: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s{0,3}> ?/, ""));
        i++;
      }
      i--;
      blocks.push({ kind: "quote", lines: quote });
      continue;
    }
    md.push(line);
  }
  flushMd();
  return blocks;
}

// Obsidian callout types grouped onto the app's semantic accents.
const CALLOUT_TONE: Record<string, string> = {
  note: "info", info: "info", todo: "info", abstract: "neutral", summary: "neutral", tldr: "neutral",
  tip: "positive", hint: "positive", important: "positive", success: "positive", check: "positive", done: "positive",
  question: "caution", help: "caution", faq: "caution", warning: "caution", caution: "caution", attention: "caution",
  failure: "danger", fail: "danger", missing: "danger", danger: "danger", error: "danger", bug: "danger",
  example: "neutral", quote: "neutral", cite: "neutral",
};

const CALLOUT_HEAD_RE = /^\[!([A-Za-z-]+)\]([+-]?)\s*(.*)$/;

function ObsidianQuote({ lines, enableCodeCopy }: { lines: string[]; enableCodeCopy: boolean }) {
  const head = lines[0]?.match(CALLOUT_HEAD_RE);
  if (!head) {
    return (
      <blockquote className="md-quote">
        <MarkdownContent content={lines.join("\n")} enableCodeCopy={enableCodeCopy} obsidian />
      </blockquote>
    );
  }
  const type = head[1].toLowerCase();
  const fold = head[2];
  const title = head[3].trim() || type.charAt(0).toUpperCase() + type.slice(1);
  const body = lines.slice(1).join("\n");
  const className = `md-callout md-callout--${CALLOUT_TONE[type] ?? "info"}`;
  const titleNode = (
    <span className="md-callout-title">
      <Inline text={title} reg={[]} pk="ct" ob />
    </span>
  );
  const bodyNode = body.trim() ? (
    <div className="md-callout-body">
      <MarkdownContent content={body} enableCodeCopy={enableCodeCopy} obsidian />
    </div>
  ) : null;
  if (fold) {
    return (
      <details className={className} open={fold === "+"}>
        <summary>{titleNode}</summary>
        {bodyNode}
      </details>
    );
  }
  return (
    <div className={className} role="note">
      {titleNode}
      {bodyNode}
    </div>
  );
}

const TASK_RE = /^\[([ xX])\]\s+/;

// Memoized: parsing + KaTeX is the expensive part of every chat render, and
// both props are primitives. Without it, each keystroke in a chat composer and
// each streamed token re-rendered every earlier message from scratch.
//
// `obsidian` turns on the student-answer flavor (highlights, strike, safe links,
// callouts, quotes, task lists, hidden comments) and turns OFF everything that
// interprets text as a spec (graph/chart/mermaid visuals): student text is shown,
// never executed. Off, the renderer behaves exactly as before.
export const MarkdownContent = React.memo(function MarkdownContent({
  content,
  enableCodeCopy = false,
  obsidian = false,
}: {
  content: string;
  enableCodeCopy?: boolean;
  obsidian?: boolean;
}) {
  if (obsidian) {
    const blocks = splitObsidianQuotes(stripObsidianComments(content));
    if (blocks.some((block) => block.kind === "quote")) {
      return (
        <div className="kojo-markdown md-obsidian">
          {blocks.map((block, idx) =>
            block.kind === "quote" ? (
              <ObsidianQuote key={idx} lines={block.lines} enableCodeCopy={enableCodeCopy} />
            ) : (
              <MarkdownBlocks key={idx} content={block.text} enableCodeCopy={enableCodeCopy} obsidian />
            ),
          )}
        </div>
      );
    }
    return (
      <div className="kojo-markdown md-obsidian">
        <MarkdownBlocks content={blocks[0]?.kind === "md" ? blocks[0].text : ""} enableCodeCopy={enableCodeCopy} obsidian />
      </div>
    );
  }
  return (
    <div className="kojo-markdown">
      <MarkdownBlocks content={content} enableCodeCopy={enableCodeCopy} obsidian={false} />
    </div>
  );
});

function MarkdownBlocks({
  content,
  enableCodeCopy,
  obsidian,
}: {
  content: string;
  enableCodeCopy: boolean;
  obsidian: boolean;
}) {
  const ob = obsidian;
  // Step 0: reflow malformed code fences onto their own lines, and swap any
  // TikZ picture (which KaTeX cannot draw) for a short note (GH #156)
  const fenced = replaceTikz(normalizeFences(content));
  // Step 1: restore LaTeX environments that were deleted before storage. Every
  // surface renders through this component, so content damaged by the old
  // normalize_latex comes back correctly wherever it appears, with no per-page
  // wiring and nothing for the reader to press.
  const repaired = repairMathDelimiters(fenced);
  // Step 2: extract math into placeholders
  const [withPlaceholders, reg] = extractMath(repaired);
  // Step 3: auto-wrap bare LaTeX lines that have no delimiters
  const normalized = autoWrapMath(withPlaceholders, reg);

  const nodes: React.ReactNode[] = [];
  const lines = normalized.split("\n");
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Blank line ──────────────────────────────────────────────────────────
    if (line.trim() === "") { i++; continue; }

    // ── Lone math placeholder (display block) ───────────────────────────────
    // Happens when the LLM put $$...$$ on its own line. Render as block, not
    // inside a <p>, to avoid invalid block-in-inline HTML.
    const loneMathMatch = line.trim().match(/^\x00M:(\d+):\x00$/);
    if (loneMathMatch) {
      const entry = reg[parseInt(loneMathMatch[1], 10)];
      if (entry) {
        nodes.push(
          <div key={k++} className="math-block" dangerouslySetInnerHTML={{ __html: rkx(entry.src, true) }} />,
        );
        i++;
        continue;
      }
    }

    // ── Horizontal rule: ---, ***, ___ ─────────────────────────────────────
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      nodes.push(<hr key={k++} className="kojo-md-hr" />);
      i++;
      continue;
    }

    // ── Fenced code block ───────────────────────────────────────────────────
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) { code.push(lines[i]); i++; }
      const closed = i < lines.length;
      i++;
      const src = code.join("\n").trim();
      // Declarative visual spec (graph/geometry/mermaid/chart). While the reply
      // is still streaming the fence is unclosed, so show a placeholder instead
      // of trying to parse half a spec.
      // Student text (obsidian) never becomes a visual: a fence is shown as code.
      if (!ob && isVisualLang(lang)) {
        nodes.push(closed
          ? <VisualBlock key={k++} lang={lang} src={src} />
          : <VisualPending key={k++} lang={lang} />);
        continue;
      }
      // A spec fenced as ```json (or untagged) by a model that missed the tag.
      const inferred = closed && !ob ? inferVisualLang(lang, src) : null;
      if (inferred) {
        nodes.push(<VisualBlock key={k++} lang={inferred} src={src} />);
        continue;
      }
      // LLM sometimes wraps math in a code fence instead of $$ delimiters
      const looksLikeMath =
        !lang &&
        (src.startsWith("\\[") || src.startsWith("\\(") || src.startsWith("$$") || /^\\[a-zA-Z]/.test(src));
      if (looksLikeMath) {
        let expr = src;
        if (expr.startsWith("$$") && expr.endsWith("$$")) expr = expr.slice(2, -2).trim();
        else if (expr.startsWith("\\[") && expr.endsWith("\\]")) expr = expr.slice(2, -2).trim();
        else if (expr.startsWith("\\(") && expr.endsWith("\\)")) expr = expr.slice(2, -2).trim();
        nodes.push(<div key={k++} className="math-block" dangerouslySetInnerHTML={{ __html: rkx(expr, true) }} />);
      } else {
        nodes.push(<CodeBlock key={k++} lang={lang} src={src} enableCopy={enableCodeCopy} />);
      }
      continue;
    }

    // ── Heading ─────────────────────────────────────────────────────────────
    if (/^#{1,4} /.test(line)) {
      const level = line.match(/^(#+)/)?.[1].length ?? 1;
      const text = line.replace(/^#+\s+/, "");
      const Tag = `h${Math.min(level + 2, 6)}` as keyof React.JSX.IntrinsicElements;
      nodes.push(<Tag key={k++} className="kojo-md-heading"><Inline text={text} reg={reg} pk={`h${k}`} ob={ob} /></Tag>);
      i++;
      continue;
    }

    // ── Unordered list ──────────────────────────────────────────────────────
    if (/^[-*+] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+] /.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s+/, ""));
        i++;
      }
      // Obsidian task items ("- [ ] todo", "- [x] done") show a read-only checkbox.
      const isTaskList = ob && items.some((item) => TASK_RE.test(item));
      nodes.push(
        <ul key={k++} className={`kojo-md-list${isTaskList ? " md-task-list" : ""}`}>
          {items.map((item, j) => {
            const task = ob ? item.match(TASK_RE) : null;
            if (task) {
              const done = task[1] !== " ";
              return (
                <li key={j} className={`md-task${done ? " is-done" : ""}`}>
                  <input type="checkbox" className="checkbox-input" checked={done} disabled readOnly aria-label={done ? "Done" : "Not done"} />
                  <span><Inline text={item.slice(task[0].length)} reg={reg} pk={`ul${k}-${j}`} ob={ob} /></span>
                </li>
              );
            }
            return <li key={j}><Inline text={item} reg={reg} pk={`ul${k}-${j}`} ob={ob} /></li>;
          })}
        </ul>,
      );
      continue;
    }

    // ── Ordered list ────────────────────────────────────────────────────────
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      nodes.push(
        <ol key={k++} className="kojo-md-list">
          {items.map((item, j) => <li key={j}><Inline text={item} reg={reg} pk={`ol${k}-${j}`} ob={ob} /></li>)}
        </ol>,
      );
      continue;
    }

    // ── Table ───────────────────────────────────────────────────────────────
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) { tableLines.push(lines[i]); i++; }
      const parseRow = (row: string) => row.split("|").slice(1, -1).map((c) => c.trim());
      const isSep = (row: string) => /^\|[-:\s|]+\|$/.test(row);
      let headers: string[] = [];
      let body: string[][] = [];
      if (tableLines.length >= 2 && isSep(tableLines[1])) {
        headers = parseRow(tableLines[0]);
        body = tableLines.slice(2).map(parseRow);
      } else {
        body = tableLines.map(parseRow);
      }
      const tk = k++;
      nodes.push(
        <div key={tk} className="kojo-md-table-wrapper">
          <table className="kojo-md-table">
            {headers.length > 0 && (
              <thead><tr>{headers.map((c, ci) => <th key={ci}><Inline text={c} reg={reg} pk={`th${tk}-${ci}`} ob={ob} /></th>)}</tr></thead>
            )}
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri}>{row.map((c, ci) => <td key={ci}><Inline text={c} reg={reg} pk={`td${tk}-${ri}-${ci}`} ob={ob} /></td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // ── Paragraph ───────────────────────────────────────────────────────────
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("|") &&
      !lines[i].startsWith("```") &&
      !/^#{1,4} /.test(lines[i]) &&
      !/^[-*+] /.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i]) &&
      !lines[i].trim().match(/^\x00M:\d+:\x00$/)
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      nodes.push(
        <p key={k++} className="kojo-md-p">
          <Inline text={paraLines.join(" ")} reg={reg} pk={`p${k}`} ob={ob} />
        </p>,
      );
    }
  }

  return <>{nodes}</>;
}
