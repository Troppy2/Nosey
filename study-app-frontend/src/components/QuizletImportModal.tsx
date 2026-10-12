import { ArrowLeft, ArrowLeftRight, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Button } from "./Button";
import { Dropdown, type DropdownOption } from "./Dropdown";
import { TextInput } from "./Field";
import { FormError } from "./FormError";
import { InlineLoading } from "./Loaders";
import {
  createFolder,
  fetchFlashcards,
  fetchFolders,
  importFlashcards,
  markTourSeen,
  tidyFlashcardPaste,
} from "../lib/api";
import {
  DEFAULT_SEPARATORS,
  IMPORT_MAX_CARDS,
  TIDY_MAX_CHARS,
  detectSeparators,
  draftIssues,
  looksMessy,
  parseCardText,
  toDrafts,
  type CardDraft,
  type CardIssue,
  type ParsedCard,
  type RowSeparator,
  type Separators,
  type TermSeparator,
} from "../lib/quizletFormat";
import { toast } from "../lib/toast";
import type { Flashcard, Folder } from "../lib/types";

// Far above any real set, small enough that parsing stays instant.
const MAX_PASTE_CHARS = 500_000;
// Review rows rendered before "Show all", so a 1,000-card set stays responsive.
const REVIEW_PAGE = 200;
const NEW_FOLDER = "new";

const ISSUE_LABELS: Record<CardIssue, string> = {
  missing: "Missing a side",
  "too-long": "Too long to save",
  duplicate: "Duplicate",
  reworded: "Kojo changed this, check it",
};

const TERM_LABELS: Record<TermSeparator, string> = {
  tab: "Tab",
  comma: "Comma",
  dash: "Dash",
  custom: "Custom",
};

const ROW_LABELS: Record<RowSeparator, string> = {
  newline: "New line",
  semicolon: "Semicolon",
  alternating: "Separate lines",
  custom: "Custom",
};

const TERM_OPTIONS: DropdownOption<TermSeparator>[] = [
  { value: "tab", label: "Tab" },
  { value: "comma", label: "Comma" },
  { value: "dash", label: "Dash ( - )" },
  { value: "custom", label: "Custom" },
];

const ROW_OPTIONS: DropdownOption<RowSeparator>[] = [
  { value: "newline", label: "New line" },
  { value: "semicolon", label: "Semicolon" },
  { value: "alternating", label: "Term and definition on separate lines" },
  { value: "custom", label: "Custom" },
];

export type QuizletImportResult = {
  folderId: number;
  cards: Flashcard[];
  /** Set when the import created a new folder. */
  createdFolder: Folder | null;
};

