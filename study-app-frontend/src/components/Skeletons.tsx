/**
 * Skeleton screens for content-heavy loads (roughly 1-3s): pages and panels
 * whose final layout is known. Prefer these over spinners or "Loading..."
 * text; a wireframe of the incoming layout reads as progress, a spinner reads
 * as waiting.
 *
 * Composition rule: pick (or add) a preset that mirrors the real layout it
 * stands in for. A skeleton that doesn't match the loaded content trades one
 * jarring transition for another.
 *
 * Each preset is a single `role="status"` region with one accessible label;
 * the individual bones are aria-hidden.
 */

type SkeletonProps = {
  width?: string;
  height?: string;
  circle?: boolean;
  className?: string;
};

/** A single bone. Building block for presets; rarely used alone in pages. */
export function Skeleton({ width, height, circle = false, className = "" }: SkeletonProps) {
  return (
    <span
      className={`skel${circle ? " skel--circle" : ""}${className ? ` ${className}` : ""}`}
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

/** Paragraph stand-in: full-width lines with a short last line. */
export function SkeletonText({
  lines = 3,
  label = "Loading content",
}: {
  lines?: number;
  label?: string;
}) {
  const widths = ["100%", "94%", "98%", "89%", "96%", "92%"];
  return (
    <div className="skel-text" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? "62%" : widths[i % widths.length]} />
      ))}
    </div>
  );
}

/** List stand-in: rows of title + subtitle, like test lists or command lists. */
export function SkeletonList({
  rows = 4,
  label = "Loading list",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="skel-list" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skel-list-row" key={i}>
          <Skeleton width="42%" height="0.9rem" />
          <Skeleton width="68%" height="0.7rem" />
        </div>
      ))}
    </div>
  );
}

/** Dashboard stat-grid stand-in: icon + label over a large value, 3-up. */
export function SkeletonStatGrid({
  count = 3,
  label = "Loading stats",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <div className="grid grid-3 stat-grid" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div className="skel-card" key={i}>
          <div className="skel-card-top">
            <Skeleton circle width="23px" height="23px" />
            <Skeleton width="45%" height="0.8rem" />
          </div>
          <Skeleton width="34%" height="1.6rem" />
        </div>
      ))}
    </div>
  );
}

/** Card-grid stand-in: icon + title + meta line, 2-up, like folder cards. */
export function SkeletonCardGrid({
  count = 4,
  label = "Loading",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <div className="grid grid-2" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div className="skel-card" key={i}>
          <div className="skel-card-top">
            <Skeleton circle width="25px" height="25px" />
            <Skeleton width="55%" height="0.9rem" />
          </div>
          <Skeleton width="40%" height="0.7rem" />
        </div>
      ))}
    </div>
  );
}

/**
 * Full folder-card grid stand-in for the Folders and Learning Modes pickers.
 * Mirrors `.folder-card` exactly: color dot top-right, big icon block, title,
 * subject line, then the tests/cards counts pinned to the bottom. Reuses
 * `.folder-grid` so the auto-fit columns collapse on mobile like the real grid.
 */
export function SkeletonFolderGrid({
  count = 4,
  label = "Loading your folders",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <section className="folder-grid" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div className="skel-folder-card" key={i}>
          <Skeleton circle width="12px" height="12px" className="skel-folder-dot" />
          <div className="skel-folder-top">
            <Skeleton width="34px" height="34px" className="skel-folder-icon" />
            <Skeleton width="62%" height="1.15rem" />
            <Skeleton width="38%" height="0.8rem" />
          </div>
          <div className="skel-folder-footer">
            <Skeleton width="52px" height="0.8rem" />
            <Skeleton width="52px" height="0.8rem" />
          </div>
        </div>
      ))}
    </section>
  );
}

/**
 * Dashboard "Folders" section stand-in. Mirrors `.folder-mini`: icon on the
 * left, then name, subject, and the tests/cards meta row.
 */
export function SkeletonFolderMiniGrid({
  count = 4,
  label = "Loading your folders",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <div className="grid grid-2" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div className="skel-folder-mini" key={i}>
          <Skeleton width="25px" height="25px" className="skel-folder-icon" />
          <div className="skel-folder-mini-body">
            <Skeleton width="58%" height="0.95rem" />
            <Skeleton width="34%" height="0.75rem" />
            <div className="skel-folder-footer">
              <Skeleton width="48px" height="0.7rem" />
              <Skeleton width="48px" height="0.7rem" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Test-list stand-in for FolderDetail and the dashboard's Continue Test
 * section. Mirrors `.test-row`: title + meta on the left, a quiet action
 * cluster on the right.
 */
export function SkeletonTestRows({
  rows = 3,
  label = "Loading tests",
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="test-list" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div className="skel-test-row" key={i}>
          <div className="skel-test-row-main">
            <Skeleton width="38%" height="0.95rem" />
            <Skeleton width="58%" height="0.75rem" />
          </div>
          <Skeleton circle width="26px" height="26px" />
        </div>
      ))}
    </div>
  );
}

