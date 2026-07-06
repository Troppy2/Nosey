import { ArrowLeft, BookOpen, LogIn, ShieldCheck } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import {
  googleSignIn,
  hasValidSession,
  sanitizeRedirect,
  setGoogleSession,
  submitDateOfBirth,
} from "../lib/api";
import { useEffect, useRef, useState } from "react";

// Dedicated authentication page (issue #41). Holds the Google sign-in flow,
// the age gate for brand-new accounts, and post-login redirect handling. The
// landing page routes here via its primary "Sign In" action. Guest access
// stays on the landing page so signing in is the emphasized path.
export default function SignIn() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Where to land after a successful sign-in. Sanitized to an internal path so
  // a crafted ?redirect= cannot turn this into an open redirect. Defaults to
  // /dashboard.
  const redirectTo = sanitizeRedirect(searchParams.get("redirect"));

  const [googleLoading, setGoogleLoading] = useState(false);
  const [showDobModal, setShowDobModal] = useState(false);
  const [dob, setDob] = useState("");
  const [dobError, setDobError] = useState<string | null>(null);
  const [dobLoading, setDobLoading] = useState(false);

  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const initialized = useRef(false);

  useEffect(() => {
    if (hasValidSession()) navigate(redirectTo, { replace: true });
  }, [navigate, redirectTo]);

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
            setGoogleLoading(true);
            try {
              const user = await googleSignIn(resp.credential);
              // New accounts have no date of birth yet: gate on the age prompt
              // before completing the redirect. Returning users skip straight
              // through.
              if (!user.date_of_birth) {
                setShowDobModal(true);
                setGoogleLoading(false);
              } else {
                navigate(redirectTo);
              }
            } catch (err) {
              console.error(err);
              setGoogleLoading(false);
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
  }, [clientId, navigate, redirectTo]);

  return (
    <main className="landing signin-page">
      <section className="landing-card">
        <button className="signin-back" onClick={() => navigate("/")}>
          <ArrowLeft size={16} />
          <span>Back</span>
        </button>

        <div className="landing-brand">
          <div className="brand-mark">
            <BookOpen size={25} />
          </div>
          <div>
            <h1>Sign in to Nosey</h1>
            <p>Save your notes, tests, and progress across devices.</p>
          </div>
        </div>

        <Card tone="soft" className="signin-card">
          <div className="signin-copy">
            <span className="eyebrow">Account</span>
            <h2>Continue with your Google account.</h2>
            <p className="muted">
              New here? We will ask for your date of birth once to keep the app age-appropriate. It stays private and is never shared.
            </p>
          </div>
          <div className="signin-actions">
            <Button
              fullWidth
              icon={<LogIn size={18} />}
              disabled={googleLoading}
              onClick={() => {
                if (clientId && (window as any).google?.accounts?.id) {
                  (window as any).google.accounts.id.prompt();
                  return;
                }
                // Local-dev fallback when no Google client ID is configured.
                setGoogleSession();
                navigate(redirectTo);
              }}
            >
              {googleLoading ? "Signing in..." : "Continue with Google"}
            </Button>
          </div>
          <div className="trust-note">
            <ShieldCheck size={17} />
            <span>Your notes stay tied to your account and are never sold.</span>
          </div>
        </Card>
      </section>

      {showDobModal && (
        <div className="modal-backdrop">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Date of birth" onMouseDown={(e) => e.stopPropagation()}>
            <h2>One quick thing</h2>
            <p className="muted">We use your date of birth to keep the app age-appropriate. This is kept private and never shared.</p>
            <input
              type="date"
              className="modal-input"
              value={dob}
              onChange={(e) => { setDob(e.target.value); setDobError(null); }}
              max={new Date().toISOString().split("T")[0]}
              autoFocus
            />
            {dobError && <p style={{ color: "var(--red, #c0392b)", fontSize: "0.875rem" }}>{dobError}</p>}
            <div className="button-row">
              <Button
                variant="primary"
                disabled={!dob || dobLoading}
                onClick={async () => {
                  setDobLoading(true);
                  setDobError(null);
                  try {
                    await submitDateOfBirth(dob);
                    navigate(redirectTo);
                  } catch (err) {
                    // The backend rejects out-of-range dates (under 5 / over 120).
                    // Surface its message so an invalid entry can be corrected.
                    const message = err instanceof Error && err.message
                      ? err.message
                      : "Could not save your date of birth. Please try again.";
                    setDobError(message);
                    setDobLoading(false);
                  }
                }}
              >
                {dobLoading ? "Saving..." : "Continue"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
