import { ChevronDown, PenLine } from "lucide-react";
import { useRef, useState } from "react";
import { MathKeyboard } from "./MathKeyboard";

type MathInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function MathInput({ value, onChange, placeholder }: MathInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [scratchpad, setScratchpad] = useState("");
  const [scratchOpen, setScratchOpen] = useState(false);

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
    // restore cursor after React re-render
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + symbol.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  return (
    <div className="math-input-wrap">
      <label className="field-label">Your answer</label>
      <textarea
        ref={textareaRef}
        className="field-input math-answer-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Type your answer using the keyboard below or write normally…"}
        rows={3}
      />

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
