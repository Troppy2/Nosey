import { Link } from "react-router-dom";
import { BrainIcon } from "../icons";
import { Button } from "./Button";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { MarkdownContent } from "./MarkdownContent";
import { SkeletonWeakStack } from "./Skeletons";
import type { FlashcardDueSummary } from "../lib/types";

interface ReviewTheseWidgetProps {
  // undefined while the parent is still loading, null when the fetch failed.
  summary: FlashcardDueSummary | null | undefined;
}

export function ReviewTheseWidget({ summary }: ReviewTheseWidgetProps) {
  const loading = summary === undefined;
  const failed = summary === null;
  const topFolder = summary?.folders[0] ?? null;
  const hasDue = !!summary && summary.total_due > 0;

  return (
    <div className="review-these-widget">
      <div className="section-title">
        <h2>Review These</h2>
        {hasDue ? (
          <span className="muted small">
            {summary.total_due} card{summary.total_due === 1 ? "" : "s"} due
          </span>
        ) : (
          <Link className="text-link" to="/flashcards">
            Study
          </Link>
        )}
      </div>

      {loading ? <SkeletonWeakStack count={2} /> : null}
      {failed ? (
        <p className="muted small">Couldn't load your due cards right now.</p>
      ) : null}
      {summary && !hasDue ? (
        <EmptyState
          icon={<BrainIcon />}
          title="All caught up!"
          body="All caught up on flashcards for now."
          action={
            <Link to="/flashcards">
              <Button variant="secondary">Go to Flashcards</Button>
            </Link>
          }
        />
      ) : null}
      {summary && hasDue ? (
        <>
          <div className="weak-stack">
            {summary.cards.map((card) => (
              <Link
                key={card.id}
                to={`/flashcards/${card.folder_id}/review?card=${card.id}`}
                className="weak-card-link"
              >
                <Card tone="dark" interactive className="weak-card">
                  <span className="pill dark-pill">{card.folder_name}</span>
                  {/* role=heading rather than <h3>: MarkdownContent
                      emits block elements, which are not valid inside
                      a heading element. */}
                  <div role="heading" aria-level={3} className="weak-card-front">
                    <MarkdownContent content={card.front} />
                  </div>
                </Card>
              </Link>
            ))}
          </div>
          {topFolder ? (
            <Link to={`/flashcards/${topFolder.folder_id}/review`} className="text-link weak-stack-cta">
              Review due cards
            </Link>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export default ReviewTheseWidget;
