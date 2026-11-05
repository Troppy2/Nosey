import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { toast } from "../lib/toast";
import { updateDashboardWidgets } from "../lib/api";
import "../styles/components/dashboard-widget-picker.css";

const OPTIONS = [
  { key: "review_these", label: "Flashcards due", hint: "Cards ready to review today" },
  { key: "weak_spots", label: "Weak Spots", hint: "Topics you miss most" },
  { key: "study_plan", label: "Study plan", hint: "Exam countdown and today's checklist" },
];

const LIMIT = 2;
const ORDINAL = ["Shows first", "Shows second"];

type Props = {
  current: string[];
  onSaved: (widgets: string[]) => void;
  onClose: () => void;
};

// Pick 2 sidebar widgets. They show in the order they were ticked.
// Portalled to <body> so the backdrop covers the whole screen; inside the
// page it is clipped by the page's own containing block.
export function DashboardWidgetPicker({ current, onSaved, onClose }: Props) {
  const [picked, setPicked] = useState(current);
  const [saving, setSaving] = useState(false);
  const full = picked.length >= LIMIT;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  function toggle(key: string) {
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : p.length < LIMIT ? [...p, key] : p));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await updateDashboardWidgets(picked);
      onSaved(res.dashboard_widgets);
      toast.success("Widgets updated");
    } catch {
      toast.error("Couldn't save your widgets. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" onMouseDown={() => !saving && onClose()}>
      <div
        className="modal-card widget-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="widget-picker-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="widget-picker-head">
          <h2 id="widget-picker-title">Dashboard widgets</h2>
          <p className="muted small">Pick {LIMIT}. The first one you tick shows on top.</p>
        </header>

        <ul className="widget-picker-list">
          {OPTIONS.map((opt) => {
            const order = picked.indexOf(opt.key);
            const checked = order >= 0;
            const locked = !checked && full;
            return (
              <li key={opt.key}>
                <label className={`widget-picker-row${checked ? " is-checked" : ""}${locked ? " is-locked" : ""}`}>
                  <input
                    type="checkbox"
                    className="checkbox-input widget-picker-check"
                    checked={checked}
                    disabled={locked || saving}
                    onChange={() => toggle(opt.key)}
                  />
                  <span className="widget-picker-text">
                    <span className="widget-picker-label">{opt.label}</span>
                    <span className="widget-picker-hint">{opt.hint}</span>
                  </span>
                  {checked ? <span className="widget-picker-order">{ORDINAL[order]}</span> : null}
                </label>
              </li>
            );
          })}
        </ul>

        <div className="widget-picker-foot">
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving || picked.length !== LIMIT} onClick={() => void save()}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
