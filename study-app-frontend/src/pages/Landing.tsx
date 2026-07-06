import { BookOpen, Brain, FileText, LogIn, ShieldCheck, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { guestSignIn, hasValidSession } from "../lib/api";
import { useEffect, useState } from "react";

const features = [
  {
    icon: FileText,
    title: "Upload notes",
    body: "Use PDF, TXT, or Markdown notes as the grounded source for practice.",
  },
  {
    icon: BookOpen,
    title: "Generate tests",
    body: "Practice with MCQ, FRQ, or mixed question sets.",
  },
  {
    icon: Brain,
    title: "Review weak spots",
    body: "Turn missed concepts into flashcards you can revisit.",
  },
];

export default function Landing() {
  const navigate = useNavigate();

  useEffect(() => {
    if (hasValidSession()) navigate("/dashboard", { replace: true });
  }, [navigate]);

  const [guestLoading, setGuestLoading] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  useEffect(() => {
    if (!privacyOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPrivacyOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [privacyOpen]);

  return (
    <main className="landing">
      <section className="landing-card">
        <div className="landing-brand">
          <div className="brand-mark">
            <BookOpen size={25} />
          </div>
          <div>
            <h1>Nosey</h1>
            <p>Free study practice from your own notes.</p>
          </div>
        </div>

        <Card tone="soft" className="signin-card">
          <div className="signin-copy">
            <span className="eyebrow">Self-hosted study app</span>
            <h2>Build practice from material you already trust.</h2>
            <p className="muted">
              Nosey keeps the workflow focused: upload notes, take practice tests, then review the places that need another pass.
            </p>
          </div>
          <div className="signin-actions">
            <Button
              fullWidth
              icon={<LogIn size={18} />}
              onClick={() => navigate("/sign-in")}
            >
              Sign in
            </Button>
          </div>
          <div className="trust-note">
            <ShieldCheck size={17} />
            <span>Sign in to save your notes, tests, and progress across devices.</span>
          </div>
          <div className="guest-skip">
            <button
              type="button"
              className="guest-skip-link"
              disabled={guestLoading}
              onClick={async () => {
                setGuestLoading(true);
                try {
                  await guestSignIn();
                  navigate("/dashboard");
                } catch {
                  setGuestLoading(false);
                }
              }}
            >
              {guestLoading ? "Starting a guest session..." : "or keep looking around as a guest"}
            </button>
          </div>
        </Card>

        <div className="feature-list">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <Card key={feature.title} className="feature-item">
                <Icon size={21} />
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </div>
              </Card>
            );
          })}
        </div>

        <footer className="landing-footer">
          <span className="landing-footer-version">v1.0</span>
          <a
            className="landing-footer-link"
            href="https://github.com/Troppy2/Nosey"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open source
          </a>
          <button className="landing-footer-link landing-footer-btn" onClick={() => setPrivacyOpen(true)}>
            Privacy policy
          </button>
        </footer>
      </section>

      {privacyOpen && (
        <div className="modal-backdrop" onMouseDown={() => setPrivacyOpen(false)}>
          <div className="modal-card privacy-modal" role="dialog" aria-modal="true" aria-label="Privacy policy" onMouseDown={(e) => e.stopPropagation()}>
            <div className="privacy-modal-header">
              <h2>Privacy Policy</h2>
              <button className="privacy-modal-close" onClick={() => setPrivacyOpen(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="privacy-modal-body">
              <p className="muted small">Last updated: May 2025</p>

              <h3>Data we collect</h3>
              <ul>
                <li>Account info (name, email) when you sign in with Google.</li>
                <li>Notes and documents you upload to generate tests and flashcards.</li>
                <li>Test attempts and flashcard history to track your progress.</li>
                <li>Chat messages sent to the Kojo AI assistant.</li>
              </ul>

              <h3>How we use it</h3>
              <ul>
                <li>To provide the study features of the app.</li>
                <li>To send your content to AI providers (Groq, Google Gemini, Anthropic) for question generation and chat.</li>
                <li>We do not sell your data to third parties.</li>
              </ul>

              <h3>AI providers</h3>
              <p>
                Content you submit may be processed by Groq, Google Gemini, and Anthropic.
                Each provider has its own privacy policy governing data sent to their APIs.
              </p>

              <h3>Data retention</h3>
              <p>
                Data is stored while your account is active. You can delete your account and
                all associated data at any time from Settings.
              </p>

              <h3>Guest sessions</h3>
              <p>Guest sessions are temporary. Data is not persisted after the session ends.</p>

              <h3>Contact</h3>
              <p>
                Nosey is open source. For questions, open an issue on{" "}
                <a href="https://github.com/Troppy2/Nosey" target="_blank" rel="noopener noreferrer">
                  GitHub
                </a>.
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
