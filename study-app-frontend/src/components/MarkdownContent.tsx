import katex from "katex";
import "katex/dist/katex.min.css";
import React from "react";

type InlineToken =
  | { t: "text"; v: string }
  | { t: "bold"; v: string }
  | { t: "italic"; v: string }
  | { t: "code"; v: string }
  | { t: "math-inline"; v: string };

function renderKatex(src: string, display: boolean): string {
  try {
    return katex.renderToString(src, { displayMode: display, throwOnError: false, output: "html" });
  } catch {
    return src;
  }
}

function tokenizeInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  // Order matters: check $...$ before bold/italic so dollar signs don't interfere.
  // Use [^$]+ to allow whitespace inside inline math (e.g. $\frac{a}{b}$).
  const pattern = /(\$([^$]+?)\$|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) tokens.push({ t: "text", v: text.slice(last, m.index) });
    if (m[2] !== undefined) tokens.push({ t: "math-inline", v: m[2] });
    else if (m[3] !== undefined) tokens.push({ t: "bold", v: m[3] });
    else if (m[4] !== undefined) tokens.push({ t: "italic", v: m[4] });
    else if (m[5] !== undefined) tokens.push({ t: "code", v: m[5] });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ t: "text", v: text.slice(last) });
  return tokens;
}

function Inline({ text, pk }: { text: string; pk: string }) {
  return (
    <>
      {tokenizeInline(text).map((tok, i) => {
        const key = `${pk}-${i}`;
        if (tok.t === "bold") return <strong key={key}>{tok.v}</strong>;
        if (tok.t === "italic") return <em key={key}>{tok.v}</em>;
        if (tok.t === "code") return <code key={key} className="kojo-inline-code">{tok.v}</code>;
        if (tok.t === "math-inline") return (
          <span
            key={key}
            className="math-inline"
            dangerouslySetInnerHTML={{ __html: renderKatex(tok.v, false) }}
          />
        );
        return <React.Fragment key={key}>{tok.v}</React.Fragment>;
      })}
    </>
  );
}

/** Indicators that a piece of text is LaTeX math content. */
const LATEX_CMD_RE = /\\(?:frac|int|sum|prod|sqrt|left|right|text|over|partial|nabla|infty|cdot|times|div|pm|mp|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Alpha|Beta|Gamma|Delta|Theta|Lambda|Pi|Sigma|Phi|Psi|Omega|hbar|ell|lim|sin|cos|tan|log|ln|exp|det|dim|ker|max|min|sup|inf|vec|hat|bar|dot|ddot|tilde|widehat|widetilde|overline|underline|oplus|otimes|forall|exists|in|notin|subset|supset|cup|cap|leq|geq|neq|approx|equiv|sim|to|rightarrow|leftarrow|Rightarrow|Leftarrow|cdots|ldots|vdots)\b/;

/** Greek letter and common math word → LaTeX command, for LLM outputs that skipped backslashes. */
// "pi" is intentionally NOT included here — too common in English ("pitch", "pilot", etc.)
// It's handled separately via convertFracPiShorthand and the \bpi\b math-context check.
const GREEK_WORD_RE =
  /\b(theta|alpha|beta|gamma|delta|epsilon|zeta|eta|iota|kappa|lambda|nu|xi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Sigma|Upsilon|Phi|Psi|Omega)\b/g;

/**
 * Replace bare Greek-letter words (theta, pi, alpha, …) that appear outside of existing
 * $…$ delimiters with their $\cmd$ equivalents. Only applied to math-looking contexts
 * (the surrounding text contains digits, operators, or LaTeX commands).
 */
function convertBareGreekWords(text: string): string {
  // Don't touch lines that already have $ delimiters — they're already handled.
  return text
    .split("\n")
    .map((line) => {
      if (line.includes("$") || !GREEK_WORD_RE.test(line)) return line;
      GREEK_WORD_RE.lastIndex = 0;
      // Only convert if the line looks mathematical (has digits/operators/common math words)
      const looksLikeMath = /[\d=+\-*/^_()[\]{}]|\\[a-zA-Z]|\bfrac\b|\bsqrt\b|\bint\b|\bsum\b|\bpi\b|\binfty\b/.test(line);
      if (!looksLikeMath) return line;
      GREEK_WORD_RE.lastIndex = 0;
      let converted = line.replace(GREEK_WORD_RE, (_m, word) => `$\\${word}$`);
      // Also convert standalone "pi" in math context (word boundary, not inside a word)
      converted = converted.replace(/\bpi\b/g, "$\\pi$");
      return converted;
    })
    .join("\n");
}

/** Handle "frac<num>pi<denom>" patterns (e.g. "frac5pi6" → "$\frac{5\pi}{6}$"). */
function convertFracPiShorthand(text: string): string {
  // Matches patterns like frac5pi6, frac2pi3, frac7pi4, etc.
  return text.replace(/\bfrac(\d+)pi(\d+)\b/g, (_m, num, denom) => `$\\frac{${num}\\pi}{${denom}}$`);
}

function normalizeMathContent(text: string): string {
  // 1. Unescape escaped dollar signs and convert \(...\) / \[...\] delimiters.
  let out = text.replace(/\\\$/g, "$");
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_m, g1) => `$${g1}$`);
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_m, g1) => `$$${g1}$$`);

  // 2. Fix LLM outputs that skipped LaTeX formatting.
  out = convertFracPiShorthand(out);
  out = convertBareGreekWords(out);

  // 3. Pull $$ blocks that appear mid-line onto their own lines so the block
  //    math handler can process them. E.g. "text $$expr$$ more" becomes:
  //    "text\n$$expr$$\nmore".
  out = out.replace(/([^\n$])\$\$([\s\S]*?)\$\$/g, (_m, before, inner) => `${before}\n$$${inner}$$\n`);

  // 4. For each line: if it contains LaTeX commands but no $ delimiters,
  //    treat the whole line as display math.
  out = out
    .split("\n")
    .map((line) => {
      if (line.includes("$") || line.trim() === "" || line.startsWith("```") || line.startsWith("#")) {
        return line;
      }
      const cmdMatches = (line.match(/\\[a-zA-Z]+/g) ?? []).length;
      if (cmdMatches >= 2 && LATEX_CMD_RE.test(line)) {
        return `$$${line.trim()}$$`;
      }
      return line;
    })
    .join("\n");

  return out;
}

