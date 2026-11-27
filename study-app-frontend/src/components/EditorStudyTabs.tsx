import { useEffect, useRef, useState } from "react";
import {
  fetchLCNotes,
  syncLCNotes,
  fetchSolutionWalkthrough,
  isGuestSession,
  scopeKey,
} from "../lib/api";
import { toast } from "../lib/toast";
import type {
  SolutionWalkthroughResponse,
  WalkApproach,
} from "../lib/types";
import "../styles/components/markdown-answer.css";
import MarkdownLiveEditor from "./MarkdownLiveEditor";
import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { formatSelection, insertLink, toggleLines } from "../lib/markdownFormat";
import { Button } from "./Button";
import { LoadingNotice } from "./Loaders";
import { CollapsibleSection } from "./CollapsibleSection";
import { MarkdownContent } from "./MarkdownContent";
import { PlayIcon } from "../icons";

type NoteFormat = { label: string; glyph: string; kind: string; run: (state: EditorState) => TransactionSpec };
// Text glyphs, like the selection bar in MarkdownLiveEditor: each shows what it applies.
const NOTE_FORMATS: NoteFormat[][] = [
  [
    { label: "Heading", glyph: "H", kind: "heading", run: (s) => toggleLines(s, "heading") },
    { label: "Bold (Ctrl+B)", glyph: "B", kind: "bold", run: (s) => formatSelection(s, "bold") },
    { label: "Italic (Ctrl+I)", glyph: "I", kind: "italic", run: (s) => formatSelection(s, "italic") },
  ],
  [
    { label: "Numbered list", glyph: "1.", kind: "numbered", run: (s) => toggleLines(s, "numbered") },
    { label: "Bulleted list", glyph: "•", kind: "bullet", run: (s) => toggleLines(s, "bullet") },
    { label: "Quote", glyph: "“", kind: "quote", run: (s) => toggleLines(s, "quote") },
  ],
  [
    { label: "Code (Ctrl+E)", glyph: "</>", kind: "code", run: (s) => formatSelection(s, "code") },
    { label: "Link", glyph: "Link", kind: "link", run: insertLink },
  ],
];