/**
 * Results page stand-in, shaped like what lands there: the green score hero
 * with its huge centered number, the three-up stat row, then the answer list.
 * The hero keeps its soft green wash so the page reads as Results even while
 * the score is unknown.
 */
export function SkeletonScoreSummary({ label = "Loading your results" }: { label?: string }) {
  return (
    <div role="status" aria-label={label}>
      <div className="skel-score-hero">
        <Skeleton width="90px" height="0.7rem" />
        <Skeleton width="150px" height="3rem" />
        <Skeleton width="120px" height="0.85rem" />
      </div>
      <div className="grid grid-3 result-stats" aria-hidden="true">
        {Array.from({ length: 3 }, (_, i) => (
          <div className="skel-card" key={i}>
            <Skeleton width="55%" height="0.8rem" />
            <Skeleton width="30%" height="1.4rem" />
          </div>
        ))}
      </div>
      <SkeletonList rows={4} label="" />
    </div>
  );
}

/**
 * Question-card stand-in for TakeTest's first load. Mirrors the real card:
 * type pill and counter up top, the prompt, then four option rows.
 */
export function SkeletonQuestionCard({ label = "Loading this test" }: { label?: string }) {
  return (
    <div className="skel-question-card" role="status" aria-label={label}>
      <div className="skel-question-head">
        <Skeleton width="64px" height="1.3rem" className="skel-pill" />
        <Skeleton width="80px" height="0.75rem" />
      </div>
      <div className="skel-question-prompt">
        <Skeleton width="96%" height="0.95rem" />
        <Skeleton width="72%" height="0.95rem" />
      </div>
      <div className="skel-question-options">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="skel-option-row" key={i}>
            <Skeleton circle width="18px" height="18px" />
            <Skeleton width={`${[68, 54, 74, 47][i]}%`} height="0.85rem" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Flashcard-face stand-in for the review deck. A tall centered card so the
 * page reads as "your card is coming", not a paragraph of missing text.
 */
export function SkeletonFlashcard({ label = "Loading your flashcards" }: { label?: string }) {
  return (
    <div className="skel-flashcard" role="status" aria-label={label}>
      <Skeleton width="70px" height="0.7rem" />
      <div className="skel-flashcard-text">
        <Skeleton width="72%" height="1.05rem" />
        <Skeleton width="52%" height="1.05rem" />
      </div>
      <Skeleton width="110px" height="0.75rem" />
    </div>
  );
}

/**
 * Dashboard "Review These" stand-in: the dark weak-card stack, kept on its
 * deep green gradient so the sidebar reads as itself while it loads.
 */
export function SkeletonWeakStack({
  count = 2,
  label = "Loading review cards",
}: {
  count?: number;
  label?: string;
}) {
  return (
    <div className="weak-stack" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div className="skel-weak-card" key={i}>
          <Skeleton width="86px" height="1.2rem" className="skel-pill" />
          <Skeleton width={i % 2 ? "58%" : "74%"} height="0.95rem" />
          <Skeleton width="40%" height="0.75rem" />
        </div>
      ))}
    </div>
  );
}

/**
 * Kojo chat shell stand-in: sidebar rail of class rows beside a message column
 * with alternating bubbles, so the two-pane layout is already standing when
 * the real chat arrives.
 */
export function SkeletonChatShell({ label = "Loading your classes" }: { label?: string }) {
  return (
    <div className="skel-chat" role="status" aria-label={label}>
      <div className="skel-chat-sidebar">
        <Skeleton width="60%" height="1rem" />
        {Array.from({ length: 4 }, (_, i) => (
          <div className="skel-chat-side-row" key={i}>
            <Skeleton circle width="10px" height="10px" />
            <Skeleton width={`${[70, 55, 64, 48][i]}%`} height="0.8rem" />
          </div>
        ))}
      </div>
      <div className="skel-chat-main">
        <div className="skel-chat-bubble skel-chat-bubble--kojo">
          <Skeleton width="82%" height="0.8rem" />
          <Skeleton width="58%" height="0.8rem" />
        </div>
        <div className="skel-chat-bubble skel-chat-bubble--user">
          <Skeleton width="70%" height="0.8rem" />
        </div>
        <div className="skel-chat-bubble skel-chat-bubble--kojo">
          <Skeleton width="76%" height="0.8rem" />
          <Skeleton width="44%" height="0.8rem" />
        </div>
      </div>
    </div>
  );
}
