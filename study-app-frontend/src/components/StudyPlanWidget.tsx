import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckIcon } from "../icons";
import { fetchPinnedStudyPlan, toggleStudyPlanItem } from "../lib/api";
import { toast } from "../lib/toast";
import type { StudyPlanDetail } from "../lib/types";
import { Button } from "./Button";
import { Card } from "./Card";
import { Skeleton } from "./Skeletons";
import "../styles/components/study-plan-widget.css";

function getTodayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatExamCountdown(dateStr: string): string {
  const target = new Date(dateStr + "T00:00:00");
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `Exam was ${Math.abs(diffDays)}d ago`;
  if (diffDays === 0) return "Exam today";
  if (diffDays === 1) return "Exam tomorrow";
  return `Exam in ${diffDays} days`;
}

export function StudyPlanWidget() {
  const [plan, setPlan] = useState<StudyPlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPinnedStudyPlan()
      .then((data) => {
        if (!cancelled) {
          setPlan(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleToggle(itemId: number, currentDone: boolean) {
    const nextDone = !currentDone;
    setPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((it) =>
          it.id === itemId
            ? { ...it, done: nextDone, done_source: nextDone ? "manual" : null }
            : it
        ),
      };
    });

    try {
      const updated = await toggleStudyPlanItem(itemId, nextDone);
      setPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((it) => (it.id === itemId ? updated : it)),
        };
      });
    } catch {
      setPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((it) =>
            it.id === itemId ? { ...it, done: currentDone } : it
          ),
        };
      });
      toast.error("Failed to update item");
    }
  }

  if (failed) return null;

  const today = getTodayString();
  const openItems = (plan?.items ?? []).filter((item) => !item.done);
  const sortedOpen = [...openItems].sort((a, b) => {
    const aDue = a.due_date;
    const bDue = b.due_date;
    const aOverdue = Boolean(aDue && aDue < today);
    const bOverdue = Boolean(bDue && bDue < today);
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;

    const aToday = Boolean(aDue && aDue === today);
    const bToday = Boolean(bDue && bDue === today);
    if (aToday && !bToday) return -1;
    if (!aToday && bToday) return 1;

    return a.position - b.position;
  });
  const displayItems = sortedOpen.slice(0, 5);

  return (
    <section className="study-plan-widget" aria-label="Study Plan">
      <div className="section-title">
        <h2>Study Plan</h2>
        <Link className="text-link" to="/plans">
          Open plan
        </Link>
      </div>

      <Card className="study-plan-card">
        {loading ? (
          <div className="study-plan-widget-loading" role="status" aria-label="Loading your study plan">
            <Skeleton width="60%" height="1.2rem" />
            <Skeleton width="40%" height="0.85rem" />
            <div className="study-plan-widget-skeleton-rows">
              <Skeleton width="100%" height="1rem" />
              <Skeleton width="90%" height="1rem" />
              <Skeleton width="95%" height="1rem" />
            </div>
          </div>
        ) : !plan ? (
          <div className="study-plan-widget-empty">
            <p className="muted small">No plan pinned</p>
            <Link to="/plans">
              <Button variant="secondary">
                Make a plan
              </Button>
            </Link>
          </div>
        ) : (
          <div className="study-plan-widget-content">
            <div className="study-plan-widget-header">
              <h3 className="study-plan-widget-title" title={plan.title}>
                <Link to="/plans" className="study-plan-title-link">
                  {plan.title}
                </Link>
              </h3>
              {plan.exam_date && (
                <span className="study-plan-countdown-badge">
                  {formatExamCountdown(plan.exam_date)}
                </span>
              )}
            </div>

            {displayItems.length === 0 ? (
              <p className="muted small study-plan-widget-all-done">
                {plan.items.length === 0
                  ? "No items in this plan yet."
                  : "All items completed!"}
              </p>
            ) : (
              <ul className="study-plan-widget-items">
                {displayItems.map((item) => {
                  const isOverdue = Boolean(item.due_date && item.due_date < today);
                  const isDueToday = Boolean(item.due_date && item.due_date === today);

                  return (
                    <li key={item.id} className="study-plan-widget-item-row">
                      <label className="study-plan-widget-checkbox-label">
                        <input
                          type="checkbox"
                          className="study-plan-checkbox"
                          checked={item.done}
                          onChange={() => handleToggle(item.id, item.done)}
                          aria-label={`Mark "${item.label}" as done`}
                        />
                        <span className="study-plan-item-label" title={item.label}>
                          {item.label}
                        </span>
                      </label>

                      <div className="study-plan-item-meta">
                        {item.done_source === "auto" && (
                          <span className="study-plan-auto-badge" title="Done in Nosey">
                            <CheckIcon size={12} className="study-plan-auto-check-anim" />
                            Done in Nosey
                          </span>
                        )}
                        {item.progress && (
                          <span className="study-plan-progress-pill">{item.progress}</span>
                        )}
                        {isOverdue && (
                          <span className="study-plan-due-pill overdue">Overdue</span>
                        )}
                        {isDueToday && (
                          <span className="study-plan-due-pill due-today">Due today</span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="study-plan-widget-footer">
              <Link to="/plans" className="text-link small">
                Open plan
              </Link>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}
