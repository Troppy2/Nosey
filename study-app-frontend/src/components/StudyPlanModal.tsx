import { useEffect, useState } from "react";
import { Button } from "./Button";
import { ConfirmModal } from "./ConfirmModal";
import { DatePicker } from "./DatePicker";
import { ToggleSwitch } from "./ToggleSwitch";
import { Dropdown, type DropdownOption } from "./Dropdown";
import KojoMascot from "./KojoMascot";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CloseIcon, PencilIcon, PlusIcon, SparklesIcon, TrashIcon } from "../icons";
import {
  createStudyPlan,
  deleteStudyPlan,
  fetchStudyPlan,
  fetchStudyPlans,
  fetchStudyPlansCatalog,
  generateStudyPlanDraft,
  replaceStudyPlanItems,
  toggleStudyPlanItem,
  updateStudyPlan,
} from "../lib/api";
import { toast } from "../lib/toast";
import type { CatalogResponse, StudyPlanDetail, StudyPlanItem, StudyPlanItemInput, StudyPlanItemKind, StudyPlanSummary } from "../lib/types";
import "../styles/components/study-plan-modal.css";

const KIND_LABEL: Record<StudyPlanItemKind, string> = {
  free_text: "Task",
  test: "Test",
  module: "Module",
  flashcards: "Flashcards",
  leetcode: "KojoCode",
  system_design: "System design",
  mock_interview: "Mock interview",
};

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

type Draft = { id?: number; title: string; exam_date: string; items: StudyPlanItemInput[] };
type View = "list" | "edit" | "new";

