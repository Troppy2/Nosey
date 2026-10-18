import { Download, ExternalLink } from "lucide-react";
import { CloseIcon, CopyIcon } from "../icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./Button";
import { InlineLoading } from "./Loaders";
import { fetchFlashcards } from "../lib/api";
import { serializeForQuizlet } from "../lib/quizletFormat";
import type { Flashcard } from "../lib/types";

const QUIZLET_CREATE_URL = "https://quizlet.com/create-set";

type Props = {
  folderId: number;
  folderName?: string;
  onClose: () => void;
};

function fileSlug(name: string | undefined): string {
  const slug = (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "flashcards";
}

export function QuizletExportModal({ folderId, folderName, onClose }: Props) {
  // All cards, not the Manage page's first 50.
  const [cards, setCards] = useState<Flashcard[] | null>(null);
  const [status, setStatus] = useState<"idle" | "copied" | "copy-failed">("idle");
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let active = true;
    fetchFlashcards(folderId).then((loaded) => {
      // Oldest first, so a set imported from Quizlet goes back in its order
      // (the API lists newest first).
      if (active) setCards([...loaded].sort((a, b) => a.id - b.id));
    });
    return () => {
      active = false;
    };
  }, [folderId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const text = useMemo(() => serializeForQuizlet(cards ?? []), [cards]);
  const empty = cards !== null && cards.length === 0;
  const disabled = cards === null || empty;

  async function copy(openQuizlet: boolean) {
    // Start the clipboard write before opening the tab: the write needs this
    // page focused, and the popup has to open inside the click itself.
    const copying = navigator.clipboard
      ? navigator.clipboard.writeText(text)
      : Promise.reject(new Error("Clipboard unavailable"));
    if (openQuizlet) window.open(QUIZLET_CREATE_URL, "_blank", "noopener,noreferrer");
    try {
      await copying;
      setStatus("copied");
    } catch {
      setStatus("copy-failed");
      textRef.current?.focus();
      textRef.current?.select();
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileSlug(folderName)}-quizlet.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal-card qz-modal qz-modal--export"
        role="dialog"
        aria-modal="true"
        aria-labelledby="qz-export-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="qz-header">
          <div>
            <h2 id="qz-export-title">Export to Quizlet</h2>
            <p className="muted small">
              {cards === null
                ? "Loading your cards"
                : `${cards.length} card${cards.length === 1 ? "" : "s"}${folderName ? ` from ${folderName}` : ""}`}
            </p>
          </div>
          <button className="qz-close" type="button" aria-label="Close" onClick={onClose}>
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="qz-body">
          {cards === null ? (
            <InlineLoading label="Loading your cards" />
          ) : empty ? (
            <p className="muted small">No cards in this folder yet.</p>
          ) : (
            <>
              <ol className="qz-steps">
                <li>
                  Click <strong>Copy and open Quizlet</strong>.
                </li>
                <li>
                  On Quizlet's new set page, click <strong>Import</strong>, paste, then click <strong>Import</strong>{" "}
                  again.
                </li>
              </ol>
              <p className="muted small">
                Text only: images don't carry over, and maths shows as written (like $x^2$).
              </p>
              <textarea
                ref={textRef}
                className="input textarea qz-paste qz-export-text"
                aria-label="Cards in Quizlet format"
                readOnly
                spellCheck={false}
                value={text}
              />
              {status === "copied" ? (
                <p className="qz-found" role="status">
                  Copied. Paste it into Quizlet's Import box.
                </p>
              ) : status === "copy-failed" ? (
                <p className="qz-found qz-found--warn" role="status">
                  Couldn't copy automatically. The text is selected: press Ctrl+C (Cmd+C on a Mac) to copy it.
                </p>
              ) : null}
            </>
          )}
        </div>

        <div className="qz-footer">
          <div className="button-row">
            <Button variant="secondary" icon={<Download size={16} />} onClick={download} disabled={disabled}>
              Download .txt
            </Button>
            <Button variant="secondary" icon={<CopyIcon size={16} />} onClick={() => copy(false)} disabled={disabled}>
              Copy
            </Button>
            <Button icon={<ExternalLink size={16} />} onClick={() => copy(true)} disabled={disabled}>
              Copy and open Quizlet
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
