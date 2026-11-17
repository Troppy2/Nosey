import { useState, type ComponentType, type CSSProperties } from "react";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { CheckIcon, PlusIcon, SparklesIcon } from "../icons";
import "../styles/components/kojo-topic-grid.css";

// The KojoCode dashboard's topic cards. Visual language carried over from the
// skill tree preview (2026-11-08): each card is a leaf that fills from the
// bottom as its problems are solved and turns solid green when complete.

type TopicIcon = ComponentType<{ size?: number | string }>;

export type TopicState = "not-started" | "in-progress" | "complete";
export type TopicFilter = "all" | TopicState;

export type GridTopic = {
  id: string;
  label: string;
  icon: TopicIcon;
  done: number;
  total: number;
};

export type CustomTopic = {
  label: string;
  icon: TopicIcon;
  done: number;
  total: number;
  onOpen: () => void;
  onAdd: () => void;
};

export function topicState(done: number, total: number): TopicState {
  if (total > 0 && done >= total) return "complete";
  if (done > 0) return "in-progress";
  return "not-started";
}

const FILTERS: { id: TopicFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "in-progress", label: "In progress" },
  { id: "not-started", label: "Not started" },
  { id: "complete", label: "Complete" },
];

const EMPTY_COPY: Record<TopicState, { title: string; body: string }> = {
  "in-progress": { title: "Nothing in progress", body: "Solve a problem in any topic and it shows up here." },
  "not-started": { title: "Every topic is started", body: "You have solved at least one problem in each topic." },
  complete: { title: "No topics complete yet", body: "Solve every problem in a topic to fill its leaf." },
};

function TopicCard({
  label,
  icon: Icon,
  done,
  total,
  emptyText,
  onClick,
}: {
  label: string;
  icon: TopicIcon;
  done: number;
  total: number;
  emptyText?: string;
  onClick: () => void;
}) {
  const state = topicState(done, total);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const detail = total === 0 && emptyText ? emptyText : `${done} / ${total} complete`;
  return (
    <button
      type="button"
      className="lc-topic"
      data-state={state}
      style={{ "--lc-fill": `${pct}%` } as CSSProperties}
      onClick={onClick}
      aria-label={`${label}, ${detail}`}
    >
      <span className="lc-topic-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
      <span className="lc-topic-copy">
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
      {state === "complete" ? (
        <span className="lc-topic-check" aria-hidden="true">
          <CheckIcon size={16} />
        </span>
      ) : null}
    </button>
  );
}

export function KojoTopicGrid({
  topics,
  custom,
  onOpen,
}: {
  topics: GridTopic[];
  custom?: CustomTopic;
  onOpen: (topicId: string) => void;
}) {
  const [filter, setFilter] = useState<TopicFilter>("all");

  const withState = topics.map((topic) => ({ ...topic, state: topicState(topic.done, topic.total) }));
  const counts: Record<TopicFilter, number> = {
    all: withState.length,
    "not-started": withState.filter((topic) => topic.state === "not-started").length,
    "in-progress": withState.filter((topic) => topic.state === "in-progress").length,
    complete: withState.filter((topic) => topic.state === "complete").length,
  };
  const visible = filter === "all" ? withState : withState.filter((topic) => topic.state === filter);

  return (
    <section className="lc-topics" aria-label="Topics">
      {custom ? (
        <div className="lc-topics-custom">
          <TopicCard
            label={custom.label}
            icon={custom.icon}
            done={custom.done}
            total={custom.total}
            emptyText="Add your own problems"
            onClick={custom.onOpen}
          />
          <Button icon={<PlusIcon size={16} />} onClick={custom.onAdd}>
            Add question
          </Button>
        </div>
      ) : null}

      <div className="lc-topics-bar">
        <p className="lc-topics-summary muted small">
          {counts.all} topics, {counts.complete} complete
        </p>
        <div className="lc-practice-seg lc-topics-filter" role="group" aria-label="Filter topics by progress">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`lc-practice-seg-btn${filter === item.id ? " is-active" : ""}`}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.id !== "all" ? <span className="lc-topics-dot" data-state={item.id} aria-hidden="true" /> : null}
              {item.label}
              <span className="lc-topics-filter-count">{counts[item.id]}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 && filter !== "all" ? (
        <EmptyState
          icon={<SparklesIcon size={22} />}
          title={EMPTY_COPY[filter].title}
          body={EMPTY_COPY[filter].body}
          action={
            <Button variant="secondary" onClick={() => setFilter("all")}>
              Show all topics
            </Button>
          }
        />
      ) : (
        <div className="lc-topics-grid">
          {visible.map((topic) => (
            <TopicCard
              key={topic.id}
              label={topic.label}
              icon={topic.icon}
              done={topic.done}
              total={topic.total}
              onClick={() => onOpen(topic.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