export function todayString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function examCountdown(date: string): string {
  const days = Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${todayString()}T00:00:00`).getTime()) / 86_400_000);
  if (days < 0) return `Exam was ${-days}d ago`;
  if (days === 0) return "Exam today";
  if (days === 1) return "Exam tomorrow";
  return `Exam in ${days} days`;
}

function toDraft(plan: StudyPlanDetail): Draft {
  return {
    id: plan.id,
    title: plan.title,
    exam_date: plan.exam_date ?? "",
    items: plan.items.map(({ id, kind, label, target_id, target_count, due_date, done }) => ({
      id, kind, label, target_id, target_count, due_date, done,
    })),
  };
}

type Props = {
  initialPlanId: number | null;
  onClose: () => void;
  /** Called after any change so the dashboard widget can refetch. */
  onChanged: () => void;
};

export function StudyPlanModal({ initialPlanId, onClose, onChanged }: Props) {
  const [plans, setPlans] = useState<StudyPlanSummary[]>([]);
  const [plan, setPlan] = useState<StudyPlanDetail | null>(null);
  const [view, setView] = useState<View>(initialPlanId ? "list" : "new");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  async function load(planId: number | null) {
    setLoading(true);
    try {
      const list = await fetchStudyPlans();
      setPlans(list);
      const id = planId ?? list.find((p) => p.is_pinned)?.id ?? list[0]?.id ?? null;
      setPlan(id ? await fetchStudyPlan(id) : null);
      if (!id) setView("new");
    } catch {
      toast.error("Couldn't load your study plans.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(initialPlanId);
    // Runs once per open; the modal remounts each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !e.defaultPrevented && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function toggle(item: StudyPlanItem) {
    if (!plan) return;
    const swap = (next: StudyPlanItem) =>
      setPlan((p) => (p ? { ...p, items: p.items.map((it) => (it.id === item.id ? next : it)) } : p));
    swap({ ...item, done: !item.done, done_source: "manual" });
    try {
      swap(await toggleStudyPlanItem(item.id, !item.done));
      onChanged();
    } catch {
      swap(item);
      toast.error("Couldn't save that. Try again.");
    }
  }

  async function togglePin() {
    if (!plan) return;
    setBusy(true);
    try {
      setPlan(await updateStudyPlan(plan.id, { is_pinned: !plan.is_pinned }));
      setPlans(await fetchStudyPlans());
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!plan) return;
    setBusy(true);
    try {
      await deleteStudyPlan(plan.id);
      toast.success("Plan deleted");
      onChanged();
      await load(null);
      setView((v) => (v === "edit" ? "list" : v));
    } finally {
      setBusy(false);
    }
  }

  async function save(next: Draft) {
    if (!next.title.trim()) {
      toast.error("Give the plan a name.");
      return;
    }
    setBusy(true);
    try {
      const body = { title: next.title.trim(), exam_date: next.exam_date || null };
      let saved: StudyPlanDetail;
      if (next.id) {
        await updateStudyPlan(next.id, body);
        saved = await replaceStudyPlanItems(next.id, next.items);
      } else {
        saved = await createStudyPlan({ ...body, is_pinned: plans.length === 0, items: next.items });
      }
      toast.success("Plan saved");
      onChanged();
      setDraft(null);
      setView("list");
      await load(saved.id);
    } catch {
      toast.error("Couldn't save the plan. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const titleId = "study-plan-modal-title";
  const done = plan?.items.filter((it) => it.done).length ?? 0;
  const total = plan?.items.length ?? 0;

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal-card plan-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="plan-modal-head">
          {view === "list" && plan && plans.length > 1 ? (
            <Dropdown
              bare
              label="Switch plan"
              className="plan-modal-switch"
              value={String(plan.id)}
              options={plans.map((p) => ({ value: String(p.id), label: p.title }))}
              onChange={(id) => void load(Number(id))}
            />
          ) : (
            <h2 id={titleId} className="plan-modal-title">
              {view === "new" || (view === "edit" && !draft?.id) ? "New study plan" : view === "edit" ? "Edit plan" : plan?.title ?? "Study plan"}
            </h2>
          )}
          <button type="button" className="plan-icon-btn" onClick={onClose} aria-label="Close" disabled={busy}>
            <CloseIcon size={18} />
          </button>
        </header>

        {loading ? (
          <div className="plan-modal-loading" role="status">
            <KojoMascot state="loading" size={40} />
          </div>
        ) : view === "new" ? (
          <NewPlan
            busy={busy}
            setBusy={setBusy}
            onBlank={() => {
              setDraft({ title: "", exam_date: "", items: [] });
              setView("edit");
            }}
            onDraft={(d) => {
              setDraft({ title: d.title, exam_date: d.exam_date ?? "", items: d.items });
              setView("edit");
            }}
            onCancel={plan ? () => setView("list") : undefined}
          />
        ) : view === "edit" && draft ? (
          <PlanEditor
            draft={draft}
            busy={busy}
            onChange={setDraft}
            onSave={() => void save(draft)}
            onCancel={() => {
              setDraft(null);
              setView(plan ? "list" : "new");
            }}
            onDelete={draft.id ? () => void remove() : undefined}
          />
        ) : plan ? (
          <>
            <div className="plan-modal-meta">
              {plan.exam_date ? <span className="plan-countdown">{examCountdown(plan.exam_date)}</span> : null}
              <span className="muted small">{done} of {total} done</span>
              <ToggleSwitch
                className="plan-pin"
                checked={plan.is_pinned}
                label="Show on dashboard"
                onClick={() => void togglePin()}
                disabled={busy}
              />
            </div>
            <div className="plan-progress" aria-hidden="true">
              <span style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
            </div>

            {total === 0 ? (
              <p className="plan-empty">Nothing on this plan yet. Edit it to add tests, modules, flashcards or tasks.</p>
            ) : (
              <ul className="plan-checklist">
                {plan.items.map((item) => (
                  <PlanRow key={item.id} item={item} onToggle={() => void toggle(item)} />
                ))}
              </ul>
            )}

            <footer className="button-row plan-modal-foot">
              <Button variant="secondary" onClick={() => setView("new")} icon={<PlusIcon size={15} />}>
                New plan
              </Button>
              <span className="plan-foot-spacer" />
              <Button
                variant="primary"
                onClick={() => {
                  setDraft(toDraft(plan));
                  setView("edit");
                }}
               icon={<PencilIcon size={15} />}>
                Edit plan
              </Button>
            </footer>
          </>
        ) : null}
      </div>
    </div>
  );
}

function PlanRow({ item, onToggle }: { item: StudyPlanItem; onToggle: () => void }) {
  const today = todayString();
  const overdue = !item.done && item.due_date && item.due_date < today;
  return (
    <li className={`plan-row${item.done ? " is-done" : ""}`}>
      <label className="plan-row-main">
        <input type="checkbox" className="checkbox-input plan-check" checked={item.done} onChange={onToggle} />
        <span className="plan-row-label">{item.label}</span>
      </label>
      <span className="plan-row-meta">
        {item.kind !== "free_text" ? <span className="pill plan-pill">{KIND_LABEL[item.kind]}</span> : null}
        {item.progress ? <span className="pill plan-pill">{item.progress}</span> : null}
        {item.done && item.done_source === "auto" ? (
          <span className="plan-stamp">
            <CheckIcon size={12} />
            Done in Nosey
          </span>
        ) : null}
        {!item.done && item.due_date ? (
          <span className={`plan-due${overdue ? " is-overdue" : ""}`}>
            {overdue ? "Overdue" : item.due_date === today ? "Due today" : `Due ${item.due_date.slice(5).replace("-", "/")}`}
          </span>
        ) : null}
      </span>
    </li>
  );
}

function NewPlan({
  busy,
  setBusy,
  onBlank,
  onDraft,
  onCancel,
}: {
  busy: boolean;
  setBusy: (b: boolean) => void;
  onBlank: () => void;
  onDraft: (d: { title: string; exam_date?: string | null; items: StudyPlanItemInput[] }) => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      onDraft(await generateStudyPlanDraft(text));
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
      <label className="field-label" htmlFor="plan-dump">What do you need to get done?</label>
      <textarea
        id="plan-dump"
        className="input plan-dump"
        rows={6}
        value={text}
        maxLength={6000}
        onChange={(e) => setText(e.target.value)}
        placeholder="Bio midterm next Friday. Retake practice test 2, finish the photosynthesis module, review 30 cell bio flashcards, reread chapter 4."
      />
      {error ? (
        <p className="plan-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="button-row plan-modal-foot">
        <Button variant="ghost" onClick={onBlank}>
          Start blank instead
        </Button>
        <span className="plan-foot-spacer" />
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button variant="primary" disabled={!text.trim()} onClick={() => void generate()} icon={<SparklesIcon size={15} />}>
          Make my plan
        </Button>
      </div>
    </div>
  );
}

function PlanEditor({
  draft,
  busy,
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: Draft;
  busy: boolean;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [kind, setKind] = useState<StudyPlanItemKind>("free_text");
  const [label, setLabel] = useState("");
  const [targetId, setTargetId] = useState("");
  const [count, setCount] = useState("");
  const [due, setDue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    fetchStudyPlansCatalog().then(setCatalog).catch(() => setCatalog(null));
  }, []);

  const catalogKey = CATALOG_KEY[kind];
  const options = (catalogKey && catalog ? catalog[catalogKey] : []).map((it) => ({
    value: String(it.id),
    label: it.title,
  }));
  const items = draft.items;
  const setItems = (next: StudyPlanItemInput[]) => onChange({ ...draft, items: next });
  const noun = KIND_LABEL[kind].toLowerCase();
  const canAdd = kind === "free_text" ? Boolean(label.trim()) : Boolean(targetId);

  function move(i: number, by: number) {
    const next = [...items];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setItems(next);
  }

  function add() {
    if (!canAdd) return;
    const linked = kind !== "free_text";
    const name = linked ? options.find((o) => o.value === targetId)?.label ?? "" : label.trim();
    setItems([
      ...items,
      {
        kind,
        label: name,
        target_id: linked ? Number(targetId) : null,
        target_count: kind === "flashcards" && count ? Number(count) : null,
        due_date: due || null,
      },
    ]);
    setLabel("");
    setTargetId("");
    setCount("");
    setDue("");
  }

  return (
    <div className="plan-editor">
      <div className="plan-editor-meta">
        <label className="field">
          <span className="field-label">Plan name</span>
          <input
            className="input"
            value={draft.title}
            maxLength={120}
            placeholder="Bio midterm"
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
          />
        </label>
        <label className="field">
          <span className="field-label">Exam date</span>
          <DatePicker
            label="Exam date"
            value={draft.exam_date}
            onChange={(v) => onChange({ ...draft, exam_date: v })}
            min={todayString()}
            placeholder="Pick a date"
          />
        </label>
      </div>

      <section className="plan-editor-section" aria-labelledby="plan-items-heading">
        <h3 id="plan-items-heading" className="plan-section-title">
          Checklist <span className="muted">{items.length}</span>
        </h3>
        {items.length ? (
          <ol className="plan-edit-list">
            {items.map((it, i) => (
              <li key={it.id ?? `new-${i}`} className="plan-edit-row">
                <span className="plan-edit-index">{i + 1}</span>
                <span className="plan-edit-body">
                  <span className="plan-row-label">{it.label}</span>
                  <span className="plan-row-meta">
                    <span className="pill plan-pill">{KIND_LABEL[it.kind]}</span>
                    {it.target_count ? <span className="pill plan-pill">{it.target_count} cards</span> : null}
                    {it.due_date ? <span className="plan-due">Due {it.due_date.slice(5).replace("-", "/")}</span> : null}
                  </span>
                </span>
                <span className="plan-row-tools">
                  <button type="button" className="plan-icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    <ChevronUpIcon size={18} />
                  </button>
                  <button
                    type="button"
                    className="plan-icon-btn"
                    disabled={i === items.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="Move down"
                  >
                    <ChevronDownIcon size={18} />
                  </button>
                  <button
                    type="button"
                    className="plan-icon-btn plan-icon-btn--danger"
                    onClick={() => setItems(items.filter((_, j) => j !== i))}
                    aria-label={`Remove ${it.label}`}
                  >
                    <TrashIcon size={18} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="plan-empty">Nothing on the checklist yet. Add the first item below.</p>
        )}
      </section>

      <section className="plan-add" aria-labelledby="plan-add-heading">
        <h3 id="plan-add-heading" className="plan-section-title">Add an item</h3>
        <div className="plan-add-grid">
          <Dropdown
            label="Type"
            value={kind}
            options={KIND_OPTIONS}
            onChange={(k) => {
              setKind(k);
              setTargetId("");
            }}
          />
          {kind === "free_text" ? (
            <label className="field plan-add-main">
              <span className="field-label">Task</span>
              <input
                className="input"
                value={label}
                placeholder="Reread chapter 4"
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
              />
            </label>
          ) : (
            <div className="plan-add-main">
              <Dropdown
                label={KIND_LABEL[kind]}
                value={targetId}
                placeholder={options.length ? `Pick a ${noun}` : `No ${noun}s yet`}
                options={options}
                disabled={!options.length}
                onChange={setTargetId}
              />
            </div>
          )}
          {kind === "flashcards" ? (
            <label className="field">
              <span className="field-label">Cards</span>
              <input
                className="input"
                type="number"
                min={1}
                value={count}
                placeholder="30"
                onChange={(e) => setCount(e.target.value)}
              />
            </label>
          ) : null}
          <label className="field">
            <span className="field-label">Due (optional)</span>
            <DatePicker
              label="Due date"
              value={due}
              onChange={setDue}
              placeholder="Pick a date"
            />
          </label>
        </div>
        <div className="plan-add-actions">
          <Button variant="secondary" onClick={add} disabled={!canAdd} icon={<PlusIcon size={16} />}>
            Add to checklist
          </Button>
        </div>
      </section>

      <div className="button-row plan-modal-foot">
        {onDelete ? (
          <Button variant="danger-outline" onClick={() => setConfirmDelete(true)} disabled={busy}>
            Delete plan
          </Button>
        ) : null}
        <span className="plan-foot-spacer" />
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onSave} disabled={busy || !draft.title.trim()}>
          {busy ? "Saving..." : "Save plan"}
        </Button>
      </div>

      {confirmDelete && onDelete ? (
        <ConfirmModal
          title="Delete this plan?"
          message={`"${draft.title || "This plan"}" and its checklist will be removed. This can't be undone.`}
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
