import { AlertTriangle, RefreshCw, ShieldCheck, Users, Zap, Clock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import {
  adminAuthenticate,
  clearAdminToken,
  fetchAdminStats,
  fetchAdminUsers,
  getAdminToken,
  getAdminTokenExpiresAt,
  getStoredUser,
} from "../lib/api";
import type { AdminStats, AdminUserRow } from "../lib/types";

const ADMIN_EMAIL = "jamesinah34@gmail.com";
const REAUTH_WARN_SECONDS = 60;

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatFeatureName(feature: string): string {
  return feature.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function TimeRemaining({ expiresAt }: { expiresAt: number }) {
  const [secsLeft, setSecsLeft] = useState(() => Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));

  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setSecsLeft(left);
    }, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  const mins = Math.floor(secsLeft / 60);
  const secs = secsLeft % 60;
  const isWarning = secsLeft <= REAUTH_WARN_SECONDS;

  return (
    <span className={`admin-session-timer${isWarning ? " admin-session-timer--warn" : ""}`}>
      <Clock size={13} />
      {secsLeft === 0 ? "Expired" : `${mins}:${String(secs).padStart(2, "0")} remaining`}
    </span>
  );
}

export default function AdminPanel() {
  const navigate = useNavigate();
  const user = getStoredUser();
  const [authed, setAuthed] = useState(() => !!getAdminToken());
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(() => getAdminTokenExpiresAt());

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reauthing, setReauthing] = useState(false);

  const expiredCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Access guard: only admin email allowed
  useEffect(() => {
    if (!user || user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      navigate("/settings", { replace: true });
    }
  }, [user, navigate]);

  // Poll for session expiry and trigger re-auth prompt
  useEffect(() => {
    if (!authed) return;
    expiredCheckRef.current = setInterval(() => {
      if (!getAdminToken()) {
        setAuthed(false);
        setReauthing(true);
      }
    }, 5000);
    return () => {
      if (expiredCheckRef.current) clearInterval(expiredCheckRef.current);
    };
  }, [authed]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [s, u] = await Promise.all([fetchAdminStats(), fetchAdminUsers()]);
      setStats(s);
      setUsers(u);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load admin data.";
      if (msg.toLowerCase().includes("expired") || msg.toLowerCase().includes("invalid")) {
        setAuthed(false);
        setReauthing(true);
      } else {
        setLoadError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authed) void loadData();
  }, [authed, loadData]);

  async function handleAuth() {
    setAuthLoading(true);
    setAuthError(null);
    try {
      const resp = await adminAuthenticate();
      setExpiresAt(Date.now() + resp.expires_in_seconds * 1000);
      setAuthed(true);
      setReauthing(false);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setAuthLoading(false);
    }
  }

  function handleSignOut() {
    clearAdminToken();
    navigate("/settings");
  }

  // Not admin email
  if (!user || user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    return null;
  }

  // Auth / re-auth screen
  if (!authed || reauthing) {
    return (
      <div className="page page-narrow">
        <div className="admin-auth-screen">
          <div className="admin-auth-icon">
            <ShieldCheck size={40} />
          </div>
          <h1>Admin access</h1>
          <p className="muted">
            {reauthing
              ? "Your admin session expired. Re-authenticate to continue."
              : "Verify your identity to enter the admin panel. Sessions last 5 minutes."}
          </p>
          {authError ? (
            <div className="admin-auth-error">
              <AlertTriangle size={15} />
              <span>{authError}</span>
            </div>
          ) : null}
          <div className="admin-auth-actions">
            <Button onClick={() => void handleAuth()} disabled={authLoading}>
              {authLoading ? "Verifying..." : "Authenticate"}
            </Button>
            <Button variant="secondary" onClick={handleSignOut}>
              Cancel
            </Button>
          </div>
          <p className="muted small admin-auth-note">
            Sessions are single-device. Opening the admin panel on another device or tab will invalidate this session.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Admin</span>
          <h1>Admin panel</h1>
          <p className="muted">Platform overview, user roster, and feature performance metrics.</p>
        </div>
        <div className="toolbar">
          {expiresAt ? <TimeRemaining expiresAt={expiresAt} /> : null}
          <Button
            variant="secondary"
            icon={<RefreshCw size={15} />}
            onClick={() => void loadData()}
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </Button>
          <Button variant="secondary" onClick={() => void handleAuth()} disabled={authLoading}>
            {authLoading ? "Renewing..." : "Renew session"}
          </Button>
          <Button variant="danger" onClick={handleSignOut}>
            Exit
          </Button>
        </div>
      </header>

      {loadError ? (
        <div className="admin-error-banner">
          <AlertTriangle size={16} />
          <span>{loadError}</span>
        </div>
      ) : null}

      {stats ? (
        <>
          <section className="admin-stats-grid">
            <div className="admin-stat-card">
              <Users size={20} className="admin-stat-icon" />
              <p className="admin-stat-value">{stats.total_users.toLocaleString()}</p>
              <p className="admin-stat-label">Total users</p>
            </div>
            <div className="admin-stat-card">
              <Zap size={20} className="admin-stat-icon" />
              <p className="admin-stat-value">{stats.total_tokens_used.toLocaleString()}</p>
              <p className="admin-stat-label">Tokens used (est.)</p>
            </div>
            <div className="admin-stat-card">
              <Clock size={20} className="admin-stat-icon" />
              <p className="admin-stat-value">{stats.total_usage_events.toLocaleString()}</p>
              <p className="admin-stat-label">Feature calls logged</p>
            </div>
          </section>

          {stats.feature_timings.length > 0 ? (
            <section className="admin-section">
              <h2 className="admin-section-title">Average response time by feature</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Feature</th>
                      <th>Avg response time</th>
                      <th>Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.feature_timings.map((ft) => (
                      <tr key={ft.feature}>
                        <td>{formatFeatureName(ft.feature)}</td>
                        <td>{formatMs(ft.avg_ms)}</td>
                        <td>{ft.call_count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {stats.tokens_per_user.length > 0 ? (
            <section className="admin-section">
              <h2 className="admin-section-title">Token usage by user</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>User ID</th>
                      <th>Tokens (est.)</th>
                      <th>API calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.tokens_per_user.map((row) => (
                      <tr key={row.user_id}>
                        <td>#{row.user_id}</td>
                        <td>{row.total_tokens.toLocaleString()}</td>
                        <td>{row.call_count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : loading ? (
        <p className="muted">Loading stats...</p>
      ) : null}

      <section className="admin-section">
        <h2 className="admin-section-title">All users ({users.length})</h2>
        {users.length === 0 && !loading ? (
          <p className="muted small">No users found.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table admin-users-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Verified</th>
                  <th>Admin</th>
                  <th>Type</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const isGuest = u.email.endsWith("@nosey.guest");
                  return (
                    <tr key={u.id}>
                      <td className="admin-cell-id">#{u.id}</td>
                      <td>{u.full_name ?? <span className="muted">-</span>}</td>
                      <td className="admin-cell-email">{u.email}</td>
                      <td>
                        <span className={`admin-badge ${u.email_verified ? "admin-badge--green" : "admin-badge--muted"}`}>
                          {u.email_verified ? "Yes" : "No"}
                        </span>
                      </td>
                      <td>
                        {u.is_admin ? (
                          <span className="admin-badge admin-badge--blue">Admin</span>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                      <td>
                        <span className={`admin-badge ${isGuest ? "admin-badge--muted" : "admin-badge--green"}`}>
                          {isGuest ? "Guest" : "Member"}
                        </span>
                      </td>
                      <td className="admin-cell-date">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
