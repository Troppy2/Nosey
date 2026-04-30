import { useState } from "react";

type SymbolGroup = { label: string; symbols: { display: string; insert: string }[] };

const SYMBOL_GROUPS: SymbolGroup[] = [
  {
    label: "Ops",
    symbols: [
      { display: "+", insert: " + " },
      { display: "−", insert: " - " },
      { display: "×", insert: " × " },
      { display: "÷", insert: " ÷ " },
      { display: "=", insert: " = " },
      { display: "≠", insert: " ≠ " },
      { display: "≈", insert: " ≈ " },
      { display: "±", insert: " ± " },
      { display: "√", insert: "√" },
      { display: "∛", insert: "∛" },
      { display: "^", insert: "^" },
      { display: "(", insert: "(" },
      { display: ")", insert: ")" },
      { display: "|x|", insert: "|  |" },
      { display: "%", insert: "%" },
    ],
  },
  {
    label: "Compare",
    symbols: [
      { display: "<", insert: " < " },
      { display: ">", insert: " > " },
      { display: "≤", insert: " ≤ " },
      { display: "≥", insert: " ≥ " },
      { display: "∞", insert: "∞" },
      { display: "→", insert: " → " },
      { display: "↔", insert: " ↔ " },
    ],
  },
  {
    label: "Greek",
    symbols: [
      { display: "π", insert: "π" },
      { display: "θ", insert: "θ" },
      { display: "α", insert: "α" },
      { display: "β", insert: "β" },
      { display: "γ", insert: "γ" },
      { display: "δ", insert: "δ" },
      { display: "λ", insert: "λ" },
      { display: "μ", insert: "μ" },
      { display: "σ", insert: "σ" },
      { display: "φ", insert: "φ" },
      { display: "Σ", insert: "Σ" },
      { display: "Δ", insert: "Δ" },
      { display: "Ω", insert: "Ω" },
    ],
  },
  {
    label: "Calc",
    symbols: [
      { display: "∫", insert: "∫" },
      { display: "∂", insert: "∂" },
      { display: "∇", insert: "∇" },
      { display: "lim", insert: "lim" },
      { display: "dy/dx", insert: "dy/dx" },
      { display: "f'(x)", insert: "f'(x)" },
      { display: "∑", insert: "∑" },
      { display: "∏", insert: "∏" },
      { display: "ⁿ√", insert: "ⁿ√" },
    ],
  },
  {
    label: "Exponents",
    symbols: [
      { display: "x²", insert: "²" },
      { display: "x³", insert: "³" },
      { display: "x⁻¹", insert: "⁻¹" },
      { display: "x⁻²", insert: "⁻²" },
      { display: "x½", insert: "^(1/2)" },
      { display: "x^n", insert: "^n" },
      { display: "10ⁿ", insert: "×10^" },
      { display: "eˣ", insert: "e^" },
    ],
  },
];

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
            key={s.display}
            type="button"
            className="math-sym-btn"
            onClick={() => onInsert(s.insert)}
            title={s.insert}
          >
            {s.display}
          </button>
        ))}
      </div>
    </div>
  );
}
