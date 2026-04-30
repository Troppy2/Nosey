import { CheckCircle, LogIn, LogOut, Sparkles, XCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import {
  fetchClearedKojoConversations,
  getStoredUser,
  googleSignIn,
  isGuestSession,
  restoreKojoConversation,
  setGoogleSession,
  signOut,
} from "../lib/api";
import { useEffect, useRef, useState } from "react";
import type { KojoClearedConversation } from "../lib/types";

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