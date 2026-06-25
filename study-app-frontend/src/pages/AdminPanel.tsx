import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
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

const ADMIN_EMAILS = ["jamesinah34@gmail.com", "jamesinah883@gmail.com"];
const REAUTH_WARN_SECONDS = 60;

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatFeatureName(feature: string): string {
  return feature.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatProviderName(provider: string): string {
  const map: Record<string, string> = {
    groq: "Groq",
    openai: "OpenAI",
    claude: "Claude (Anthropic)",
    ollama: "Ollama (local)",
    gemini: "Gemini",
  };
  return map[provider.toLowerCase()] ?? provider;
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
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

function DailyActivityBar({ count, max }: { count: number; max: number }) {
  const pctWidth = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0;
  return (
    <div className="admin-activity-bar-wrap">
      <div className="admin-activity-bar" style={{ width: `${pctWidth}%` }} />
    </div>
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

  useEffect(() => {
    if (!user || !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
      navigate("/settings", { replace: true });
    }
  }, [user, navigate]);

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

  if (!user || !ADMIN_EMAILS.includes(user.email.toLowerCase())) {
    return null;
  }

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

  const maxDailyCount = stats ? Math.max(...stats.daily_counts.map((d) => d.count), 1) : 1;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">Admin</span>
          <h1>Admin panel</h1>
          <p className="muted">Platform overview, feature health, and LLM provider stats.</p>
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
          {/* Overview cards */}
          <section className="admin-stats-grid">
            <div className="admin-stat-card">
              <Users size={20} className="admin-stat-icon" />
              <p className="admin-stat-value">{stats.total_users.toLocaleString()}</p>
              <p className="admin-stat-label">Total users</p>
            </div>
            <div className="admin-stat-card">
              <Activity size={20} className="admin-stat-icon" />
              <p className="admin-stat-value">{stats.active_users_7d.toLocaleString()}</p>
              <p className="admin-stat-label">Active users (7d)</p>
            </div>
            <div className="admin-stat-card">
              <TrendingUp size={20} className="admin-stat-icon" />
              <p className="admin-stat-value">{stats.total_usage_events.toLocaleString()}</p>
              <p className="admin-stat-label">Feature calls logged</p>
            </div>
            <div className="admin-stat-card">
              <Zap size={20} className="admin-stat-icon" />
              <p className="admin-stat-value">{stats.total_tokens_used.toLocaleString()}</p>
              <p className="admin-stat-label">Tokens used (est.)</p>
            </div>
          </section>

          {/* Feature usage ranked */}
          {stats.feature_stats.length > 0 ? (
            <section className="admin-section">
              <h2 className="admin-section-title">Feature usage</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Feature</th>
                      <th>Calls</th>
                      <th>Errors</th>
                      <th>Error rate</th>
                      <th>Avg response</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.feature_stats.map((fs) => {
                      const healthy = fs.error_rate < 0.05;
                      const degraded = fs.error_rate >= 0.05 && fs.error_rate < 0.2;
                      return (
                        <tr key={fs.feature}>
                          <td>{formatFeatureName(fs.feature)}</td>
                          <td>{fs.call_count.toLocaleString()}</td>
                          <td>{fs.error_count.toLocaleString()}</td>
                          <td>
                            <span
                              className={`admin-badge ${
                                healthy
                                  ? "admin-badge--green"
                                  : degraded
                                  ? "admin-badge--yellow"
                                  : "admin-badge--red"
                              }`}
                            >
                              {pct(fs.error_rate)}
                            </span>
                          </td>
                          <td>{formatMs(fs.avg_ms)}</td>
                          <td>
                            {healthy ? (
                              <span className="admin-health admin-health--ok">
                                <CheckCircle size={13} /> OK
                              </span>
                            ) : degraded ? (
                              <span className="admin-health admin-health--warn">
                                <AlertTriangle size={13} /> Degraded
                              </span>
                            ) : (
                              <span className="admin-health admin-health--error">
                                <XCircle size={13} /> Failing
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* LLM provider health */}
          {stats.provider_stats.length > 0 ? (
            <section className="admin-section">
              <h2 className="admin-section-title">LLM provider health</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Calls</th>
                      <th>Successes</th>
                      <th>Failures</th>
                      <th>Success rate</th>
                      <th>Avg response</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.provider_stats.map((ps) => (
                      <tr key={ps.provider}>
                        <td>
                          <strong>{formatProviderName(ps.provider)}</strong>
                        </td>
                        <td>{ps.call_count.toLocaleString()}</td>
                        <td className="admin-cell-green">{ps.success_count.toLocaleString()}</td>
                        <td className="admin-cell-red">{ps.error_count.toLocaleString()}</td>
                        <td>
                          <span
                            className={`admin-badge ${
                              ps.success_rate >= 0.95
                                ? "admin-badge--green"
                                : ps.success_rate >= 0.8
                                ? "admin-badge--yellow"
                                : "admin-badge--red"
                            }`}
                          >
                            {pct(ps.success_rate)}
                          </span>
                        </td>
                        <td>{formatMs(ps.avg_ms)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* Daily activity */}
          {stats.daily_counts.length > 0 ? (
            <section className="admin-section">
              <h2 className="admin-section-title">Daily activity (last 14 days)</h2>
              <div className="admin-table-wrap">
                <table className="admin-table admin-activity-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Events</th>
                      <th style={{ width: "100%" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.daily_counts.map((dc) => (
                      <tr key={dc.date}>
                        <td className="admin-cell-date">{formatDate(dc.date)}</td>
                        <td className="admin-cell-count">{dc.count.toLocaleString()}</td>
                        <td>
                          <DailyActivityBar count={dc.count} max={maxDailyCount} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* Error breakdown */}
          {stats.error_breakdown.length > 0 ? (
            <section className="admin-section">
              <h2 className="admin-section-title">Error breakdown</h2>
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Error type</th>
                      <th>Feature</th>
                      <th>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.error_breakdown.map((eb, i) => (
                      <tr key={i}>
                        <td>
                          <span className="admin-badge admin-badge--red">{eb.error_type}</span>
                        </td>
                        <td>{formatFeatureName(eb.feature)}</td>
                        <td>{eb.count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {/* Token usage by user */}
          {stats.tokens_per_user.some((r) => r.total_tokens > 0) ? (
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

      {/* Authenticated user roster */}
      {(() => {
        const realUsers = users.filter((u) => !u.email.endsWith("@nosey.guest"));
        const guestUsers = users.filter((u) => u.email.endsWith("@nosey.guest"));
        return (
          <>
            <section className="admin-section">
              <h2 className="admin-section-title">Authenticated users ({realUsers.length})</h2>
              {realUsers.length === 0 && !loading ? (
                <p className="muted small">No authenticated users found.</p>
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
                        <th>Joined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {realUsers.map((u) => (
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
                          <td className="admin-cell-date">
                            {new Date(u.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="admin-section">
              <h2 className="admin-section-title">Guest sessions ({guestUsers.length})</h2>
              {guestUsers.length === 0 && !loading ? (
                <p className="muted small">No guest sessions found.</p>
              ) : (
                <div className="admin-table-wrap">
                  <table className="admin-table admin-users-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Token (email)</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {guestUsers.map((u) => (
                        <tr key={u.id}>
                          <td className="admin-cell-id">#{u.id}</td>
                          <td className="admin-cell-email">{u.email}</td>
                          <td className="admin-cell-date">
                            {new Date(u.created_at).toLocaleDateString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        );
      })()}
    </div>
  );
}