export function MarkdownContent({ content }: { content: string }) {
  content = normalizeMathContent(content);
  const nodes: React.ReactNode[] = [];
  const lines = content.split("\n");
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Block math: $$...$$ (possibly multi-line)
    if (line.trimStart().startsWith("$$")) {
      const mathLines: string[] = [];
      const opening = line.trimStart().slice(2);
      // Check if it closes on the same line: $$expr$$
      if (opening.includes("$$")) {
        const expr = opening.slice(0, opening.lastIndexOf("$$"));
        nodes.push(
          <div
            key={k++}
            className="math-block"
            dangerouslySetInnerHTML={{ __html: renderKatex(expr.trim(), true) }}
          />
        );
        i++;
        continue;
      }
      if (opening.trim()) mathLines.push(opening);
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("$$")) {
        mathLines.push(lines[i]);
        i++;
      }
      i++; // skip closing $$
      nodes.push(
        <div
          key={k++}
          className="math-block"
          dangerouslySetInnerHTML={{ __html: renderKatex(mathLines.join("\n").trim(), true) }}
        />
      );
      continue;
    }

    // Fenced code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        code.push(lines[i]);
        i++;
      }
      i++;
      const codeContent = code.join("\n").trim();
      // Detect when the LLM wrapped math in a code fence instead of $$ delimiters
      const looksLikeMath =
        !lang &&
        (codeContent.startsWith("$$") ||
          codeContent.startsWith("\\[") ||
          codeContent.startsWith("\\(") ||
          /^\\[a-zA-Z]/.test(codeContent));
      if (looksLikeMath) {
        let mathExpr = codeContent;
        if (mathExpr.startsWith("$$") && mathExpr.endsWith("$$")) {
          mathExpr = mathExpr.slice(2, -2).trim();
        } else if (mathExpr.startsWith("\\[") && mathExpr.endsWith("\\]")) {
          mathExpr = mathExpr.slice(2, -2).trim();
        } else if (mathExpr.startsWith("\\(") && mathExpr.endsWith("\\)")) {
          mathExpr = mathExpr.slice(2, -2).trim();
        }
        nodes.push(
          <div
            key={k++}
            className="math-block"
            dangerouslySetInnerHTML={{ __html: renderKatex(mathExpr, true) }}
          />,
        );
      } else {
        nodes.push(
          <pre key={k++} className="kojo-code-block">
            {lang && <span className="kojo-code-lang">{lang}</span>}
            <code>{codeContent}</code>
          </pre>,
        );
      }
      continue;
    }

    // Heading
    if (/^#{1,4} /.test(line)) {
      const level = (line.match(/^(#+)/)?.[1].length ?? 1);
      const text = line.replace(/^#+\s+/, "");
      const Tag = (`h${Math.min(level + 2, 6)}`) as keyof React.JSX.IntrinsicElements;
      nodes.push(
        <Tag key={k++} className="kojo-md-heading">
          <Inline text={text} pk={`h${k}`} />
        </Tag>,
      );
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*+] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+] /.test(lines[i])) {
        items.push(lines[i].replace(/^[-*+]\s+/, ""));
        i++;
      }
      nodes.push(
        <ul key={k++} className="kojo-md-list">
          {items.map((item, j) => (
            <li key={j}><Inline text={item} pk={`ul${k}-${j}`} /></li>
          ))}
        </ul>,
      );
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      nodes.push(
        <ol key={k++} className="kojo-md-list">
          {items.map((item, j) => (
            <li key={j}><Inline text={item} pk={`ol${k}-${j}`} /></li>
          ))}
        </ol>,
      );
      continue;
    }

    // Table: lines starting with |
    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        tableLines.push(lines[i]);
        i++;
      }
      const parseRow = (row: string) =>
        row.split("|").slice(1, -1).map((cell) => cell.trim());
      const isSeparator = (row: string) => /^\|[-:\s|]+\|$/.test(row);

      let headerCells: string[] = [];
      let bodyRows: string[][] = [];
      if (tableLines.length >= 2 && isSeparator(tableLines[1])) {
        headerCells = parseRow(tableLines[0]);
        bodyRows = tableLines.slice(2).map(parseRow);
      } else {
        bodyRows = tableLines.map(parseRow);
      }
      const tk = k++;
      nodes.push(
        <div key={tk} className="kojo-md-table-wrapper">
          <table className="kojo-md-table">
            {headerCells.length > 0 && (
              <thead>
                <tr>
                  {headerCells.map((cell, ci) => (
                    <th key={ci}><Inline text={cell} pk={`th${tk}-${ci}`} /></th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}><Inline text={cell} pk={`td${tk}-${ri}-${ci}`} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("|") &&
      !lines[i].startsWith("```") &&
      !lines[i].trimStart().startsWith("$$") &&
      !/^#{1,4} /.test(lines[i]) &&
      !/^[-*+] /.test(lines[i]) &&
      !/^\d+\.\s/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      nodes.push(
        <p key={k++} className="kojo-md-p">
          <Inline text={paraLines.join(" ")} pk={`p${k}`} />
        </p>,
      );
    }
  }

  return <div className="kojo-markdown">{nodes}</div>;
}
