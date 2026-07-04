import katex from "katex";
import "katex/dist/katex.min.css";
import { ChevronDown, PenLine } from "lucide-react";
import type { MathfieldElement } from "mathlive";
import type { DetailedHTMLProps, HTMLAttributes } from "react";
import { useEffect, useRef, useState } from "react";
import { MathKeyboard } from "./MathKeyboard";

// The <math-field> web component is registered by the lazy mathlive import below.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "math-field": DetailedHTMLProps<HTMLAttributes<MathfieldElement>, MathfieldElement>;
    }
  }
}

// MathLive is only needed on math-mode tests, so it is loaded on demand and the
// promise is shared across mounts (question navigation re-renders this component).
let mathlivePromise: Promise<void> | null = null;

function loadMathlive(): Promise<void> {
  if (!mathlivePromise) {
    mathlivePromise = Promise.all([
      import("mathlive"),
      import("mathlive/fonts.css"),
    ]).then(([{ MathfieldElement }]) => {
      // Fonts ship via the bundled fonts.css import; sounds are not wanted.
      // Nulling both stops MathLive fetching from directories that do not
      // exist in this build.
      MathfieldElement.fontsDirectory = null;
      MathfieldElement.soundsDirectory = null;
    });
  }
  return mathlivePromise;
}

type MathInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

function renderLatexPreview(src: string): string {
  if (!src.trim()) return "";
  try {
    return katex.renderToString(src, {
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
  const mathFieldRef = useRef<MathfieldElement | null>(null);
  const [fieldReady, setFieldReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [latexMode, setLatexMode] = useState(false);
  const [scratchpad, setScratchpad] = useState("");
  const [scratchOpen, setScratchOpen] = useState(false);

  // Keep the latest onChange reachable from the input listener without
  // re-binding the listener on every TakeTest render (it passes an inline arrow).
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    let alive = true;
    loadMathlive()
      .then(() => {
        if (alive) setFieldReady(true);
      })
      .catch(() => {
        // If the editor bundle cannot load, fall back to the LaTeX textarea so
        // the student can still answer.
        if (alive) {
          setLoadFailed(true);
          setLatexMode(true);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const visual = !latexMode && fieldReady;

  // Push external value changes (question navigation, resume, mode switch)
  // into the field. Guarded so the field's own edits do not loop back and
  // reset the caret.
  useEffect(() => {
    const mf = mathFieldRef.current;
    if (visual && mf && mf.value !== value) mf.value = value;
  }, [visual, value]);

  // <math-field> is a web component, so its input event is wired manually.
  useEffect(() => {
    const mf = mathFieldRef.current;
    if (!visual || !mf) return;
    const handleInput = () => onChangeRef.current(mf.value);
    mf.addEventListener("input", handleInput);
    return () => mf.removeEventListener("input", handleInput);
  }, [visual]);

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

  const showLatexEditor = latexMode || loadFailed;

  return (
    <div className="math-input-wrap">
      <div className="math-input-header">
        <label className="field-label">Your answer</label>
        {!loadFailed && (
          <button
            type="button"
            className="math-preview-toggle"
            onClick={() => setLatexMode((m) => !m)}
          >
            {latexMode ? "Visual editor" : "Edit as LaTeX"}
          </button>
        )}
      </div>

      {showLatexEditor ? (
        <>
          <textarea
            ref={textareaRef}
            className="field-input math-answer-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder ?? "Type LaTeX (e.g. \\frac{dx}{dt} = 3t^2 + 1) or use the keyboard below…"}
            rows={3}
          />
          {value.trim() && (
            <div className="math-preview">
              <span className="math-preview-label">Preview</span>
              {(() => {
                // KaTeX output is safe generated markup; if rendering fails,
                // fall back to showing the raw source as TEXT, never as HTML.
                const previewHtml = renderLatexPreview(value);
                return previewHtml ? (
                  <div
                    className="math-preview-rendered"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                ) : (
                  <code className="math-preview-rendered">{value}</code>
                );
              })()}
            </div>
          )}
          <MathKeyboard onInsert={insertSymbol} />
        </>
      ) : fieldReady ? (
        <>
          <math-field ref={mathFieldRef} className="math-field-input" />
          <p className="math-field-hint">
            Type your answer directly, it renders as real math. Tap the keyboard
            icon in the box for fractions, roots and symbols; empty slots can be
            clicked or reached with the arrow keys.
          </p>
        </>
      ) : (
        <div className="math-field-loading">
          <span className="loader" />
        </div>
      )}

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
            placeholder="Work out your problem here , this isn't submitted…"
            rows={5}
          />
        )}
      </div>
    </div>
  );
}
