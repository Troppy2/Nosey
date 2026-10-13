import { ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "./Button";
import { banUser, dismissContentFlag, fetchContentFlags, unbanUser } from "../lib/api";
import type { AdminUserRow, ContentFlagRow, ID } from "../lib/types";

// GH #173. Moderation hits on what users typed, for review. Child sexual
// content arrives already auto-banned; everything else waits on a decision
// here. "History" loads every flag an account has had, which is the context
// to judge a ban by.

const SEVERITY_LABEL: Record<ContentFlagRow["severity"], string> = {
  minors: "Child safety",
  harmful: "Harmful",
  self_harm: "Self-harm",
};

const SEVERITY_BADGE: Record<ContentFlagRow["severity"], string> = {
  minors: "admin-badge--red",
  harmful: "admin-badge--yellow",
  self_harm: "admin-badge--blue",
};

export function BanModal({
  email,
  onConfirm,
  onCancel,
}: {
  email: string;
  onConfirm: (reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not ban this account.");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={busy ? undefined : onCancel}>
      <div className="modal-card" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>Ban {email}?</h2>
        <p className="muted small">
          They are signed out on their next request, cannot sign up again with this Google account, and
          new guest sessions from their browser are refused. You can unban later.
        </p>
        <textarea
          className="admin-ban-reason"
          placeholder="Reason (kept with the ban)"
          value={reason}
          maxLength={500}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
          autoFocus
        />
        {error ? <p className="admin-error small">{error}</p> : null}
        <div className="button-row">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void submit()} disabled={busy || !reason.trim()}>
            {busy ? "Banning…" : "Ban account"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AdminModeration({ onUserChanged }: { onUserChanged: (user: AdminUserRow) => void }) {
  const [flags, setFlags] = useState<ContentFlagRow[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [historyFor, setHistoryFor] = useState<{ id: ID; email: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banTarget, setBanTarget] = useState<{ id: ID; email: string } | null>(null);
  const [busyId, setBusyId] = useState<ID | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchContentFlags(historyFor?.id);
      setFlags(res.flags);
      setOpenCount(res.open_count);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load flags.");
    } finally {
      setLoading(false);
    }
  }, [historyFor]);

  useEffect(() => {
    void load();
  }, [load]);

  async function dismiss(flag: ContentFlagRow) {
    setBusyId(flag.id);
    try {
      await dismissContentFlag(flag.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not dismiss.");
    } finally {
      setBusyId(null);
    }
  }

  async function unban(userId: ID) {
    setBusyId(userId);
    try {
      onUserChanged(await unbanUser(userId));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unban.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="admin-section">
      <div className="admin-moderation-head">
        <h2 className="admin-section-title">
          <ShieldAlert size={18} />{" "}
          {historyFor ? `Flag history: ${historyFor.email}` : `Flagged content (${openCount} open)`}
        </h2>
        <div className="button-row">
          {historyFor ? (
            <Button variant="secondary" onClick={() => setHistoryFor(null)}>
              Back to open flags
            </Button>
          ) : null}
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>
      {error ? <p className="admin-error small">{error}</p> : null}
      {!loading && flags.length === 0 ? (
        <p className="muted small">{historyFor ? "No flags for this account." : "Nothing waiting for review."}</p>
      ) : null}
      <ul className="admin-flag-list">
        {flags.map((flag) => (
          <li key={flag.id} className="admin-flag">
            <div className="admin-flag-meta">
              <span className={`admin-badge ${SEVERITY_BADGE[flag.severity]}`}>{SEVERITY_LABEL[flag.severity]}</span>
              <span className="admin-cell-email">{flag.user_email}</span>
              {flag.user_banned ? <span className="admin-badge admin-badge--red">Banned</span> : null}
              <span className="muted small">
                {flag.feature} · {flag.categories} · {flag.score.toFixed(2)} ·{" "}
                {new Date(flag.created_at).toLocaleString()}
              </span>
              {flag.action ? <span className="muted small">({flag.action})</span> : null}
            </div>
            <blockquote className="admin-flag-excerpt">{flag.excerpt}</blockquote>
            <div className="button-row">
              {!historyFor && flag.user_id != null ? (
                <Button
                  variant="ghost"
                  onClick={() => setHistoryFor({ id: flag.user_id as ID, email: flag.user_email })}
                >
                  History
                </Button>
              ) : null}
              {!flag.reviewed_at ? (
                <Button variant="secondary" onClick={() => void dismiss(flag)} disabled={busyId === flag.id}>
                  Dismiss
                </Button>
              ) : null}
              {/* A deleted account has nothing to ban yet: its flags relink if
                  the same Google account signs up again. */}
              {flag.user_id == null || flag.user_is_admin ? null : flag.user_banned ? (
                <Button
                  variant="secondary"
                  onClick={() => void unban(flag.user_id as ID)}
                  disabled={busyId === flag.user_id}
                >
                  Unban
                </Button>
              ) : (
                <Button
                  variant="danger-outline"
                  onClick={() => setBanTarget({ id: flag.user_id as ID, email: flag.user_email })}
                >
                  Ban
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {banTarget ? (
        <BanModal
          email={banTarget.email}
          onCancel={() => setBanTarget(null)}
          onConfirm={async (reason) => {
            onUserChanged(await banUser(banTarget.id, reason));
            setBanTarget(null);
            await load();
          }}
        />
      ) : null}
    </section>
  );
}