type Props = {
  /** Folder the destination picker starts on. */
  folderId?: number;
  /** Start on "New folder" with this name (from the Create Folder modal). */
  newFolderName?: string;
  onClose: () => void;
  onImported: (result: QuizletImportResult) => void;
  /** An import failed partway after saving something (a new folder or some
   *  cards); the page should reload what it shows. */
  onPartialSave?: () => void;
};

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function QuizletImportModal({ folderId, newFolderName, onClose, onImported, onPartialSave }: Props) {
  const [step, setStep] = useState<"paste" | "review">("paste");
  const [text, setText] = useState("");
  const [seps, setSeps] = useState<Separators>(DEFAULT_SEPARATORS);
  const [sepsTouched, setSepsTouched] = useState(false);
  const [drafts, setDrafts] = useState<CardDraft[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [destination, setDestination] = useState<string>(
    newFolderName !== undefined || folderId == null ? NEW_FOLDER : String(folderId),
  );
  const [folderName, setFolderName] = useState(newFolderName ?? "");
  const [existing, setExisting] = useState<ParsedCard[]>([]);
  const [tidying, setTidying] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = tidying || importing;

  useEffect(() => {
    fetchFolders().then(setFolders);
  }, []);

  // Cards already in the target folder, for the duplicate check.
  useEffect(() => {
    if (destination === NEW_FOLDER) {
      setExisting([]);
      return;
    }
    let active = true;
    fetchFlashcards(Number(destination)).then((cards) => {
      if (active) setExisting(cards.map((card) => ({ front: card.front, back: card.back })));
    });
    return () => {
      active = false;
    };
  }, [destination]);

  // Rows that turn out to duplicate the target folder's cards start unticked.
  useEffect(() => {
    setDrafts((current) => {
      const issues = draftIssues(current, existing);
      if (!current.some((draft, i) => draft.include && issues[i] === "duplicate")) return current;
      return current.map((draft, i) => (issues[i] === "duplicate" ? { ...draft, include: false } : draft));
    });
  }, [existing]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Same guard as the backdrop: Escape must not throw away a paste.
      if (event.key === "Escape" && !busy && !text.trim()) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy, text]);

  const deferredText = useDeferredValue(text);
  const activeSeps = useMemo(
    () => (sepsTouched ? seps : detectSeparators(deferredText)),
    [sepsTouched, seps, deferredText],
  );
  const parsed = useMemo(() => parseCardText(deferredText, activeSeps), [deferredText, activeSeps]);
  const completeCount = parsed.filter((card) => card.front && card.back).length;
  const incompleteCount = parsed.length - completeCount;
  const messy = deferredText.trim().length > 0 && looksMessy(parsed);

  const issues = useMemo(() => draftIssues(drafts, existing), [drafts, existing]);
  const importable = (i: number) => issues[i] !== "missing" && issues[i] !== "too-long";
  const selected = drafts.filter((draft, i) => draft.include && importable(i));
  const importableCount = drafts.filter((_, i) => importable(i)).length;
  const allSelected = importableCount > 0 && selected.length === importableCount;
  const visible = showAll ? drafts : drafts.slice(0, REVIEW_PAGE);

  function changeSeps(patch: Partial<Separators>) {
    setSepsTouched(true);
    setSeps({ ...activeSeps, ...patch });
  }

  function openReview(cards: (ParsedCard & { reworded?: boolean })[]) {
    setDrafts(toDrafts(cards, existing));
    setShowAll(false);
    setError(null);
    setStep("review");
  }

  async function handleTidy() {
    if (text.length > TIDY_MAX_CHARS) {
      setError(
        `That's too long for Kojo to tidy in one go. Paste up to ${TIDY_MAX_CHARS.toLocaleString()} characters at a time.`,
      );
      return;
    }
    setTidying(true);
    setError(null);
    try {
      const cards = await tidyFlashcardPaste(text);
      openReview(cards.map((card) => ({ front: card.front, back: card.back, reworded: !card.verbatim })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kojo couldn't tidy that. Try again.");
    } finally {
      setTidying(false);
    }
  }

  function updateDraft(id: number, patch: Partial<Pick<CardDraft, "front" | "back" | "include">>) {
    setDrafts((current) =>
      current.map((draft) => {
        if (draft.id !== id) return draft;
        const next = { ...draft, ...patch };
        // Filling in a missing side ticks the row.
        const wasMissing = !draft.front.trim() || !draft.back.trim();
        if (patch.include === undefined && wasMissing && next.front.trim() && next.back.trim()) next.include = true;
        return next;
      }),
    );
  }

  function toggleAll() {
    const on = !allSelected;
    setDrafts((current) => current.map((draft, i) => (importable(i) ? { ...draft, include: on } : draft)));
  }

  function swapSides() {
    setDrafts((current) => {
      const swapped = current.map((draft) => ({ ...draft, front: draft.back, back: draft.front }));
      // Duplicates are judged on front + back, so redo the default ticks.
      const before = draftIssues(current, existing);
      const after = draftIssues(swapped, existing);
      return swapped.map((draft, i) => {
        if (after[i] === "duplicate") return { ...draft, include: false };
        if (before[i] === "duplicate") return { ...draft, include: true };
        return draft;
      });
    });
  }

  async function handleImport() {
    if (busy || selected.length === 0) return;
    const name = folderName.trim();
    if (destination === NEW_FOLDER && !name) {
      setError("Name the new folder first.");
      return;
    }
    setImporting(true);
    setError(null);
    const payload = selected.map((draft) => ({ front: draft.front.trim(), back: draft.back.trim() }));
    const saved: Flashcard[] = [];
    let createdFolder: Folder | null = null;
    try {
      let targetId: number;
      if (destination === NEW_FOLDER) {
        createdFolder = await createFolder({ name, subject: null, description: null });
        targetId = createdFolder.id;
      } else {
        targetId = Number(destination);
      }
      // The server takes at most IMPORT_MAX_CARDS per request.
      for (let i = 0; i < payload.length; i += IMPORT_MAX_CARDS) {
        saved.push(...(await importFlashcards(targetId, payload.slice(i, i + IMPORT_MAX_CARDS))));
      }
      void markTourSeen("quizlet-import");
      const folderLabel = createdFolder?.name ?? folders.find((folder) => folder.id === targetId)?.name;
      toast.success(`${plural(saved.length, "card")} imported`, folderLabel);
      onImported({ folderId: targetId, cards: saved, createdFolder });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed. Try again.";
      if (createdFolder) {
        // Retry into the folder that was just made, never a second copy.
        const made = createdFolder;
        setFolders((current) => [made, ...current]);
        setDestination(String(made.id));
      }
      if (saved.length > 0) {
        const savedIds = new Set(selected.slice(0, saved.length).map((draft) => draft.id));
        setDrafts((current) => current.filter((draft) => !savedIds.has(draft.id)));
        setError(`Saved ${saved.length} of ${payload.length} cards, then this went wrong: ${message}`);
      } else {
        setError(message);
      }
      if (createdFolder || saved.length > 0) onPartialSave?.();
    } finally {
      setImporting(false);
    }
  }

  const destinationKnown =
    destination === NEW_FOLDER || folders.some((folder) => String(folder.id) === destination);
  const destinationOptions: DropdownOption<string>[] = [
    { value: NEW_FOLDER, label: "New folder" },
    // Folders still loading: keep the preselected folder showing.
    ...(destinationKnown ? [] : [{ value: destination, label: "This folder" }]),
    ...folders.map((folder) => ({ value: String(folder.id), label: folder.name })),
  ];

  return (
    <div
      className="modal-backdrop"
      onMouseDown={() => {
        // A stray click outside must not throw away a long paste.
        if (!busy && !text.trim()) onClose();
      }}
    >
      <div
        className="modal-card qz-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qz-import-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="qz-header">
          <div>
            <h2 id="qz-import-title">Import from Quizlet</h2>
            <p className="muted small">
              {step === "paste"
                ? "Paste your set, check the cards, then save them to a folder."
                : `${selected.length} of ${plural(drafts.length, "card")} selected`}
            </p>
          </div>
          <button className="qz-close" type="button" aria-label="Close" onClick={onClose} disabled={busy}>
            <X size={18} />
          </button>
        </div>

        {step === "paste" ? (
          <div className="qz-body">
            <ol className="qz-steps">
              <li>
                On quizlet.com, open your set and pick <strong>Export</strong> from the three-dot menu.
              </li>
              <li>
                Click <strong>Copy text</strong>, then paste it here.
              </li>
            </ol>
            <p className="muted small">
              Quizlet only exports sets you made. For anyone else's set, copy the cards straight off the set page
              and paste them here.
            </p>
            <textarea
              className="input textarea qz-paste"
              aria-label="Pasted cards"
              autoFocus
              maxLength={MAX_PASTE_CHARS}
              onChange={(event) => setText(event.target.value)}
              placeholder="Paste here. One card per line: the term, a tab, then the definition."
              spellCheck={false}
              value={text}
            />

            <details className="qz-seps">
              <summary>
                Separators: {TERM_LABELS[activeSeps.term]} between term and definition,{" "}
                {ROW_LABELS[activeSeps.row].toLowerCase()} between cards{sepsTouched ? "" : " (detected)"}
              </summary>
              <div className="qz-seps-grid">
                <Dropdown
                  label="Between term and definition"
                  value={activeSeps.term}
                  options={TERM_OPTIONS}
                  onChange={(term) => changeSeps({ term })}
                />
                <Dropdown
                  label="Between cards"
                  value={activeSeps.row}
                  options={ROW_OPTIONS}
                  onChange={(row) => changeSeps({ row })}
                />
                {activeSeps.term === "custom" ? (
                  <TextInput
                    label="Custom term separator"
                    value={activeSeps.customTerm ?? ""}
                    onChange={(event) => changeSeps({ customTerm: event.target.value })}
                  />
                ) : null}
                {activeSeps.row === "custom" ? (
                  <TextInput
                    label="Custom card separator"
                    value={activeSeps.customRow ?? ""}
                    onChange={(event) => changeSeps({ customRow: event.target.value })}
                  />
                ) : null}
              </div>
              {sepsTouched ? (
                <button className="qz-link" type="button" onClick={() => setSepsTouched(false)}>
                  Detect automatically
                </button>
              ) : null}
            </details>

            {deferredText.trim() ? (
              <p className="qz-found" aria-live="polite">
                {completeCount > 0 ? `Found ${plural(completeCount, "card")}.` : "No terms and definitions found yet."}
                {incompleteCount > 0 ? ` ${plural(incompleteCount, "row")} missing a side.` : ""}
              </p>
            ) : null}

            {messy ? (
              <div className="qz-tidy">
                <div>
                  <strong>Looks messy?</strong>
                  <p className="muted small">
                    Kojo can pick out the terms and definitions for you. Uses your Kojo allowance.
                  </p>
                </div>
                <Button variant="secondary" onClick={handleTidy} disabled={busy}>
                  {tidying ? <InlineLoading label="Kojo is tidying" /> : "Have Kojo tidy this"}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="qz-body">
            {drafts.length === 0 ? (
              <p className="muted small">No cards left. Go back to paste again.</p>
            ) : (
              <>
                <div className="qz-review-bar">
                  <label className="qz-check-all">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={busy} />
                    Select all
                  </label>
                  <Button variant="ghost" icon={<ArrowLeftRight size={15} />} onClick={swapSides} disabled={busy}>
                    Swap term and definition
                  </Button>
                </div>
                <ul className="qz-rows">
                  {visible.map((draft, index) => {
                    const issue = issues[index];
                    return (
                      <li key={draft.id} className={`qz-row${draft.include && importable(index) ? " is-on" : ""}`}>
                        <input
                          type="checkbox"
                          aria-label={`Include card ${index + 1}`}
                          checked={draft.include && importable(index)}
                          disabled={busy || !importable(index)}
                          onChange={(event) => updateDraft(draft.id, { include: event.target.checked })}
                        />
                        <div className="qz-row-fields">
                          <textarea
                            className="input qz-field"
                            aria-label={`Term ${index + 1}`}
                            rows={1}
                            disabled={busy}
                            value={draft.front}
                            onChange={(event) => updateDraft(draft.id, { front: event.target.value })}
                          />
                          <textarea
                            className="input qz-field"
                            aria-label={`Definition ${index + 1}`}
                            rows={1}
                            disabled={busy}
                            value={draft.back}
                            onChange={(event) => updateDraft(draft.id, { back: event.target.value })}
                          />
                          {issue ? <span className={`qz-issue qz-issue--${issue}`}>{ISSUE_LABELS[issue]}</span> : null}
                        </div>
                        <button
                          className="qz-remove"
                          type="button"
                          aria-label={`Remove card ${index + 1}`}
                          onClick={() => setDrafts((current) => current.filter((row) => row.id !== draft.id))}
                          disabled={busy}
                        >
                          <X size={15} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {!showAll && drafts.length > REVIEW_PAGE ? (
                  <Button variant="secondary" onClick={() => setShowAll(true)}>
                    Show all {drafts.length} cards
                  </Button>
                ) : null}
              </>
            )}
          </div>
        )}

        <FormError message={error} />

        <div className="qz-footer">
          {step === "paste" ? (
            <div className="button-row">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => openReview(parsed)} disabled={busy || completeCount === 0}>
                Review {completeCount > 0 ? plural(completeCount, "card") : "cards"}
              </Button>
            </div>
          ) : (
            <>
              <div className="qz-destination">
                <Dropdown
                  label="Save to"
                  value={destination}
                  options={destinationOptions}
                  onChange={setDestination}
                  disabled={busy}
                />
                {destination === NEW_FOLDER ? (
                  <TextInput
                    label="Folder name"
                    value={folderName}
                    onChange={(event) => setFolderName(event.target.value)}
                    placeholder="Spanish vocab"
                    maxLength={120}
                    disabled={busy}
                  />
                ) : null}
              </div>
              <div className="button-row">
                <Button
                  variant="secondary"
                  icon={<ArrowLeft size={16} />}
                  onClick={() => {
                    setStep("paste");
                    setError(null);
                  }}
                  disabled={busy}
                >
                  Back
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={busy || selected.length === 0 || (destination === NEW_FOLDER && !folderName.trim())}
                >
                  {importing ? <InlineLoading label="Importing" /> : `Import ${plural(selected.length, "card")}`}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
