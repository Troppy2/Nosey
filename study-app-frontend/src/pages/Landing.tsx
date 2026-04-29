import { ArrowRight, BookOpen, Brain, FileText, LogIn, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { setGoogleSession, setGuestSession, googleSignIn } from "../lib/api";
import { useEffect, useRef, useState } from "react";

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
  const [googleLoading, setGoogleLoading] = useState(false);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const initialized = useRef(false);

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
              await googleSignIn(resp.credential);
              navigate("/dashboard");
            } catch (err) {
              console.error(err);
            } finally {
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
  }, [clientId, navigate]);

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
              onClick={async () => {
                if (clientId && (window as any).google?.accounts?.id) {
                  (window as any).google.accounts.id.prompt();
                  return;
                }
                setGoogleSession();
                navigate("/dashboard");
              }}
            >
              {googleLoading ? "Signing in..." : "Google sign in"}
            </Button>
            <Button
              fullWidth
              icon={<ArrowRight size={19} />}
              variant="secondary"
              onClick={() => {
                setGuestSession();
                navigate("/dashboard");
              }}
            >
              Continue as guest
            </Button>
          </div>
          <div className="trust-note">
            <ShieldCheck size={17} />
            <span>AI feedback can be wrong, so answers stay tied to your uploaded notes.</span>
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
      </section>
    </main>
  );
}
