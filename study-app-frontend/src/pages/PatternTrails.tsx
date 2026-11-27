import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { SkeletonTrailMap } from "../components/Skeletons";
import { TrailScene, type SceneStop } from "../components/trails/TrailScene";
import { YarnBall } from "../components/trails/YarnBall";
import { usePageTour } from "../components/tours/usePageTour";
import {
  AlertIcon,
  ArraysIcon,
  BinarySearchIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DpTableIcon,
  GraphIcon,
  HashTableIcon,
  SlidingWindowIcon,
  StackIcon,
  SummitIcon,
} from "../icons";
import { fetchTrailMap } from "../lib/api";
import type { PTMap, PTTopicSummary } from "../lib/types";
import { gateUrl } from "../lib/trailGate";
import { useMobileShell } from "../lib/useMobileShell";
import { gateStatus, initialTopic, percent, redoRunUrl, subtopicStatus, topicProgress } from "../lib/trailView";
import "../styles/pages/pattern-trails.css";

type IconComponent = typeof SlidingWindowIcon;

/** Land icons by the topic's icon_key (falls back to a progress number). */
const LAND_ICONS: Record<string, IconComponent> = {
  "sliding-window": SlidingWindowIcon,
  "two-pointers": ArraysIcon,
  arrays: ArraysIcon,
  "binary-search": BinarySearchIcon,
  "hash-table": HashTableIcon,
  stack: StackIcon,
  "monotonic-stack": StackIcon,
  graphs: GraphIcon,
  dp: DpTableIcon,
};

function LandGlyph({ topic, index, selected }: { topic: PTTopicSummary; index: number; selected: boolean }) {
  const Icon = topic.icon_key ? LAND_ICONS[topic.icon_key] : undefined;
  const progress = topicProgress(topic);
  return (
    <span className="pt-land-glyph">
      <svg className="pt-land-ring" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="17" className="pt-land-track" />
        <circle
          cx="20"
          cy="20"
          r="17"
          className="pt-land-fill"
          pathLength={100}
          strokeDasharray={`${Math.round(progress * 100)} 100`}
          transform="rotate(-90 20 20)"
        />
      </svg>
      {Icon ? <Icon size={22} active={selected} /> : <span>{index + 1}</span>}
    </span>
  );
}

function StepDots({ states }: { states: string[] }) {
  return (
    <span className="pt-dots" aria-hidden="true">
      {states.map((s, i) => (
        <i key={i} className={`pt-dot pt-dot--${s}`} />
      ))}
    </span>
  );
}

