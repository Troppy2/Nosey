import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { SkeletonTrailPath } from "../components/Skeletons";
import { TrailLesson } from "../components/trails/TrailLesson";
import { TrailScene, type SceneStop } from "../components/trails/TrailScene";
import { YarnBall } from "../components/trails/YarnBall";
import { usePageTour } from "../components/tours/usePageTour";
import { AlertIcon, CheckIcon, ChevronLeftIcon, PlayIcon } from "../icons";
import { fetchTrailPath, markTrailLessonWatched } from "../lib/api";
import { toast } from "../lib/toast";
import type { PTPath } from "../lib/types";
import { useMobileShell } from "../lib/useMobileShell";
import { dueIn, formatMinutes, kojoIndex, pathStops, readWalkState, stepEditorUrl, type PathStop } from "../lib/trailView";

const TAG: Record<PathStop["state"], string> = {
  done: "Done",
  current: "You are here",
  open: "Open",
  locked: "Locked",
};

function stopGlyph(stop: PathStop, index: number) {
  if (stop.kind === "yarn") return <YarnBall size={38} />;
  if (stop.kind === "lesson") return stop.state === "done" ? <CheckIcon size={20} /> : <PlayIcon size={18} />;
  return stop.state === "done" ? <CheckIcon size={20} /> : <span>{index}</span>;
}

function sceneStops(stops: PathStop[]): SceneStop[] {
  return stops.map((s, i) => ({
    key: s.key,
    kind: s.kind,
    short: s.short,
    status: s.status,
    state: s.state,
    glyph: stopGlyph(s, i),
    ariaLabel: `${s.title}. ${s.state === "locked" && s.lockedReason ? `Locked: ${s.lockedReason}` : s.status}${s.redo ? `. ${s.redo.label}` : ""}`,
    redo: s.redo,
  }));
}

