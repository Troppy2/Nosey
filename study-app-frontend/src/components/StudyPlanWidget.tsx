import { useEffect, useState } from "react";
import { fetchPinnedStudyPlan, toggleStudyPlanItem } from "../lib/api";
import { toast } from "../lib/toast";
import type { StudyPlanDetail, StudyPlanItem } from "../lib/types";
import { Button } from "./Button";
import { Skeleton } from "./Skeletons";
import { StudyPlanModal, examCountdown, todayString } from "./StudyPlanModal";
import "../styles/components/study-plan-widget.css";
import "../styles/components/study-plan-modal.css";

// Beta dashboard widget: the pinned plan's next open items. The full plan
// (switching, editing, Plan with Kojo) lives in StudyPlanModal.
export function StudyPlanWidget() {
  const [plan, setPlan] = useState<StudyPlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  function load() {
    fetchPinnedStudyPlan()
      .then((data) => setPlan(data))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function toggle(item: StudyPlanItem) {
    const swap = (next: StudyPlanItem) =>
      setPlan((p) => (p ? { ...p, items: p.items.map((it) => (it.id === item.id ? next : it)) } : p));
    swap({ ...item, done: !item.done, done_source: "manual" });
    try {
      swap(await toggleStudyPlanItem(item.id, !item.done));
    } catch {
      swap(item);
      toast.error("Couldn't save that. Try again.");
    }
  }

  if (failed) return null;

  const today = todayString();
  const rank = (it: StudyPlanItem) => (!it.due_date ? 2 : it.due_date < today ? 0 : it.due_date === today ? 1 : 2);
  const next = (plan?.items ?? [])
    .filter((it) => !it.done)
    .sort((a, b) => rank(a) - rank(b) || a.position - b.position)
    .slice(0, 5);
  const done = plan?.items.filter((it) => it.done).length ?? 0;
  const total = plan?.items.length ?? 0;

  return (
    <section className="study-plan-widget" aria-label="Study plan">
      <div className="section-title">
        <h2>Study Plan</h2>
        {plan ? (
          <button type="button" className="text-link plan-widget-open" onClick={() => setOpen(true)}>
            Open
          </button>
        ) : null}
      </div>

      <div className="plan-widget">
        {loading ? (
          <div className="plan-widget-loading" role="status" aria-label="Loading your study plan">
            <Skeleton width="60%" height="1.1rem" />
            <Skeleton width="100%" height="0.9rem" />
            <Skeleton width="90%" height="0.9rem" />
          </div>
        ) : !plan ? (
          <div className="plan-widget-empty">
            <p>No plan pinned. Make one for your next exam and check things off as you go.</p>
            <Button variant="secondary" onClick={() => setOpen(true)}>
              Make a plan
            </Button>
          </div>
        ) : (
          <>
            <button type="button" className="plan-widget-head" onClick={() => setOpen(true)}>
              <span className="plan-widget-title">{plan.title}</span>
              <span className="plan-widget-sub">
                {plan.exam_date ? `${examCountdown(plan.exam_date)}, ` : ""}
                {done} of {total} done
              </span>
            </button>
            <div className="plan-progress" aria-hidden="true">
              <span style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
            </div>
            {next.length === 0 ? (
              <p className="plan-empty">{total ? "Everything's done. Nice." : "Nothing on this plan yet."}</p>
            ) : (
              <ul className="plan-checklist">
                {next.map((item) => (
                  <li key={item.id} className="plan-row">
                    <label className="plan-row-main">
                      <input type="checkbox" className="checkbox-input plan-check" checked={item.done} onChange={() => void toggle(item)} />
                      <span className="plan-row-label">{item.label}</span>
                    </label>
                    {item.progress || item.due_date ? (
                      <span className="plan-row-meta">
                        {item.progress ? <span className="plan-kind">{item.progress}</span> : null}
                        {item.due_date && item.due_date <= today ? (
                          <span className={`plan-due${item.due_date < today ? " is-overdue" : ""}`}>
                            {item.due_date < today ? "Overdue" : "Due today"}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {open ? (
        <StudyPlanModal
          initialPlanId={plan?.id ?? null}
          onClose={() => setOpen(false)}
          onChanged={load}
        />
      ) : null}
    </section>
  );
}