export default function PatternTrails() {
  const navigate = useNavigate();
  const mobile = useMobileShell();
  const [map, setMap] = useState<PTMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);

  usePageTour("pattern-trails", Boolean(map && map.topics.length));

  useEffect(() => {
    let live = true;
    setError(null);
    fetchTrailMap()
      .then((m) => {
        if (!live) return;
        setMap(m);
        setSelectedSlug((s) => s ?? initialTopic(m));
      })
      .catch((e: unknown) => live && setError(e instanceof Error ? e.message : "Could not load pattern trails."));
    return () => {
      live = false;
    };
  }, [attempt]);

  const topics = map?.topics ?? [];
  const selectedIndex = Math.max(0, topics.findIndex((t) => t.slug === selectedSlug));
  const topic = topics[selectedIndex] ?? null;
  const currentIndex = Math.max(0, topics.findIndex((t) => t.slug === map?.current_topic_slug));

  const stops: SceneStop[] = useMemo(() => {
    const lands: SceneStop[] = topics.map((t, i) => {
      const walked = Math.round(topicProgress(t) * 100);
      const recognition = t.stats.recognition;
      return {
        key: t.slug,
        kind: "land",
        short: t.title,
        status: t.finished && t.gate.cleared ? "Cleared" : walked > 0 ? `${walked}% walked` : "Unexplored",
        state: t.finished && t.gate.cleared ? "done" : i === currentIndex ? "current" : "open",
        glyph: <LandGlyph topic={t} index={i} selected={t.slug === selectedSlug} />,
        ariaLabel: `${t.title}, ${walked}% walked${recognition != null ? `, ${percent(recognition)} picked right` : ""}${t.stats.weak ? ", weak spot" : ""}`,
        storm: t.stats.weak ? `Weak spot, ${percent(recognition)} picked right` : null,
      };
    });
    const summit: SceneStop = {
      key: "summit",
      kind: "summit",
      short: "The summit",
      status: "Every land cleared",
      state: topics.length && topics.every((t) => t.gate.cleared) ? "done" : "locked",
      glyph: <SummitIcon size={24} />,
      ariaLabel: "The summit: clear every land's gate to reach it",
    };
    return [...lands, summit];
  }, [topics, currentIndex, selectedSlug]);

  if (error) {
    return (
      <div className="page pt-page">
        <EmptyState
          icon={<AlertIcon size={22} />}
          title="Pattern trails did not load"
          body={error}
          action={<Button onClick={() => setAttempt((n) => n + 1)}>Try again</Button>}
        />
      </div>
    );
  }
  if (!map) return <SkeletonTrailMap />;

  const redoUrl = redoRunUrl(map.redos_due);
  // "Walk with Kojo" goes to the first open path that is not finished yet.
  const nextPath = topic?.subtopics.find((s) => s.open && !s.finished) ?? null;
  const weakest = map.weakest;

  return (
    <div className="page pt-page pt-map-page">
      <Link to="/leetcode" className="pt-back">
        <ChevronLeftIcon size={16} /> KojoCode
      </Link>
      <div className="pt-map-head" data-tour="pt-map-title">
        <div>
          <h1>Pattern trails</h1>
          <p className="muted">Learn which technique a problem needs. Pick a land, walk its paths, catch the yarn.</p>
        </div>
        <div className="pt-count" aria-label={`${map.solved_total} solved on trails`}>
          <YarnBall size={30} />
          <span>
            <strong>{map.solved_total}</strong> solved on trails
          </span>
        </div>
      </div>
      {topics.length ? (
        <TrailScene
          stops={stops}
          orientation={mobile ? "vertical" : "horizontal"}
          variant="map"
          selected={selectedIndex}
          onSelect={(i) => i < topics.length && setSelectedSlug(topics[i].slug)}
          kojoAt={currentIndex}
          label="World map of pattern lands. Pick a land to see its paths."
        />
      ) : (
        <EmptyState icon={<SummitIcon size={22} />} title="No trails yet" body="Kojo is still laying out the first land. Check back soon." />
      )}
      {topic ? (
        <div className="pt-map-body">
          <section className="pt-panel pt-land" aria-labelledby="pt-land-title" data-tour="pt-land">
            <div className="pt-panel-head">
              <h2 id="pt-land-title">{topic.title}</h2>
              <span className="muted">
                {topic.subtopics.length} {topic.subtopics.length === 1 ? "path" : "paths"}
              </span>
            </div>
            <p className="muted">Walk the paths in order. Every step is one problem, and each pass adds one to your solved count.</p>
            <ol className="pt-paths">
              {topic.subtopics.map((s, i) => {
                const row = (
                  <>
                    <YarnBall size={34} dim={!s.finished} />
                    <span className="pt-path-text">
                      <b>{s.title}</b>
                      <span className="muted">{subtopicStatus(s, i, topic.subtopics)}</span>
                    </span>
                    <StepDots states={s.step_states} />
                  </>
                );
                return (
                  <li key={s.slug}>
                    {s.open ? (
                      <Link to={`/pattern-trails/${s.slug}`} className={`pt-path-row${s.finished ? " is-finished" : ""}`}>
                        {row}
                        <ChevronRightIcon size={18} className="pt-path-chev" />
                      </Link>
                    ) : (
                      <div className="pt-path-row is-locked" aria-disabled="true">
                        {row}
                      </div>
                    )}
                  </li>
                );
              })}
              <li>
                {(() => {
                  const gate = topic.gate;
                  const playable = gate.state === "open" || gate.state === "in_progress";
                  const className = `pt-path-row pt-gate-row is-${gate.cleared ? "cleared" : gate.state}`;
                  const row = (
                    <>
                      <span className="pt-gate-mark" aria-hidden="true">
                        ?
                      </span>
                      <span className="pt-path-text">
                        <b>{topic.title} gate</b>
                        <span>{gateStatus(gate)}</span>
                      </span>
                      <span className="pt-gate-need">
                        Need {gate.need} of {gate.size}
                      </span>
                    </>
                  );
                  return playable ? (
                    <Link to={gateUrl(topic.slug, gate.state === "in_progress" ? gate.attempt_id : null)} className={className}>
                      {row}
                      <ChevronRightIcon size={18} className="pt-path-chev" />
                    </Link>
                  ) : (
                    <div className={className} aria-disabled="true">
                      {row}
                    </div>
                  );
                })()}
              </li>
            </ol>
            {nextPath ? (
              <div className="pt-panel-actions">
                <Button onClick={() => navigate(`/pattern-trails/${nextPath.slug}`)}>Walk with Kojo</Button>
              </div>
            ) : null}
          </section>
          <aside className="pt-map-side">
            {map.redos_due.length || map.redos_waiting ? (
              <section className="pt-panel pt-redos" aria-labelledby="pt-redos-title" data-tour="pt-redos">
                <h2 id="pt-redos-title">
                  {map.redos_due.length
                    ? `${map.redos_due.length} ${map.redos_due.length === 1 ? "redo" : "redos"} due today`
                    : `${map.redos_waiting} ${map.redos_waiting === 1 ? "redo" : "redos"} waiting`}
                </h2>
                <p>
                  Problems you failed or took too long on come back after 1 day, 1 week and 3 weeks, on a timer.
                </p>
                {redoUrl ? (
                  <Button onClick={() => navigate(redoUrl)}>Start redos</Button>
                ) : (
                  <p className="muted">Nothing is due today.</p>
                )}
              </section>
            ) : null}
            <section className="pt-panel pt-stats" aria-labelledby="pt-stats-title">
              <h2 id="pt-stats-title">Spotting it vs solving it</h2>
              <div className="pt-stat-row">
                <div>
                  <strong>{percent(topic.stats.recognition)}</strong>
                  <span className="muted">Picked right in the gate</span>
                </div>
                <div>
                  <strong>{percent(topic.stats.solve_rate)}</strong>
                  <span className="muted">Solved on the first try</span>
                </div>
              </div>
              {weakest ? (
                <p>
                  Weak spot: <b>{weakest.pattern.title}</b>
                  {weakest.kind === "recognition"
                    ? `, ${percent(weakest.recognition)} picked right. You solve it when told, but miss it when it is unlabeled.`
                    : `, ${percent(weakest.solve_rate)} solved first try. Kojo brings these back as redos.`}
                </p>
              ) : topic.stats.recognition == null && topic.stats.solve_rate == null ? (
                <p className="muted">Your numbers show up after your first passes and the gate.</p>
              ) : null}
            </section>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
