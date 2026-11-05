import { memo, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type MutableRefObject, type RefObject } from "react";
import { Link } from "react-router-dom";
import { Button } from "./Button";
import { ConfirmModal } from "./ConfirmModal";
import { DatePicker } from "./DatePicker";
import { ToggleSwitch } from "./ToggleSwitch";
import { Dropdown, type DropdownOption } from "./Dropdown";
import KojoMascot from "./KojoMascot";
import { ArrowLeftIcon, CheckIcon, CloseIcon, PlayIcon, PlusIcon, SettingsIcon, SparklesIcon, TrashIcon } from "../icons";
import {
  createStudyPlan,
  deleteStudyPlan,
  fetchStudyPlan,
  fetchStudyPlans,
  fetchStudyPlansCatalog,
  generateStudyPlanDraft,
  replaceStudyPlanItems,
  updateStudyPlan,
} from "../lib/api";
import { toast } from "../lib/toast";
import { examCountdown, groupByDay, itemHref, KIND_LABEL, shortDay, todayString, type DayGroup } from "../lib/studyPlan";
import type { CatalogResponse, StudyPlanDetail, StudyPlanItem, StudyPlanItemInput, StudyPlanItemKind, StudyPlanSummary } from "../lib/types";
import "../styles/components/study-plan-modal.css";

const CATALOG_KEY: Partial<Record<StudyPlanItemKind, keyof CatalogResponse>> = {
  test: "tests",
  module: "modules",
  flashcards: "flashcards",
  leetcode: "leetcode",
  system_design: "system_design",
  mock_interview: "mock_interview",
};

const KIND_OPTIONS: DropdownOption<StudyPlanItemKind>[] = (Object.keys(KIND_LABEL) as StudyPlanItemKind[]).map(
  (kind) => ({ value: kind, label: KIND_LABEL[kind] }),
);

type View = "plan" | "new" | "settings";

type RowActions = {
  toggle: (item: StudyPlanItem) => void;
  rename: (item: StudyPlanItem, label: string) => void;
  reschedule: (item: StudyPlanItem, date: string) => void;
  remove: (item: StudyPlanItem) => void;
  navigate: () => void;
};
type RowActionsRef = MutableRefObject<RowActions>;

type Props = {
  initialPlanId: number | null;
  /** The plan the caller already has (the widget's), so the modal opens without a spinner. */
  initialPlan?: StudyPlanDetail | null;
  onClose: () => void;
  /** Called after any change so the dashboard widget can refetch. */
  onChanged: () => void;
};

