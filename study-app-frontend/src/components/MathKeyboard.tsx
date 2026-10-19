import katex from "katex";
import "katex/dist/katex.min.css";
import type { ReactNode } from "react";
import { useState } from "react";
import { CloseIcon } from "../icons";
import "../styles/components/math-keyboard.css";

// What a key does. The keyboard only reports actions; MathInput decides how to
// apply them to the visual math field or to the LaTeX textarea.
//  - insert: a MathLive template. #@ takes the previous term, #0 the selection,
//    #? is an empty slot the caret jumps into.
//  - type: characters typed as if from a physical keyboard.
export type MathKeyAction =
  | { type: "insert"; latex: string }
  | { type: "type"; text: string }
  | { type: "cmd"; cmd: "left" | "right" | "backspace" | "enter" };

type Tone = "num" | "op" | "fn" | "util" | "primary";
type Key = { label: ReactNode; aria: string; action?: MathKeyAction; span?: number; tone?: Tone; shift?: true };
type Page = { id: string; label: string; rows: Key[][] };

const katexCache = new Map<string, string>();

function Tex({ src }: { src: string }) {
  let html = katexCache.get(src);
  if (html === undefined) {
    html = katex.renderToString(src, { throwOnError: false, output: "html" });
    katexCache.set(src, html);
  }
  return <span className="mkb-tex" dangerouslySetInnerHTML={{ __html: html }} />;
}

const t = (text: string, tone: Tone = "fn", aria = text): Key => ({ label: text, aria, tone, action: { type: "type", text } });
const ins = (label: ReactNode, latex: string, aria: string, tone: Tone = "fn"): Key => ({ label, aria, tone, action: { type: "insert", latex } });
const num = (d: string) => t(d, "num");
const op = (label: string, latex: string, aria: string) => ins(label, latex, aria, "op");

const LEFT: Key = { label: "←", aria: "Move left", tone: "util", action: { type: "cmd", cmd: "left" } };
const RIGHT: Key = { label: "→", aria: "Move right", tone: "util", action: { type: "cmd", cmd: "right" } };
const BACK: Key = { label: "⌫", aria: "Delete", tone: "util", span: 2, action: { type: "cmd", cmd: "backspace" } };
const ENTER: Key = { label: "↵", aria: "Done", tone: "primary", span: 2, action: { type: "cmd", cmd: "enter" } };

const SLOT = "\\square";