export default function PatternTrailPath() {
  const { subtopicSlug = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const mobile = useMobileShell();
  const [path, setPath] = useState<PTPath | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [savingLesson, setSavingLesson] = useState(false);
  const [walk, setWalk] = useState<{ from: number; float: string | null } | null>(null);
  const [announce, setAnnounce] = useState("");

  usePageTour("pattern-trail-path", Boolean(path));

  useEffect(() => {
    let live = true;
    setError(null);
    fetchTrailPath(subtopicSlug)
      .then((p) => {
        if (!live) return;
        setPath(p);
        // Coming back from the editor after a pass: play the walk once, then
        // drop the router state so a refresh does not replay it.
        const handed = readWalkState(location.state);
        if (handed) {
          const to = kojoIndex(p);
          setWalk({ from: Math.max(0, to - 1), float: handed.solvedDelta > 0 ? `+${handed.solvedDelta} solved` : null });
          setSelected(to);
          navigate(location.pathname, { replace: true, state: null });
        }
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load this path."));
    return () => {
      live = false;
    };
    // location.state is read once per load on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtopicSlug, attempt]);

  const stops = useMemo(() => (path ? pathStops(path) : []), [path]);
  const kojoAt = path ? kojoIndex(path) : 0;
  const active = selected ?? kojoAt;
  const stop = stops[active];

  const onWalkEnd = useCallback(() => {
    if (!path) return;
    const here = stops[kojoIndex(path)];
    const line = path.finished
      ? "Kojo caught the yarn. Path finished."
      : `Kojo walked to ${here?.title ?? "the next step"}.`;
    setAnnounce(walk?.float ? `${walk.float}. ${line}` : line);
    setWalk(null);
  }, [path, stops, walk]);

  async function lessonDone() {
    if (!path || savingLesson) return;
    setSavingLesson(true);
    try {
      const next = await markTrailLessonWatched(path.slug);
      setLessonOpen(false);
      setPath(next);
      setSelected(1);
      setWalk({ from: 0, float: null });
      toast.success("Step 1 is open", "Kojo walks on each time you pass a step.");
    } catch (e) {
      toast.error("Could not save the lesson", e instanceof Error ? e.message : "Try again in a moment.");
    } finally {
      setSavingLesson(false);
    }
  }

  if (error) {
    return (
      <div className="page pt-page">
        <Link to="/pattern-trails" className="pt-back">
          <ChevronLeftIcon size={16} /> Pattern trails
        </Link>
        <EmptyState
          icon={<AlertIcon size={22} />}
          title="This path did not load"
          body={error}
          action={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
        />
      </div>
    );
  }
  if (!path) return <SkeletonTrailPath />;

  const step = stop?.kind === "step" ? path.steps.find((s) => s.id === stop.stepId) ?? null : null;
  const hasVideo = Boolean(path.lesson.lecture_slug);

  function action() {
    if (!path || !stop) return null;
    if (stop.kind === "lesson") {
      if (stop.state === "locked") return null;
      const again = stop.state === "done";
      return (
        <Button variant={again ? "secondary" : "primary"} onClick={() => setLessonOpen(true)}>
          {hasVideo ? (again ? "Watch again" : "Watch the lesson") : again ? "Read the notes again" : "Read Kojo's notes"}
        </Button>
      );
    }
    if (stop.kind === "step" && step) {
      if (stop.state === "current")
        return <Button onClick={() => navigate(stepEditorUrl(step.problem_slug, step.id, path.slug))}>Solve step {step.position}</Button>;
      if (stop.state === "done")
        return (
          <Button variant="secondary" onClick={() => navigate(stepEditorUrl(step.problem_slug, step.id, path.slug))}>
            Practice it again
          </Button>
        );
      return null;
    }
    if (stop.kind === "yarn" && path.finished) {
      return path.next_subtopic_slug ? (
        <Button onClick={() => navigate(`/pattern-trails/${path.next_subtopic_slug}`)}>Next path</Button>
      ) : (
        <Button onClick={() => navigate("/pattern-trails")}>Back to the map</Button>
      );
    }
    return null;
  }

  const solvedLine = `${path.solved_count} of ${path.steps.length} solved`;
  const questAction = action();

  return (
    <div className={`page pt-page pt-path-page${mobile && questAction ? " has-quest-bar" : ""}`}>
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <div className="pt-stage">
        <header className="pt-hud pt-hud--title" data-tour="pt-path-title">
          <Link to="/pattern-trails" className="pt-back">
            <ChevronLeftIcon size={16} /> Pattern trails
          </Link>
          <p className="pt-kicker">{path.topic_title}</p>
          <h1>{path.title}</h1>
          <p className="muted">Each step is one problem. Pass it and Kojo walks on.</p>
        </header>
        <div className="pt-hud pt-hud--count" aria-label={solvedLine}>
          <YarnBall size={34} />
          <div>
            <strong>{solvedLine}</strong>
            <span className="muted">Every step passed is +1</span>
          </div>
        </div>
        <TrailScene
          stops={sceneStops(stops)}
          orientation={mobile ? "vertical" : "horizontal"}
          variant="path"
          selected={active}
          onSelect={setSelected}
          kojoAt={kojoAt}
          walkFrom={walk?.from ?? null}
          onWalkEnd={onWalkEnd}
          floatLabel={walk?.float ?? null}
          label={`${path.title} path. Kojo is at ${stops[kojoAt]?.short ?? "the start"}.`}
        />
      </div>
      {stop ? (
        <section className={`pt-quest is-${stop.state}`} aria-labelledby="pt-quest-title" data-tour="pt-quest">
          <div className="pt-quest-head">
            <h2 id="pt-quest-title">{stop.title}</h2>
            <span className={`pt-tag pt-tag--${stop.state}`}>{TAG[stop.state]}</span>
          </div>
          <p className="muted">{stop.detail}</p>
          {stop.redo ? (
            <p className={`pt-quest-redo${stop.redo.due ? " is-due" : ""}`}>
              {stop.redo.due
                ? "A timed redo of this problem is due. Start it from the redos card on the map."
                : `A timed redo comes back ${step?.redo ? dueIn(step.redo.due_at) : "soon"}, with ${formatMinutes(step?.redo?.time_limit_s ?? 0)} on the clock.`}
            </p>
          ) : null}
          {mobile ? null : <div className="pt-quest-actions">{action()}</div>}
        </section>
      ) : null}
      {mobile && stop && questAction ? (
        // Phone: the selected stop's action stays in reach above the dock while
        // the tall trail scrolls.
        <div className="pt-quest-bar">
          <span className="pt-quest-bar-text">
            <b>{stop.short}</b>
            <span>{TAG[stop.state]}</span>
          </span>
          {questAction}
        </div>
      ) : null}
      {lessonOpen ? (
        <TrailLesson path={path} busy={savingLesson} onWatched={lessonDone} onClose={() => !savingLesson && setLessonOpen(false)} />
      ) : null}
    </div>
  );
}
