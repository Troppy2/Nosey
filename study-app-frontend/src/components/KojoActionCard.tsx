import {
  AlertCircle,
  BookOpen,
  Check,
  ExternalLink,
  FolderPlus,
  GraduationCap,
  Layers,
  Puzzle,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  createFolder,
  createLearningTrack,
  generateFlashcards,
  resolveKojoActionCard,
} from "../lib/api";
import type { Folder, KojoActionCard as KojoActionCardType } from "../lib/types";

// Chat-embedded action proposal card (extends the BlueprintCard UX shape):
// propose -> edit -> confirm/dismiss, persisted server-side so it survives
// reloads. Confirmed cards mutate into a compact done row that links out.

type Props = {
  card: KojoActionCardType;
  folders: Folder[];
  // Folder the chat is scoped to, or null in General chat
  scopedFolderId: number | null;
  provider?: string;
  onResolved: (card: KojoActionCardType) => void;
  onFolderCreated: (folder: Folder) => void;
};

const ACTION_META: Record<string, { label: string; icon: React.ReactNode }> = {
  create_folder: { label: "new folder", icon: <FolderPlus size={13} /> },
  create_flashcards: { label: "flashcards", icon: <Layers size={13} /> },
  create_module: { label: "learning module", icon: <GraduationCap size={13} /> },
  start_matching: { label: "matching mode", icon: <Puzzle size={13} /> },
};

function str(payload: Record<string, unknown>, key: string, fallback = ""): string {
  const v = payload[key];
  return typeof v === "string" ? v : fallback;
}

