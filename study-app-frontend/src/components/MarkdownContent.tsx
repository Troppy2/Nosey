import katex from "katex";
import "katex/dist/katex.min.css";
import React from "react";

// ── KaTeX ─────────────────────────────────────────────────────────────────────

function rkx(src: string, display: boolean): string {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, output: "html" });
  } catch {
    return src;
  }
}

// ── Math extraction ───────────────────────────────────────────────────────────
// Pull ALL math delimiters out BEFORE markdown parsing. This means $x$ inside
// *italic* or **bold** gets replaced with a placeholder, so the markdown
// tokenizer never sees the dollar signs. Placeholders are substituted back
// when rendering leaf text nodes.

interface MathEntry { display: boolean; src: string }

// Use ASCII control chars as delimiters — can't appear in LLM text output.
const PH_RE = /\x00M:(\d+):\x00/g;
const ph = (id: number) => `\x00M:${id}:\x00`;

function extractMath(raw: string): [string, MathEntry[]] {
  const reg: MathEntry[] = [];
  const add = (display: boolean, src: string): string => {
    const id = reg.length;
    reg.push({ display, src: src.trim() });
    return ph(id);
  };

  // Protect \$ so it isn't consumed by the $...$ pass
  let out = raw.replace(/\\\$/g, "\x01DS\x01");

  // Block: \[...\]  and  $$...$$  (multi-line safe — [\s\S]*? is non-greedy)
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_, s) => add(true, s));
  out = out.replace(/\$\$([\s\S]*?)\$\$/g, (_, s) => add(true, s));

  // Inline: \(...\)  and  $...$
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_, s) => add(false, s));
  out = out.replace(/\$([^$\n]+?)\$/g, (_, s) => add(false, s));

  // Restore escaped dollars as literal $
  out = out.replace(/\x01DS\x01/g, "$");

  return [out, reg];
}

// ── Auto-wrap: undelimited math lines ─────────────────────────────────────────
// Some LLMs output bare LaTeX without $$ delimiters. Detect lines that are
// clearly math expressions. Critically: skip lines that look like English prose
// with LaTeX mixed in — those caused the "Integrateusingthepowerrule" bug.

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
  return text
    .split("\n")
    .map((line) => {
      // Skip lines that already have math placeholders, are empty,
      // are markdown structural elements, or look like prose.
      if (
        line.includes("\x00M:") ||
        line.trim() === "" ||
        line.startsWith("#") ||
        line.startsWith("```") ||
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
// Splits text on math placeholders FIRST, then applies markdown patterns
// (bold, italic, code) within each non-math chunk. This naturally handles
// math nested inside bold/italic without any special casing.

type Seg =
  | { k: "text"; v: string }
  | { k: "bold"; v: string }
  | { k: "italic"; v: string }
  | { k: "code"; v: string }
  | { k: "math"; entry: MathEntry };

function tokenizeInline(text: string, reg: MathEntry[]): Seg[] {
  const segs: Seg[] = [];

  // split() on a regex with a capturing group interleaves matched IDs into the array
  const parts = text.split(PH_RE);

  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) {
      const entry = reg[parseInt(parts[i], 10)];
      if (entry) segs.push({ k: "math", entry });
      continue;
    }

    const chunk = parts[i];
    if (!chunk) continue;

    // Bold uses (?:(?!\*\*).)+  so it stops at ** but allows single * inside.
    const mdRe = /(\*\*((?:(?!\*\*).)+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`)/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = mdRe.exec(chunk)) !== null) {
      if (m.index > last) segs.push({ k: "text", v: chunk.slice(last, m.index) });
      if (m[2] !== undefined) segs.push({ k: "bold", v: m[2] });
      else if (m[3] !== undefined) segs.push({ k: "italic", v: m[3] });
      else if (m[4] !== undefined) segs.push({ k: "code", v: m[4] });
      last = m.index + m[0].length;
    }
    if (last < chunk.length) segs.push({ k: "text", v: chunk.slice(last) });
  }

  return segs;
}

// Bold/italic segments are rendered recursively so that any math or formatting
// nested inside them is also processed (e.g. *Distribute the $x$ term:*).
function Inline({ text, reg, pk }: { text: string; reg: MathEntry[]; pk: string }) {
  return (
    <>
      {tokenizeInline(text, reg).map((seg, i) => {
        const key = `${pk}-${i}`;
        if (seg.k === "math") {
          const html = rkx(seg.entry.src, seg.entry.display);
          return seg.entry.display
            ? <div key={key} className="math-block" dangerouslySetInnerHTML={{ __html: html }} />
            : <span key={key} className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />;
        }
        if (seg.k === "bold") return <strong key={key}><Inline text={seg.v} reg={reg} pk={`${key}b`} /></strong>;
        if (seg.k === "italic") return <em key={key}><Inline text={seg.v} reg={reg} pk={`${key}i`} /></em>;
        if (seg.k === "code") return <code key={key} className="kojo-inline-code">{seg.v}</code>;
        return <React.Fragment key={key}>{seg.v}</React.Fragment>;
      })}
    </>
  );
}

// ── Block parser ──────────────────────────────────────────────────────────────

export function MarkdownContent({ content }: { content: string }) {
  // Step 1: extract math into placeholders
  const [withPlaceholders, reg] = extractMath(content);
  // Step 2: auto-wrap bare LaTeX lines that have no delimiters
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
      i++;
      const src = code.join("\n").trim();
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
        nodes.push(
          <pre key={k++} className="kojo-code-block">
            {lang && <span className="kojo-code-lang">{lang}</span>}
            <code>{src}</code>
          </pre>,
        );
      }
      continue;
    }

    // ── Heading ─────────────────────────────────────────────────────────────
    if (/^#{1,4} /.test(line)) {
      const level = line.match(/^(#+)/)?.[1].length ?? 1;
      const text = line.replace(/^#+\s+/, "");
      const Tag = `h${Math.min(level + 2, 6)}` as keyof React.JSX.IntrinsicElements;
      nodes.push(<Tag key={k++} className="kojo-md-heading"><Inline text={text} reg={reg} pk={`h${k}`} /></Tag>);
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
      nodes.push(
        <ul key={k++} className="kojo-md-list">
          {items.map((item, j) => <li key={j}><Inline text={item} reg={reg} pk={`ul${k}-${j}`} /></li>)}
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
          {items.map((item, j) => <li key={j}><Inline text={item} reg={reg} pk={`ol${k}-${j}`} /></li>)}
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
              <thead><tr>{headers.map((c, ci) => <th key={ci}><Inline text={c} reg={reg} pk={`th${tk}-${ci}`} /></th>)}</tr></thead>
            )}
            <tbody>
              {body.map((row, ri) => (
                <tr key={ri}>{row.map((c, ci) => <td key={ci}><Inline text={c} reg={reg} pk={`td${tk}-${ri}-${ci}`} /></td>)}</tr>
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
          <Inline text={paraLines.join(" ")} reg={reg} pk={`p${k}`} />
        </p>,
      );
    }
  }

  return <div className="kojo-markdown">{nodes}</div>;
}
