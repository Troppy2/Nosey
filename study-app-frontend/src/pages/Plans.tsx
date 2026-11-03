import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import {
  BookIcon,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronUpIcon,
  CloseIcon,
  PencilIcon,
  PlusIcon,
  RetryIcon,
  SparklesIcon,
  TrashIcon,
} from "../icons";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { ConfirmModal } from "../components/ConfirmModal";
import { Dropdown, type DropdownOption } from "../components/Dropdown";
import { EmptyState } from "../components/EmptyState";
import KojoMascot from "../components/KojoMascot";
import { Skeleton, SkeletonList } from "../components/Skeletons";
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
import type {
  CatalogItem,
  CatalogResponse,
  StudyPlanDetail,
  StudyPlanItem,
  StudyPlanItemInput,
  StudyPlanItemKind,
  StudyPlanSummary,
} from "../lib/types";
import { useSettings } from "../lib/useSettings";
import "../styles/components/plans.css";

const KIND_OPTIONS: DropdownOption<StudyPlanItemKind>[] = [
  { value: "free_text", label: "Custom task" },
  { value: "test", label: "Practice test" },
  { value: "flashcards", label: "Flashcards" },
  { value: "module", label: "Learning module" },
  { value: "leetcode", label: "Coding problem" },
  { value: "system_design", label: "System design" },
  { value: "mock_interview", label: "Mock interview" },
];

function getTodayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getCatalogKey(kind: StudyPlanItemKind): keyof CatalogResponse | null {
  switch (kind) {
    case "test":
      return "tests";
    case "module":
      return "modules";
    case "flashcards":
      return "flashcards";
    case "leetcode":
      return "leetcode";
    case "system_design":
      return "system_design";
    case "mock_interview":
      return "mock_interview";
    default:
      return null;
  }
}

function getLinkedItemPath(kind: string, targetId?: number | null): string | null {
  if (!targetId && kind !== "leetcode" && kind !== "system_design" && kind !== "mock_interview") {
    return null;
  }
  switch (kind) {
    case "test":
      return `/test/${targetId}`;
    case "flashcards":
      return `/flashcards/${targetId}`;
    case "module":
      return "/flashcards";
    case "leetcode":
      return "/leetcode";
    case "system_design":
      return "/system-design";
    case "mock_interview":
      return "/mock-interview";
    default:
      return null;
  }
}

function getKindBadgeLabel(kind: string): string {
  switch (kind) {
    case "test":
      return "Test";
    case "flashcards":
      return "Cards";
    case "module":
      return "Module";
    case "leetcode":
      return "Code";
    case "system_design":
      return "System Design";
    case "mock_interview":
      return "Mock Interview";
    default:
      return "Task";
  }
}

