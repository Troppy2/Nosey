import { CheckCircle, LogIn, LogOut, RotateCcw, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { ONBOARDING_DONE_KEY, TOUR_SEGMENT_KEY } from "../components/OnboardingTour";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { CollapsibleSection } from "../components/CollapsibleSection";
import { ConfirmModal, TypeToConfirmModal } from "../components/ConfirmModal";
import { SelectInput } from "../components/Field";
import {
  deleteAccount,
  fetchArchivedFolders,
  fetchClearedKojoConversations,
  fetchFlashcards,
  fetchSlashCommands,
  fetchTests,
  getStoredUser,
  googleSignIn,
  isGuestSession,
  restoreKojoConversation,
  scopeKey,
  setGoogleSession,
  signOut,
  unarchiveFolder,
} from "../lib/api";
import { useSettings } from "../lib/useSettings";
import { useEffect, useRef, useState } from "react";
import type { Folder, KojoClearedConversation, SlashCommand } from "../lib/types";
import SlashCommandManager from "../components/SlashCommandManager";

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
  const [archivedFolders, setArchivedFolders] = useState<Folder[]>([]);
  const [loadingArchived, setLoadingArchived] = useState(true);
  const [unarchivedFolderId, setUnarchivedFolderId] = useState<number | null>(null);
  const [unarchiveError, setUnarchiveError] = useState<string | null>(null);
  const [resettingStats, setResettingStats] = useState(false);
  const [statsResetNotice, setStatsResetNotice] = useState<string | null>(null);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [loadingSlashCommands, setLoadingSlashCommands] = useState(true);
  const [deleteStep, setDeleteStep] = useState<0 | 1 | 2>(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const {
    questionFallbackEnabled,
    setQuestionFallbackEnabled,
    generationProvider,
    setGenerationProvider,
    kojoStrictness,
    setKojoStrictness,
    betaMode,
  } = useSettings();
  const ADMIN_EMAILS = ["jamesinah34@gmail.com", "jamesinah883@gmail.com"];
  const isAdmin = !guest && !!user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase());
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const initialized = useRef(false);

  async function loadClearedConversations() {
    setLoadingCleared(true);
    const conversations = await fetchClearedKojoConversations();
    setClearedConversations(conversations);
    setLoadingCleared(false);
  }

  async function loadArchivedFolders() {
    setLoadingArchived(true);
    const folders = await fetchArchivedFolders();
    setArchivedFolders(folders);
    setLoadingArchived(false);
  }

  async function handleUnarchive(folderId: number) {
    setUnarchiveError(null);
    setUnarchivedFolderId(folderId);
    try {
      await unarchiveFolder(folderId);
      await loadArchivedFolders();
    } catch (err) {
      setUnarchiveError(err instanceof Error ? err.message : "Unable to restore this class.");
    } finally {
      setUnarchivedFolderId(null);
    }
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

  useEffect(() => {
    void loadArchivedFolders();
  }, [user?.id]);

  useEffect(() => {
    setLoadingSlashCommands(true);
    fetchSlashCommands()
      .then(setSlashCommands)
      .finally(() => setLoadingSlashCommands(false));
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

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount();
      setUser(null);
      navigate("/");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Account deletion failed. Please try again.");
      setDeleting(false);
    }
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
      localStorage.setItem(scopeKey(STATS_RESET_BASELINE_KEY), JSON.stringify(baseline));
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
    <div className="page page-narrow settings-page">
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
          {guest ? (
            <p className="muted">
              Guest mode works like a normal workspace, but it is limited to one folder and one practice test until you sign in.
            </p>
          ) : null}
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

        <h2 className="settings-group-title">AI &amp; models</h2>

        <CollapsibleSection title="LLM model override">
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
        </CollapsibleSection>

        <CollapsibleSection title="Question Fallback">
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
        </CollapsibleSection>

        {!guest ? (
          <>
            <CollapsibleSection title="Kojo constitution strictness">
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
            </CollapsibleSection>

            <CollapsibleSection title="Slash commands">
              <SlashCommandManager
                commands={slashCommands}
                loading={loadingSlashCommands}
                onChange={setSlashCommands}
              />
            </CollapsibleSection>
          </>
        ) : null}

        <h2 className="settings-group-title">App preferences</h2>

        {!guest && betaMode ? (
          <CollapsibleSection title="Beta features">
            <p className="muted small">
              Beta features are enabled for your account: LeetCode mode and Mock Interview. These are works-in-progress and may have rough edges. Access is granted by an admin.
            </p>
            <div className="settings-reset-row">
              <span className="pill">Beta access enabled</span>
            </div>
          </CollapsibleSection>
        ) : null}

        <CollapsibleSection title="Onboarding Tour">
          <p className="muted small">
            Replay the full guided tour across the app's key pages.
          </p>
          <div className="settings-reset-row">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                localStorage.removeItem(scopeKey(ONBOARDING_DONE_KEY));
                localStorage.removeItem(scopeKey(TOUR_SEGMENT_KEY));
                navigate("/dashboard");
              }}
            >
              Replay Tour
            </Button>
          </div>
        </CollapsibleSection>

        <h2 className="settings-group-title">Data &amp; history</h2>

        <CollapsibleSection title="Reset Study Stats">
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
        </CollapsibleSection>

        {!guest ? (
          <CollapsibleSection title="Kojo chat history restore">
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
          </CollapsibleSection>
        ) : null}

        <CollapsibleSection title="Restore archived classes">
          <p className="muted small">
            Classes you've archived are listed here. Restoring one brings it back to your dashboard.
          </p>

          {unarchiveError ? (
            <div className="settings-feedback settings-feedback--error">
              <XCircle size={16} />
              <span>{unarchiveError}</span>
            </div>
          ) : null}

          {loadingArchived ? (
            <p className="muted small">Loading archived classes…</p>
          ) : archivedFolders.length === 0 ? (
            <p className="muted small">No archived classes.</p>
          ) : (
            <div className="settings-restore-list">
              {archivedFolders.map((folder) => (
                <div className="settings-restore-item" key={folder.id}>
                  <div>
                    <p className="settings-restore-folder">{folder.name}</p>
                    {folder.subject ? <p className="muted small">{folder.subject}</p> : null}
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => void handleUnarchive(folder.id)}
                    disabled={unarchivedFolderId === folder.id}
                  >
                    {unarchivedFolderId === folder.id ? "Restoring…" : "Restore"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CollapsibleSection>

        {isAdmin ? (
          <>
            <h2 className="settings-group-title">Admin</h2>
            <CollapsibleSection title="Admin panel">
              <p className="muted small">
                Access platform metrics, user roster, and feature performance data.
              </p>
              <div className="settings-reset-row">
                <Link to="/admin" className="button button--secondary">
                  <ShieldCheck size={16} />
                  Open admin panel
                </Link>
              </div>
            </CollapsibleSection>
          </>
        ) : null}

        {!guest && user ? (
          <>
            <h2 className="settings-group-title settings-group-title--danger">Danger zone</h2>
            <CollapsibleSection title="Delete Account">
              <p className="muted small">
                Permanently delete your account and all associated data , classes, tests, flashcards, and chat history. This cannot be undone.
              </p>
              <div className="settings-reset-row">
                <Button type="button" variant="danger" onClick={() => setDeleteStep(1)}>
                  Delete account
                </Button>
              </div>
            </CollapsibleSection>
          </>
        ) : null}
      </Card>

      {deleteStep === 1 ? (
        <ConfirmModal
          title="Delete your account?"
          message="This will permanently delete your account, all classes, tests, flashcards, and chat history. This action cannot be undone."
          confirmLabel="Continue"
          danger
          onConfirm={() => { setDeleteStep(2); setDeleteError(null); }}
          onCancel={() => setDeleteStep(0)}
        />
      ) : null}

      {deleteStep === 2 ? (
        <TypeToConfirmModal
          title="Type to confirm deletion"
          message='Enter "delete" below to permanently delete your account.'
          confirmWord="delete"
          confirmLabel="Delete my account"
          loading={deleting}
          error={deleteError}
          onConfirm={handleDeleteAccount}
          onCancel={() => { setDeleteStep(0); setDeleteError(null); }}
        />
      ) : null}

    </div>
  );
}
