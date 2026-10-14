import { AlertTriangle, Check, Link2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { InlineLoading } from "../components/Loaders";
import { decideMcpConsentRequest, fetchMcpConsentRequest, hasValidSession } from "../lib/api";
import type { McpConsentRequest } from "../lib/types";

// Consent page for the MCP connector. An app like Claude or ChatGPT sends the
// user here (via the backend's /oauth/authorize) to approve access to their
// library. Lives outside RequireAuth so a signed-out user is bounced through
// /sign-in and lands back here with the same request id.
export default function ConnectAuthorize() {
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get("request") ?? "";
  const signedIn = hasValidSession();
  const [details, setDetails] = useState<McpConsentRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<"approve" | "deny" | null>(null);

  useEffect(() => {
    if (!signedIn || !requestId) return;
    let cancelled = false;
    fetchMcpConsentRequest(requestId)
      .then((data) => {
        if (!cancelled) setDetails(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [requestId, signedIn]);

  if (!signedIn) {
    const back = `/connect/authorize?request=${encodeURIComponent(requestId)}`;
    return <Navigate to={`/sign-in?redirect=${encodeURIComponent(back)}`} replace />;
  }

  // Clickjacking guard: Vercel sends frame-ancestors 'none' for /connect/*, but
  // local dev and other hosts do not, so never show Allow inside a frame.
  if (window.top !== window.self) {
    return (
      <main className="landing signin-page">
        <section className="landing-card">
          <Card tone="soft" className="signin-card">
            <p>Open this page in its own browser tab to connect an app.</p>
          </Card>
        </section>
      </main>
    );
  }

  const unverified = details?.trust === "unverified";
  const destination = details?.trust === "local" ? "an app on this computer" : details?.redirect_host;

  async function decide(approve: boolean) {
    setDeciding(approve ? "approve" : "deny");
    setError(null);
    try {
      const url = await decideMcpConsentRequest(requestId, approve);
      window.location.assign(url);
    } catch (err) {
      setError((err as Error).message);
      setDeciding(null);
    }
  }

  return (
    <main className="landing signin-page">
      <section className="landing-card">
        <div className="landing-brand">
          <span className="brand-mark brand-mark--art" role="img" aria-label="Nosey" />
          <div>
            <h1>{details && !unverified ? `Connect ${details.client_name}` : "Connect an app"}</h1>
            <p>Let another app build study material in your Nosey library.</p>
          </div>
        </div>

        <Card tone="soft" className="signin-card connect-card">
          {!requestId ? (
            <p className="muted">This link is missing its request. Start connecting again from the app.</p>
          ) : error ? (
            <div className="connect-error">
              <p>{error}</p>
              <Link to="/dashboard" className="button button-secondary">
                Go to dashboard
              </Link>
            </div>
          ) : !details ? (
            <InlineLoading label="Loading request" />
          ) : (
            <>
              <div className="signin-copy">
                <h2>
                  <Link2 size={18} />{" "}
                  {unverified ? `An app calling itself "${details.client_name}"` : details.client_name} wants access to
                  your library
                </h2>
                <p className="muted">It will be able to:</p>
              </div>
              {unverified && (
                <div className="connect-warning" role="alert">
                  <AlertTriangle size={18} />
                  <p>
                    Nosey can't verify this app. Anyone can register an app under any name. Only allow it if you
                    started connecting it yourself and expected to be sent to <strong>{details.redirect_host}</strong>.
                  </p>
                </div>
              )}
              <ul className="connect-scopes">
                <li>
                  <Check size={16} /> Read your folders, notes, tests, flashcards and learning modules
                </li>
                <li>
                  <Check size={16} /> Create and rename folders (never delete them)
                </li>
                <li>
                  <Check size={16} /> Create, edit and delete tests, flashcards, notes and learning modules
                </li>
              </ul>
              <p className="small muted">
                After you choose, you go back to <strong>{destination}</strong>.
              </p>
              <div className="button-row connect-actions">
                <Button variant="ghost" disabled={deciding !== null} onClick={() => decide(false)}>
                  {deciding === "deny" ? <InlineLoading label="Cancelling" /> : "Cancel"}
                </Button>
                <Button variant="primary" disabled={deciding !== null} onClick={() => decide(true)}>
                  {deciding === "approve" ? <InlineLoading label="Connecting" /> : "Allow"}
                </Button>
              </div>
              <div className="trust-note">
                <ShieldCheck size={17} />
                <span>Only allow apps you started connecting yourself.</span>
              </div>
            </>
          )}
        </Card>
      </section>
    </main>
  );
}
