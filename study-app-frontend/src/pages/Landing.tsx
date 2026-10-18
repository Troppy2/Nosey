import { FileText, LogIn } from "lucide-react";
import { BookIcon, BrainIcon, ShieldIcon } from "../icons";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { InlineLoading } from "../components/Loaders";
import { PrivacyTermsModal } from "../components/PrivacyTermsModal";
import { guestSignIn, hasValidSession } from "../lib/api";
import { useEffect, useState } from "react";

const features = [
  {
    icon: FileText,
    title: "Upload notes",
    body: "Use PDF, TXT, or Markdown notes as the grounded source for practice.",
  },
  {
    icon: BookIcon,
    title: "Generate tests",
    body: "Practice with multiple choice, written, or mixed question sets.",
  },
  {
    icon: BrainIcon,
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

  return (
    <main className="landing">
      <section className="landing-card">
        <div className="landing-brand">
          <span className="brand-mark brand-mark--art" role="img" aria-label="Nosey" />
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
            <ShieldIcon size={17} />
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
              {guestLoading ? (
                <InlineLoading label="Starting a guest session" />
              ) : (
                "or keep looking around as a guest"
              )}
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
            GitHub
          </a>
          <button className="landing-footer-link landing-footer-btn" onClick={() => setPrivacyOpen(true)}>
            Privacy &amp; terms
          </button>
          <a className="landing-footer-link" href="mailto:jamesinah34@gmail.com">
            Contact
          </a>
        </footer>
      </section>

      {privacyOpen && <PrivacyTermsModal onClose={() => setPrivacyOpen(false)} />}
    </main>
  );
}