const PAGES: Page[] = [
  {
    id: "main",
    label: "123",
    rows: [
      [t("x"), t("y"), ins(<Tex src={`a^2`} />, "#@^{2}", "Squared"), ins(<Tex src={`a^b`} />, "#@^{#?}", "Power"),
        num("7"), num("8"), num("9"), op("÷", "\\div", "Divide"), LEFT, RIGHT],
      [t("("), t(")"), t("<"), t(">"), num("4"), num("5"), num("6"), op("×", "\\times", "Times"), BACK],
      [ins(<Tex src={`|a|`} />, "\\left|#0\\right|", "Absolute value"), t(","), ins("≤", "\\le", "Less or equal"), ins("≥", "\\ge", "Greater or equal"),
        num("1"), num("2"), num("3"), op("−", "-", "Minus"), ins("±", "\\pm", "Plus or minus"), ins("°", "^{\\circ}", "Degrees")],
      [ins(<Tex src={`\\frac{${SLOT}}{${SLOT}}`} />, "\\frac{#0}{#?}", "Fraction"), ins(<Tex src={`\\sqrt{${SLOT}}`} />, "\\sqrt{#0}", "Square root"),
        ins(<Tex src={`\\sqrt[n]{${SLOT}}`} />, "\\sqrt[#?]{#0}", "Nth root"), ins("π", "\\pi", "Pi"),
        num("0"), num("."), op("=", "=", "Equals"), op("+", "+", "Plus"), ENTER],
    ],
  },
  {
    id: "func",
    label: "f(x)",
    rows: [
      [ins("sin", "\\sin(#0)", "sine"), ins("cos", "\\cos(#0)", "cosine"), ins("tan", "\\tan(#0)", "tangent"), ins("ln", "\\ln(#0)", "natural log"),
        ins("log", "\\log(#0)", "log"), ins(<Tex src={`\\log_{n}`} />, "\\log_{#?}(#0)", "log base n"), ins(<Tex src={`e^{x}`} />, "e^{#?}", "e to the power"),
        ins(<Tex src={`a_{n}`} />, "#@_{#?}", "Subscript"), LEFT, RIGHT],
      [ins(<Tex src={`\\sin^{-1}`} />, "\\sin^{-1}(#0)", "arcsine"), ins(<Tex src={`\\cos^{-1}`} />, "\\cos^{-1}(#0)", "arccosine"),
        ins(<Tex src={`\\tan^{-1}`} />, "\\tan^{-1}(#0)", "arctangent"), ins(<Tex src={`\\frac{d}{dx}`} />, "\\frac{d}{dx}", "Derivative"),
        ins(<Tex src={`\\frac{\\partial}{\\partial x}`} />, "\\frac{\\partial}{\\partial #?}", "Partial derivative"), ins("f′", "#@'", "Prime"),
        ins("!", "!", "Factorial"), ins("∞", "\\infty", "Infinity"), BACK],
      [ins("∫", "\\int #0\\,d#?", "Integral"), ins(<Tex src={`\\int_{a}^{b}`} />, "\\int_{#?}^{#?} #0\\,d#?", "Definite integral"),
        ins(<Tex src={`\\sum`} />, "\\sum_{#?}^{#?} #0", "Sum"), ins(<Tex src={`\\prod`} />, "\\prod_{#?}^{#?} #0", "Product"),
        ins("lim", "\\lim_{#? \\to #?} #0", "Limit"), ins("∇", "\\nabla", "Nabla"), ins(<Tex src={`\\vec{v}`} />, "\\vec{#0}", "Vector"),
        ins(<Tex src={`\\hat{n}`} />, "\\hat{#0}", "Unit vector"), ins("×10ⁿ", "\\times 10^{#?}", "Scientific notation"), ins("%", "\\%", "Percent")],
      [ins("≠", "\\ne", "Not equal"), ins("≈", "\\approx", "Approximately"), ins("∝", "\\propto", "Proportional to"), ins("·", "\\cdot", "Dot"),
        ins("→", "\\to", "Approaches"), ins("∠", "\\angle", "Angle"), ins("⊥", "\\perp", "Perpendicular"), ins("∥", "\\parallel", "Parallel"), ENTER],
    ],
  },
  {
    id: "abc",
    label: "abc",
    rows: [
      "qwertyuiop".split("").map((c) => t(c)),
      [..."asdfghjkl".split("").map((c) => t(c)), { ...BACK, span: 1 }],
      [{ label: "⇧", aria: "Shift", tone: "util", shift: true }, ..."zxcvbnm".split("").map((c) => t(c)), LEFT, RIGHT],
      [t("'"), t(":"), { label: "space", aria: "Space", tone: "fn", span: 6, action: { type: "insert", latex: "\\ " } }, ENTER],
    ],
  },
  {
    id: "greek",
    label: "αβγ",
    rows: [
      [..."αβγδεθλμ".split("").map((c) => t(c)), LEFT, RIGHT],
      [..."πρστφω".split("").map((c) => t(c)), t("Δ"), t("Ω"), BACK],
      [ins("∀", "\\forall", "For all"), ins("∃", "\\exists", "Exists"), ins("∈", "\\in", "In"), ins("∉", "\\notin", "Not in"),
        ins("⊂", "\\subset", "Subset"), ins("∪", "\\cup", "Union"), ins("∩", "\\cap", "Intersection"), ins("∅", "\\emptyset", "Empty set"),
        t("Σ"), t("Φ")],
      [ins("∧", "\\land", "And"), ins("∨", "\\lor", "Or"), ins("¬", "\\neg", "Not"), ins("⇒", "\\Rightarrow", "Implies"),
        ins("⇔", "\\Leftrightarrow", "If and only if"), ins("ℝ", "\\mathbb{R}", "Reals"), ins("ℏ", "\\hbar", "h bar"), ins("ℓ", "\\ell", "ell"), ENTER],
    ],
  },
];

type MathKeyboardProps = {
  onKey: (action: MathKeyAction) => void;
  docked?: boolean;
  onHide?: () => void;
};

export function MathKeyboard({ onKey, docked = false, onHide }: MathKeyboardProps) {
  const [pageId, setPageId] = useState("main");
  const [shift, setShift] = useState(false);
  const page = PAGES.find((p) => p.id === pageId) ?? PAGES[0];

  function press(key: Key) {
    if (key.shift) {
      setShift((s) => !s);
      return;
    }
    if (!key.action) return;
    const action = key.action;
    if (shift && action.type === "type") {
      onKey({ type: "type", text: action.text.toUpperCase() });
      setShift(false);
      return;
    }
    onKey(action);
  }

  return (
    <div
      className={`mkb${docked ? " mkb--docked" : ""}`}
      role="group"
      aria-label="Math keyboard"
      // Keys must not take focus from the answer field, or the caret is lost.
      onPointerDown={(e) => e.preventDefault()}
    >
      <div className="mkb-bar">
        <div className="mkb-pages" role="tablist" aria-label="Key sets">
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={p.id === pageId}
              className={`mkb-page${p.id === pageId ? " is-active" : ""}`}
              onClick={() => setPageId(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
        {docked && onHide && (
          <button type="button" className="mkb-hide" aria-label="Hide keyboard" onClick={onHide}>
            <CloseIcon size={18} />
          </button>
        )}
      </div>
      <div className="mkb-grid">
        {page.rows.flat().map((key, i) => {
          const upper = shift && key.action?.type === "type";
          return (
            <button
              key={`${page.id}-${i}`}
              type="button"
              className={`mkb-key mkb-key--${key.tone ?? "fn"}${key.shift && shift ? " is-on" : ""}`}
              style={key.span ? { gridColumn: `span ${key.span}` } : undefined}
              aria-label={key.aria}
              aria-pressed={key.shift ? shift : undefined}
              onClick={() => press(key)}
            >
              {upper && typeof key.label === "string" ? key.label.toUpperCase() : key.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
