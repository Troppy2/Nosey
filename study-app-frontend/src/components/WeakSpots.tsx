import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SproutIcon } from "../icons";
import { fetchWeakSpots } from "../lib/api";
import type { WeakSpot } from "../lib/types";
import { Card } from "./Card";
import { Skeleton } from "./Skeletons";

// Dashboard: the weakest topics across every folder, each linking to that
// folder's Stats (where the daily quiz lives). Loads on its own so a slow
// stats query never holds up the rest of the dashboard.
export function WeakSpots() {
  const [spots, setSpots] = useState<WeakSpot[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchWeakSpots()
      .then((data) => !cancelled && setSpots(data))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return null;

  return (
    <section className="weak-spots" aria-label="Weak spots">
      <div className="section-title">
        <h2>Weak Spots</h2>
      </div>
      <Card className="weak-spots-card icon-hover">
        {spots === null ? (
          <div className="weak-spots-list folder-stats--loading" role="status" aria-label="Loading your weak spots">
            {[0, 1, 2].map((i) => (
              <div key={i} className="weak-spots-skel">
                <Skeleton width="55%" height="0.9rem" />
                <Skeleton width="100%" height="6px" />
              </div>
            ))}
          </div>
        ) : spots.length === 0 ? (
          <div className="weak-spots-empty">
            <SproutIcon size={22} />
            <p className="muted small">
              No weak spots right now. Take tests and review flashcards, and the topics that need practice show up here.
            </p>
          </div>
        ) : (
          <ul className="weak-spots-list">
            {spots.map((spot) => (
              <li key={`${spot.folder_id}-${spot.topic}`}>
                <Link to={`/folders/${spot.folder_id}`} className="weak-spots-item">
                  <div className="folder-stats-topic-row">
                    <span className="folder-stats-topic-name">{spot.topic}</span>
                    <span className="folder-stats-topic-pct">{Math.round(spot.accuracy * 100)}%</span>
                  </div>
                  <div className="folder-stats-bar weak-spots-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(4, Math.round(spot.accuracy * 100))}%` }} />
                  </div>
                  <span className="muted small">{spot.folder_name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
