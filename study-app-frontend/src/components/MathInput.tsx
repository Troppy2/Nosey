import katex from "katex";
import "katex/dist/katex.min.css";
import { ChevronDown, PenLine } from "lucide-react";
import { useRef, useState } from "react";
import { MathKeyboard } from "./MathKeyboard";

type MathInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

function renderLatexPreview(src: string): string {
  if (!src.trim()) return "";
  // Wrap in $...$ for inline rendering if not already wrapped
  const toRender = src.includes("\\") ? src : src;
  try {
    return katex.renderToString(toRender, {
      throwOnError: false,
      output: "html",
      displayMode: false,
    });
  } catch {
    return "";
  }
}

export function MathInput({ value, onChange, placeholder }: MathInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [scratchpad, setScratchpad] = useState("");
  const [scratchOpen, setScratchOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  function insertSymbol(symbol: string) {
    const el = textareaRef.current;
    if (!el) {
      onChange(value + symbol);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + symbol + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + symbol.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  const previewHtml = renderLatexPreview(value);

  return (
    <div className="math-input-wrap">
      <div className="math-input-header">
        <label className="field-label">Your answer</label>
        <button
          type="button"
          className="math-preview-toggle"
          onClick={() => setShowPreview((v) => !v)}
        >
          {showPreview ? "Hide preview" : "Show preview"}
        </button>
      </div>

      <textarea
        ref={textareaRef}
        className="field-input math-answer-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Type LaTeX (e.g. \\frac{dx}{dt} = 3t^2 + 1) or use the keyboard below…"}
        rows={3}
      />

      {showPreview && value.trim() && (
        <div className="math-preview">
          <span className="math-preview-label">Preview</span>
          <div
            className="math-preview-rendered"
            dangerouslySetInnerHTML={{ __html: previewHtml || value }}
          />
        </div>
      )}

      <MathKeyboard onInsert={insertSymbol} />

      <div className="math-scratchpad">
        <button
          type="button"
          className="math-scratchpad-toggle"
          onClick={() => setScratchOpen((o) => !o)}
        >
          <PenLine size={14} />
          Scratch work
          <ChevronDown size={14} className={scratchOpen ? "rotated" : ""} />
        </button>
        {scratchOpen && (
          <textarea
            className="field-input math-scratchpad-area"
            value={scratchpad}
            onChange={(e) => setScratchpad(e.target.value)}
            placeholder="Work out your problem here — this isn't submitted…"
            rows={5}
          />
        )}
      </div>
    </div>
  );
}
