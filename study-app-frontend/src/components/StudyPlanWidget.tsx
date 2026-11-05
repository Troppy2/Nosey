import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPinnedStudyPlan, toggleStudyPlanItem } from "../lib/api";
import { toast } from "../lib/toast";
import {
  addDays,
  dayName,
  dayOfMonth,
  daysBetween,
  itemHref,
  todayString,
  weekdayInitial,
} from "../lib/studyPlan";
import type { StudyPlanDetail, StudyPlanItem } from "../lib/types";
import { Button } from "./Button";
import { Skeleton } from "./Skeletons";
import { StudyPlanModal } from "./StudyPlanModal";
import { PlayIcon } from "../icons";
import "../styles/components/study-plan-widget.css";

const STRIP_DAYS = 7;
const LIST_LIMIT = 5;

// Beta dashboard widget for the pinned plan. It answers "what do I do today":
// a countdown to the exam, a week strip of how much is planned per day, and
// the selected day's items. Everything else lives in StudyPlanModal.
export function StudyPlanWidget() {
  const [plan, setPlan] = useState<StudyPlanDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(todayString);
  // Ticked this visit. They stay listed (struck through) so a mis-tap is easy
  // to see and undo, instead of the row vanishing.
  const [justDone, setJustDone] = useState<Set<number>>(new Set());

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
    const done = !item.done;
    swap({ ...item, done, done_source: "manual" });
    setJustDone((prev) => {
      const next = new Set(prev);
      if (done) next.add(item.id);
      return next;
    });
    try {
      const saved = await toggleStudyPlanItem(item.id, done);
      swap({ ...saved, progress: item.progress, target_folder_id: item.target_folder_id });
    } catch {
      swap(item);
      toast.error("Couldn't save that. Try again.");
    }
  }

  const today = todayString();
  const items = plan?.items ?? [];
  const total = items.length;
  const doneCount = items.filter((it) => it.done).length;
  const overdue = items.filter((it) => !it.done && it.due_date && it.due_date < today);

  // Today's list also carries overdue work: that is what is due now.
  const dayItems = items
    .filter((it) => {
      if (selected === today) {
        if (it.due_date === today) return true;
        if (it.due_date && it.due_date < today) return !it.done || justDone.has(it.id);
        return false;
      }
      return it.due_date === selected;
    })
    .sort((a, b) => Number(a.done) - Number(b.done) || (a.due_date ?? "").localeCompare(b.due_date ?? "") || a.position - b.position);
  const shown = dayItems.slice(0, LIST_LIMIT);
  const openLeft = dayItems.filter((it) => !it.done).length;

  const strip = Array.from({ length: STRIP_DAYS }, (_, i) => {
    const date = addDays(today, i);
    const due = items.filter((it) => it.due_date === date);
    const left = due.filter((it) => !it.done).length + (i === 0 ? overdue.length : 0);
    return { date, left, total: due.length + (i === 0 ? overdue.length : 0) };
  });

  const nextUp = items
    .filter((it) => !it.done && it.due_date && it.due_date > today)
    .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))[0];

  return (
    <section className="study-plan-widget" aria-label="Study plan">
      <div className="section-title">
        <h2>Study plan</h2>
        {plan ? (
          <button type="button" className="text-link spw-open" onClick={() => setOpen(true)}>
            Open plan
          </button>
        ) : null}
      </div>

      <div className="spw">
        {loading ? (
          <div className="spw-loading" role="status" aria-label="Loading your study plan">
            <Skeleton width="40%" height="2.4rem" />
            <Skeleton width="100%" height="3rem" />
            <Skeleton width="90%" height="0.9rem" />
            <Skeleton width="80%" height="0.9rem" />
          </div>
        ) : failed ? (
          <div className="spw-empty">
            <p>Couldn't load your plan.</p>
            <Button
              variant="secondary"
              onClick={() => {
                setFailed(false);
                setLoading(true);
                load();
              }}
            >
              Try again
            </Button>
          </div>
        ) : !plan ? (
          <div className="spw-empty">
            <p>Tell Kojo what's coming up and get a day-by-day checklist for it.</p>
            <Button variant="secondary" onClick={() => setOpen(true)}>
              Make a plan
            </Button>
          </div>
        ) : (
          <>
            <Countdown plan={plan} done={doneCount} total={total} onOpen={() => setOpen(true)} />

            <div className="spw-strip" role="group" aria-label="Pick a day">
              {strip.map((day) => {
                const isExam = plan.exam_date === day.date;
                const isToday = day.date === today;
                const late = isToday && overdue.length > 0;
                return (
                  <button
                    key={day.date}
                    type="button"
                    className={
                      "spw-day" +
                      (day.date === selected ? " is-selected" : "") +
                      (isToday ? " is-today" : "") +
                      (isExam ? " is-exam" : "") +
                      (day.total > 0 && day.left === 0 ? " is-clear" : "")
                    }
                    aria-pressed={day.date === selected}
                    aria-label={`${dayName(day.date, today)}${isExam ? ", exam day" : ""}: ${
                      day.left ? `${day.left} left` : day.total ? "all done" : "nothing planned"
                    }`}
                    onClick={() => setSelected(day.date)}
                  >
                    <span className="spw-day-name">{weekdayInitial(day.date)}</span>
                    <span className="spw-day-num">{dayOfMonth(day.date)}</span>
                    <span className={`spw-day-load${late ? " is-late" : ""}`} aria-hidden="true">
                      {isExam ? (
                        <span className="spw-day-exam">Exam</span>
                      ) : (
                        Array.from({ length: Math.min(day.left, 3) }, (_, i) => <i key={i} />)
                      )}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="spw-list-head">
              <h3>{dayName(selected, today)}</h3>
              {dayItems.length ? (
                <span className="spw-left">{openLeft ? `${openLeft} left` : "All done"}</span>
              ) : null}
            </div>

            {shown.length === 0 ? (
              <p className="spw-none">
                {total === 0
                  ? "This plan is empty. Open it to add what you need to do."
                  : selected === today && nextUp?.due_date
                    ? `Nothing due today. Next up: ${dayName(nextUp.due_date, today)}.`
                    : "Nothing planned for this day."}
              </p>
            ) : (
              <ul className="spw-list">
                {shown.map((item) => (
                  <WidgetRow key={item.id} item={item} today={today} onToggle={() => void toggle(item)} />
                ))}
              </ul>
            )}

            {dayItems.length > LIST_LIMIT ? (
              <button type="button" className="text-link spw-more" onClick={() => setOpen(true)}>
                {dayItems.length - LIST_LIMIT} more in the plan
              </button>
            ) : null}
          </>
        )}
      </div>

      {open ? (
        <StudyPlanModal
          initialPlanId={plan?.id ?? null}
          onClose={() => setOpen(false)}
          onChanged={() => {
            setJustDone(new Set());
            load();
          }}
        />
      ) : null}
    </section>
  );
}

function Countdown({
  plan,
  done,
  total,
  onOpen,
}: {
  plan: StudyPlanDetail;
  done: number;
  total: number;
  onOpen: () => void;
}) {
  const days = plan.exam_date ? daysBetween(todayString(), plan.exam_date) : null;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <button type="button" className="spw-hero" onClick={onOpen} aria-label={`Open ${plan.title}`}>
      {days != null && days > 0 ? (
        <span className="spw-count">
          <span className="spw-count-num">{days}</span>
          <span className="spw-count-unit">{days === 1 ? "day until" : "days until"}</span>
        </span>
      ) : days === 0 ? (
        <span className="spw-count">
          <span className="spw-count-num spw-count-word">Exam day</span>
        </span>
      ) : null}
      <span className="spw-title">{plan.title}</span>
      <span className="spw-progress">
        <span className="spw-bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
        <span className="spw-progress-text">
          {done} of {total} done
        </span>
      </span>
    </button>
  );
}

function WidgetRow({ item, today, onToggle }: { item: StudyPlanItem; today: string; onToggle: () => void }) {
  const overdue = !item.done && item.due_date != null && item.due_date < today;
  const href = item.done ? null : itemHref(item);
  return (
    <li className={`spw-row${item.done ? " is-done" : ""}`}>
      <label className="spw-row-main">
        <input type="checkbox" className="checkbox-input spw-check" checked={item.done} onChange={onToggle} />
        <span className="spw-row-text">
          <span className="spw-row-label">{item.label}</span>
          {overdue || item.progress ? (
            <span className="spw-row-meta">
              {overdue ? <span className="spw-late">Overdue</span> : null}
              {item.progress ? <span>{item.progress} cards</span> : null}
            </span>
          ) : null}
        </span>
      </label>
      {href ? (
        <Link className="spw-start" to={href} aria-label={`Start ${item.label}`}>
          <PlayIcon size={14} />
          Start
        </Link>
      ) : null}
    </li>
  );
}
