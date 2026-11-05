import { Link } from "react-router-dom";
import { BrainIcon } from "../icons";
import { Button } from "./Button";
import { EmptyState } from "./EmptyState";
import { MarkdownContent } from "./MarkdownContent";
import { Skeleton } from "./Skeletons";
import type { FlashcardDueSummary } from "../lib/types";
import "../styles/components/flashcards-due-widget.css";

interface ReviewTheseWidgetProps {
  // undefined while the parent is still loading, null when the fetch failed.
  summary: FlashcardDueSummary | null | undefined;
  onRetry?: () => void;
}

const dueLink = (folderId: number) => `/flashcards/${folderId}/review?due=1`;
const cards = (n: number) => `${n} card${n === 1 ? "" : "s"}`;

/** Loading stand-in built from the widget's own deck and button, so nothing jumps when data lands. */
export function FlashcardsDueSkeleton() {
  return (
    <div className="fcd-panel fcd-skeleton" role="status" aria-label="Loading due flashcards">
      <div className="fcd-deck" data-depth="3">
        <div className="fcd-card">
          <Skeleton width="46%" height="0.7rem" />
          <span className="fcd-skel-front">
            <Skeleton width="92%" height="1.1rem" />
            <Skeleton width="58%" height="1.1rem" />
          </span>
        </div>
      </div>
      <div className="button button-secondary button-full fcd-skel-cta" aria-hidden="true">
        <Skeleton width="104px" height="0.85rem" />
      </div>
    </div>
  );
}

// Dashboard widget for flashcards that are due. One deck preview, one clear
// action that starts a due-only session, and the other folders below it.
export function ReviewTheseWidget({ summary, onRetry }: ReviewTheseWidgetProps) {
  const loading = summary === undefined;
  const failed = summary === null;
  const folders = summary?.folders.filter((f) => f.due > 0) ?? [];
  const top = folders[0] ?? null;
  const next = top ? summary?.cards.find((c) => c.folder_id === top.folder_id) ?? null : null;
  const depth = Math.min(top?.due ?? 0, 3);
  const hasDue = !!summary && summary.total_due > 0 && top != null;

  return (
    <div className="review-these-widget fcd">
      <div className="section-title">
        <h2>Flashcards due</h2>
        {hasDue ? (
          <span className="muted small">{cards(summary.total_due)}</span>
        ) : loading ? null : (
          <Link className="text-link" to="/flashcards">
            All flashcards
          </Link>
        )}
      </div>

      {loading ? (
        <FlashcardsDueSkeleton />
      ) : failed ? (
        <div className="fcd-panel fcd-failed">
          <p>Couldn't load your due cards.</p>
          {onRetry ? (
            <Button variant="secondary" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : !hasDue ? (
        <EmptyState
          icon={<BrainIcon />}
          title="All caught up"
          body="No flashcards are due right now."
          action={
            <Link to="/flashcards">
              <Button variant="secondary">Go to flashcards</Button>
            </Link>
          }
        />
      ) : (
        <div className="fcd-panel">
          <Link to={dueLink(top.folder_id)} className="fcd-deck" data-depth={depth} aria-label={`Review ${cards(top.due)} from ${top.name}`}>
            <span className="fcd-card">
              <span className="fcd-folder">{top.name}</span>
              {next ? (
                <span className="fcd-front">
                  <MarkdownContent content={next.front} />
                </span>
              ) : null}
            </span>
          </Link>

          <Link to={dueLink(top.folder_id)} className="button button-secondary button-full fcd-cta">
            <span>Review {cards(top.due)}</span>
          </Link>

          {folders.length > 1 ? (
            <div className="fcd-more">
              <h3>Also due</h3>
              <ul>
                {folders.slice(1).map((folder) => (
                  <li key={folder.folder_id}>
                    <Link to={dueLink(folder.folder_id)}>
                      <span className="fcd-more-name">{folder.name}</span>
                      <span className="fcd-more-count">{folder.due}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default ReviewTheseWidget;
