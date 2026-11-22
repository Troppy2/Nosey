import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowRightIcon, ChevronDownIcon, CloseIcon, LectureIcon, PlayIcon, SearchIcon } from "../icons";
import { fetchLectures, requestLecture, scopeKey } from "../lib/api";
import { toast } from "../lib/toast";
import type { LectureListResponse, LectureSummary } from "../lib/types";
import { Button } from "./Button";
import { CollapsibleSection } from "./CollapsibleSection";
import { Dropdown } from "./Dropdown";
import { EmptyState } from "./EmptyState";
import { TextInput } from "./Field";
import { FormError } from "./FormError";
import { KojoLecture } from "./KojoWalkthrough";
import { InlineLoading } from "./Loaders";
import { Skeleton, SkeletonList, SkeletonText } from "./Skeletons";
import "../styles/components/lecture-library.css";

type Props = {
  categoryLabels: Map<string, string>;
  onTryProblem: (problemSlug: string) => boolean | void;
  initialLecture?: string | null;
};

type BrowseState = {
  query: string;
  category: string;
  availability: "ready" | "all";
  selectedSlug: string | null;
};

const BROWSE_KEY = "nosey_lecture_browse";
const RETURN_SCROLL_KEY = "nosey_lecture_return_scroll";

function readBrowseState(initialLecture?: string | null): BrowseState {
  const defaults: BrowseState = { query: "", category: "", availability: "ready", selectedSlug: initialLecture ?? null };
  if (initialLecture) return { ...defaults, availability: "all" };
  try {
    const saved = JSON.parse(sessionStorage.getItem(scopeKey(BROWSE_KEY)) ?? "null") as Partial<BrowseState> | null;
    return {
      query: typeof saved?.query === "string" ? saved.query : "",
      category: typeof saved?.category === "string" ? saved.category : "",
      availability: saved?.availability === "all" ? "all" : "ready",
      selectedSlug: typeof saved?.selectedSlug === "string" ? saved.selectedSlug : null,
    };
  } catch {
    return defaults;
  }
}

function LectureDetails({ lecture, onWatch, onTryProblem, error }: {
  lecture: LectureSummary;
  onWatch: (slug: string) => void;
  onTryProblem: (slug: string) => void;
  error: string | null;
}) {
  return (
    <div className="lec-detail-copy">
      <h2>{lecture.title}</h2>
      {lecture.summary ? <p className="lec-detail-summary">{lecture.summary}</p> : null}
      {lecture.problem_title ? <div className="lec-example"><p>Worked example</p><strong>{lecture.problem_title}</strong></div> : null}
      {lecture.ready ? (
        <div className="lec-lecture-actions">
          <Button icon={<PlayIcon size={16} />} onClick={() => onWatch(lecture.slug)}>Watch lecture</Button>
          {lecture.problem_slug ? <Button variant="secondary" onClick={() => onTryProblem(lecture.problem_slug)} icon={<ArrowRightIcon size={16} />}>Try worked problem</Button> : null}
        </div>
      ) : <p className="lec-detail-note">This lecture is being prepared. Check back for the recording.</p>}
      {error ? <p role="alert" className="lec-error">{error}</p> : null}
      {lecture.source === "community" ? <p className="lec-provenance">Community-requested lecture</p> : null}
    </div>
  );
}

