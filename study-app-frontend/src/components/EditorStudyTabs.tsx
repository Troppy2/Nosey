import { useEffect, useRef, useState } from "react";
import {
  fetchLCNotes,
  syncLCNotes,
  fetchSolutionWalkthrough,
  listLCTestRuns,
  isGuestSession,
  scopeKey,
} from "../lib/api";
import { toast } from "../lib/toast";
import type {
  LCTestRunSummary,
  SolutionWalkthroughResponse,
  WalkApproach,
} from "../lib/types";
import "../styles/components/markdown-answer.css";
import MarkdownLiveEditor from "./MarkdownLiveEditor";
import { Button } from "./Button";
import { SkeletonList } from "./Skeletons";
import { LoadingNotice } from "./Loaders";
import { CollapsibleSection } from "./CollapsibleSection";
import { MarkdownContent } from "./MarkdownContent";
import { EmptyState } from "./EmptyState";
import { HistoryIcon, PlayIcon } from "../icons";

// Storage can be blocked (private mode, full quota): notes still work for the page.
function readNote(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeNote(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* kept in memory and synced to the account */
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
    writeNote(storageKey, next);
    clearTimeout(pending.current);
    if (!isGuestSession())
      pending.current = setTimeout(() => {
        chain.current = chain.current
          .then(() => {
            if (scopeKey("notes") === account) return syncLCNotes(slug, latest.current);
          })
          .catch(() => {
            toast.error(
              "Notes saved on this device",
              "Could not sync to your account.",
            );
          });
      }, 600);
  }
  return (
    <MarkdownLiveEditor
      label="Problem notes"
      placeholder="Write your approach or edge cases"
      value={value}
      onChange={change}
    />
  );
}
export function EditorSubmissions({
  slug,
  revision,
}: {
  slug: string;
  revision: number;
}) {
  const [rows, setRows] = useState<LCTestRunSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setError(false);
    setRows(null);
    if (!isGuestSession())
      listLCTestRuns(slug)
        .then((r) => {
          if (live) setRows(r);
        })
        .catch(() => {
          if (live) {
            setError(true);
            toast.error("Could not load submissions");
          }
        });
    return () => {
      live = false;
    };
  }, [slug, revision, retry]);
  if (isGuestSession()) return <p>Sign in to keep submission history.</p>;
  if (error)
    return (
      <Button variant="secondary" onClick={() => setRetry((r) => r + 1)}>
        Retry submissions
      </Button>
    );
  if (!rows) return <SkeletonList rows={3} label="Reading submissions" />;
  if (!rows.length)
    return (
      <EmptyState
        icon={<HistoryIcon size={22} />}
        title="No submissions yet"
        body="Submit your code and each result lands here with its time."
      />
    );
  return (
    <ol className="lc-run-history">
      {rows.map((row) => (
        <li key={row.id}>
          <strong className={row.passed ? "lc-run-ok" : "lc-run-bad"}>
            {row.passed ? "Accepted" : "Not accepted"}
          </strong>
          <time dateTime={row.run_at}>
            {new Date(row.run_at).toLocaleString()}
          </time>
        </li>
      ))}
    </ol>
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
        {!custom && (
          <a
            className="lc-sol-link"
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
          <Button variant="secondary" onClick={onWatch}>
            <PlayIcon size={15} /> Watch Kojo solve it
          </Button>
        </>
      )}
    </div>
  );
}
