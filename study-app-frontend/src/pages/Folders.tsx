import { FileUp, Grid3X3, List } from "lucide-react";
import { FolderIcon } from "../icons";
import { CheckIcon, MenuIcon, PencilIcon, PlusIcon, TrashIcon } from "../icons";
import { FormEvent, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { FormError } from "../components/FormError";
import { Card } from "../components/Card";
import { ConfirmModal } from "../components/ConfirmModal";
import { Dropdown } from "../components/Dropdown";
import { EmptyState } from "../components/EmptyState";
import { TextInput } from "../components/Field";
import { SkeletonFolderGrid } from "../components/Skeletons";
import { PullToRefreshIndicator } from "../components/PullToRefreshIndicator";
import { QuizletImportModal, type QuizletImportResult } from "../components/QuizletImportModal";
import { bulkFolderAction, createFolder, deleteFolder, fetchFolders, hasSeenTour, reorderFolders, scopeKey, updateFolder } from "../lib/api";
import { toast } from "../lib/toast";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { usePageTour } from "../components/tours/usePageTour";
import type { Folder } from "../lib/types";
import { EASE_SETTLE, prefersReducedMotion } from "../lib/motion";
import "../styles/pages/folders.css";

type PointerSample = { pointerId: number; clientX: number; clientY: number };

/** `list` with `id` moved into `targetId`'s slot; the same list when nothing moves. */
function moveItem(list: Folder[], id: number, targetId: number): Folder[] {
  const from = list.findIndex((folder) => folder.id === id);
  const to = list.findIndex((folder) => folder.id === targetId);
  if (from < 0 || to < 0 || from === to) return list;
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export default function Folders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [view, setView] = useState<"grid" | "list">(
    () => (localStorage.getItem(scopeKey("nosey_folder_view")) as "grid" | "list") ?? "grid"
  );
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [folderAction, setFolderAction] = useState<{
    type: "rename" | "delete";
    folder: Folder;
    draftName: string;
  } | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"normal" | "select" | "reorder">("normal");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkAction, setBulkAction] = useState<"archive" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const savedFolders = useRef<Folder[]>([]);
  const drag = useRef<{
    id: number; card: HTMLElement; pointerId: number; moved: boolean; overId: number | null;
    startX: number; startY: number; px: number; py: number; grabX: number; grabY: number;
    detach: () => void;
  } | null>(null);
  const cardRects = useRef(new Map<number, DOMRect>());
  const listRef = useRef<HTMLElement>(null);
  const editing = useRef(false);
  const refreshVersion = useRef(0);
  // Open import modal; newFolderName is set when it came from Create Folder.
  const [quizletImport, setQuizletImport] = useState<{ newFolderName?: string } | null>(null);
  const navigate = useNavigate();

  async function refreshFolders() {
    if (editing.current) return;
    const version = ++refreshVersion.current;
    try {
      const data = await fetchFolders({ throwOnError: true });
      if (!editing.current && version === refreshVersion.current) {
        setFolders(data);
        setError(null);
      }
    } catch (err) {
      if (version === refreshVersion.current) setError(err instanceof Error ? err.message : "Unable to load your folders.");
    }
  }

  useEffect(() => {
    refreshFolders().finally(() => setIsLoading(false));
  }, []);

  const { pullPx, isRefreshing } = usePullToRefresh(refreshFolders);
  usePageTour("folders", !isLoading);
  // Read once at mount: the Folders tour marks itself seen as it opens, so a
  // live check would start this one right after (over the Create Folder modal
  // its last step opens). Brand-new users get it on a later visit instead.
  const [foldersTourSeenAtMount] = useState(() => hasSeenTour("folders"));
  usePageTour("quizlet-import", !isLoading && foldersTourSeenAtMount);

  const selectedFolders = folders.filter((folder) => selectedIds.has(folder.id));
  const allSelected = folders.length > 0 && selectedFolders.length === folders.length;
  const orderChanged = mode === "reorder"
    && folders.some((folder, index) => folder.id !== savedFolders.current[index]?.id);

  // Escape backs out of select/reorder, unless a dialog is open on top.
  useEffect(() => {
    if (mode === "normal") return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy || bulkAction) return;
      cancelMode();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, busy, bulkAction]);

  function startMode(next: "select" | "reorder") {
    refreshVersion.current += 1;
    editing.current = true;
    savedFolders.current = folders;
    setSelectedIds(new Set());
    setError(null);
    setMode(next);
  }

  function finishMode() {
    editing.current = false;
    setMode("normal");
    setSelectedIds(new Set());
    stopDrag();
  }

  function cancelMode() {
    if (mode === "reorder") setFolders(savedFolders.current);
    setError(null);
    finishMode();
  }

  function toggleSelected(id: number) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function cardElement(id: number) {
    return listRef.current?.querySelector<HTMLElement>(`[data-folder-id="${id}"]`) ?? null;
  }

  // FLIP, step 1: remember where every card is on screen before the order
  // changes. The layout effect below slides each one from there to its new slot.
  function snapshotCardRects() {
    const rects = new Map<number, DOMRect>();
    listRef.current?.querySelectorAll<HTMLElement>("[data-folder-id]").forEach((card) => {
      rects.set(Number(card.dataset.folderId), card.getBoundingClientRect());
    });
    cardRects.current = rects;
  }

  function moveFolder(id: number, targetId: number) {
    snapshotCardRects();
    setFolders((current) => moveItem(current, id, targetId));
  }

  function announcePosition(id: number, list: Folder[]) {
    const index = list.findIndex((folder) => folder.id === id);
    if (index >= 0) setAnnouncement(`${list[index].name} moved to position ${index + 1} of ${list.length}.`);
  }

  // Keeps the grabbed card glued under the pointer, wherever its slot is now.
  function placeDraggedCard() {
    const current = drag.current;
    if (!current) return;
    const { card } = current;
    card.style.transform = "";
    const slot = card.getBoundingClientRect();
    card.style.transform = `translate(${current.px - current.grabX - slot.left}px, ${current.py - current.grabY - slot.top}px)`;
  }

  useLayoutEffect(() => {
    const before = cardRects.current;
    if (!before.size) return;
    cardRects.current = new Map();
    const reduceMotion = prefersReducedMotion();
    listRef.current?.querySelectorAll<HTMLElement>("[data-folder-id]").forEach((card) => {
      const id = Number(card.dataset.folderId);
      if (id === drag.current?.id) {
        placeDraggedCard();
        return;
      }
      const was = before.get(id);
      if (!was || reduceMotion) return;
      card.getAnimations().forEach((animation) => animation.cancel());
      const now = card.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (!dx && !dy) return;
      card.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: 220, easing: EASE_SETTLE },
      );
    });
  }, [folders]);

  // The grabbed handle sits under the pointer, so look through the whole hit
  // stack for the first card that is not the one being dragged.
  function dragTarget(x: number, y: number, draggedId: number): number | null {
    for (const element of document.elementsFromPoint(x, y)) {
      const card = element.closest<HTMLElement>("[data-folder-id]");
      if (!card || !listRef.current?.contains(card)) continue;
      const id = Number(card.dataset.folderId);
      if (id !== draggedId) return id;
    }
    return null;
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>, id: number) {
    if (busy || event.button !== 0 || !event.isPrimary) return;
    const card = cardElement(id);
    if (!card) return;
    const rect = card.getBoundingClientRect();
    // Window listeners, not pointer capture: reordering moves the card's DOM
    // node, and moving a node releases any capture held inside it.
    const onMove = (pointer: globalThis.PointerEvent) => dragListeners.current.move(pointer);
    const onEnd = (pointer: globalThis.PointerEvent) => dragListeners.current.end(pointer);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    drag.current = {
      id, card, pointerId: event.pointerId, moved: false, overId: null,
      startX: event.clientX, startY: event.clientY, px: event.clientX, py: event.clientY,
      grabX: event.clientX - rect.left, grabY: event.clientY - rect.top,
      detach: () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      },
    };
  }

  function moveDrag(event: PointerSample) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.px = event.clientX;
    current.py = event.clientY;
    if (!current.moved) {
      if (Math.hypot(current.px - current.startX, current.py - current.startY) < 5) return;
      current.moved = true;
      setDragId(current.id);
    }
    placeDraggedCard();
    // Swap only when the pointer enters a new card. Staying on the card it
    // just swapped with must not swap back while that card slides away.
    const overId = dragTarget(current.px, current.py, current.id);
    if (overId !== current.overId) {
      current.overId = overId;
      if (overId !== null) moveFolder(current.id, overId);
    }
    if (event.clientY < 70) window.scrollBy(0, -16);
    else if (event.clientY > window.innerHeight - 70) window.scrollBy(0, 16);
  }

  function stopDrag() {
    const current = drag.current;
    current?.detach();
    drag.current = null;
    setDragId(null);
    const card = current?.card;
    if (!card?.style.transform) return;
    // Settle the card into its slot instead of snapping.
    const from = card.style.transform;
    card.style.transform = "";
    if (!prefersReducedMotion()) {
      card.animate([{ transform: from }, { transform: "none" }], { duration: 180, easing: EASE_SETTLE });
    }
  }

  function endDrag(event: PointerSample) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.moved) announcePosition(current.id, folders);
    stopDrag();
  }

  // Window listeners outlive a render, so they call through this ref to reach
  // the latest handlers (and the latest folder order).
  const dragListeners = useRef({ move: moveDrag, end: endDrag });
  dragListeners.current = { move: moveDrag, end: endDrag };
  useEffect(() => () => drag.current?.detach(), []);

  async function saveOrder() {
    setBusy(true);
    setError(null);
    try {
      setFolders(await reorderFolders(folders.map((folder) => folder.id)));
      finishMode();
      toast.success("Folder order saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save the folder order. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function commitBulkAction() {
    if (!bulkAction) return;
    const action = bulkAction;
    const ids = selectedIds;
    setBusy(true);
    setError(null);
    try {
      await bulkFolderAction([...ids], action);
      setFolders((current) => current.filter((folder) => !ids.has(folder.id)));
      setBulkAction(null);
      finishMode();
      toast.success(`${ids.size} ${ids.size === 1 ? "folder" : "folders"} ${action === "archive" ? "archived" : "deleted"}`);
    } catch (err) {
      setBulkAction(null);
      setError(err instanceof Error ? err.message : "Unable to update those folders. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      const folder = await createFolder({ name: name.trim(), subject: subject.trim() || null, description: null });
      setFolders((current) => [folder, ...current]);
      setName("");
      setSubject("");
      setIsModalOpen(false);
      setError(null);
      toast.success("Folder created", folder.name);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create that folder.");
    }
  }

  function openQuizletFromCreate() {
    setIsModalOpen(false);
    setQuizletImport({ newFolderName: name.trim() });
  }

  function handleQuizletImported({ folderId, cards, createdFolder }: QuizletImportResult) {
    setQuizletImport(null);
    if (createdFolder) {
      setName("");
      setSubject("");
    }
    setFolders((current) =>
      createdFolder
        ? [{ ...createdFolder, flashcard_count: cards.length }, ...current]
        : current.map((item) =>
            item.id === folderId ? { ...item, flashcard_count: item.flashcard_count + cards.length } : item,
          ),
    );
    navigate(`/folders/${folderId}`);
  }

  async function handleRename(folder: Folder) {
    setFolderAction({ type: "rename", folder, draftName: folder.name });
  }

  async function handleDelete(folder: Folder) {
    setFolderAction({ type: "delete", folder, draftName: folder.name });
  }

  function handleRenameSubmit(event: FormEvent) {
    event.preventDefault();
    if (!folderAction) return;
    const nextName = folderAction.draftName.trim();
    if (!nextName) return;
    const folderId = folderAction.folder.id;
    const prev = folders;
    setFolders((current) => current.map((item) => (item.id === folderId ? { ...item, name: nextName } : item)));
    setFolderAction(null);
    updateFolder(folderId, {
      name: nextName,
      subject: folderAction.folder.subject ?? null,
      description: folderAction.folder.description ?? null,
    })
      .then((updated) => {
        setFolders((current) => current.map((item) => (item.id === updated.id ? updated : item)));
        toast.success("Folder renamed");
      })
      .catch((err) => {
        setFolders(prev);
        setError(err instanceof Error ? err.message : "Unable to rename that folder.");
      });
  }

  function commitFolderDelete() {
    if (!folderAction) return;
    const folder = folderAction.folder;
    const prev = folders;
    setFolders((current) => current.filter((item) => item.id !== folder.id));
    setFolderAction(null);
    deleteFolder(folder.id)
      .then(() => toast.success("Folder deleted"))
      .catch((err) => {
        setFolders(prev);
        setError(err instanceof Error ? err.message : "Unable to delete that folder.");
      });
  }

  return (
    <div className="page folders-page">
      <PullToRefreshIndicator pullPx={pullPx} isRefreshing={isRefreshing} />
      <header className="page-header">
        <div data-tour="folders-header">
          <h1>Folders</h1>
          <p className="muted">Organize tests and flashcards by subject or exam.</p>
        </div>
        <div className="toolbar">
          <div className="segmented" aria-label="View mode">
            <button className={view === "grid" ? "active" : ""} onClick={() => { setView("grid"); localStorage.setItem(scopeKey("nosey_folder_view"), "grid"); }} type="button">
              <Grid3X3 size={18} />
            </button>
            <button className={view === "list" ? "active" : ""} onClick={() => { setView("list"); localStorage.setItem(scopeKey("nosey_folder_view"), "list"); }} type="button">
              <List size={18} />
            </button>
          </div>
          <Button
            data-tour="folders-quizlet"
            variant="secondary"
            icon={<FileUp size={18} />}
            disabled={mode !== "normal" || busy}
            onClick={() => setQuizletImport({})}
          >
            Import from Quizlet
          </Button>
          <Button data-tour="folders-new" icon={<PlusIcon size={18} />} disabled={mode !== "normal" || busy} onClick={() => setIsModalOpen(true)}>
            New Folder
          </Button>
          {mode === "normal" && folders.length > 0 ? (
            <Dropdown<"" | "select" | "reorder">
              bare actionMenu label="Organize folders" value="" placeholder="Organize"
              className="button button-secondary folders-actions-trigger"
              options={[
                { value: "select", label: "Select folders" },
                ...(folders.length > 1 ? [{ value: "reorder" as const, label: "Reorder folders" }] : []),
              ]}
              onChange={(next) => { if (next) startMode(next); }}
              disabled={isLoading || busy}
            />
          ) : null}
        </div>
      </header>

      <div className="folders-error-row">
        <FormError message={error} />
        {error && !busy && mode === "normal" ? (
          <Button variant="secondary" onClick={() => void refreshFolders()}>Reload folders</Button>
        ) : null}
      </div>
      <span className="sr-only" role="status">{announcement}</span>
      {mode !== "normal" ? (
        <div className="folders-organize-bar" role="toolbar" aria-label={mode === "select" ? "Selected folders" : "Reorder folders"}>
          {mode === "select" ? (
            <button
              type="button"
              className="file-manager-select-toggle"
              data-active={selectedFolders.length > 0 ? "true" : "false"}
              aria-pressed={allSelected}
              disabled={busy}
              onClick={() => setSelectedIds(allSelected ? new Set() : new Set(folders.map((folder) => folder.id)))}
            >
              <span className={`fm-check${allSelected ? " is-checked" : selectedFolders.length ? " is-indeterminate" : ""}`} aria-hidden="true">
                {allSelected ? <CheckIcon size={11} strokeWidth={3} /> : selectedFolders.length ? <span className="folders-check-minus" /> : null}
              </span>
              {selectedFolders.length ? `${selectedFolders.length} selected` : "Select all"}
            </button>
          ) : (
            <div className="folders-organize-status">
              <strong>Reorder folders</strong>
              <span className="muted small" id="folders-reorder-help">Drag a handle, or focus it and use the arrow keys.</span>
            </div>
          )}
          <div className="button-row">
            {mode === "select" ? <>
              <Button variant="secondary" disabled={busy || selectedFolders.length === 0} onClick={() => setBulkAction("archive")}>Archive</Button>
              <Button variant="danger-outline" icon={<TrashIcon size={14} />} disabled={busy || selectedFolders.length === 0} onClick={() => setBulkAction("delete")}>Delete</Button>
              <Button variant="secondary" disabled={busy} onClick={cancelMode}>Done</Button>
            </> : <>
              <Button variant="secondary" disabled={busy} onClick={cancelMode}>Cancel</Button>
              <Button disabled={busy || !orderChanged} onClick={() => void saveOrder()}>{busy ? "Saving..." : "Save order"}</Button>
            </>}
          </div>
        </div>
      ) : null}

      {/* Without this the empty state flashes on every visit before the fetch
          lands, telling the user they have no folders when they do. */}
      {isLoading ? (
        <SkeletonFolderGrid count={4} label="Loading your folders" />
      ) : folders.length === 0 && !error ? (
        <EmptyState
          icon={<FolderIcon />}
          title="No folders yet"
          body="Create your first folder to organize tests and flashcards."
          action={
            <Button data-tour="folders-new" icon={<PlusIcon size={18} />} onClick={() => setIsModalOpen(true)}>
              New Folder
            </Button>
          }
        />
      ) : (
        <section ref={listRef} data-tour="folders-list" className={`${view === "grid" ? "folder-grid" : "folder-list"} folders-organizable${mode !== "normal" ? ` folders-organizable--${mode}` : ""}`}>
          {folders.map((folder, index) => (
            <FolderCard
              key={folder.id} folder={folder} view={view} mode={mode}
              selected={selectedIds.has(folder.id)}
              dragging={dragId === folder.id} position={index + 1}
              onToggle={() => toggleSelected(folder.id)} onRename={handleRename} onDelete={handleDelete}
              control={mode === "reorder" ? (
                <button
                  type="button" className="folders-drag-handle" disabled={busy}
                  aria-label={`Reorder ${folder.name}`} aria-describedby="folders-reorder-help"
                  onPointerDown={(event) => startDrag(event, folder.id)}
                  onKeyDown={(event) => {
                    const direction = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1
                      : event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : 0;
                    if (!direction) return;
                    event.preventDefault();
                    const target = folders[index + direction];
                    if (!target) return;
                    moveFolder(folder.id, target.id);
                    announcePosition(folder.id, moveItem(folders, folder.id, target.id));
                  }}
                ><MenuIcon size={18} /></button>
              ) : null}
            />
          ))}
        </section>
      )}


      {isModalOpen ? (
        <div className="modal-backdrop" onMouseDown={() => setIsModalOpen(false)}>
          <form className="modal-card" onMouseDown={(event) => event.stopPropagation()} onSubmit={handleSubmit}>
            <h2>Create Folder</h2>
            <TextInput label="Name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Discrete Structures" />
            <TextInput label="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Math" />
            <button className="qz-create-link" type="button" onClick={openQuizletFromCreate}>
              <FileUp size={16} />
              Have a Quizlet set? Import it into a new folder
            </button>
            <div className="button-row">
              <Button variant="secondary" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                Create
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {folderAction?.type === "rename" ? (
        <div className="modal-backdrop" onMouseDown={() => setFolderAction(null)}>
          <form className="modal-card" onMouseDown={(event) => event.stopPropagation()} onSubmit={handleRenameSubmit}>
            <h2>Rename Folder</h2>
            <TextInput
              label="Name"
              value={folderAction.draftName}
              onChange={(event) =>
                setFolderAction((current) =>
                  current ? { ...current, draftName: event.target.value } : current,
                )
              }
              placeholder="Discrete Structures"
            />
            <div className="button-row">
              <Button variant="secondary" onClick={() => setFolderAction(null)}>Cancel</Button>
              <Button type="submit" disabled={!folderAction.draftName.trim()}>Save</Button>
            </div>
          </form>
        </div>
      ) : null}

      {quizletImport ? (
        <QuizletImportModal
          newFolderName={quizletImport.newFolderName}
          onClose={() => setQuizletImport(null)}
          onImported={handleQuizletImported}
          onPartialSave={() => void refreshFolders()}
        />
      ) : null}

      {folderAction?.type === "delete" ? (
        <ConfirmModal
          title="Delete Folder"
          message={<>Delete <strong>{folderAction.folder.name}</strong>? This cannot be undone.</>}
          confirmLabel="Delete"
          danger
          onConfirm={commitFolderDelete}
          onCancel={() => setFolderAction(null)}
        />
      ) : null}
      {bulkAction ? createPortal(
        <ConfirmModal
          title={`${bulkAction === "archive" ? "Archive" : "Delete"} ${selectedFolders.length} ${selectedFolders.length === 1 ? "folder" : "folders"}?`}
          message={<>
            <span className="folders-confirm-names">{selectedFolders.map((folder) => folder.name).join(", ")}</span>
            {bulkAction === "archive"
              ? "They leave your folder list but keep everything inside. You can restore them in Settings."
              : "Their tests, flashcards, files, learning modules and folder chats are deleted too. This cannot be undone."}
          </>}
          confirmLabel={bulkAction === "archive" ? "Archive folders" : "Delete folders"}
          danger={bulkAction === "delete"} busy={busy} busyLabel={bulkAction === "archive" ? "Archiving" : "Deleting"}
          onConfirm={() => void commitBulkAction()} onCancel={() => setBulkAction(null)}
        />, document.body,
      ) : null}
    </div>
  );
}

function FolderCard({
  folder, view, mode, selected, dragging, position, onToggle, onRename, onDelete, control,
}: {
  folder: Folder;
  view: "grid" | "list";
  mode: "normal" | "select" | "reorder";
  selected: boolean;
  dragging: boolean;
  position: number;
  onToggle: () => void;
  onRename: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
  control: React.ReactNode;
}) {
  const mainClass = view === "grid" ? "folder-card-main" : "folder-list-main";
  const content = <>
    <FolderIcon size={view === "grid" ? 34 : 30} style={{ color: folder.color ?? "var(--green-dark)" }} />
    <div>
      {view === "grid" ? <h2>{folder.name}</h2> : <h3>{folder.name}</h3>}
      <p className="muted">{view === "grid" ? folder.description ?? folder.subject ?? "Study folder" : folder.subject ?? "General"}</p>
    </div>
  </>;
  const actions = mode === "normal" ? <div className="row-actions folder-card-actions">
    <button type="button" aria-label={`Rename ${folder.name}`} onClick={() => onRename(folder)}><PencilIcon size={17} /></button>
    <button type="button" aria-label={`Delete ${folder.name}`} onClick={() => onDelete(folder)}><TrashIcon size={17} /></button>
  </div> : null;
  const counts = <div className={view === "grid" ? "folder-card-footer" : "mini-meta"}>
    <span>{folder.test_count} tests</span><span>{folder.flashcard_count} cards</span>
  </div>;
  return <Card
    interactive={mode === "normal"}
    data-folder-id={folder.id}
    className={`${view === "grid" ? "folder-card" : "folder-list-row"} folders-organize-card${selected ? " folders-organize-card--selected" : ""}${dragging ? " folders-organize-card--dragging" : ""}`}
  >
    {mode === "select" ? (
      <button type="button" role="checkbox" aria-checked={selected} aria-label={`Select ${folder.name}`}
        className={`${mainClass} folders-select-main`} onClick={onToggle}>
        <span className={`folders-card-check${selected ? " is-checked" : ""}`} aria-hidden="true">{selected ? <CheckIcon size={14} /> : null}</span>
        {content}
      </button>
    ) : mode === "reorder" ? (
      <div className={mainClass}>
        <span className="folders-card-position" aria-hidden="true">{position}</span>
        {content}
      </div>
    )
      : <Link className={mainClass} to={`/folders/${folder.id}`}>{content}</Link>}
    {view === "grid" ? <div className="folder-card-bottom">{counts}{actions}</div> : <>{counts}{actions}</>}
    {control}
  </Card>;
}
