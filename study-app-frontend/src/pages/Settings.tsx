import { CheckCircle, LogIn, LogOut, RotateCcw, Sparkles, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { SelectInput } from "../components/Field";
import {
  fetchClearedKojoConversations,
  fetchFlashcards,
  fetchTests,
  getStoredUser,
  googleSignIn,
  isGuestSession,
  restoreKojoConversation,
  setGoogleSession,
  signOut,
} from "../lib/api";
import { useSettings } from "../lib/useSettings";
import { useEffect, useRef, useState } from "react";
import type { KojoClearedConversation } from "../lib/types";

const GENERATION_PROVIDER_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "groq", label: "Groq" },
  { value: "gemini", label: "DeepSeek" },
  { value: "claude", label: "Anthropic (Claude)" },
  { value: "ollama", label: "Ollama" },
];

const STATS_RESET_BASELINE_KEY = "nosey_stats_reset_baseline";

export default function Settings() {
  const navigate = useNavigate();
  const [user, setUser] = useState(getStoredUser);
  const guest = isGuestSession();
  const [loading, setLoading] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signInSuccess, setSignInSuccess] = useState(false);
  const [clearedConversations, setClearedConversations] = useState<KojoClearedConversation[]>([]);
  const [loadingCleared, setLoadingCleared] = useState(true);
  const [restoreFolderId, setRestoreFolderId] = useState<number | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [resettingStats, setResettingStats] = useState(false);
  const [statsResetNotice, setStatsResetNotice] = useState<string | null>(null);
  const {
    questionFallbackEnabled,
    setQuestionFallbackEnabled,
    generationProvider,
    setGenerationProvider,
    kojoStrictness,
    setKojoStrictness,
  } = useSettings();
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const initialized = useRef(false);

  async function loadClearedConversations() {
    setLoadingCleared(true);
    const conversations = await fetchClearedKojoConversations();
    setClearedConversations(conversations);
    setLoadingCleared(false);
  }

  useEffect(() => {
    if (!clientId || initialized.current) return;
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      try {
        (window as any).google.accounts.id.initialize({
          client_id: clientId,
          callback: async (resp: any) => {
            if (!resp?.credential) return;
            setLoading(true);
            setSignInError(null);
            setSignInSuccess(false);
            try {
              const signedInUser = await googleSignIn(resp.credential);
              setUser(signedInUser);
              setSignInSuccess(true);
              setTimeout(() => navigate("/dashboard"), 800);
            } catch (err) {
              setSignInError(err instanceof Error ? err.message : "Google sign-in failed. Please try again.");
            } finally {
              setLoading(false);
            }
          },
        });
        initialized.current = true;
      } catch (e) {
        console.warn("Google Identity init failed", e);
      }
    };
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, [clientId, navigate]);

  useEffect(() => {
    void loadClearedConversations();
  }, [user?.id]);

  function handleSignIn() {
    setSignInError(null);
    setSignInSuccess(false);
    if (clientId && (window as any).google?.accounts?.id) {
      (window as any).google.accounts.id.prompt();
      return;
    }
    const fallbackUser = setGoogleSession();
    setUser(fallbackUser);
    navigate("/dashboard");
  }

  function handleSignOut() {
    signOut();
    setUser(null);
    navigate("/");
  }

  async function handleResetStats() {
    setResettingStats(true);
    setStatsResetNotice(null);
    try {
      const [tests, flashcards] = await Promise.all([fetchTests(), fetchFlashcards()]);
      const scored = tests.filter((test) => typeof test.best_score === "number");
      const baseline = {
        attempts: tests.reduce((sum, test) => sum + test.attempt_count, 0),
        cardsReviewed: flashcards.reduce((sum, card) => sum + card.attempt_count, 0),
        scoreSum: scored.reduce((sum, test) => sum + (test.best_score ?? 0), 0),
        scoreCount: scored.length,
        resetAt: new Date().toISOString(),
      };
      localStorage.setItem(STATS_RESET_BASELINE_KEY, JSON.stringify(baseline));
      window.dispatchEvent(new Event("nosey-stats-reset"));
      setStatsResetNotice("Stats reset. Dashboard totals now start from zero.");
    } catch (err) {
      setStatsResetNotice(err instanceof Error ? err.message : "Unable to reset stats right now.");
    } finally {
      setResettingStats(false);
    }
  }

  function handleToggleFallback() {
    const next = !questionFallbackEnabled;
    setQuestionFallbackEnabled(next);
  }

  function handleChangeGenerationProvider(nextProvider: string) {
    setGenerationProvider(nextProvider);
  }

  async function handleRestore(folderId: number) {
    setRestoreError(null);
    setRestoreFolderId(folderId);
    try {
      const result = await restoreKojoConversation(folderId);
      if (!result.restored) {
        setRestoreError("This chat can no longer be restored. The 5-hour window may have expired.");
      }
      await loadClearedConversations();
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : "Unable to restore chat history.");
    } finally {
      setRestoreFolderId(null);
    }
  }

  function getRestoreTimeLabel(isoTime: string) {
    const diffMs = new Date(isoTime).getTime() - Date.now();
    if (diffMs <= 0) return "Expired";
    const totalMinutes = Math.ceil(diffMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours <= 0) return `${minutes}m left`;
    return `${hours}h ${minutes}m left`;
  }

  return (
    <div className="page page-narrow">
      <header className="page-header">
        <div>
          <span className="eyebrow">Account</span>
          <h1>Settings</h1>
          <p className="muted">Manage your current session and switch between guest and signed-out states.</p>
        </div>
      </header>

      <Card className="settings-card">
        <div className="settings-summary">
          <span className="pill">{guest ? "Guest session" : user ? "Signed in" : "Signed out"}</span>
          <h2>{user?.full_name ?? "No active session"}</h2>
          {user?.email ? <p className="muted small">{user.email}</p> : null}
          <p className="muted">
            Guest mode works like a normal workspace, but it is limited to one folder and one practice test until you sign in.
          </p>
        </div>

        {signInSuccess ? (
          <div className="settings-feedback settings-feedback--success">
            <CheckCircle size={16} />
            <span>Signed in as {user?.full_name ?? user?.email}. Redirecting…</span>
          </div>
        ) : signInError ? (
          <div className="settings-feedback settings-feedback--error">
            <XCircle size={16} />
            <span>{signInError}</span>
          </div>
        ) : null}

        <div className="settings-actions">
          <Button icon={<LogIn size={18} />} onClick={handleSignIn} variant="secondary" disabled={loading}>
            {loading ? "Signing in…" : "Google sign in"}
          </Button>
          <Button icon={<LogOut size={18} />} onClick={handleSignOut} variant="danger">
            Sign out
          </Button>
        </div>

        <div className="settings-note">
          <Sparkles size={18} />
          <span>Use the guest session to try the full flow before connecting a real account.</span>
        </div>

        <section className="settings-appearance">
          <h3><RotateCcw size={16} /> Reset Study Stats</h3>
          <p className="muted small">
            Reset dashboard counters for Tests Taken, Cards Reviewed, and Average Score.
          </p>
          <div className="settings-reset-row">
            <Button
              type="button"
              variant="secondary"
              icon={<RotateCcw size={16} />}
              onClick={handleResetStats}
              disabled={resettingStats}
            >
              {resettingStats ? "Resetting..." : "Reset Stats"}
            </Button>
            {statsResetNotice ? <span className="muted small">{statsResetNotice}</span> : null}
          </div>
        </section>

        <section className="settings-appearance">
          <h3>Question Fallback</h3>
          <p className="muted small">
            When enabled, if the AI model fails to generate questions, placeholder questions are shown instead.
            When disabled, you'll see an error and can try again once the AI is available.
          </p>
          <div className="settings-reset-row">
            <button
              type="button"
              role="switch"
              className={`settings-toggle-switch${questionFallbackEnabled ? " settings-toggle-switch--on" : ""}`}
              onClick={handleToggleFallback}
              aria-pressed={questionFallbackEnabled}
            >
              <span className="settings-toggle-track">
                <span className="settings-toggle-thumb" />
              </span>
              <span className="settings-toggle-label">
                {questionFallbackEnabled ? "Fallback on" : "Fallback off"}
              </span>
            </button>
          </div>
        </section>

        <section className="settings-appearance">
          <h3>LLM model override</h3>
          <p className="muted small">
            Choose the default provider Nosey should use for all LLM-powered features.
          </p>
          <SelectInput
            label="Default provider"
            value={generationProvider}
            onChange={(event) => handleChangeGenerationProvider(event.target.value)}
            hint="This setting feeds Create Test, Flashcards, Kojo, and other AI workflows."
          >
            {GENERATION_PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </SelectInput>
        </section>

        <section className="settings-appearance">
          <h3>Kojo constitution strictness</h3>
          <p className="muted small">
            Controls how strictly Kojo sticks to your uploaded notes when answering questions.
          </p>
          <div className="settings-strictness-row">
            {(["strict", "medium", "none"] as const).map((level) => (
              <button
                key={level}
                type="button"
                className={`settings-strictness-btn${kojoStrictness === level ? " settings-strictness-btn--active" : ""}`}
                onClick={() => setKojoStrictness(level)}
              >
                <span className="settings-strictness-label">
                  {level === "strict" ? "Strict" : level === "medium" ? "Medium" : "Not at all"}
                </span>
                <span className="settings-strictness-desc muted small">
                  {level === "strict"
                    ? "Only answers from your notes"
                    : level === "medium"
                    ? "Prefers notes, fills gaps with general knowledge"
                    : "Answers freely, tells you to fact-check"}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="settings-restore">
          <h3>Kojo chat history restore</h3>
          <p className="muted small">
            Cleared Kojo chats are available here for up to 5 hours.
          </p>

          {restoreError ? (
            <div className="settings-feedback settings-feedback--error">
              <XCircle size={16} />
              <span>{restoreError}</span>
            </div>
          ) : null}

          {loadingCleared ? (
            <p className="muted small">Loading cleared chats…</p>
          ) : clearedConversations.length === 0 ? (
            <p className="muted small">No recently cleared Kojo chats.</p>
          ) : (
            <div className="settings-restore-list">
              {clearedConversations.map((conv) => (
                <div className="settings-restore-item" key={conv.conversation_id}>
                  <div>
                    <p className="settings-restore-folder">{conv.folder_name}</p>
                    <p className="muted small">{getRestoreTimeLabel(conv.restore_expires_at)}</p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => handleRestore(conv.folder_id)}
                    disabled={restoreFolderId === conv.folder_id}
                  >
                    {restoreFolderId === conv.folder_id ? "Restoring…" : "Restore"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </Card>
    </div>
  );
}