// The full study plan, grouped by day. Every edit (tick, rename, reschedule,
// remove, add) saves on its own through one queue, so there is no edit mode.
export function StudyPlanModal({ initialPlanId, initialPlan = null, onClose, onChanged }: Props) {
  const seeded = initialPlan && initialPlan.id === initialPlanId ? initialPlan : null;
  const [plans, setPlans] = useState<StudyPlanSummary[]>([]);
  const [plan, setPlan] = useState<StudyPlanDetail | null>(seeded);
  const [view, setView] = useState<View>(initialPlanId ? "plan" : "new");
  const [loading, setLoading] = useState(!seeded);
  const [busy, setBusy] = useState(false);
  const [composerDate, setComposerDate] = useState("");
  const composerInputRef = useRef<HTMLInputElement>(null);

  // Save queue. Saves run one at a time with the newest local items, so two
  // quick edits never race. New rows carry a negative temp id until the
  // server answers; `idMap` maps those to real ids for the next save.
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const versionRef = useRef(0);
  const itemsRef = useRef<StudyPlanItem[]>(seeded?.items ?? []);
  const idMap = useRef(new Map<number, number>());
  const tempId = useRef(-1);

  // `quiet` refreshes behind what is already on screen (no spinner). The list
  // and the plan load in parallel when the plan id is known.
  async function load(planId: number | null, quiet = false) {
    if (!quiet) setLoading(true);
    const startVersion = versionRef.current;
    try {
      const [list, known] = await Promise.all([
        fetchStudyPlans(),
        planId ? fetchStudyPlan(planId) : Promise.resolve(null),
      ]);
      setPlans(list);
      const id = planId ?? list.find((p) => p.is_pinned)?.id ?? list[0]?.id ?? null;
      const detail = known ?? (id ? await fetchStudyPlan(id) : null);
      // An edit made while this was loading wins over the fetched copy.
      if (versionRef.current === startVersion) {
        setPlan(detail);
        itemsRef.current = detail?.items ?? [];
      }
      if (!detail) setView("new");
    } catch {
      toast.error("Couldn't load your study plans.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(initialPlanId, seeded != null);
    // Runs once per open; the modal remounts each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lock the page behind the sheet. Otherwise a swipe that reaches the end of
  // the list scrolls the dashboard, and on phones the browser bar then
  // resizes the sheet under your finger.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function commit(next: StudyPlanItem[]) {
    if (!plan) return;
    const planId = plan.id;
    const previous = itemsRef.current;
    itemsRef.current = next;
    setPlan((p) => (p ? { ...p, items: next } : p));
    const version = ++versionRef.current;

    queueRef.current = queueRef.current.then(async () => {
      const sending = itemsRef.current;
      const payload: StudyPlanItemInput[] = sending.map((it) => {
        const id = it.id > 0 ? it.id : idMap.current.get(it.id);
        return {
          ...(id ? { id } : {}),
          kind: it.kind,
          label: it.label,
          target_id: it.target_id ?? null,
          target_count: it.target_count ?? null,
          due_date: it.due_date ?? null,
          done: it.done,
        };
      });
      try {
        const saved = await replaceStudyPlanItems(planId, payload);
        const ordered = [...saved.items].sort((a, b) => a.position - b.position);
        sending.forEach((it, i) => {
          if (it.id < 0 && ordered[i]) idMap.current.set(it.id, ordered[i].id);
        });
        if (version === versionRef.current) {
          itemsRef.current = saved.items;
          setPlan((p) => (p && p.id === saved.id ? saved : p));
        }
        onChanged();
      } catch {
        if (version === versionRef.current) {
          itemsRef.current = previous;
          setPlan((p) => (p && p.id === planId ? { ...p, items: previous } : p));
        }
        toast.error("Couldn't save that change. Try again.");
      }
    });
  }

  const update = (id: number, patch: Partial<StudyPlanItem>) =>
    commit(itemsRef.current.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  function toggle(item: StudyPlanItem) {
    update(item.id, { done: !item.done, done_source: "manual" });
  }

  function remove(item: StudyPlanItem) {
    const before = itemsRef.current;
    commit(before.filter((it) => it.id !== item.id));
    toast.success("Removed from plan", item.label, {
      label: "Undo",
      onClick: () => {
        const without = itemsRef.current;
        const at = Math.min(before.findIndex((it) => it.id === item.id), without.length);
        commit([...without.slice(0, at), { ...item, id: tempId.current-- }, ...without.slice(at)]);
      },
    });
  }

  function add(input: Omit<StudyPlanItemInput, "id">) {
    if (!plan) return;
    const items = itemsRef.current;
    const position = items.reduce((max, it) => Math.max(max, it.position), -1) + 1;
    commit([
      ...items,
      {
        id: tempId.current--,
        plan_id: plan.id,
        position,
        kind: input.kind,
        label: input.label,
        target_id: input.target_id ?? null,
        target_count: input.target_count ?? null,
        due_date: input.due_date ?? null,
        done: false,
        created_at: new Date().toISOString(),
      },
    ]);
  }

  async function switchPlan(id: number) {
    await queueRef.current;
    idMap.current.clear();
    setView("plan");
    await load(id);
  }

  async function savePlanFields(body: { title?: string; exam_date?: string | null; is_pinned?: boolean }) {
    if (!plan) return;
    setPlan({ ...plan, ...body });
    try {
      const saved = await updateStudyPlan(plan.id, body);
      setPlan((p) => (p && p.id === saved.id ? { ...saved, items: p.items } : p));
      setPlans(await fetchStudyPlans());
      onChanged();
    } catch {
      toast.error("Couldn't save the plan. Try again.");
      void load(plan.id);
    }
  }

  async function removePlan() {
    if (!plan) return;
    setBusy(true);
    try {
      await queueRef.current;
      await deleteStudyPlan(plan.id);
      toast.success("Plan deleted");
      onChanged();
      setView("plan");
      await load(null);
    } catch {
      toast.error("Couldn't delete the plan. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Rows get one stable ref instead of fresh callbacks, so memoized rows skip
  // re-rendering when a sibling changes. Synced after each render; handlers
  // only run from events, which come after that.
  const rowActions = useRef<RowActions>(null as unknown as RowActions);
  useLayoutEffect(() => {
    rowActions.current = {
      toggle,
      rename: (item, label) => update(item.id, { label }),
      reschedule: (item, date) => update(item.id, { due_date: date || null }),
      remove,
      navigate: onClose,
    };
  });

  function addToDay(date: string | null) {
    setComposerDate(date ?? "");
    composerInputRef.current?.focus();
  }

  const titleId = "study-plan-modal-title";
  const items = plan?.items ?? [];
  const done = items.filter((it) => it.done).length;
  const total = items.length;

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className={`modal-card plan-modal plan-modal--${view}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="plan-modal-top">
          <div className="plan-modal-head">
            {view !== "plan" && plan ? (
              <button type="button" className="plan-icon-btn" onClick={() => setView("plan")} aria-label="Back to plan">
                <ArrowLeftIcon size={18} />
              </button>
            ) : null}
            {view === "plan" && plan && plans.length > 1 ? (
              <Dropdown
                bare
                id={titleId}
                label="Switch plan"
                className="plan-modal-switch"
                value={String(plan.id)}
                options={plans.map((p) => ({ value: String(p.id), label: p.title }))}
                onChange={(id) => void switchPlan(Number(id))}
              />
            ) : (
              <h2 id={titleId} className="plan-modal-title">
                {view === "new" ? "New study plan" : view === "settings" ? "Plan settings" : plan?.title ?? "Study plan"}
              </h2>
            )}
            {view === "plan" && plan ? (
              <>
                <button type="button" className="plan-icon-btn" onClick={() => setView("new")} aria-label="New plan" title="New plan">
                  <PlusIcon size={18} />
                </button>
                <button type="button" className="plan-icon-btn" onClick={() => setView("settings")} aria-label="Plan settings" title="Plan settings">
                  <SettingsIcon size={18} />
                </button>
              </>
            ) : null}
            <button type="button" className="plan-icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
              <CloseIcon size={18} />
            </button>
          </div>

          {view === "plan" && plan ? (
            <div className="plan-modal-meta">
              {plan.exam_date ? <span className="plan-countdown">{examCountdown(plan.exam_date)}</span> : null}
              <span className="plan-progress" aria-hidden="true">
                <span style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
              </span>
              <span className="plan-done-count">
                {done} of {total} done
              </span>
            </div>
          ) : null}
        </header>

        {loading ? (
          <div className="plan-modal-loading" role="status">
            <KojoMascot state="loading" size={40} />
          </div>
        ) : view === "new" ? (
          <NewPlan
            busy={busy}
            setBusy={setBusy}
            isFirst={plans.length === 0}
            onCreated={(created) => {
              onChanged();
              idMap.current.clear();
              setView("plan");
              void load(created.id);
            }}
            onCancel={plan ? () => setView("plan") : undefined}
          />
        ) : view === "settings" && plan ? (
          <PlanSettings plan={plan} busy={busy} onSave={(body) => void savePlanFields(body)} onDelete={() => void removePlan()} />
        ) : plan ? (
          <>
            <div className="plan-body">
              {total === 0 ? (
                <p className="plan-empty">Nothing on this plan yet. Add the first thing below.</p>
              ) : (
                groupByDay(items).map((group) => (
                  <DaySection
                    key={group.key}
                    group={group}
                    actions={rowActions}
                    onAddHere={group.key === "overdue" ? undefined : () => addToDay(group.date)}
                  />
                ))
              )}
            </div>
            <Composer inputRef={composerInputRef} date={composerDate} onDateChange={setComposerDate} onAdd={add} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function DaySection({
  group,
  actions,
  onAddHere,
}: {
  group: DayGroup;
  actions: RowActionsRef;
  onAddHere?: () => void;
}) {
  const today = todayString();
  const finishedPast = group.open.length === 0 && group.date != null && group.date < today;
  const [showDone, setShowDone] = useState(false);
  const headingId = `plan-day-${group.key}`;
  const row = (item: StudyPlanItem) => <PlanRow key={item.id} item={item} actions={actions} />;

  return (
    <section className={`plan-day${group.key === "overdue" ? " is-overdue" : ""}${finishedPast ? " is-past" : ""}`} aria-labelledby={headingId}>
      <div className="plan-day-head">
        <h3 id={headingId}>{group.title}</h3>
        <span className="plan-day-count">
          {group.open.length ? `${group.open.length} left` : "All done"}
        </span>
        {onAddHere ? (
          <button type="button" className="plan-day-add" onClick={onAddHere} aria-label={`Add to ${group.title}`}>
            <PlusIcon size={16} />
          </button>
        ) : null}
      </div>
      {group.open.length ? <ul className="plan-checklist">{group.open.map(row)}</ul> : null}
      {group.done.length ? (
        <>
          <button type="button" className="plan-done-toggle" aria-expanded={showDone} onClick={() => setShowDone((s) => !s)}>
            <CheckIcon size={14} />
            {group.done.length} done
          </button>
          {showDone ? <ul className="plan-checklist">{group.done.map(row)}</ul> : null}
        </>
      ) : null}
    </section>
  );
}

// Rows only show what you act on every day: tick it, or start it. Renaming,
// moving to another day and removing live in a small editor that opens when
// the label is tapped, so a 30-item plan is not 90 icon buttons. Memoized:
// ticking one row re-renders that row only.
const PlanRow = memo(function PlanRow({ item, actions }: { item: StudyPlanItem; actions: RowActionsRef }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.label);
  const today = todayString();
  const overdue = !item.done && item.due_date != null && item.due_date < today;
  const href = item.done ? null : itemHref(item);
  const saving = item.id < 0;
  const auto = item.done && item.done_source === "auto";
  const hasMeta = item.kind !== "free_text" || Boolean(item.progress) || overdue || auto;

  function openEditor() {
    setText(item.label);
    setEditing(true);
  }

  function finish(save: boolean) {
    setEditing(false);
    const next = text.trim();
    if (save && next && next !== item.label) actions.current.rename(item, next);
  }

  return (
    <li className={`plan-row${item.done ? " is-done" : ""}${editing ? " is-editing" : ""}`}>
      <input
        type="checkbox"
        className="checkbox-input plan-check"
        checked={item.done}
        disabled={saving}
        onChange={() => actions.current.toggle(item)}
        aria-label={item.done ? `Mark "${item.label}" not done` : `Mark "${item.label}" done`}
      />
      {editing ? (
        <div className="plan-row-editor">
          <input
            className="input plan-row-edit"
            value={text}
            maxLength={300}
            autoFocus
            aria-label="Item name"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") finish(true);
              if (e.key === "Escape") {
                e.preventDefault();
                finish(false);
              }
            }}
          />
          <div className="plan-row-editor-bar">
            <DatePicker
              label="Due date"
              value={item.due_date ?? ""}
              placeholder="No date"
              onChange={(date) => actions.current.reschedule(item, date)}
              disabled={saving}
            />
            <Button variant="ghost" className="plan-row-remove" onClick={() => actions.current.remove(item)} disabled={saving} icon={<TrashIcon size={16} />}>
              Remove
            </Button>
            <Button variant="secondary" onClick={() => finish(true)}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" className="plan-row-main" onClick={openEditor} aria-label={`Edit ${item.label}`}>
          <span className="plan-row-label">{item.label}</span>
          {hasMeta ? (
            <span className="plan-row-meta">
              {overdue ? <span className="plan-late">Overdue</span> : null}
              {item.kind !== "free_text" ? <span>{KIND_LABEL[item.kind]}</span> : null}
              {item.progress ? <span>{item.progress} cards</span> : null}
              {auto ? (
                <span className="plan-stamp">
                  <CheckIcon size={12} />
                  Done in Nosey
                </span>
              ) : null}
            </span>
          ) : null}
        </button>
      )}
      {href && !editing ? (
        <Link className="plan-start" to={href} onClick={() => actions.current.navigate()} aria-label={`Start ${item.label}`}>
          <PlayIcon size={14} />
          Start
        </Link>
      ) : null}
    </li>
  );
});

function Composer({
  inputRef,
  date,
  onDateChange,
  onAdd,
}: {
  inputRef: RefObject<HTMLInputElement>;
  date: string;
  onDateChange: (date: string) => void;
  onAdd: (input: Omit<StudyPlanItemInput, "id">) => void;
}) {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [kind, setKind] = useState<StudyPlanItemKind>("free_text");
  const [label, setLabel] = useState("");
  const [targetId, setTargetId] = useState("");
  const [count, setCount] = useState("");

  useEffect(() => {
    fetchStudyPlansCatalog().then(setCatalog).catch(() => setCatalog(null));
  }, []);

  const catalogKey = CATALOG_KEY[kind];
  const options = (catalogKey && catalog ? catalog[catalogKey] : []).map((it) => ({ value: String(it.id), label: it.title }));
  const linked = kind !== "free_text";
  const noun = KIND_LABEL[kind].toLowerCase();
  const canAdd = linked ? Boolean(targetId) : Boolean(label.trim());

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canAdd) return;
    onAdd({
      kind,
      label: linked ? options.find((o) => o.value === targetId)?.label ?? "" : label.trim(),
      target_id: linked ? Number(targetId) : null,
      target_count: kind === "flashcards" && count ? Number(count) : null,
      due_date: date || null,
    });
    setLabel("");
    setTargetId("");
    setCount("");
    inputRef.current?.focus();
  }

  return (
    <form className="plan-composer" onSubmit={submit} aria-label="Add to plan">
      <Dropdown
        bare
        label="Type"
        className="input plan-composer-kind"
        value={kind}
        options={KIND_OPTIONS}
        onChange={(k) => {
          setKind(k);
          setTargetId("");
        }}
      />
      <div className="plan-composer-main">
        {linked ? (
          <Dropdown
            bare
            label={KIND_LABEL[kind]}
            className="input plan-composer-target"
            value={targetId}
            placeholder={options.length ? `Pick a ${noun}` : `No ${noun}s yet`}
            options={options}
            disabled={!options.length}
            onChange={setTargetId}
          />
        ) : (
          <input
            ref={inputRef}
            className="input"
            value={label}
            maxLength={300}
            placeholder="Add a task, like Reread chapter 4"
            aria-label="Task"
            onChange={(e) => setLabel(e.target.value)}
          />
        )}
      </div>
      {kind === "flashcards" ? (
        <input
          className="input plan-composer-count"
          type="number"
          min={1}
          value={count}
          placeholder="Cards"
          aria-label="Number of cards"
          onChange={(e) => setCount(e.target.value)}
        />
      ) : null}
      <DatePicker variant="chip" label="Due date" value={date} display={date ? shortDay(date) : "No date"} onChange={onDateChange} />
      <Button type="submit" variant="primary" disabled={!canAdd} icon={<PlusIcon size={16} />}>
        Add
      </Button>
    </form>
  );
}

function PlanSettings({
  plan,
  busy,
  onSave,
  onDelete,
}: {
  plan: StudyPlanDetail;
  busy: boolean;
  onSave: (body: { title?: string; exam_date?: string | null; is_pinned?: boolean }) => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(plan.title);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="plan-settings">
      <label className="field">
        <span className="field-label">Plan name</span>
        <input
          className="input"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            const next = title.trim();
            if (next && next !== plan.title) onSave({ title: next });
            else setTitle(plan.title);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <div className="field">
        <span className="field-label">Exam date</span>
        <DatePicker
          label="Exam date"
          value={plan.exam_date ?? ""}
          onChange={(v) => onSave({ exam_date: v || null })}
          placeholder="No exam date"
        />
      </div>
      <div className="plan-settings-row">
        <ToggleSwitch
          checked={plan.is_pinned}
          label="Show on dashboard"
          onClick={() => onSave({ is_pinned: !plan.is_pinned })}
          disabled={busy}
        />
        <p className="muted small">One plan shows on the dashboard at a time.</p>
      </div>

      <div className="plan-settings-danger">
        <Button variant="danger-outline" onClick={() => setConfirmDelete(true)} disabled={busy} icon={<TrashIcon size={16} />}>
          Delete plan
        </Button>
      </div>

      {confirmDelete ? (
        <ConfirmModal
          title="Delete this plan?"
          message={`"${plan.title}" and its checklist will be removed. This can't be undone.`}
          confirmLabel="Delete plan"
          danger
          busy={busy}
          busyLabel="Deleting"
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      ) : null}
    </div>
  );
}

function NewPlan({
  busy,
  setBusy,
  isFirst,
  onCreated,
  onCancel,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  isFirst: boolean;
  onCreated: (plan: StudyPlanDetail) => void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [examDate, setExamDate] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function create(withKojo: boolean) {
    setBusy(true);
    setError(null);
    try {
      const draft = withKojo ? await generateStudyPlanDraft(text) : null;
      const created = await createStudyPlan({
        title: title.trim() || draft?.title || "New study plan",
        exam_date: examDate || draft?.exam_date || null,
        is_pinned: isFirst,
        items: draft?.items ?? [],
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kojo couldn't make a plan. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (busy) {
    return (
      <div className="plan-modal-loading" role="status">
        <KojoMascot state="loading" size={48} />
        <p>Kojo is sorting your plan</p>
      </div>
    );
  }

  return (
    <div className="plan-new">
      <div className="plan-new-fields">
        <label className="field">
          <span className="field-label">Plan name</span>
          <input className="input" value={title} maxLength={120} placeholder="Bio midterm" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="field">
          <span className="field-label">Exam date</span>
          <DatePicker label="Exam date" value={examDate} onChange={setExamDate} min={todayString()} placeholder="Pick a date" />
        </div>
      </div>
      <label className="field">
        <span className="field-label">What do you need to get done?</span>
        <textarea
          className="input plan-dump"
          rows={6}
          value={text}
          maxLength={6000}
          onChange={(e) => setText(e.target.value)}
          placeholder="Retake practice test 2, finish the photosynthesis module, review 30 cell bio flashcards, reread chapter 4."
        />
      </label>
      {error ? (
        <p className="plan-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="button-row plan-modal-foot">
        <Button variant="ghost" onClick={() => void create(false)}>
          Start blank
        </Button>
        <span className="plan-foot-spacer" />
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button variant="primary" disabled={!text.trim()} onClick={() => void create(true)} icon={<SparklesIcon size={15} />}>
          Make my plan
        </Button>
      </div>
    </div>
  );
}
