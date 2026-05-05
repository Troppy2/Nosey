import { Edit3, FolderOpen, Grid3X3, List, Plus, Trash2 } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { TextInput } from "../components/Field";
import { createFolder, deleteFolder, fetchFolders, updateFolder } from "../lib/api";
import type { Folder } from "../lib/types";

export default function Folders() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [view, setView] = useState<"grid" | "list">("grid");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [folderAction, setFolderAction] = useState<{
    type: "rename" | "delete";
    folder: Folder;
    draftName: string;
  } | null>(null);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFolders().then(setFolders);
  }, []);

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
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Unable to create that folder.");
    }
  }

  async function handleRename(folder: Folder) {
    setFolderAction({ type: "rename", folder, draftName: folder.name });
  }

  async function handleDelete(folder: Folder) {
    setFolderAction({ type: "delete", folder, draftName: folder.name });
  }

  async function handleActionSubmit(event: FormEvent) {
    event.preventDefault();
    if (!folderAction) return;

    try {
      if (folderAction.type === "rename") {
        const nextName = folderAction.draftName.trim();
        if (!nextName) return;

        const updated = await updateFolder(folderAction.folder.id, {
          name: nextName,
          subject: folderAction.folder.subject ?? null,
          description: folderAction.folder.description ?? null,
        });
        setFolders((current) => current.map((item) => (item.id === folderAction.folder.id ? updated : item)));
      } else {
        await deleteFolder(folderAction.folder.id);
        setFolders((current) => current.filter((item) => item.id !== folderAction.folder.id));
      }
      setError(null);
      setFolderAction(null);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update that folder.");
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Library</span>
          <h1>Folders</h1>
          <p className="muted">Organize tests and flashcards by subject or exam.</p>
        </div>
        <div className="toolbar">
          <div className="segmented" aria-label="View mode">
            <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} type="button">
              <Grid3X3 size={18} />
            </button>
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")} type="button">
              <List size={18} />
            </button>
          </div>
          <Button icon={<Plus size={18} />} onClick={() => setIsModalOpen(true)}>
            New Folder
          </Button>
        </div>
      </header>

      {error ? <div className="form-error">{error}</div> : null}

      {folders.length === 0 ? (
        <EmptyState
          icon={<FolderOpen />}
          title="No folders yet"
          body="Create your first folder to organize tests and flashcards."
          action={
            <Button icon={<Plus size={18} />} onClick={() => setIsModalOpen(true)}>
              New Folder
            </Button>
          }
        />
      ) : (
        <section className={view === "grid" ? "folder-grid" : "folder-list"}>
          {folders.map((folder) =>
            view === "grid" ? (
              <FolderGridCard key={folder.id} folder={folder} onRename={handleRename} onDelete={handleDelete} />
            ) : (
              <FolderListCard key={folder.id} folder={folder} onRename={handleRename} onDelete={handleDelete} />
            ),
          )}
        </section>
      )}

      <button className="floating-action" aria-label="Create folder" onClick={() => setIsModalOpen(true)} type="button">
        <Plus size={24} />
      </button>

      {isModalOpen ? (
        <div className="modal-backdrop" onMouseDown={() => setIsModalOpen(false)}>
          <form className="modal-card" onMouseDown={(event) => event.stopPropagation()} onSubmit={handleSubmit}>
            <h2>Create Folder</h2>
            <TextInput label="Name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Discrete Structures" />
            <TextInput label="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Math" />
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

      {folderAction ? (
        <div className="modal-backdrop" onMouseDown={() => setFolderAction(null)}>
          <form className="modal-card" onMouseDown={(event) => event.stopPropagation()} onSubmit={handleActionSubmit}>
            <h2>{folderAction.type === "rename" ? "Rename Folder" : "Delete Folder"}</h2>
            {folderAction.type === "rename" ? (
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
            ) : (
              <p className="muted">
                Delete <strong>{folderAction.folder.name}</strong>? This cannot be undone.
              </p>
            )}
            <div className="button-row">
              <Button variant="secondary" onClick={() => setFolderAction(null)}>
                Cancel
              </Button>
              <Button type="submit" variant={folderAction.type === "delete" ? "danger" : "primary"} disabled={folderAction.type === "rename" && !folderAction.draftName.trim()}>
                {folderAction.type === "rename" ? "Save" : "Delete"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function FolderGridCard({
  folder,
  onRename,
  onDelete,
}: {
  folder: Folder;
  onRename: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
}) {
  return (
    <Card interactive className="folder-card">
      <Link className="folder-card-main" to={`/folders/${folder.id}`}>
        <span className="folder-dot" style={{ background: folder.color ?? "var(--green-dark)" }} />
        <div>
          <FolderOpen size={34} style={{ color: folder.color ?? "var(--green-dark)" }} />
          <h2>{folder.name}</h2>
          <p className="muted">{folder.description ?? folder.subject ?? "Study folder"}</p>
        </div>
        <div className="folder-card-footer">
          <span>{folder.test_count} tests</span>
          <span>{folder.flashcard_count} cards</span>
        </div>
      </Link>
      <div className="row-actions folder-card-actions">
        <button aria-label={`Rename ${folder.name}`} onClick={() => onRename(folder)} type="button">
          <Edit3 size={17} />
        </button>
        <button aria-label={`Delete ${folder.name}`} onClick={() => onDelete(folder)} type="button">
          <Trash2 size={17} />
        </button>
      </div>
    </Card>
  );
}

function FolderListCard({
  folder,
  onRename,
  onDelete,
}: {
  folder: Folder;
  onRename: (folder: Folder) => void;
  onDelete: (folder: Folder) => void;
}) {
  return (
    <Card interactive className="folder-list-row">
      <Link className="folder-list-main" to={`/folders/${folder.id}`}>
        <FolderOpen size={30} style={{ color: folder.color ?? "var(--green-dark)" }} />
        <div>
          <h3>{folder.name}</h3>
          <p className="muted small">{folder.subject ?? "General"}</p>
        </div>
        <div className="mini-meta">
          <span>{folder.test_count} tests</span>
          <span>{folder.flashcard_count} cards</span>
        </div>
      </Link>
      <div className="row-actions">
        <button type="button" aria-label={`Rename ${folder.name}`} onClick={() => onRename(folder)}>
          <Edit3 size={17} />
        </button>
        <button type="button" aria-label={`Delete ${folder.name}`} onClick={() => onDelete(folder)}>
          <Trash2 size={17} />
        </button>
      </div>
    </Card>
  );
}
