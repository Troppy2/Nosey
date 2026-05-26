import { Check, Edit3, Pin, Plus, Search, Trash2, X } from "lucide-react";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { Button } from "./Button";
import { TextArea, TextInput } from "./Field";
import {
  createSlashCommand,
  deleteSlashCommand,
  updateSlashCommand,
} from "../lib/api";
import type { SlashCommand, SlashCommandInput } from "../lib/types";

type FormState = SlashCommandInput;

type Props = {
  commands: SlashCommand[];
  loading?: boolean;
  onChange: (commands: SlashCommand[]) => void;
};

const EMPTY_FORM: FormState = {
  slash: "",
  label: "",
  description: "",
  prompt: "",
  is_pinned: false,
};

function normalizeSlash(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function toForm(command: SlashCommand): FormState {
  return {
    slash: command.slash,
    label: command.label,
    description: command.description,
    prompt: command.prompt,
    is_pinned: command.is_pinned,
    position: command.position,
  };
}

export default function SlashCommandManager({ commands, loading = false, onChange }: Props) {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibleCommands = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^\//, "");
    if (!needle) return commands;
    return commands.filter((command) => {
      return (
        command.slash.toLowerCase().includes(needle) ||
        command.label.toLowerCase().includes(needle) ||
        command.description.toLowerCase().includes(needle)
      );
    });
  }, [commands, query]);

  const pinnedCount = commands.filter((command) => command.is_pinned).length;

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setError(null);
  }

  function editCommand(command: SlashCommand) {
    setForm(toForm(command));
    setEditingId(command.id);
    setError(null);
  }

  async function saveCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const payload: SlashCommandInput = {
      ...form,
      slash: normalizeSlash(form.slash),
      label: form.label.trim(),
      description: form.description.trim(),
      prompt: form.prompt.trim(),
    };

    try {
      const saved = editingId
        ? await updateSlashCommand(editingId, payload)
        : await createSlashCommand({ ...payload, position: commands.length });
      const next = editingId
        ? commands.map((command) => (command.id === saved.id ? saved : command))
        : [saved, ...commands];
      onChange(next.sort(sortCommands));
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save slash command.");
    } finally {
      setSaving(false);
    }
  }

  async function togglePinned(command: SlashCommand) {
    try {
      const updated = await updateSlashCommand(command.id, { is_pinned: !command.is_pinned });
      onChange(commands.map((item) => (item.id === command.id ? updated : item)).sort(sortCommands));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update slash command.");
    }
  }

  async function removeCommand(command: SlashCommand) {
    try {
      await deleteSlashCommand(command.id);
      onChange(commands.filter((item) => item.id !== command.id));
      if (editingId === command.id) resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete slash command.");
    }
  }

  return (
    <section className="slash-manager" aria-label="Slash command manager">
      <div className="slash-manager-header">
        <div>
          <h3>Slash commands</h3>
          <p className="muted small">Reusable Kojo prompts that show up when you type `/`.</p>
        </div>
        <div className="slash-manager-counts" aria-label="Command counts">
          <span className="pill">{commands.length} total</span>
          <span className="pill">{pinnedCount} pinned</span>
        </div>
      </div>

      <form className="slash-manager-composer card" onSubmit={saveCommand}>
        <div className="grid grid-2 slash-manager-form-row">
          <TextInput
            label="Command"
            value={form.slash}
            onChange={(event) => setForm((cur) => ({ ...cur, slash: event.target.value }))}
            placeholder="/teach-back"
            required
          />
          <TextInput
            label="Name"
            value={form.label}
            onChange={(event) => setForm((cur) => ({ ...cur, label: event.target.value }))}
            placeholder="Teach Back"
            required
          />
        </div>

        <TextInput
          label="Description"
          value={form.description}
          onChange={(event) => setForm((cur) => ({ ...cur, description: event.target.value }))}
          placeholder="Explain an idea and end with a check question"
          required
        />

        <TextArea
          label="Prompt"
          rows={3}
          value={form.prompt}
          onChange={(event) => setForm((cur) => ({ ...cur, prompt: event.target.value }))}
          placeholder="Tell Kojo exactly what to send when this command is selected."
          required
        />

        {error ? <p className="slash-manager-error">{error}</p> : null}

        <div className="slash-manager-actions">
          <Button
            type="button"
            variant="primary"
            icon={<Pin size={15} className="icon-pin" />}
            onClick={() => setForm((cur) => ({ ...cur, is_pinned: !cur.is_pinned }))}
          >
            {form.is_pinned ? "Pinned" : "Pin"}
          </Button>
          {editingId ? (
            <Button type="button" variant="primary" icon={<X size={15} className="icon-cancel" />} onClick={resetForm}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" icon={saving ? <Check size={15} className="icon-check" /> : <Plus size={15} className="icon-plus" />} disabled={saving}>
            {saving ? "Saving" : editingId ? "Update" : "Create"}
          </Button>
        </div>
      </form>

      <div className="slash-manager-search">
        <Search size={15} className="icon-search" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search commands" />
      </div>

      <div className="slash-manager-list" aria-live="polite">
        {loading ? (
          <p className="muted small">Loading slash commands...</p>
        ) : visibleCommands.length === 0 ? (
          <p className="muted small">{commands.length === 0 ? "No custom commands yet." : "No commands match that search."}</p>
        ) : (
          visibleCommands.map((command) => (
            <article
              key={command.id}
              className={`slash-manager-item card${command.is_pinned ? " slash-manager-item--pinned" : ""}`}
            >
              <button type="button" className="slash-manager-item-main" onClick={() => editCommand(command)}>
                <span className="slash-manager-trigger">{command.slash}</span>
                <span className="slash-manager-item-copy">
                  <strong>{command.label}</strong>
                  <small>{command.description}</small>
                </span>
              </button>
              <div className="slash-manager-item-actions">
                <button
                  type="button"
                  className={`slash-action-btn action-pin${command.is_pinned ? " slash-action-btn--pinned" : ""}`}
                  onClick={() => togglePinned(command)}
                  aria-label={command.is_pinned ? "Unpin command" : "Pin command"}
                  title={command.is_pinned ? "Unpin" : "Pin"}
                >
                  <Pin size={16} />
                </button>
                <button type="button" className="slash-action-btn action-edit" onClick={() => editCommand(command)} aria-label="Edit command" title="Edit">
                  <Edit3 size={16} />
                </button>
                <button type="button" className="slash-action-btn action-delete" onClick={() => removeCommand(command)} aria-label="Delete command" title="Delete">
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function sortCommands(a: SlashCommand, b: SlashCommand) {
  if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
  if (a.position !== b.position) return a.position - b.position;
  return a.slash.localeCompare(b.slash);
}
