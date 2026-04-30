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
  // Order matters: check $...$ before bold/italic so dollar signs don't interfere
  const pattern = /(\$([^$\n]+?)\$|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`)/g;
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

export function MarkdownContent({ content }: { content: string }) {
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
      nodes.push(
        <pre key={k++} className="kojo-code-block">
          {lang && <span className="kojo-code-lang">{lang}</span>}
          <code>{code.join("\n")}</code>
        </pre>,
      );
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
