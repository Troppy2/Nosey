import katex from "katex";
import "katex/dist/katex.min.css";
import type { MathfieldElement } from "mathlive";
import type { DetailedHTMLProps, HTMLAttributes } from "react";
import { useEffect, useRef, useState } from "react";
import { useMobileShell } from "../lib/useMobileShell";
import { MathKeyboard, type MathKeyAction } from "./MathKeyboard";

// The <math-field> web component is registered by the lazy mathlive import below.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      // React 18 passes className to custom elements as a literal "classname"
      // attribute, so the field is styled through a plain class attribute.
      "math-field": DetailedHTMLProps<HTMLAttributes<MathfieldElement>, MathfieldElement> & { class?: string };
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
  // Start in plain text: the math editor drops spaces, so a sentence typed
  // into it reads as one run-on word. The student can switch either way.
  preferText?: boolean;
};

// Questions that ask for a sentence, not a formula.
const PROSE_PROMPT_RE =
  /\b(explain|describe|justify|why|discuss|interpret|compare|contrast|argue|opinion|in your own words|do you think|should)\b/i;

export function looksLikeProsePrompt(questionText: string): boolean {
  return PROSE_PROMPT_RE.test(questionText);
}

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

export function MathInput({ value, onChange, placeholder, preferText = false }: MathInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mathFieldRef = useRef<MathfieldElement | null>(null);
  const [fieldReady, setFieldReady] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [latexMode, setLatexMode] = useState(false);
  const [textMode, setTextMode] = useState(preferText);
  // On phones the keypad docks to the bottom while the field has focus, like
  // Desmos. The field never opens the OS keyboard (MathLive's input sink is
  // inputmode=none), so the keypad is the only way to type there.
  const isMobile = useMobileShell();
  const [keypadOpen, setKeypadOpen] = useState(false);

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

  const visual = !textMode && !latexMode && fieldReady;

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
    // Our keypad replaces MathLive's built-in one.
    mf.mathVirtualKeyboardPolicy = "manual";
    const handleInput = () => onChangeRef.current(mf.value);
    const handleFocus = () => setKeypadOpen(true);
    const handleBlur = () => setKeypadOpen(false);
    mf.addEventListener("input", handleInput);
    mf.addEventListener("focusin", handleFocus);
    mf.addEventListener("focusout", handleBlur);
    return () => {
      mf.removeEventListener("input", handleInput);
      mf.removeEventListener("focusin", handleFocus);
      mf.removeEventListener("focusout", handleBlur);
    };
  }, [visual]);

  const docked = visual && isMobile && keypadOpen;

  // Reserve room under the page so the docked keypad never covers the field.
  useEffect(() => {
    if (!docked) return;
    document.body.classList.add("mkb-docked-open");
    const id = window.setTimeout(() => {
      mathFieldRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
    return () => {
      window.clearTimeout(id);
      document.body.classList.remove("mkb-docked-open");
    };
  }, [docked]);

  // The LaTeX textarea gets the template with its slot markers stripped, and
  // the caret lands where the first slot was.
  function applyToTextarea(action: MathKeyAction) {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    let next = value;
    let cursor = start;
    if (action.type === "cmd") {
      if (action.cmd === "enter") {
        el?.blur();
        return;
      }
      if (action.cmd === "left") cursor = Math.max(0, start - 1);
      else if (action.cmd === "right") cursor = Math.min(value.length, end + 1);
      else if (start !== end) {
        next = value.slice(0, start) + value.slice(end);
      } else if (start > 0) {
        next = value.slice(0, start - 1) + value.slice(start);
        cursor = start - 1;
      }
    } else {
      const raw = action.type === "type" ? action.text : action.latex.replace(/#@/g, "");
      const slot = raw.search(/#[0?]/);
      const text = raw.replace(/#[0?]/g, "");
      const padded = action.type === "insert" && /^\[a-zA-Z]+$/.test(text) ? `${text} ` : text;
      next = value.slice(0, start) + padded + value.slice(end);
      cursor = start + (slot >= 0 ? slot : padded.length);
    }
    if (next !== value) onChange(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  function applyToField(action: MathKeyAction) {
    const mf = mathFieldRef.current;
    if (!mf) return;
    if (action.type === "insert") {
      mf.insert(action.latex, { focus: true, selectionMode: "placeholder", format: "latex" });
    } else if (action.type === "type") {
      mf.executeCommand(["typedText", action.text]);
    } else if (action.cmd === "enter") {
      mf.blur();
      setKeypadOpen(false);
      return;
    } else {
      mf.executeCommand(
        action.cmd === "left" ? "moveToPreviousChar" : action.cmd === "right" ? "moveToNextChar" : "deleteBackward",
      );
    }
    mf.focus();
    onChangeRef.current(mf.value);
  }

  const showLatexEditor = latexMode || loadFailed;

  return (
    <div className="math-input-wrap">
      <div className="math-input-header">
        <label className="field-label">Your answer</label>
        <div className="math-input-modes">
          {!loadFailed && !textMode && (
            <button
              type="button"
              className="math-preview-toggle"
              onClick={() => setLatexMode((m) => !m)}
            >
              {latexMode ? "Visual editor" : "Edit as LaTeX"}
            </button>
          )}
          <button type="button" className="math-preview-toggle" onClick={() => setTextMode((t) => !t)}>
            {textMode ? "Math editor" : "Plain text"}
          </button>
        </div>
      </div>

      {textMode ? (
        <textarea
          className="field-input math-answer-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Write your answer in sentences. Switch to the math editor for formulas."
          rows={4}
        />
      ) : showLatexEditor ? (
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
          <MathKeyboard onKey={applyToTextarea} />
        </>
      ) : fieldReady ? (
        <>
          <math-field ref={mathFieldRef} class="math-field-input" />
          {(!isMobile || docked) && (
            <MathKeyboard
              onKey={applyToField}
              docked={docked}
              onHide={() => {
                mathFieldRef.current?.blur();
                setKeypadOpen(false);
              }}
            />
          )}
        </>
      ) : (
        <div className="math-field-loading">
          <span className="loader" />
        </div>
      )}
    </div>
  );
}
