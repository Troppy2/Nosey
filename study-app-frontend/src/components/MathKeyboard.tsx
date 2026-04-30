import katex from "katex";
import "katex/dist/katex.min.css";
import { useState } from "react";

type Symbol = { display: string; insert: string; label?: string };
type SymbolGroup = { label: string; symbols: Symbol[] };

const SYMBOL_GROUPS: SymbolGroup[] = [
  {
    label: "Fractions",
    symbols: [
      { display: "\\frac{a}{b}", insert: "\\frac{}{}", label: "Fraction" },
      { display: "\\frac{1}{2}", insert: "\\frac{1}{2}", label: "1/2" },
      { display: "\\frac{1}{3}", insert: "\\frac{1}{3}", label: "1/3" },
      { display: "\\frac{d}{dx}", insert: "\\frac{d}{dx}", label: "d/dx" },
      { display: "\\frac{\\partial}{\\partial x}", insert: "\\frac{\\partial}{\\partial x}", label: "∂/∂x" },
      { display: "\\frac{dy}{dx}", insert: "\\frac{dy}{dx}", label: "dy/dx" },
    ],
  },
  {
    label: "Powers",
    symbols: [
      { display: "x^{2}", insert: "^{2}", label: "x²" },
      { display: "x^{3}", insert: "^{3}", label: "x³" },
      { display: "x^{n}", insert: "^{n}", label: "xⁿ" },
      { display: "x^{-1}", insert: "^{-1}", label: "x⁻¹" },
      { display: "\\sqrt{x}", insert: "\\sqrt{}", label: "√x" },
      { display: "\\sqrt[n]{x}", insert: "\\sqrt[n]{}", label: "ⁿ√x" },
      { display: "e^{x}", insert: "e^{}", label: "eˣ" },
      { display: "10^{n}", insert: "\\times 10^{}", label: "×10ⁿ" },
      { display: "x^{1/2}", insert: "^{1/2}", label: "x^½" },
      { display: "|x|", insert: "|x|", label: "|x|" },
    ],
  },
  {
    label: "Ops",
    symbols: [
      { display: "+", insert: " + " },
      { display: "-", insert: " - " },
      { display: "\\times", insert: " \\times " },
      { display: "\\div", insert: " \\div " },
      { display: "=", insert: " = " },
      { display: "\\neq", insert: " \\neq " },
      { display: "\\approx", insert: " \\approx " },
      { display: "\\pm", insert: " \\pm " },
      { display: "\\leq", insert: " \\leq " },
      { display: "\\geq", insert: " \\geq " },
      { display: "<", insert: " < " },
      { display: ">", insert: " > " },
      { display: "\\infty", insert: "\\infty" },
      { display: "\\%", insert: "\\%" },
    ],
  },
  {
    label: "Calculus",
    symbols: [
      { display: "\\int", insert: "\\int ", label: "∫" },
      { display: "\\int_{a}^{b}", insert: "\\int_{a}^{b} ", label: "∫ᵃᵇ" },
      { display: "\\oint", insert: "\\oint ", label: "∮" },
      { display: "\\sum", insert: "\\sum ", label: "∑" },
      { display: "\\sum_{i=0}^{n}", insert: "\\sum_{i=0}^{n} ", label: "∑ᵢ" },
      { display: "\\prod", insert: "\\prod ", label: "∏" },
      { display: "\\lim", insert: "\\lim_{x \\to } ", label: "lim" },
      { display: "\\lim_{x\\to\\infty}", insert: "\\lim_{x \\to \\infty} ", label: "lim∞" },
      { display: "\\partial", insert: "\\partial ", label: "∂" },
      { display: "\\nabla", insert: "\\nabla ", label: "∇" },
      { display: "f'(x)", insert: "f'(x)", label: "f'(x)" },
      { display: "f''(x)", insert: "f''(x)", label: "f''(x)" },
    ],
  },
  {
    label: "Greek",
    symbols: [
      { display: "\\alpha", insert: "\\alpha ", label: "α" },
      { display: "\\beta", insert: "\\beta ", label: "β" },
      { display: "\\gamma", insert: "\\gamma ", label: "γ" },
      { display: "\\delta", insert: "\\delta ", label: "δ" },
      { display: "\\epsilon", insert: "\\epsilon ", label: "ε" },
      { display: "\\theta", insert: "\\theta ", label: "θ" },
      { display: "\\lambda", insert: "\\lambda ", label: "λ" },
      { display: "\\mu", insert: "\\mu ", label: "μ" },
      { display: "\\pi", insert: "\\pi ", label: "π" },
      { display: "\\sigma", insert: "\\sigma ", label: "σ" },
      { display: "\\phi", insert: "\\phi ", label: "φ" },
      { display: "\\omega", insert: "\\omega ", label: "ω" },
      { display: "\\Sigma", insert: "\\Sigma ", label: "Σ" },
      { display: "\\Delta", insert: "\\Delta ", label: "Δ" },
      { display: "\\Omega", insert: "\\Omega ", label: "Ω" },
      { display: "\\Phi", insert: "\\Phi ", label: "Φ" },
    ],
  },
  {
    label: "Trig",
    symbols: [
      { display: "\\sin", insert: "\\sin()", label: "sin" },
      { display: "\\cos", insert: "\\cos()", label: "cos" },
      { display: "\\tan", insert: "\\tan()", label: "tan" },
      { display: "\\csc", insert: "\\csc()", label: "csc" },
      { display: "\\sec", insert: "\\sec()", label: "sec" },
      { display: "\\cot", insert: "\\cot()", label: "cot" },
      { display: "\\sin^{-1}", insert: "\\sin^{-1}()", label: "sin⁻¹" },
      { display: "\\cos^{-1}", insert: "\\cos^{-1}()", label: "cos⁻¹" },
      { display: "\\tan^{-1}", insert: "\\tan^{-1}()", label: "tan⁻¹" },
      { display: "\\ln", insert: "\\ln()", label: "ln" },
      { display: "\\log", insert: "\\log()", label: "log" },
      { display: "\\log_{b}", insert: "\\log_{b}()", label: "logᵦ" },
    ],
  },
  {
    label: "Logic",
    symbols: [
      { display: "\\forall", insert: "\\forall ", label: "∀" },
      { display: "\\exists", insert: "\\exists ", label: "∃" },
      { display: "\\in", insert: " \\in ", label: "∈" },
      { display: "\\notin", insert: " \\notin ", label: "∉" },
      { display: "\\subset", insert: " \\subset ", label: "⊂" },
      { display: "\\cup", insert: " \\cup ", label: "∪" },
      { display: "\\cap", insert: " \\cap ", label: "∩" },
      { display: "\\land", insert: " \\land ", label: "∧" },
      { display: "\\lor", insert: " \\lor ", label: "∨" },
      { display: "\\neg", insert: "\\neg ", label: "¬" },
      { display: "\\Rightarrow", insert: " \\Rightarrow ", label: "⇒" },
      { display: "\\Leftrightarrow", insert: " \\Leftrightarrow ", label: "⟺" },
    ],
  },
];

function KatexSpan({ src }: { src: string }) {
  try {
    const html = katex.renderToString(src, { throwOnError: false, output: "html" });
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <span>{src}</span>;
  }
}

type MathKeyboardProps = {
  onInsert: (symbol: string) => void;
};

export function MathKeyboard({ onInsert }: MathKeyboardProps) {
  const [activeTab, setActiveTab] = useState(0);
  const group = SYMBOL_GROUPS[activeTab];

  return (
    <div className="math-keyboard">
      <div className="math-keyboard-tabs">
        {SYMBOL_GROUPS.map((g, i) => (
          <button
            key={g.label}
            type="button"
            className={`math-tab ${activeTab === i ? "active" : ""}`}
            onClick={() => setActiveTab(i)}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="math-keyboard-symbols">
        {group.symbols.map((s) => (
          <button
            key={s.insert}
            type="button"
            className="math-sym-btn"
            onClick={() => onInsert(s.insert)}
            title={s.label ?? s.insert}
          >
            <KatexSpan src={s.display} />
          </button>
        ))}
      </div>
    </div>
  );
}
