import { useEffect, useState, type ReactNode } from "react";
import { isGuestSession, listLCTestRuns } from "../lib/api";
import { toast } from "../lib/toast";
import type { LCTestRunSummary } from "../lib/types";
import { formatDuration, formatRuntime, loadSubmissions, matchSubmissions, parseServerTime, type SubmissionRecord } from "../lib/submissionLog";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { EditorRunResult, resultTitle } from "./EditorRunResult";
import KojoMascot from "./KojoMascot";
import { InlineLoading, LoadingNotice } from "./Loaders";
import { MarkdownContent } from "./MarkdownContent";
import { SkeletonList } from "./Skeletons";
import { ChevronLeftIcon, HistoryIcon } from "../icons";
import "../styles/components/editor-submissions.css";

const when = (time: number) =>
  new Date(time).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Submissions, LeetCode style: a submit opens its result here while Kojo grades it,
    and the history lists every submit with its runtime. */
export function EditorSubmissions({
  slug,
  revision,
  latestAt,
  running,
  grading,
  gradeError,
  extras,
}: {
  slug: string;
  revision: number;
  /** The submit made on this visit, opened automatically. */
  latestAt: string | null;
  /** A submit is running its test cases right now. */
  running: boolean;
  grading: boolean;
  gradeError: boolean;
  /** Follow-ups for the latest submit (difficulty question, drill offer, up next). */
  extras?: ReactNode;
}) {
  const [rows, setRows] = useState<LCTestRunSummary[] | null>(null);
  const [records, setRecords] = useState<SubmissionRecord[]>(() => loadSubmissions(slug));
  const [openAt, setOpenAt] = useState<string | null>(latestAt);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => setOpenAt(latestAt), [latestAt]);
  // Feedback lands in storage after grading, so re-read when grading finishes.
  useEffect(() => setRecords(loadSubmissions(slug)), [slug, revision, latestAt, grading]);
  useEffect(() => {
    let live = true;
    setError(false);
    if (!isGuestSession())
      listLCTestRuns(slug)
        .then((r) => live && setRows(r))
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

  if (running) return <InlineLoading label="Running your submission" />;
  const open = records.find((item) => item.at === openAt);
  if (open) {
    const latest = open.at === latestAt;
    const runtime = open.result.runtime_ms;
    return (
      <div className="lc-sub-detail">
        <Button variant="ghost" className="lc-sub-back" icon={<ChevronLeftIcon size={15} />} onClick={() => setOpenAt(null)}>
          All submissions
        </Button>
        <EditorRunResult
          result={open.result}
          kind="submit"
          aside={
            <dl className="lc-sub-stats">
              {runtime != null ? <div><dt>Runtime</dt><dd>{formatRuntime(runtime)}</dd></div> : null}
              {open.elapsedMs != null ? <div><dt>Time spent</dt><dd>{formatDuration(open.elapsedMs)}</dd></div> : null}
              <div><dt>Submitted</dt><dd>{when(Date.parse(open.at))}</dd></div>
            </dl>
          }
        />
        {latest && grading ? (
          <LoadingNotice
            compact
            title="Kojo is grading your submission"
            estimate="Reading your solution and checking the approach. About 15 seconds."
            slowNote="Still reading. A long solution takes Kojo longer to work through."
            slowAfterMs={18000}
          />
        ) : open.feedback ? (
          <section className="lc-grade-feedback lc-sub-feedback" aria-label="Kojo's feedback">
            <div className="lc-grade-feedback-header">
              <KojoMascot state="idle" />
              <span>Kojo's feedback</span>
            </div>
            <MarkdownContent content={open.feedback} />
          </section>
        ) : latest && gradeError ? (
          <p className="lc-feedback-note" role="status">Kojo feedback is unavailable right now. Submit again to retry.</p>
        ) : null}
        {latest ? extras : null}
      </div>
    );
  }

  if (isGuestSession()) return <p className="lc-feedback-note">Sign in to keep submission history.</p>;
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
        body="Submit your code and each result lands here with its runtime and Kojo's feedback."
      />
    );
  const matched = matchSubmissions(rows, records);
  return (
    <div className="lc-sub-history">
      {/* The follow-ups stay reachable after leaving the submission's detail. */}
      {latestAt ? <div className="lc-sub-extras">{extras}</div> : null}
      <div className="lc-sub-row lc-sub-row--head" aria-hidden="true">
        <span>Status</span>
        <span className="lc-sub-runtime">Runtime</span>
        <span>Submitted</span>
      </div>
      <ol className="lc-sub-list">
        {rows.map((row) => {
          const record = matched.get(row.id);
          const label = record ? resultTitle(record.result, "submit") : row.passed ? "Accepted" : "Wrong answer";
          const cells = (
            <>
              <span className={"lc-sub-status " + (row.passed ? "is-ok" : "is-bad")}>
                {label}
                {record?.result.cases?.length ? (
                  <small>
                    {record.result.cases.filter((item) => item.passed).length} / {record.result.cases.length} passed
                  </small>
                ) : null}
              </span>
              <span className="lc-sub-runtime">{record?.result.runtime_ms != null ? formatRuntime(record.result.runtime_ms) : "-"}</span>
              <time dateTime={row.run_at}>{when(parseServerTime(row.run_at))}</time>
            </>
          );
          return (
            <li key={row.id}>
              {record ? (
                <button type="button" className="lc-sub-row" onClick={() => setOpenAt(record.at)} aria-label={`${label}, ${when(parseServerTime(row.run_at))}. Open details`}>
                  {cells}
                </button>
              ) : (
                <div className="lc-sub-row">{cells}</div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