// Storage can be blocked (private mode, full quota): notes still work for the page.
function readNote(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeNote(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function EditorNotes({
  slug,
  storageKey,
}: {
  slug: string;
  storageKey: string;
}) {
  const [value, setValue] = useState(() => readNote(storageKey) ?? "");
  const latest = useRef(value);
  const edited = useRef(false);
  const pending = useRef<ReturnType<typeof setTimeout>>();
  const chain = useRef(Promise.resolve());
  const account = scopeKey("notes");
  const [preview, setPreview] = useState(false);
  const view = useRef<EditorView | null>(null);
  function format(run: NoteFormat["run"]) {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch(run(editor.state), { scrollIntoView: true, userEvent: "input.format" });
    editor.focus();
  }
  const [saveStatus, setSaveStatus] = useState("Private notes");
  useEffect(() => {
    let live = true;
    if (!readNote(storageKey) && !isGuestSession()) {
      fetchLCNotes(slug)
        .then((note) => {
          if (live && !edited.current && note) {
            writeNote(storageKey, note);
            latest.current = note;
            setValue(note);
          }
        })
        .catch(() => {
          if (live) toast.error("Could not load saved notes");
        });
    }
    return () => {
      live = false;
    };
  }, [slug, storageKey]);
  function change(next: string) {
    edited.current = true;
    latest.current = next;
    setValue(next);
    const saved = writeNote(storageKey, next);
    setSaveStatus(saved ? "Saved on this device" : "Device storage unavailable");
    clearTimeout(pending.current);
    if (!isGuestSession()) {
      setSaveStatus("Saving...");
      pending.current = setTimeout(() => {
        chain.current = chain.current
          .then(() => {
            if (scopeKey("notes") === account) {
              const snapshot = latest.current;
              return syncLCNotes(slug, snapshot).then(() => {
                if (latest.current === snapshot) setSaveStatus("Saved");
              });
            }
          })
          .catch(() => {
            setSaveStatus(saved ? "Saved on this device. Sync unavailable" : "Could not save notes");
            toast.error(
              saved ? "Notes saved on this device" : "Could not save notes",
              saved ? "Could not sync to your account." : "Keep this page open and copy your notes before leaving.",
            );
          });
      }, 600);
    }
  }
  return (
    <div className="lc-editor-notes">
      <div className="lc-notes-toolbar">
        <div className="lc-notes-format" role="toolbar" aria-label="Format notes">
          {NOTE_FORMATS.map((group, index) => (
            <div key={index} className="lc-notes-format-group">
              {group.map((item) => (
                <button
                  key={item.kind}
                  type="button"
                  className={"lc-notes-fmt is-" + item.kind}
                  title={item.label}
                  aria-label={item.label}
                  disabled={preview}
                  // Keep the editor's selection: the press never takes focus.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => format(item.run)}
                >
                  {item.glyph}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="lc-notes-mode" role="group" aria-label="Notes view">
          <button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>Write</button>
          <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>Preview</button>
        </div>
      </div>
      {preview ? <div className="lc-notes-preview">{value.trim() ? <MarkdownContent content={value} /> : <p className="muted">Your notes will appear here.</p>}</div> : (
    <MarkdownLiveEditor
      label="Problem notes"
      placeholder="Write your approach, observations, and edge cases. Markdown is supported."
      value={value}
      onChange={change}
      viewRef={view}
    />
      )}
      <div className="lc-code-status">
        <span role="status">{saveStatus}</span>
        <span>Markdown</span>
      </div>
    </div>
  );
}
const VERDICT_LABEL: Record<WalkApproach["verdict"], string> = {
  optimal: "Optimal",
  works: "Works",
  "too slow": "Too slow",
  fails: "Fails",
};
export function EditorSolutions({
  slug,
  title,
  statement,
  starterCode,
  provider,
  onReveal,
  onWatch,
  custom,
}: {
  slug: string;
  title: string;
  statement: string;
  starterCode: string;
  provider: string;
  onReveal: () => void;
  onWatch: () => void;
  custom: boolean;
}) {
  const [data, setData] = useState<SolutionWalkthroughResponse | null>(null);
  const [busy, setBusy] = useState(false);
  async function reveal() {
    setBusy(true);
    onReveal();
    try {
      setData(
        await fetchSolutionWalkthrough(slug, {
          title,
          statement,
          starterCode,
          provider,
        }),
      );
    } catch {
      toast.error("Could not open the approaches", "Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }
  const approaches = data?.walkthrough.approaches ?? [];
  return (
    <div className="lc-sol">
      <div className="lc-sol-head">
        <h3>Approaches</h3>
        <div className="lc-sol-actions">
          {data ? (
            <Button variant="ghost" className="lc-sol-action" icon={<PlayIcon size={13} />} onClick={onWatch}>
              Watch Kojo solve it
            </Button>
          ) : null}
          {!custom && (
            <a
              className="lc-sol-action lc-sol-link"
              href={
                "https://www.youtube.com/results?search_query=neetcode+" +
                encodeURIComponent(title)
              }
              target="_blank"
              rel="noreferrer"
            >
              NeetCode video
            </a>
          )}
        </div>
      </div>
      {busy ? (
        <LoadingNotice
          title="Kojo is laying out the approaches"
          estimate="Reading the problem and comparing approaches"
        />
      ) : !data ? (
        <div className="lc-sol-intro">
          <p className="muted">
            Kojo walks through each approach, from the first one that works to the
            best one, with its time and space.
          </p>
          <div className="button-row">
            <Button onClick={reveal}>Show approaches</Button>
            <Button variant="secondary" onClick={onWatch}>
              <PlayIcon size={15} /> Watch Kojo solve it
            </Button>
          </div>
        </div>
      ) : (
        <>
          <ol className="lc-sol-list">
            {approaches.map((a, i) => (
              <li key={a.name + i}>
                <CollapsibleSection
                  className={"lc-sol-item lc-sol-item--" + a.verdict.replace(" ", "-")}
                  title={`${i + 1}. ${a.name}`}
                  defaultOpen={a.verdict === "optimal"}
                  meta={
                    <>
                      <span className="lc-sol-verdict">{VERDICT_LABEL[a.verdict]}</span>
                      <span className="lc-sol-cx">{a.time}</span>
                    </>
                  }
                >
                  <p>{a.idea}</p>
                  <p className="muted">{a.why}</p>
                  <dl className="lc-sol-stats">
                    <div>
                      <dt>Time</dt>
                      <dd>{a.time}</dd>
                    </div>
                    <div>
                      <dt>Space</dt>
                      <dd>{a.space}</dd>
                    </div>
                  </dl>
                  {a.verdict === "optimal" && data?.solution_code ? (
                    <MarkdownContent content={"```python\n" + data.solution_code.trimEnd() + "\n```"} />
                  ) : null}
                </CollapsibleSection>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