export default function Plans() {
  const { betaMode } = useSettings();

  const [plans, setPlans] = useState<StudyPlanSummary[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<number | null>(null);

  const [selectedPlan, setSelectedPlan] = useState<StudyPlanDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);

  // Edit / Create state
  const [isEditing, setIsEditing] = useState(false);
  const [isNewPlan, setIsNewPlan] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editExamDate, setEditExamDate] = useState("");
  const [editItems, setEditItems] = useState<StudyPlanItemInput[]>([]);
  const [savingPlan, setSavingPlan] = useState(false);

  // New item draft inputs
  const [newItemKind, setNewItemKind] = useState<StudyPlanItemKind>("free_text");
  const [newItemLabel, setNewItemLabel] = useState("");
  const [newItemTargetId, setNewItemTargetId] = useState<number | null>(null);
  const [newItemTargetCount, setNewItemTargetCount] = useState<number | null>(null);
  const [newItemDueDate, setNewItemDueDate] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");

  // Modal states
  const [showNewModal, setShowNewModal] = useState(false);
  const [kojoDumpOpen, setKojoDumpOpen] = useState(false);
  const [brainDumpText, setBrainDumpText] = useState("");
  const [kojoLoading, setKojoLoading] = useState(false);
  const [kojoError, setKojoError] = useState<string | null>(null);

  const [deletingPlan, setDeletingPlan] = useState<StudyPlanSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Load plans list
  useEffect(() => {
    if (!betaMode) return;
    let cancelled = false;
    fetchStudyPlans()
      .then((data) => {
        if (cancelled) return;
        setPlans(data);
        setLoadingList(false);
        if (data.length > 0 && selectedPlanId === null) {
          const pinned = data.find((p) => p.is_pinned);
          setSelectedPlanId(pinned ? pinned.id : data[0].id);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingList(false);
          toast.error("Failed to load study plans");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [betaMode]);

  // Load selected plan details
  useEffect(() => {
    if (!selectedPlanId) {
      setSelectedPlan(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    fetchStudyPlan(selectedPlanId)
      .then((data) => {
        if (cancelled) return;
        setSelectedPlan(data);
        setLoadingDetail(false);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingDetail(false);
          toast.error("Failed to load study plan details");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPlanId]);

  // Load catalog lazily
  function ensureCatalog() {
    if (!catalog) {
      fetchStudyPlansCatalog()
        .then(setCatalog)
        .catch(() => toast.error("Failed to load items catalog"));
    }
  }

  if (!betaMode) {
    return <Navigate to="/dashboard" replace />;
  }

  // Pin toggle
  async function handleTogglePin(plan: StudyPlanDetail) {
    const nextPinned = !plan.is_pinned;
    try {
      const updated = await updateStudyPlan(plan.id, { is_pinned: nextPinned });
      setSelectedPlan(updated);
      setPlans((prev) =>
        prev.map((p) => ({
          ...p,
          is_pinned: p.id === plan.id ? nextPinned : false,
        }))
      );
      toast.success(nextPinned ? "Plan pinned to dashboard" : "Plan unpinned");
    } catch {
      toast.error("Failed to update pin state");
    }
  }

  // Toggle item checkbox
  async function handleToggleItem(item: StudyPlanItem) {
    if (!selectedPlan) return;
    const nextDone = !item.done;

    // Optimistic
    setSelectedPlan((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((it) =>
          it.id === item.id
            ? { ...it, done: nextDone, done_source: nextDone ? "manual" : null }
            : it
        ),
      };
    });

    try {
      const updated = await toggleStudyPlanItem(item.id, nextDone);
      setSelectedPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((it) => (it.id === item.id ? updated : it)),
        };
      });
      setPlans((prev) =>
        prev.map((p) => {
          if (p.id !== selectedPlan.id) return p;
          return {
            ...p,
            done_items: p.done_items + (nextDone ? 1 : -1),
          };
        })
      );
    } catch {
      // Rollback
      setSelectedPlan((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((it) => (it.id === item.id ? item : it)),
        };
      });
      toast.error("Failed to update item status");
    }
  }

  // Start edit mode
  function handleStartEdit() {
    if (!selectedPlan) return;
    ensureCatalog();
    setEditTitle(selectedPlan.title);
    setEditExamDate(selectedPlan.exam_date ?? "");
    setEditItems([...selectedPlan.items]);
    setIsNewPlan(false);
    setIsEditing(true);
  }

  // Start blank plan
  function handleStartBlank() {
    ensureCatalog();
    setShowNewModal(false);
    setEditTitle("New Study Plan");
    setEditExamDate("");
    setEditItems([]);
    setIsNewPlan(true);
    setIsEditing(true);
    setSelectedPlan(null);
    setSelectedPlanId(null);
  }

  // Plan with Kojo
  async function handleGenerateKojoPlan() {
    if (!brainDumpText.trim()) return;
    setKojoLoading(true);
    setKojoError(null);
    try {
      const draft = await generateStudyPlanDraft(brainDumpText);
      ensureCatalog();
      setKojoDumpOpen(false);
      setShowNewModal(false);
      setEditTitle(draft.title);
      setEditExamDate(draft.exam_date ?? "");
      setEditItems(
        draft.items.map((it, idx) => ({
          ...it,
          done: false,
        }))
      );
      setIsNewPlan(true);
      setIsEditing(true);
      setSelectedPlan(null);
      setSelectedPlanId(null);
      toast.success("Draft created! Review and save your plan.");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to generate plan";
      setKojoError(msg);
    } finally {
      setKojoLoading(false);
    }
  }

  // Save changes / create plan
  async function handleSavePlan() {
    if (!editTitle.trim()) {
      toast.error("Plan title is required");
      return;
    }
    setSavingPlan(true);
    try {
      if (isNewPlan) {
        const created = await createStudyPlan({
          title: editTitle.trim(),
          exam_date: editExamDate || null,
          items: editItems,
        });
        toast.success("Study plan created");
        const list = await fetchStudyPlans();
        setPlans(list);
        setSelectedPlanId(created.id);
        setSelectedPlan(created);
        setIsEditing(false);
        setIsNewPlan(false);
      } else if (selectedPlan) {
        await updateStudyPlan(selectedPlan.id, {
          title: editTitle.trim(),
          exam_date: editExamDate || null,
        });
        const updated = await replaceStudyPlanItems(selectedPlan.id, editItems);
        toast.success("Study plan saved");
        const list = await fetchStudyPlans();
        setPlans(list);
        setSelectedPlan(updated);
        setIsEditing(false);
      }
    } catch {
      toast.error("Failed to save plan");
    } finally {
      setSavingPlan(false);
    }
  }

  // Delete plan
  async function handleDeletePlanConfirm() {
    if (!deletingPlan) return;
    setDeleteBusy(true);
    try {
      await deleteStudyPlan(deletingPlan.id);
      toast.success("Study plan deleted");
      const list = await fetchStudyPlans();
      setPlans(list);
      if (selectedPlanId === deletingPlan.id) {
        const nextId = list.length > 0 ? list[0].id : null;
        setSelectedPlanId(nextId);
      }
      setDeletingPlan(null);
    } catch {
      toast.error("Failed to delete study plan");
    } finally {
      setDeleteBusy(false);
    }
  }

  // Catalog items for the kind chosen in the add-item form. A plain derived
  // value: a hook here would run after the non-beta early return.
  const catalogKey = newItemKind === "free_text" ? null : getCatalogKey(newItemKind);
  const query = catalogSearch.trim().toLowerCase();
  const catalogForKind: CatalogItem[] = (catalog && catalogKey ? catalog[catalogKey] ?? [] : []).filter(
    (it: CatalogItem) => !query || it.title.toLowerCase().includes(query),
  );

  // Add item in edit mode
  function handleAddItem() {
    if (!newItemLabel.trim()) {
      toast.error("Item label is required");
      return;
    }
    const item: StudyPlanItemInput = {
      kind: newItemKind,
      label: newItemLabel.trim(),
      target_id: newItemTargetId,
      target_count: newItemKind === "flashcards" ? newItemTargetCount : null,
      due_date: newItemDueDate || null,
      done: false,
    };
    setEditItems((prev) => [...prev, item]);
    setNewItemLabel("");
    setNewItemTargetId(null);
    setNewItemTargetCount(null);
    setNewItemDueDate("");
    setCatalogSearch("");
  }

  function handleMoveItem(index: number, direction: "up" | "down") {
    const next = [...editItems];
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= next.length) return;
    const temp = next[index];
    next[index] = next[targetIdx];
    next[targetIdx] = temp;
    setEditItems(next);
  }

  function handleRemoveItem(index: number) {
    setEditItems((prev) => prev.filter((_, i) => i !== index));
  }

  const today = getTodayString();
  const doneCount = selectedPlan?.items.filter((it) => it.done).length ?? 0;
  const totalCount = selectedPlan?.items.length ?? 0;
  const progressPercent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div className="plans-page">
      <div className="plans-header">
        <div className="plans-header-title">
          <h1>Study Plans</h1>
          <span className="pill dark-pill">Beta</span>
        </div>
        <div className="plans-header-actions">
          <Button
            variant="primary"
            onClick={() => setShowNewModal(true)}
          >
            <PlusIcon size={16} />
            <span>New plan</span>
          </Button>
        </div>
      </div>

      <div className="plans-layout">
        {/* Master list */}
        <aside className={`plans-sidebar ${selectedPlanId && !isNewPlan ? "hide-mobile" : ""}`}>
          {loadingList ? (
            <SkeletonList rows={4} />
          ) : plans.length === 0 && !isNewPlan ? (
            <EmptyState
              icon={<BookIcon />}
              title="No study plans yet"
              body="Create a study plan to organize your exam prep and track your progress."
              action={
                <Button variant="secondary" onClick={() => setShowNewModal(true)}>
                  Create Plan
                </Button>
              }
            />
          ) : (
            <ul className="plans-list">
              {plans.map((p) => {
                const isSelected = p.id === selectedPlanId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={`plans-list-item ${isSelected ? "selected" : ""}`}
                      onClick={() => {
                        setSelectedPlanId(p.id);
                        setIsEditing(false);
                        setIsNewPlan(false);
                      }}
                    >
                      <div className="plans-list-item-header">
                        <h3 className="plans-list-item-title">{p.title}</h3>
                        {p.is_pinned && <span className="plans-pin-badge">Pinned</span>}
                      </div>
                      <div className="plans-list-item-meta">
                        <span>
                          {p.done_items}/{p.total_items} done
                        </span>
                        {p.exam_date && (
                          <span>
                            Exam {p.exam_date}
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* Detail view / Edit view */}
        <main className={`plans-detail-pane ${!selectedPlanId && !isNewPlan ? "hide-mobile" : ""}`}>
          {/* Mobile Back Button */}
          <button
            type="button"
            className="plans-mobile-back-btn"
            onClick={() => {
              setSelectedPlanId(null);
              setIsEditing(false);
              setIsNewPlan(false);
            }}
          >
            <ChevronLeftIcon size={18} />
            <span>All plans</span>
          </button>

          {isEditing ? (
            /* Edit Mode */
            <div className="plans-editor">
              <div className="plans-detail-header">
                <h2>{isNewPlan ? "Create Study Plan" : "Edit Study Plan"}</h2>
                <div className="plans-detail-actions">
                  <Button
                    variant="secondary"
                    disabled={savingPlan}
                    onClick={() => {
                      setIsEditing(false);
                      if (isNewPlan) {
                        setIsNewPlan(false);
                        if (plans.length > 0) setSelectedPlanId(plans[0].id);
                      }
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    disabled={savingPlan}
                    onClick={handleSavePlan}
                  >
                    {savingPlan ? "Saving..." : isNewPlan ? "Save plan" : "Save changes"}
                  </Button>
                </div>
              </div>

              <div className="plans-meta-grid">
                <div className="field">
                  <label className="field-label">Plan Title</label>
                  <input
                    type="text"
                    className="input"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    placeholder="e.g. Biology Midterm"
                    maxLength={120}
                  />
                </div>
                <div className="field">
                  <label className="field-label">Exam Date (optional)</label>
                  <input
                    type="date"
                    className="input"
                    value={editExamDate}
                    onChange={(e) => setEditExamDate(e.target.value)}
                  />
                </div>
              </div>

              {/* Items in Editor */}
              <div className="plans-stack">
                <label className="field-label">Checklist Items ({editItems.length})</label>
                {editItems.length === 0 ? (
                  <p className="muted small">No items added yet. Use the form below to add tasks.</p>
                ) : (
                  editItems.map((item, idx) => (
                    <div key={idx} className="plans-edit-row">
                      <div className="plans-reorder-btns">
                        <button
                          type="button"
                          className="plans-icon-btn"
                          disabled={idx === 0}
                          onClick={() => handleMoveItem(idx, "up")}
                          aria-label="Move item up"
                        >
                          <ChevronUpIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className="plans-icon-btn"
                          disabled={idx === editItems.length - 1}
                          onClick={() => handleMoveItem(idx, "down")}
                          aria-label="Move item down"
                        >
                          <ChevronDownIcon size={14} />
                        </button>
                      </div>

                      <span className="pill dark-pill plans-kind-pill">
                        {getKindBadgeLabel(item.kind)}
                      </span>

                      <span className="plans-edit-label">
                        {item.label}
                      </span>

                      {item.target_count && (
                        <span className="muted small">{item.target_count} cards</span>
                      )}

                      {item.due_date && (
                        <span className="muted small">Due {item.due_date}</span>
                      )}

                      <button
                        type="button"
                        className="plans-icon-btn"
                        onClick={() => handleRemoveItem(idx)}
                        aria-label="Remove item"
                      >
                        <TrashIcon size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              {/* Add item section */}
              <div className="plans-add-item-card">
                <h4 className="plans-add-title">Add an item</h4>
                <div className="plans-add-grid">
                  <Dropdown
                    label="Item kind"
                    value={newItemKind}
                    options={KIND_OPTIONS}
                    onChange={(val) => {
                      setNewItemKind(val);
                      setNewItemTargetId(null);
                      setCatalogSearch("");
                    }}
                  />

                  {newItemKind === "free_text" ? (
                    <div className="field">
                      <label className="field-label">Label</label>
                      <input
                        type="text"
                        className="input"
                        value={newItemLabel}
                        onChange={(e) => setNewItemLabel(e.target.value)}
                        placeholder="e.g. Read chapter 4 notes"
                      />
                    </div>
                  ) : (
                    <div className="plans-stack">
                      <Dropdown
                        label={`Select ${getKindBadgeLabel(newItemKind)}`}
                        value={newItemTargetId ? String(newItemTargetId) : ""}
                        placeholder="Choose from your library"
                        options={catalogForKind.map((it) => ({
                          value: String(it.id),
                          label: it.title,
                        }))}
                        onChange={(val) => {
                          const idNum = Number(val);
                          setNewItemTargetId(idNum);
                          const found = catalogForKind.find((it) => it.id === idNum);
                          if (found) {
                            setNewItemLabel(found.title);
                          }
                        }}
                      />
                      {newItemKind === "flashcards" && (
                        <div className="field">
                          <label className="field-label">Review Target (cards to review)</label>
                          <input
                            type="number"
                            className="input"
                            min={1}
                            placeholder="e.g. 25"
                            value={newItemTargetCount ?? ""}
                            onChange={(e) =>
                              setNewItemTargetCount(e.target.value ? Number(e.target.value) : null)
                            }
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="plans-add-footer">
                  <div className="field plans-due-field">
                    <label className="field-label">Due Date (optional)</label>
                    <input
                      type="date"
                      className="input"
                      value={newItemDueDate}
                      onChange={(e) => setNewItemDueDate(e.target.value)}
                    />
                  </div>
                  <Button variant="secondary" onClick={handleAddItem}>
                    <PlusIcon size={15} />
                    <span>Add to plan</span>
                  </Button>
                </div>
              </div>
            </div>
          ) : loadingDetail ? (
            <div className="plans-stack plans-stack--loose">
              <Skeleton width="50%" height="2rem" />
              <Skeleton width="100%" height="3rem" />
              <SkeletonList rows={5} />
            </div>
          ) : !selectedPlan ? (
            <EmptyState
              icon={<BookIcon />}
              title="Select a study plan"
              body="Choose a plan from the list or create a new one to get started."
            />
          ) : (
            /* View Mode */
            <>
              <div className="plans-detail-header">
                <div className="plans-detail-title-group">
                  <h2 className="plans-detail-title">{selectedPlan.title}</h2>
                  {selectedPlan.exam_date && (
                    <span className="plans-detail-exam">
                      Exam Date: {selectedPlan.exam_date}
                    </span>
                  )}
                </div>
                <div className="plans-detail-actions">
                  <Button
                    variant={selectedPlan.is_pinned ? "primary" : "secondary"}
                    onClick={() => handleTogglePin(selectedPlan)}
                  >
                    {selectedPlan.is_pinned ? "Pinned to Dashboard" : "Pin to Dashboard"}
                  </Button>
                  <Button variant="secondary" onClick={handleStartEdit}>
                    <PencilIcon size={15} />
                    <span>Edit</span>
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const summary = plans.find((p) => p.id === selectedPlan.id);
                      if (summary) setDeletingPlan(summary);
                    }}
                    aria-label="Delete plan"
                  >
                    <TrashIcon size={15} />
                  </Button>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="plans-progress-card">
                <div className="plans-progress-header">
                  <span>Progress</span>
                  <span>
                    {doneCount} of {totalCount} completed ({progressPercent}%)
                  </span>
                </div>
                <div className="plans-progress-track">
                  <div
                    className="plans-progress-fill"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              {/* Items List */}
              <ul className="plans-items-list">
                {selectedPlan.items.length === 0 ? (
                  <p className="muted small">
                    No items in this plan yet. Click &quot;Edit&quot; to add checklist items.
                  </p>
                ) : (
                  selectedPlan.items.map((item) => {
                    const isOverdue = Boolean(item.due_date && item.due_date < today && !item.done);
                    const isDueToday = Boolean(item.due_date && item.due_date === today && !item.done);
                    const linkedPath = getLinkedItemPath(item.kind, item.target_id);

                    return (
                      <li
                        key={item.id}
                        className={`plans-item-row ${item.done ? "done" : ""}`}
                      >
                        <div className="plans-item-main">
                          <input
                            type="checkbox"
                            className="study-plan-checkbox"
                            checked={item.done}
                            onChange={() => handleToggleItem(item)}
                            aria-label={`Mark "${item.label}" as ${item.done ? "not done" : "done"}`}
                          />
                          <span className="plans-item-label">{item.label}</span>
                        </div>

                        <div className="plans-item-extras">
                          {item.done_source === "auto" && (
                            <span className="study-plan-auto-badge" title="Auto-completed by Nosey">
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

                          {item.due_date && !isOverdue && !isDueToday && (
                            <span className="muted small">Due {item.due_date}</span>
                          )}

                          {linkedPath && (
                            <Link to={linkedPath} className="plans-chip">
                              Open {getKindBadgeLabel(item.kind)}
                            </Link>
                          )}
                        </div>
                      </li>
                    );
                  })
                )}
              </ul>
            </>
          )}
        </main>
      </div>

      {/* New Plan Selection Modal */}
      {showNewModal && !kojoDumpOpen && (
        <div className="modal-backdrop" onMouseDown={() => setShowNewModal(false)}>
          <div
            className="modal-card plans-kojo-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2>Create a Study Plan</h2>
            <p className="muted small">
              Choose how you want to build your study checklist.
            </p>

            <div className="plans-modal-paths">
              <button
                type="button"
                className="plans-path-card"
                onClick={handleStartBlank}
              >
                <BookIcon size={32} />
                <h3>Start Blank</h3>
                <p>Build your checklist step-by-step from scratch or your library.</p>
              </button>

              <button
                type="button"
                className="plans-path-card"
                onClick={() => setKojoDumpOpen(true)}
              >
                <SparklesIcon size={32} />
                <h3>Plan with Kojo</h3>
                <p>Dump your syllabus, test dates and notes, and let Kojo build a draft plan.</p>
              </button>
            </div>

            <div className="button-row">
              <Button variant="secondary" onClick={() => setShowNewModal(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Plan with Kojo Modal */}
      {kojoDumpOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={() => !kojoLoading && setKojoDumpOpen(false)}
        >
          <div
            className="modal-card plans-kojo-modal"
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="plans-kojo-head">
              <SparklesIcon size={22} />
              <h2>Plan with Kojo</h2>
            </div>
            <p className="muted small">
              Dump everything you need to study. Mention topics, deadlines, test names, or paste your syllabus.
            </p>

            {kojoLoading ? (
              <div className="plans-kojo-loading">
                <KojoMascot state="loading" size={48} />
                <p>
                  Kojo is structuring your plan...
                </p>
              </div>
            ) : (
              <div className="plans-modal-body">
                <textarea
                  className="input"
                  rows={8}
                  value={brainDumpText}
                  onChange={(e) => setBrainDumpText(e.target.value.slice(0, 6000))}
                  placeholder="E.g. I have a Biology midterm next Friday. I want to take Test 1 and Test 2, review 30 flashcards in Cell Biology, and finish the Photosynthesis module before Tuesday."
                />
                <div className="plans-kojo-count">
                  <span>Be as detailed or messy as you like</span>
                  <span>{brainDumpText.length} / 6000</span>
                </div>

                {kojoError && (
                  <div className="plans-kojo-error" role="alert">
                    <span>{kojoError}</span>
                    <Button variant="secondary" onClick={handleGenerateKojoPlan}>
                      <RetryIcon size={14} />
                      <span>Retry</span>
                    </Button>
                  </div>
                )}

                <div className="button-row">
                  <Button
                    variant="secondary"
                    disabled={kojoLoading}
                    onClick={() => setKojoDumpOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    disabled={kojoLoading || !brainDumpText.trim()}
                    onClick={handleGenerateKojoPlan}
                  >
                    <SparklesIcon size={16} />
                    <span>Make my plan</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deletingPlan && (
        <ConfirmModal
          title="Delete Study Plan"
          message={`Are you sure you want to delete "${deletingPlan.title}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          busyLabel="Deleting"
          onConfirm={handleDeletePlanConfirm}
          onCancel={() => setDeletingPlan(null)}
        />
      )}
    </div>
  );
}
