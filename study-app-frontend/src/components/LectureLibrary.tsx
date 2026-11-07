import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { PlayIcon } from "../icons";
import { fetchLectures, requestLecture } from "../lib/api";
import type { LectureListResponse, LectureSummary } from "../lib/types";
import { KojoLecture } from "./KojoWalkthrough";
import "../styles/components/lecture-library.css";

// KojoCode "Lectures" tab: Kojo videos that teach a DSA pattern (theory, how to spot
// it, a template, a worked problem). Lectures are shared by everyone and written by an
// admin's MCP connector; users can request topics that are missing.

type Props = {
  /** Category id -> label, in KojoCode's order. */
  categoryLabels: Map<string, string>;
  onTryProblem: (problemSlug: string) => void;
  initialLecture?: string | null;
};

export function LectureLibrary({ categoryLabels, onTryProblem, initialLecture }: Props) {
  const [data, setData] = useState<LectureListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(initialLecture ?? null);
  const [topic, setTopic] = useState("");
  const [sending, setSending] = useState(false);
  const [requestMsg, setRequestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchLectures()
      .then((res) => !cancelled && setData(res))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load lectures."));
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const groups = useMemo(() => {
    const by = new Map<string, LectureSummary[]>();
    for (const l of data?.lectures ?? []) by.set(l.category, [...(by.get(l.category) ?? []), l]);
    const order = [...categoryLabels.keys()];
    return [...by.entries()].sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
  }, [data, categoryLabels]);

  const readyCount = data?.lectures.filter((l) => l.ready).length ?? 0;
  const pending = data?.requests.filter((r) => r.status === "pending") ?? [];

  async function submit(e: FormEvent) {
    e.preventDefault();
    const text = topic.trim();
    if (text.length < 2 || sending) return;
    setSending(true);
    setRequestMsg(null);
    try {
      await requestLecture(text);
      setTopic("");
      setRequestMsg({ ok: true, text: `Requested "${text}". It shows up here once Kojo has recorded it.` });
      setReload((n) => n + 1);
    } catch (err) {
      setRequestMsg({ ok: false, text: err instanceof Error ? err.message : "Couldn't send the request." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="lec-library">
      <form className="lec-request" onSubmit={submit}>
        <div>
          <strong>Missing a topic?</strong>
          <p className="muted small">
            Ask Kojo for a lecture on any DSA pattern (segment trees, KMP, Kruskal...).{" "}
            {data ? `${data.requests_left_today} request${data.requests_left_today === 1 ? "" : "s"} left today.` : null}
          </p>
        </div>
        <div className="lec-request-row">
          <input
            className="lec-request-input"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Segment tree"
            maxLength={120}
            aria-label="Topic to request"
          />
          <button type="submit" className="button button-primary" disabled={sending || topic.trim().length < 2 || data?.requests_left_today === 0}>
            {sending ? <Loader2 size={15} className="spin" /> : null} Request
          </button>
        </div>
        {requestMsg ? <p className={`small ${requestMsg.ok ? "muted" : "lec-error"}`}>{requestMsg.text}</p> : null}
        {pending.length ? (
          <div className="lec-pending">
            {pending.map((r) => (
              <span key={r.id} className="pill">
                {r.topic}: coming soon
              </span>
            ))}
          </div>
        ) : null}
      </form>

      {error ? <p className="lec-error">{error}</p> : null}
      {!data && !error ? (
        <p className="muted">
          <Loader2 size={16} className="spin" /> Loading lectures...
        </p>
      ) : null}
      {data ? (
        <p className="muted small">
          {readyCount} of {data.lectures.length} lectures recorded.
        </p>
      ) : null}

      {groups.map(([category, lectures]) => (
        <section key={category} className="lec-group">
          <h2>{categoryLabels.get(category) ?? category}</h2>
          <div className="lec-grid">
            {lectures.map((l) => (
              <article key={l.slug} className={`lec-card${l.ready ? "" : " is-soon"}`}>
                <div className="lec-card-head">
                  <strong>{l.title}</strong>
                  {l.source === "community" ? <span className="lec-tag">Community</span> : null}
                </div>
                {l.summary ? <p className="lec-summary">{l.summary}</p> : null}
                <p className="lec-worked small muted">Worked problem: {l.problem_title}</p>
                {l.ready ? (
                  <button type="button" className="lec-play" onClick={() => setOpen(l.slug)}>
                    <PlayIcon size={14} /> Watch
                  </button>
                ) : (
                  <span className="lec-soon small">Coming soon</span>
                )}
              </article>
            ))}
          </div>
        </section>
      ))}

      {open ? (
        <KojoLecture
          slug={open}
          onClose={() => setOpen(null)}
          onTryProblem={(slug) => {
            setOpen(null);
            onTryProblem(slug);
          }}
        />
      ) : null}
    </div>
  );
}
