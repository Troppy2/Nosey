import { useState } from "react";
import { Button } from "./Button";
import { toast } from "../lib/toast";
import { updateDashboardWidgets } from "../lib/api";
import "../styles/components/dashboard-widget-picker.css";

const OPTIONS = [
  { key: "review_these", label: "Review These" },
  { key: "weak_spots", label: "Weak Spots" },
  { key: "study_plan", label: "Study Plan" },
];

type Props = {
  current: string[];
  onSaved: (widgets: string[]) => void;
  onClose: () => void;
};

// Beta-only: pick exactly 2 sidebar widgets, in display order.
export function DashboardWidgetPicker({ current, onSaved, onClose }: Props) {
  const [picked, setPicked] = useState(current);
  const [saving, setSaving] = useState(false);

  function toggle(key: string) {
    if (picked.includes(key)) setPicked(picked.filter((k) => k !== key));
    else setPicked(picked.length < 2 ? [...picked, key] : [picked[0], key]);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await updateDashboardWidgets(picked);
      onSaved(res.dashboard_widgets);
      toast.success("Sidebar updated");
    } catch {
      toast.error("Couldn't save your sidebar. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => !saving && onClose()}>
      <div className="modal-card widget-picker" role="dialog" aria-modal="true" aria-labelledby="widget-picker-title" onMouseDown={(e) => e.stopPropagation()}>
        <h2 id="widget-picker-title">Sidebar widgets</h2>
        <p className="muted small">Pick 2. They show in the order you pick them.</p>

        <div className="widget-picker-options">
          {OPTIONS.map((opt) => {
            const order = picked.indexOf(opt.key);
            return (
              <label key={opt.key} className={`widget-picker-option${order >= 0 ? " is-picked" : ""}`}>
                <input type="checkbox" checked={order >= 0} onChange={() => toggle(opt.key)} />
                <span className="widget-picker-label">{opt.label}</span>
                {order >= 0 ? <span className="widget-picker-order">{order + 1}</span> : null}
              </label>
            );
          })}
        </div>

        <div className="button-row">
          <Button variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={saving || picked.length !== 2} onClick={save}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