export function LectureLibrary({ categoryLabels, onTryProblem, initialLecture }: Props) {
  const [data, setData] = useState<LectureListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(initialLecture ?? null);
  const [browse, setBrowse] = useState(() => readBrowseState(initialLecture));
  const [showRequest, setShowRequest] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [topic, setTopic] = useState("");
  const [sending, setSending] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const requestTrigger = useRef<HTMLDivElement>(null);
  const requestHistory = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const restoredScroll = useRef(false);
  const requestInFlight = useRef(false);
  const id = useId();
  const requestId = id + "-request";
  const requestErrorId = id + "-request-error";

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchLectures()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load lectures.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reload]);

  useEffect(() => {
    try {
      sessionStorage.setItem(scopeKey(BROWSE_KEY), JSON.stringify(browse));
    } catch { /* Browsing still works when storage is unavailable. */ }
  }, [browse]);

  useEffect(() => {
    if (!data || restoredScroll.current) return;
    let position: string | null = null;
    try {
      position = sessionStorage.getItem(scopeKey(RETURN_SCROLL_KEY));
      sessionStorage.removeItem(scopeKey(RETURN_SCROLL_KEY));
    } catch { /* Scroll restoration is optional. */ }
    restoredScroll.current = true;
    if (position === null || !Number.isFinite(Number(position))) return;
    const frame = requestAnimationFrame(() => {
      rowButtons.current.get(browse.selectedSlug ?? "")?.focus({ preventScroll: true });
      window.scrollTo({ top: Math.max(0, Number(position)), behavior: "instant" });
    });
    return () => cancelAnimationFrame(frame);
  }, [data, browse.selectedSlug]);

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
    return (ai < 0 ? categoryOrder.length : ai) - (bi < 0 ? categoryOrder.length : bi);
  });
  const search = browse.query.trim().toLowerCase();
  const matchingGroups = groups
    .filter(([key]) => !browse.category || key === browse.category)
    .map(([key, lectures]) => [key, lectures
      .filter((lecture) => [lecture.title, lecture.summary, lecture.problem_title, categoryLabels.get(key) ?? key]
          .some((text) => text.toLowerCase().includes(search)))
      .sort((a, b) => Number(b.ready) - Number(a.ready))] as const)
    .filter(([, lectures]) => lectures.length > 0);
  const visibleGroups = matchingGroups
    .map(([key, lectures]) => [key, lectures.filter((lecture) => browse.availability === "all" || lecture.ready)] as const)
    .filter(([, lectures]) => lectures.length > 0);
  const visibleCount = visibleGroups.reduce((count, [, lectures]) => count + lectures.length, 0);
  const visibleLectures = visibleGroups.flatMap(([, lectures]) => lectures);
  const selected = visibleLectures.find((lecture) => lecture.slug === browse.selectedSlug)
    ?? visibleLectures.find((lecture) => lecture.ready)
    ?? visibleLectures[0];
  const matchingLectures = matchingGroups.flatMap(([, lectures]) => lectures);
  const readyCount = matchingLectures.filter((lecture) => lecture.ready).length;
  const hasSearch = Boolean(search || browse.category);
  const requestsExhausted = data?.requests_left_today === 0;
  const pendingCount = data?.requests.filter((request) => request.status === "pending").length ?? 0;

  function openRequests() {
    setShowRequests(true);
    requestAnimationFrame(() => {
      requestHistory.current?.scrollIntoView({ block: "center", behavior: "instant" });
      requestHistory.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    });
  }

  function closeRequest() {
    setShowRequest(false);
    requestTrigger.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }

  function watchLecture(slug: string) {
    setPracticeError(null);
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(slug);
  }

  function closeLecture() {
    setOpen(null);
    requestAnimationFrame(() => {
      const target = returnFocus.current?.isConnected
        ? returnFocus.current
        : rowButtons.current.get(open ?? "");
      target?.focus({ preventScroll: true });
    });
  }

  function tryProblem(slug: string) {
    try {
      sessionStorage.setItem(scopeKey(RETURN_SCROLL_KEY), String(window.scrollY));
    } catch { /* Navigation does not depend on storage. */ }
    if (onTryProblem(slug) === false) {
      setPracticeError("This worked problem isn't available in your problem library yet.");
      return false;
    }
    setOpen(null);
    return true;
  }

  function showRequestedLecture(slug: string) {
    setBrowse({ query: "", category: "", availability: "all", selectedSlug: slug });
    requestAnimationFrame(() => {
      const row = rowButtons.current.get(slug);
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "center", behavior: "instant" });
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const text = topic.trim();
    if (text.length < 2 || requestInFlight.current || !data || requestsExhausted) return;
    requestInFlight.current = true;
    setSending(true);
    setRequestError(null);
    try {
      const request = await requestLecture(text);
      setTopic("");
      setData((current) => current ? {
        ...current,
        requests: [request, ...current.requests.filter((entry) => entry.id !== request.id)],
        requests_left_today: Math.max(0, current.requests_left_today - 1),
      } : current);
      toast.success("Lecture requested", "You can follow its status in Your requests.", { label: "View requests", onClick: openRequests });
      setReload((count) => count + 1);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : "Couldn't send the request.");
    } finally {
      requestInFlight.current = false;
      setSending(false);
    }
  }

  return (
    <div className="lec-library">
      <header className="lec-header">
        <div>
          <h1>Lectures</h1>
          <p className="lec-subtitle">Patterns, Python templates and worked examples.</p>
        </div>
        <div className="lec-request-entry" ref={requestTrigger}>
          <Button
            variant="secondary"
            aria-expanded={showRequest}
            aria-controls={showRequest ? requestId : undefined}
            onClick={() => showRequest ? closeRequest() : setShowRequest(true)}
          >
            Request a lecture
          </Button>
          {data && data.requests.length > 0 ? <Button variant="ghost" className="lec-history-link" onClick={openRequests}>Your requests{pendingCount ? ` (${pendingCount} pending)` : ""}</Button> : null}
        </div>
      </header>

      {showRequest ? (
        <form
          id={requestId}
          className="lec-request"
          aria-label="Request a lecture"
          onSubmit={submit}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closeRequest();
            }
          }}
        >
          <div className="lec-request-heading">
            <div>
              <h2>What would you like to learn?</h2>
              <p className="lec-request-expectation">Suggest a topic for a future lecture. It will appear here once it has been recorded.</p>
              <p className="lec-request-hint">
                {requestsExhausted
                  ? "No requests left. More become available within 24 hours."
                  : data ? `${data.requests_left_today} ${data.requests_left_today === 1 ? "request" : "requests"} available.` : "Your request allowance is loading."}
              </p>
            </div>
            <Button variant="ghost" aria-label="Close lecture request" onClick={closeRequest} icon={<CloseIcon size={18} />} />
          </div>
          <div className="lec-request-row">
            <TextInput
              label="Topic"
              id={id + "-topic"}
              value={topic}
              onChange={(event) => { setTopic(event.target.value); setRequestError(null); }}
              placeholder="e.g. Segment trees"
              maxLength={120}
              disabled={sending}
              aria-invalid={Boolean(requestError)}
              aria-describedby={requestError ? requestErrorId : undefined}
              autoFocus
            />
            <Button type="submit" disabled={sending || topic.trim().length < 2 || !data || requestsExhausted}>
              {sending ? <InlineLoading label="Sending request" /> : "Send request"}
            </Button>
          </div>
          {requestError ? <div id={requestErrorId} role="alert"><FormError message={requestError} /></div> : null}
        </form>
      ) : null}

      <div className="lec-browse">
        <div className="lec-toolbar">
          <div className="lec-search">
            <SearchIcon size={18} />
            <TextInput
              label="Search lectures"
              id={id + "-search"}
              type="search"
              value={browse.query}
              onChange={(event) => setBrowse((current) => ({ ...current, query: event.target.value }))}
              placeholder="Search lectures or worked problems"
            />
          </div>
          <Dropdown
            label="Topic"
            bare
            value={browse.category}
            options={[
              { value: "", label: "All topics" },
              ...groups.map(([key]) => ({ value: key, label: categoryLabels.get(key) ?? key })),
            ]}
            onChange={(category) => setBrowse((current) => ({ ...current, category }))}
            disabled={!data}
            className="input lec-topic-filter"
          />
        </div>
        <div className="lec-filter-row">
          <div className="lec-availability" role="group" aria-label="Lecture availability">
            <Button
              variant="ghost"
              aria-pressed={browse.availability === "ready"}
              onClick={() => setBrowse((current) => ({ ...current, availability: "ready" }))}
            >
              Ready to watch{data ? ` (${readyCount})` : ""}
            </Button>
            <Button
              variant="ghost"
              aria-pressed={browse.availability === "all"}
              onClick={() => setBrowse((current) => ({ ...current, availability: "all" }))}
            >
              All lectures{data ? ` (${matchingLectures.length})` : ""}
            </Button>
          </div>
          {hasSearch && visibleCount > 0 ? <Button variant="ghost" className="lec-clear" onClick={() => setBrowse((current) => ({ ...current, query: "", category: "" }))}>Clear filters</Button> : null}
        </div>
        {data ? <p className="lec-result-count" role="status">{visibleCount} {visibleCount === 1 ? "lecture" : "lectures"}{hasSearch ? " matching your filters" : ""}</p> : null}
      </div>

      {error ? (
        <div className="lec-load-error" role="alert">
          <div>
            <p className="lec-error-title">{data ? "Lecture availability and requests couldn't refresh" : "Couldn't load lectures"}</p>
            <p className="lec-error">{error}</p>
          </div>
          <Button variant="secondary" disabled={loading} onClick={() => setReload((count) => count + 1)}>Try again</Button>
        </div>
      ) : null}
      {loading && data ? <div className="lec-refresh-status"><InlineLoading label="Refreshing lecture availability and requests" /></div> : null}
      {!data && loading ? (
        <div className="lec-workspace lec-loading">
          <SkeletonList rows={6} label="Loading lecture playlist" />
          <div className="lec-preview lec-loading-preview" aria-hidden="true">
            <Skeleton height="108px" width="100%" />
            <Skeleton height="24px" width="70%" />
            <SkeletonText lines={3} />
            <Skeleton height="44px" width="100%" />
          </div>
        </div>
      ) : null}

      {data && visibleCount === 0 ? (
        <EmptyState
          icon={<LectureIcon size={28} />}
          title={hasSearch ? "No matching lectures" : browse.availability === "ready" ? "Lectures are being prepared" : "Your lecture library starts here"}
          body={hasSearch ? matchingLectures.length > 0 ? "Matching lectures are coming soon. Check all lectures to see them." : "Try a different topic or worked problem." : "Request a topic you'd like Kojo to teach."}
          action={hasSearch && matchingLectures.length > 0 && browse.availability === "ready" ? (
            <Button variant="secondary" onClick={() => setBrowse((current) => ({ ...current, availability: "all" }))}>Check all lectures</Button>
          ) : hasSearch ? (
            <Button variant="secondary" onClick={() => setBrowse((current) => ({ ...current, query: "", category: "" }))}>Clear filters</Button>
          ) : data.lectures.length > 0 && browse.availability === "ready" ? (
            <Button variant="secondary" onClick={() => setBrowse((current) => ({ ...current, availability: "all" }))}>View upcoming lectures</Button>
          ) : (
            <Button variant="secondary" onClick={() => setShowRequest(true)}>Request a lecture</Button>
          )}
        />
      ) : null}

      <div className="lec-workspace">
      {selected ? (
        <aside className="lec-preview" aria-label="Selected lecture">
          <div className="lec-cover" aria-hidden="true"><LectureIcon size={56} /></div>
          <p className="lec-detail-category">{categoryLabels.get(selected.category) ?? selected.category}</p>
          <LectureDetails lecture={selected} onWatch={watchLecture} onTryProblem={tryProblem} error={practiceError} />
        </aside>
      ) : null}
      <div className="lec-playlists">
        {visibleGroups.map(([key, lectures]) => (
          <section key={key} className="lec-group" aria-label={categoryLabels.get(key) ?? key}>
            <div className="lec-group-heading">
              <h2>{categoryLabels.get(key) ?? key}</h2>
              {browse.availability === "all" ? <span>{lectures.filter((lecture) => lecture.ready).length} available</span> : null}
            </div>
            <ol className="lec-tracks">
              {lectures.map((lecture, index) => {
                const expanded = selected?.slug === lecture.slug;
                const detailId = id + "-detail-" + lecture.slug;
                return (
                  <li key={lecture.slug} className={expanded ? "lec-item is-expanded" : "lec-item"}>
                    <button
                      ref={(element) => {
                        if (element) rowButtons.current.set(lecture.slug, element);
                        else rowButtons.current.delete(lecture.slug);
                      }}
                      type="button"
                      className="lec-track"
                      aria-pressed={expanded}
                      aria-controls={expanded ? detailId : undefined}
                      onClick={() => {
                        setPracticeError(null);
                        setBrowse((current) => ({ ...current, selectedSlug: lecture.slug }));
                      }}
                    >
                      <span className="lec-track-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                      <span className="lec-track-copy">
                        <span className="lec-track-title">{lecture.title}</span>
                        {lecture.problem_title ? <span className="lec-worked">Worked example: {lecture.problem_title}</span> : null}
                      </span>
                      {!lecture.ready ? <span className="lec-track-status">Coming soon</span> : null}
                      <ChevronDownIcon size={18} className="lec-row-chevron" />
                    </button>
                    {lecture.ready ? <Button variant="ghost" className="lec-quickplay" aria-label={`Watch ${lecture.title}`} title={`Watch ${lecture.title}`} icon={<PlayIcon size={16} />} onClick={() => watchLecture(lecture.slug)} /> : null}
                    {expanded ? (
                      <div id={detailId} className="lec-track-detail" role="region" aria-label={lecture.title + " details"}>
                        <LectureDetails lecture={lecture} onWatch={watchLecture} onTryProblem={tryProblem} error={practiceError} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
      </div>

      {data && data.requests.length > 0 ? (
        <div className="lec-requests" ref={requestHistory}>
          <CollapsibleSection title={`Your requests (${data.requests.length})`} open={showRequests} onOpenChange={setShowRequests}>
            <ul className="lec-request-list">
              {data.requests.map((request) => {
                const lecture = data.lectures.find((entry) => entry.slug === request.lecture_slug);
                return (
                  <li key={request.id}>
                    <span className="lec-request-topic">{request.topic}</span>
                    <span className="lec-request-status">{request.status === "done" ? "Recorded" : request.status === "rejected" ? "Not added" : "Requested"}</span>
                    {request.status === "done" && lecture ? <Button variant="ghost" onClick={() => showRequestedLecture(lecture.slug)}>View lecture</Button> : null}
                  </li>
                );
              })}
            </ul>
          </CollapsibleSection>
        </div>
      ) : null}

      {open ? <KojoLecture key={open} slug={open} onClose={closeLecture} onTryProblem={tryProblem} /> : null}
    </div>
  );
}