function num(payload: Record<string, unknown>, key: string, fallback: number): number {
  const v = payload[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function doneLink(card: KojoActionCardType): { to: string; label: string } | null {
  const folderId = card.payload["folder_id"] ?? card.entity_id;
  switch (card.action_type) {
    case "create_folder":
      return card.entity_id ? { to: `/folders/${card.entity_id}`, label: "Open folder" } : null;
    case "create_flashcards":
      return folderId ? { to: `/flashcards/${folderId}/review`, label: "Study flashcards" } : null;
    case "create_module":
      return folderId ? { to: `/flashcards/${folderId}/modules`, label: "Open modules" } : null;
    case "start_matching":
      return folderId ? { to: `/flashcards/${folderId}/matching`, label: "Play matching" } : null;
    default:
      return null;
  }
}

export function KojoActionCard({ card, folders, scopedFolderId, provider, onResolved, onFolderCreated }: Props) {
  const navigate = useNavigate();
  const meta = ACTION_META[card.action_type] ?? { label: card.action_type, icon: <BookOpen size={13} /> };
  const needsFolder = card.action_type !== "create_folder";
  const p = card.payload;

  // Editable proposal fields (per action type; unused ones stay idle)
  const [name, setName] = useState(str(p, "name"));
  const [subject, setSubject] = useState(str(p, "subject"));
  const [title, setTitle] = useState(str(p, "title"));
  const [count, setCount] = useState(num(p, "count", 10));
  const [prompt, setPrompt] = useState(str(p, "prompt"));
  const [moduleCount, setModuleCount] = useState(num(p, "module_count", 5));
  const [instructions, setInstructions] = useState(str(p, "custom_instructions"));
  const [folderId, setFolderId] = useState<number | "">(scopedFolderId ?? "");
  // Inline "create new folder" affordance for General chat
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  if (card.status === "dismissed") return null;

  if (card.status === "confirmed") {
    const link = doneLink(card);
    const entityTitle = str(p, "entity_title") || str(p, "title") || str(p, "name") || meta.label;
    return (
      <div className={`kojo-blueprint-card kojo-blueprint-card--done${card.entity_deleted ? " kojo-action-card--deleted" : ""}`}>
        <div className="kojo-blueprint-head kojo-blueprint-head--static">
          {meta.icon}
          <span className="kojo-blueprint-head-label">{meta.label}</span>
          <span className="kojo-blueprint-head-status">
            {card.entity_deleted ? <><AlertCircle size={11} /> deleted</> : <><Check size={11} /> {card.action_type === "start_matching" ? "started" : "created"}</>}
          </span>
        </div>
        <div className="kojo-blueprint-done">
          <span className={card.entity_deleted ? "kojo-action-deleted-name" : undefined}>{entityTitle}</span>
          {card.entity_deleted ? (
            <span className="kojo-action-deleted-note">no longer exists</span>
          ) : link ? (
            <Link to={link.to} className="kojo-blueprint-test-link">
              <ExternalLink size={13} />
              {link.label}
            </Link>
          ) : null}
        </div>
      </div>
    );
  }

  async function handleCreateFolderInline() {
    const trimmed = newFolderName.trim();
    if (!trimmed || working) return;
    setWorking(true);
    setError(null);
    try {
      const folder = await createFolder({ name: trimmed, subject: null, description: null });
      onFolderCreated(folder);
      setFolderId(folder.id);
      setCreatingFolder(false);
      setNewFolderName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create that folder.");
    } finally {
      setWorking(false);
    }
  }

  async function handleDismiss() {
    if (working) return;
    setWorking(true);
    try {
      const resolved = await resolveKojoActionCard(card.id, "dismissed");
      onResolved(resolved);
    } catch {
      onResolved({ ...card, status: "dismissed" });
    } finally {
      setWorking(false);
    }
  }

  async function handleConfirm() {
    if (working) return;
    if (needsFolder && folderId === "") {
      setError("Pick a folder first.");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      let resolved: KojoActionCardType;
      if (card.action_type === "create_folder") {
        const folder = await createFolder({
          name: name.trim() || "New folder",
          subject: subject.trim() || null,
          description: str(p, "description") || null,
        });
        onFolderCreated(folder);
        resolved = await resolveKojoActionCard(card.id, "confirmed", {
          entityType: "folder",
          entityId: folder.id,
          payload: { entity_title: folder.name },
        });
      } else if (card.action_type === "create_flashcards") {
        const cards = await generateFlashcards(folderId as number, {
          count,
          prompt: prompt.trim() || title.trim() || "Key terms from this conversation",
          provider,
        });
        resolved = await resolveKojoActionCard(card.id, "confirmed", {
          entityType: "flashcards",
          entityId: folderId as number,
          payload: {
            entity_title: title.trim() || "Flashcards",
            folder_id: folderId,
            flashcard_ids: cards.map((c) => c.id),
          },
        });
      } else if (card.action_type === "create_module") {
        const track = await createLearningTrack(folderId as number, moduleCount, {
          provider,
          customInstructions: instructions.trim() || undefined,
        });
        resolved = await resolveKojoActionCard(card.id, "confirmed", {
          entityType: "learning_track",
          entityId: track.id,
          payload: {
            entity_title: `${folders.find((f) => f.id === folderId)?.name ?? "Folder"} modules (${track.module_count})`,
            folder_id: folderId,
          },
        });
      } else {
        // start_matching: nothing to create, confirm records the pick and we navigate
        resolved = await resolveKojoActionCard(card.id, "confirmed", {
          entityType: "folder",
          entityId: folderId as number,
          payload: {
            entity_title: folders.find((f) => f.id === folderId)?.name ?? "Matching",
            folder_id: folderId,
          },
        });
        onResolved(resolved);
        navigate(`/flashcards/${folderId}/matching`);
        return;
      }
      onResolved(resolved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work. Try again.");
      setWorking(false);
    }
  }

  const confirmLabel =
    card.action_type === "start_matching" ? "Start Matching"
      : card.action_type === "create_folder" ? "Create Folder"
        : card.action_type === "create_module" ? "Build Modules"
          : "Generate Flashcards";

  return (
    <div className="kojo-blueprint-card">
      <button
        type="button"
        className="kojo-blueprint-head"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        {meta.icon}
        <span className="kojo-blueprint-head-label">{meta.label}</span>
        <span className="kojo-blueprint-head-toggle">{expanded ? "hide" : "show"}</span>
      </button>
      {!expanded ? null : (
        <div className="kojo-blueprint-body">
          {str(p, "intro") && (
            <div className="kojo-blueprint-intro">
              <span>{str(p, "intro")}</span>
            </div>
          )}

          <div className="kojo-blueprint-fields">
            {card.action_type === "create_folder" && (
              <>
                <label className="kojo-blueprint-label">
                  <span>Folder name</span>
                  <input className="kojo-blueprint-input" type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} disabled={working} />
                </label>
                <label className="kojo-blueprint-label">
                  <span>Subject <span className="kojo-blueprint-optional">(optional)</span></span>
                  <input className="kojo-blueprint-input" type="text" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} disabled={working} />
                </label>
              </>
            )}

            {needsFolder && (
              <label className="kojo-blueprint-label">
                <span>Folder</span>
                {creatingFolder ? (
                  <div className="kojo-action-newfolder">
                    <input
                      className="kojo-blueprint-input"
                      type="text"
                      placeholder="New folder name"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      maxLength={120}
                      disabled={working}
                      autoFocus
                    />
                    <button type="button" className="kojo-blueprint-btn kojo-blueprint-btn--primary" onClick={() => void handleCreateFolderInline()} disabled={!newFolderName.trim() || working}>
                      <Check size={13} />
                    </button>
                    <button type="button" className="kojo-blueprint-btn kojo-blueprint-btn--ghost" onClick={() => setCreatingFolder(false)} disabled={working}>
                      <X size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="kojo-action-folderpick">
                    <select
                      className="kojo-blueprint-select"
                      value={folderId}
                      onChange={(e) => setFolderId(e.target.value === "" ? "" : Number(e.target.value))}
                      disabled={working}
                    >
                      <option value="">Pick a folder…</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                    <button type="button" className="kojo-action-newfolder-btn" onClick={() => setCreatingFolder(true)} disabled={working}>
                      <FolderPlus size={13} />
                      new
                    </button>
                  </div>
                )}
              </label>
            )}

            {card.action_type === "create_flashcards" && (
              <>
                <div className="kojo-blueprint-row">
                  <label className="kojo-blueprint-label">
                    <span>Set name</span>
                    <input className="kojo-blueprint-input" type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} disabled={working} />
                  </label>
                  <label className="kojo-blueprint-label">
                    <span>Cards</span>
                    <input className="kojo-blueprint-input kojo-blueprint-input--num" type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value))))} disabled={working} />
                  </label>
                </div>
                <label className="kojo-blueprint-label">
                  <span>Instructions <span className="kojo-blueprint-optional">(from our chat, editable)</span></span>
                  <textarea className="kojo-blueprint-input kojo-action-textarea" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={2000} disabled={working} />
                </label>
              </>
            )}

            {card.action_type === "create_module" && (
              <>
                <label className="kojo-blueprint-label">
                  <span>Modules</span>
                  <input className="kojo-blueprint-input kojo-blueprint-input--num" type="number" min={1} max={20} value={moduleCount} onChange={(e) => setModuleCount(Math.max(1, Math.min(20, Number(e.target.value))))} disabled={working} />
                </label>
                <label className="kojo-blueprint-label">
                  <span>Instructions <span className="kojo-blueprint-optional">(from our chat, editable)</span></span>
                  <textarea className="kojo-blueprint-input kojo-action-textarea" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={10000} disabled={working} />
                </label>
              </>
            )}
          </div>

          {error && (
            <div className="kojo-blueprint-error"><AlertCircle size={13} /><span>{error}</span></div>
          )}
          <div className="kojo-blueprint-actions">
            <button type="button" className="kojo-blueprint-btn kojo-blueprint-btn--primary" onClick={() => void handleConfirm()} disabled={working || (needsFolder && folderId === "")}>
              {working ? <span className="loader loader--sm" /> : <Check size={13} />}
              {working ? "Working…" : confirmLabel}
            </button>
            <button type="button" className="kojo-blueprint-btn kojo-blueprint-btn--ghost" onClick={() => void handleDismiss()} disabled={working}>
              <X size={13} />Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default KojoActionCard;
