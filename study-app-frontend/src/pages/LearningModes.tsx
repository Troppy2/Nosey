import { ArrowLeft, FolderOpen, GraduationCap, Layers, Puzzle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { Button } from "../components/Button";
import { Skeleton, SkeletonFolderGrid } from "../components/Skeletons";
import { fetchFolders } from "../lib/api";
import { useSettings } from "../lib/useSettings";
import type { Folder } from "../lib/types";

// The Learning Modes hub. Replaces the old "pick a folder, jump straight into
// review" flow with two steps: pick a class folder, then pick how to study it.
// Route /flashcards shows the folder picker; /flashcards/:folderId shows the
// mode picker for that folder.
export default function LearningModes() {
  const { folderId } = useParams();
  const selectedFolderId = folderId ? Number(folderId) : null;
  const { betaMode } = useSettings();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchFolders()
      .then(setFolders)
      .catch(() => setFolders([]))
      .finally(() => setLoading(false));
  }, []);

  // Step 1: folder picker.
  if (selectedFolderId == null) {
    return (
      <div className="page">
        <header className="page-header">
          <div>
            <span className="eyebrow">Study</span>
            <h1>Learning Modes</h1>
            <p className="muted">Pick a class folder, then choose how you want to study it.</p>
          </div>
        </header>

        {/* Without the loading gate the empty state flashes on every visit
            before the fetch lands. */}
        {loading ? (
          <SkeletonFolderGrid count={4} label="Loading your class folders" />
        ) : folders.length === 0 ? (
          <EmptyState
            icon={<FolderOpen />}
            title="No class folders yet"
            body="Create a class folder first, then generate or add flashcards in that folder."
            action={
              <Link to="/folders">
                <Button>Go to Folders</Button>
              </Link>
            }
          />
        ) : (
          <section className="folder-grid flash-folder-grid">
            {folders.map((folder) => (
              <Card key={folder.id} interactive className="folder-card flash-folder-card">
                <Link className="folder-card-main" to={`/flashcards/${folder.id}`}>
                  <span className="folder-dot" style={{ background: folder.color ?? "var(--green-dark)" }} />
                  <div>
                    <FolderOpen size={34} style={{ color: folder.color ?? "var(--green-dark)" }} />
                    <h2>{folder.name}</h2>
                    <p className="muted">{folder.subject ?? "Class folder"}</p>
                  </div>
                  <div className="folder-card-footer">
                    <span>{folder.flashcard_count} cards</span>
                    <span>Choose mode</span>
                  </div>
                </Link>
              </Card>
            ))}
          </section>
        )}
      </div>
    );
  }

  // Step 2: mode picker for the chosen folder. The mode cards are static
  // content, so they render immediately; only the folder's own details (name,
  // card count, whether modes are locked) wait on the fetch.
  const folder = folders.find((f) => f.id === selectedFolderId) ?? null;
  const cardCount = folder?.flashcard_count ?? 0;
  // While loading, treat modes as available: flashing them disabled and then
  // unlocking reads worse than the reverse, and each mode handles empty decks.
  const hasCards = loading || cardCount > 0;

  return (
    <div className="page page-narrow">
      <header className="page-header mode-header">
        <Link className="flash-back-btn" to="/flashcards" aria-label="Back to class folders" title="Back to class folders">
          <ArrowLeft size={18} />
        </Link>
        {loading ? (
          <div className="mode-header-loading" role="status" aria-label="Loading this class">
            <Skeleton width="90px" height="0.7rem" />
            <Skeleton width="220px" height="1.5rem" />
            <Skeleton width="260px" height="0.85rem" />
          </div>
        ) : (
          <div>
            <span className="eyebrow">{folder?.subject ?? "Class folder"}</span>
            <h1>{folder?.name ?? "Learning Modes"}</h1>
            <p className="muted">
              {cardCount} card{cardCount === 1 ? "" : "s"} in this class. Pick a way to study.
            </p>
          </div>
        )}
      </header>

      <section className="mode-grid">
        <ModeCard
          to={`/flashcards/${selectedFolderId}/review`}
          disabled={!hasCards}
          icon={<Layers size={26} />}
          accent="var(--green-dark)"
          title="Flashcards"
          blurb="Flip through your cards one at a time and rate how well you knew each one."
          meta="Classic review"
        />
        {betaMode ? (
          <ModeCard
            to={`/flashcards/${selectedFolderId}/matching`}
            disabled={!hasCards}
            icon={<Puzzle size={26} />}
            accent="var(--warning)"
            title="Matching"
            blurb="Race the clock to pair every term with its definition across timed rounds."
            meta="Game / beta"
          />
        ) : null}
        {betaMode ? (
          <ModeCard
            to={`/flashcards/${selectedFolderId}/modules`}
            disabled={false}
            icon={<GraduationCap size={26} />}
            accent="var(--info)"
            title="Learning Modules"
            blurb="AI-written lessons from your notes, read aloud, each followed by a short quiz."
            meta="Lessons / beta"
          />
        ) : null}
      </section>

      {!loading && !hasCards ? (
        <p className="muted small mode-empty-note">
          This class has no flashcards yet. Add or generate some to start studying.
        </p>
      ) : null}
    </div>
  );
}

function ModeCard({
  to,
  disabled,
  icon,
  accent,
  title,
  blurb,
  meta,
}: {
  to: string;
  disabled: boolean;
  icon: React.ReactNode;
  accent: string;
  title: string;
  blurb: string;
  meta: string;
}) {
  const inner = (
    <>
      <span className="mode-card-icon" style={{ color: accent, background: `${accent}1a` }}>
        {icon}
      </span>
      <div className="mode-card-body">
        <span className="mode-card-meta">{meta}</span>
        <h2>{title}</h2>
        <p className="muted">{blurb}</p>
      </div>
    </>
  );

  if (disabled) {
    return (
      <div className="mode-card mode-card--disabled" aria-disabled="true">
        {inner}
      </div>
    );
  }

  return (
    <Link className="mode-card" to={to} style={{ ["--mode-accent" as string]: accent }}>
      {inner}
    </Link>
  );
}
