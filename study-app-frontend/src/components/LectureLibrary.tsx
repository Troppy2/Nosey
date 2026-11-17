import { useEffect, useId, useState, type FormEvent } from "react";
import { ArrowRightIcon, CloseIcon, LectureIcon, PlayIcon, SearchIcon } from "../icons";
import { fetchLectures, requestLecture } from "../lib/api";
import { toast } from "../lib/toast";
import type { LectureListResponse, LectureSummary } from "../lib/types";
import { Button } from "./Button";
import { Dropdown } from "./Dropdown";
import { EmptyState } from "./EmptyState";
import { TextInput } from "./Field";
import { KojoLecture } from "./KojoWalkthrough";
import { Spinner } from "./Loaders";
import { SkeletonList } from "./Skeletons";
import "../styles/components/lecture-library.css";

type Props = {
  categoryLabels: Map<string, string>;
  onTryProblem: (problemSlug: string) => void;
  initialLecture?: string | null;
};

export function LectureLibrary({ categoryLabels, onTryProblem, initialLecture }: Props) {
  const [data, setData] = useState<LectureListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(initialLecture ?? null);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(initialLecture ?? null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [showRequest, setShowRequest] = useState(false);
  const [topic, setTopic] = useState("");
  const [sending, setSending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const requestId = useId();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchLectures()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load lectures.");
      });
    return () => { cancelled = true; };
  }, [reload]);

  const grouped = new Map<string, LectureSummary[]>();
  for (const lecture of data?.lectures ?? []) {
    const entries = grouped.get(lecture.category) ?? [];
    entries.push(lecture);
    grouped.set(lecture.category, entries);
  }
  const categoryOrder = [...categoryLabels.keys()];
  const groups = [...grouped.entries()].sort(([a], [b]) => {
    const ai = categoryOrder.indexOf(a);
    const bi = categoryOrder.indexOf(b);
    return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
  });
  const search = query.trim().toLowerCase();
  const visibleGroups = groups
    .filter(([key]) => !category || key === category)
    .map(([key, lectures]) => [key, lectures.filter((lecture) =>
      [lecture.title, lecture.summary, lecture.problem_title, categoryLabels.get(key) ?? key]
        .some((text) => text.toLowerCase().includes(search))
    )] as const)
    .filter(([, lectures]) => lectures.length > 0);
  const visible = visibleGroups.flatMap(([, lectures]) => lectures);
  const selected = visible.find((lecture) => lecture.slug === selectedSlug)
    ?? visible.find((lecture) => lecture.ready)
    ?? visible[0];
  const pending = data?.requests.filter((request) => request.status === "pending") ?? [];
  const requestsExhausted = data?.requests_left_today === 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = topic.trim();
    if (text.length < 2 || sending || !data || requestsExhausted) return;
    setSending(true);
    setRequestError(null);
    try {
      await requestLecture(text);
      setTopic("");
      toast.success("Lecture requested", "Your topic will appear here once Kojo has recorded it.");
      setData((current) => current ? {
        ...current,
        requests_left_today: Math.max(0, current.requests_left_today - 1),
      } : current);
      setReload((count) => count + 1);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Couldn't send the request.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="lec-library">
      <div className="lec-toolbar">
        <div className="lec-search">
          <SearchIcon size={18} />
          <TextInput
            label="Search lectures"
            id="lecture-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search lectures"
          />
        </div>
        <Dropdown
          label="Filter lectures by topic"
          bare
          value={category}
          options={[
            { value: "", label: "All topics" },
            ...groups.map(([key]) => ({ value: key, label: categoryLabels.get(key) ?? key })),
          ]}
          onChange={setCategory}
          className="input lec-topic-filter"
        />
        <Button
          variant="secondary"
          aria-expanded={showRequest}
          aria-controls={requestId}
          onClick={() => setShowRequest((shown) => !shown)}
        >
          Request a topic
        </Button>
      </div>

      {showRequest ? (
        <form id={requestId} className="lec-request" onSubmit={submit}>
          <div className="lec-request-heading">
            <div>
              <h2>Request a lecture</h2>
              <p className="muted small">
                {requestsExhausted
                  ? "You've used today's requests. Try again tomorrow."
                  : data ? `${data.requests_left_today} requests left today.` : "Choose a DSA topic you'd like Kojo to cover."}
              </p>
            </div>
            <Button variant="ghost" aria-label="Close topic request" onClick={() => setShowRequest(false)} icon={<CloseIcon size={18} />} />
          </div>
          <div className="lec-request-row">
            <TextInput
              label="Topic"
              id="lecture-request-topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="e.g. Segment trees"
              maxLength={120}
              disabled={sending || requestsExhausted}
              autoFocus
            />
            <Button type="submit" disabled={sending || topic.trim().length < 2 || !data || requestsExhausted}>
              {sending ? <Spinner size="xs" label="Sending request" /> : "Request"}
            </Button>
          </div>
          {requestError ? <p role="alert" className="lec-error">{requestError}</p> : null}
          {pending.length > 0 ? (
            <p className="lec-pending">Requested: {pending.map((request) => request.topic).join(", ")}</p>
          ) : null}
        </form>
      ) : null}

      {error ? (
        <div className="lec-load-error" role="alert">
          <p className="lec-error">{error}</p>
          <Button variant="secondary" onClick={() => setReload((count) => count + 1)}>Retry</Button>
        </div>
      ) : null}
      {!data && !error ? <SkeletonList rows={6} label="Loading lectures" /> : null}
      {data && visible.length === 0 ? (
        <EmptyState
          icon={<LectureIcon size={28} />}
          title={data.lectures.length ? "No matching lectures" : "Lectures are on the way"}
          body={data.lectures.length ? "Try another title, problem or topic." : "Request a topic you'd like Kojo to teach."}
          action={data.lectures.length ? (
            <Button variant="secondary" onClick={() => { setQuery(""); setCategory(""); }}>Clear filters</Button>
          ) : (
            <Button variant="secondary" onClick={() => setShowRequest(true)}>Request a topic</Button>
          )}
        />
      ) : null}

      {selected ? (
        <div className="lec-workspace">
          <div className="lec-playlists">
            {visibleGroups.map(([key, lectures]) => (
              <section key={key} className="lec-group" aria-label={categoryLabels.get(key) ?? key}>
                <div className="lec-group-heading">
                  <h2>{categoryLabels.get(key) ?? key}</h2>
                  <span>{lectures.length} {lectures.length === 1 ? "lecture" : "lectures"}</span>
                </div>
                <ol className="lec-tracks">
                  {lectures.map((lecture, index) => (
                    <li key={lecture.slug}>
                      <button
                        type="button"
                        className={`lec-track${selected.slug === lecture.slug ? " is-selected" : ""}${lecture.ready ? "" : " is-soon"}`}
                        aria-pressed={selected.slug === lecture.slug}
                        onClick={() => setSelectedSlug(lecture.slug)}
                      >
                        <span className="lec-track-number" aria-hidden="true">
                          {selected.slug === lecture.slug && lecture.ready ? <PlayIcon size={16} /> : String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="lec-track-copy">
                          <span className="lec-track-title">{lecture.title}</span>
                          {lecture.problem_title ? <span className="lec-worked">Worked problem: {lecture.problem_title}</span> : null}
                          {lecture.source === "community" ? <span className="lec-community">Community</span> : null}
                        </span>
                        <span className="lec-track-status">{lecture.ready ? "Ready" : "Coming soon"}</span>
                      </button>
                      {selected.slug === lecture.slug && lecture.ready ? (
                        <div className="lec-track-action">
                          <Button icon={<PlayIcon size={16} />} aria-label={`Play ${lecture.title}`} onClick={() => setOpen(lecture.slug)}>
                            Watch lecture
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>

          <aside className="lec-detail" aria-label="Selected lecture">
            <div className="lec-cover" aria-hidden="true">
              <LectureIcon size={64} />
              <span>{categoryLabels.get(selected.category) ?? selected.category}</span>
            </div>
            <div className="lec-detail-copy">
              <p className="lec-detail-category">{categoryLabels.get(selected.category) ?? selected.category}</p>
              <h2>{selected.title}</h2>
              {selected.summary ? <p className="lec-detail-summary">{selected.summary}</p> : null}
              <Button
                fullWidth
                icon={<PlayIcon size={17} />}
                disabled={!selected.ready}
                onClick={() => setOpen(selected.slug)}
              >
                {selected.ready ? "Watch lecture" : "Coming soon"}
              </Button>
              {selected.ready && selected.problem_slug ? (
                <Button variant="ghost" className="lec-try-problem" onClick={() => onTryProblem(selected.problem_slug)} icon={<ArrowRightIcon size={16} />}>
                  Try the worked problem
                </Button>
              ) : null}
              {!selected.ready ? <p className="lec-detail-note">This lecture will be available once Kojo has recorded it.</p> : null}
              <div className="lec-contents">
                <h3>In this lecture</h3>
                <ul>
                  <li>The core idea</li>
                  <li>When to use it</li>
                  <li>A reusable template</li>
                  <li>{selected.problem_title || "A worked example"}</li>
                </ul>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

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
