import { useState } from "react";
import { CloseIcon, PlusIcon } from "../icons";

type Case = { id: string; label: string; input: string; expected: string; custom?: boolean };
export function EditorTestCases({ cases, canAdd, onAdd, onRemove, onChange, onVisualize, visualizing, unavailable }: {
  cases: Case[];
  canAdd: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onChange: (id: string, field: "inputText" | "expectedOutput", value: string) => void;
  onVisualize?: (input: string) => void;
  visualizing: string | null;
  unavailable?: string;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const selected = selectedId === "__new__" ? cases[cases.length - 1] : cases.find((item) => item.id === selectedId) ?? cases[0];
  return (
    <div className="lc-testcases">
      <div className="lc-case-toolbar">
        <div className="lc-case-tabs" role="tablist" aria-label="Test cases">
          {cases.map((item, index) => (
            <button key={item.id} id={"lc-case-" + item.id} type="button" role="tab" aria-selected={selected?.id === item.id} aria-controls="lc-case-fields" tabIndex={selected?.id === item.id ? 0 : -1}
              onClick={() => setSelectedId(item.id)} onKeyDown={(event) => {
                const offsets: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: cases.length - 1 };
                if (!(event.key in offsets)) return;
                event.preventDefault();
                const next = cases[(offsets[event.key] + cases.length) % cases.length];
                setSelectedId(next.id);
                document.getElementById("lc-case-" + next.id)?.focus();
              }}>{item.label}</button>
          ))}
        </div>
        <button type="button" className="lc-case-add" aria-label="Add custom test case" title={canAdd ? "Add custom test case" : "Custom case limit reached"} disabled={!canAdd}
          onClick={() => { onAdd(); setSelectedId("__new__"); }}><PlusIcon size={16} /></button>
      </div>
      {selected ? (
        <div id="lc-case-fields" role="tabpanel" aria-labelledby={"lc-case-" + selected.id} className="lc-case-fields">
          <div className="lc-case-meta">
            <span>{selected.custom ? "Custom case" : "Example case"}</span>
            <div>
              {onVisualize && selected.input.trim() ? <button type="button" onClick={() => onVisualize(selected.input)} disabled={visualizing === selected.input}>{visualizing === selected.input ? "Loading trace..." : "Visualize"}</button> : null}
              {selected.custom ? <button type="button" aria-label="Remove custom test case" title="Remove custom test case" onClick={() => {
                const index = cases.findIndex((item) => item.id === selected.id);
                setSelectedId(cases[index - 1]?.id ?? cases[index + 1]?.id);
                onRemove(selected.id);
              }}><CloseIcon size={14} /></button> : null}
            </div>
          </div>
          <label><span>Input</span><textarea aria-label="Test case input" value={selected.input} readOnly={!selected.custom} rows={2}
            onChange={(event) => onChange(selected.id, "inputText", event.target.value)} placeholder={cases[0]?.input || "One argument per line, like the examples"} /></label>
          <label><span>Expected output</span><textarea aria-label="Expected output" value={selected.expected} readOnly={!selected.custom} rows={1}
            onChange={(event) => onChange(selected.id, "expectedOutput", event.target.value)} placeholder="Enter the expected result" /></label>
        </div>
      ) : <p className="lc-feedback-note">No test cases yet. Add a custom case to check your solution.</p>}
      {unavailable ? <p className="lc-feedback-note">{unavailable}</p> : null}
    </div>
  );
}
