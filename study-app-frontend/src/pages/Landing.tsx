import { BookOpen, Brain, FileText, LogIn, ShieldCheck, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { Card } from "../components/Card";
import { InlineLoading } from "../components/Loaders";
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
            Open source
          </a>
          <button className="landing-footer-link landing-footer-btn" onClick={() => setPrivacyOpen(true)}>
            Privacy &amp; terms
          </button>
          <a className="landing-footer-link" href="mailto:jamesinah34@gmail.com">
            Contact
          </a>
        </footer>
      </section>

      {privacyOpen && (
        <div className="modal-backdrop" onMouseDown={() => setPrivacyOpen(false)}>
          <div className="modal-card privacy-modal" role="dialog" aria-modal="true" aria-label="Privacy policy and terms of service" onMouseDown={(e) => e.stopPropagation()}>
            <div className="privacy-modal-header">
              <h2>Privacy Policy &amp; Terms of Service</h2>
              <button className="privacy-modal-close" onClick={() => setPrivacyOpen(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="privacy-modal-body">
              <p className="muted small">Last updated: August 19, 2026</p>

              <p>
                Nosey is an open source study tool. This page explains what we collect, how your
                content reaches AI models, where it is stored, and the terms you agree to by using
                the app. Plain language, no hidden clauses.
              </p>

              <h3>1. What we collect</h3>
              <ul>
                <li>
                  <strong>Account details.</strong> When you sign in with Google we receive your
                  name, email address, profile picture URL, and Google account ID. We never see or
                  store your Google password.
                </li>
                <li>
                  <strong>Your study content.</strong> Notes and documents you upload (PDF, TXT,
                  and Markdown). We extract the text and store it in our database. We do not keep
                  the original file, only its name, type, size, and extracted text.
                </li>
                <li>
                  <strong>Career content.</strong> If you use Mock Interview, we store the resume
                  text you upload, the file name, and any job descriptions you save.
                </li>
                <li>
                  <strong>Your activity.</strong> Tests, questions, answers, scores, flashcard
                  review history, LeetCode practice progress, code you write in the editor, notes,
                  and streaks.
                </li>
                <li>
                  <strong>Kojo conversations.</strong> Your chat messages, Kojo's replies, and a
                  short AI-written memory summary of your study patterns used to personalize
                  replies.
                </li>
                <li>
                  <strong>Feedback.</strong> Ratings and comments you submit through in-app
                  surveys.
                </li>
                <li>
                  <strong>Age.</strong> Your date of birth, which we ask for once, and your age.
                </li>
                <li>
                  <strong>Usage metrics.</strong> For each AI request we log which feature was
                  used, how long it took, which provider answered, an estimated token count, and
                  whether it succeeded. This is for cost and reliability monitoring. It does not
                  include the content of the request.
                </li>
              </ul>

              <h3>2. How your content reaches AI models</h3>
              <p>
                This is the most important section. Nosey cannot generate tests, flashcards, or
                chat replies without sending your content to an external AI provider. When you
                trigger any AI feature, the relevant text leaves our servers.
              </p>
              <p>
                <strong>What gets sent:</strong> the extracted text of your notes, or the most
                relevant excerpts of it, your resume and job description text for Mock Interview,
                your code and problem context for LeetCode help, your chat messages and recent
                conversation history for Kojo, and your written answers when they are being
                graded. Your name, email, and Google ID are <strong>not</strong> included in these
                requests.
              </p>
              <p><strong>Who receives it.</strong> We use four providers:</p>
              <ul>
                <li>
                  <strong>Ollama Cloud</strong> (Gemma). Tried first by default for most requests.
                </li>
                <li>
                  <strong>Groq</strong> (Llama 3.3 70B for generating questions and flashcards,
                  Llama 3.1 8B for Kojo chat).
                </li>
                <li><strong>Google Gemini</strong> (Gemini 2.0 Flash).</li>
                <li><strong>Anthropic Claude</strong> (Claude Haiku).</li>
              </ul>
              <p>
                <strong>Routing and fallback.</strong> By default Nosey runs in "auto" mode and
                tries providers in order of cost, starting with Ollama Cloud and using Anthropic
                last. If a provider fails, is rate limited, or times out, the same content is
                re-sent to the next provider in the list. A single action can therefore send your
                content to more than one provider before it succeeds. Admin and beta users can
                override which provider is tried first. Everyone else is pinned to auto.
              </p>
              <p>
                <strong>Provider retention is outside our control.</strong> Once your content
                reaches a provider it is governed by that company's privacy policy and retention
                terms, not ours. We do not have a zero-retention or no-training agreement in place
                with any of them. If any part of your notes, resume, or chat messages is
                confidential, do not put it into Nosey. Review each provider's policy directly:{" "}
                <a href="https://ollama.com/privacy" target="_blank" rel="noopener noreferrer">Ollama</a>,{" "}
                <a href="https://groq.com/privacy-policy/" target="_blank" rel="noopener noreferrer">Groq</a>,{" "}
                <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google</a>,{" "}
                <a href="https://www.anthropic.com/legal/privacy" target="_blank" rel="noopener noreferrer">Anthropic</a>.
              </p>

              <h3>3. Search indexing of your notes</h3>
              <p>
                To find the most relevant parts of long documents, Nosey splits your notes into
                chunks and stores them, along with numeric embeddings, in Qdrant Cloud, a hosted
                vector database running on AWS. Those chunks contain the text of your notes.
                Embeddings are generated on our own server, not by a third party.
              </p>
              <p>
                Deleting your account also deletes these chunks. Every chunk is stored with the
                account it came from, and the index is purged before the account record is removed.
                If that purge fails, the deletion is aborted and nothing is deleted, so your account
                is never removed while note text of yours is still indexed. You can retry, or
                contact us using the details in section 13.
              </p>

              <h3>4. Where your data is stored</h3>
              <ul>
                <li><strong>Database:</strong> Neon, hosted PostgreSQL, US East.</li>
                <li><strong>Vector index:</strong> Qdrant Cloud, AWS, US West.</li>
                <li><strong>Backend:</strong> Render.</li>
                <li><strong>Frontend:</strong> Vercel.</li>
              </ul>
              <p>
                These vendors process data on our behalf as infrastructure providers. Data is
                stored in the United States. If you use Nosey from outside the US, your data is
                transferred there.
              </p>

              <h3>5. Analytics</h3>
              <p>
                We use Vercel Speed Insights to measure page load performance. It collects
                anonymous technical data such as load timings, browser, and approximate region. We
                do not use advertising trackers and we do not build advertising profiles.
              </p>

              <h3>6. Who else can see your data</h3>
              <ul>
                <li><strong>We do not sell your data.</strong> Ever, to anyone.</li>
                <li>
                  The AI providers and infrastructure vendors listed above, strictly to deliver the
                  features you asked for.
                </li>
                <li>
                  Nosey administrators, who can see the account list (names, emails, sign-up dates,
                  admin and beta status), aggregate usage statistics, and survey responses.
                  Administrators have no in-app tool for reading your notes or Kojo conversations,
                  but as operators of the database they are technically able to access stored
                  content. We do so only when strictly necessary to fix a fault.
                </li>
                <li>Law enforcement, if we are legally compelled.</li>
              </ul>

              <h3>7. Guest sessions</h3>
              <p>
                Guest accounts are real accounts. When you continue as a guest we create a user
                record in our database, and anything you make in that session is stored there just
                like a signed-in user's data. The difference is that a guest account has no email
                attached, so once the session token in your browser is gone the account cannot be
                recovered, and you cannot use the in-app delete option to remove it. Do not put
                anything sensitive into a guest session.
              </p>

              <h3>8. Retention and deleting your data</h3>
              <p>
                We keep your data while your account exists. You can delete your account at any
                time from Settings. That permanently removes your account record and everything
                linked to it, including folders, uploaded note text, tests, attempts, flashcards,
                Kojo conversations, resumes, job descriptions, and LeetCode progress. Deletion is
                immediate and cannot be undone.
              </p>
              <p>
                Deletion covers the note chunks in the vector index as well (see section 3). One
                exception remains, stated plainly: content already sent to an AI provider is
                subject to that provider's retention schedule and is beyond our reach.
              </p>

              <h3>9. Age requirement</h3>
              <p>
                Nosey is not intended for children under 13. We ask for your date of birth after
                sign-in. If we learn that we hold data from a child under 13, we will delete it. A
                parent or guardian can contact us at{" "}
                <a href="mailto:jamesinah34@gmail.com">jamesinah34@gmail.com</a> to request removal.
              </p>

              <h3>10. Security</h3>
              <p>
                Traffic is encrypted in transit, sessions use signed tokens that expire after 30
                days, and access is scoped so you can only reach your own records. No system is
                perfectly secure, and Nosey is a small open source project rather than an audited
                commercial service. Please size your trust accordingly.
              </p>

              <h3>11. Your choices</h3>
              <ul>
                <li>
                  Do not upload anything sensitive. This is the strongest control you have.
                </li>
                <li>
                  Delete individual folders, files, tests, flashcards, or conversations at any time.
                </li>
                <li>Delete your entire account from Settings.</li>
                <li>
                  Request a copy of your data, or corrections to it, by contacting us at{" "}
                  <a href="mailto:jamesinah34@gmail.com">jamesinah34@gmail.com</a>.
                </li>
              </ul>

              <h3>12. Changes to this policy</h3>
              <p>
                If we change how data is handled in a material way, we will update this page and
                the "last updated" date above. Because Nosey is open source, you can also read the
                exact code that handles your data.
              </p>

              <h3>13. Contact</h3>
              <p>
                Email{" "}
                <a href="mailto:jamesinah34@gmail.com">jamesinah34@gmail.com</a>{" "}
                or open an issue on{" "}
                <a href="https://github.com/Troppy2/Nosey" target="_blank" rel="noopener noreferrer">
                  GitHub
                </a>{" "}
                for anything privacy related, including data access and deletion requests.
              </p>

              <hr className="policy-divider" />

              <h2 className="policy-section-title" id="terms">Terms of Service</h2>
              <p className="muted small">Last updated: August 19, 2026</p>

              <h3>1. Agreement</h3>
              <p>
                By using Nosey, including as a guest, you agree to these terms. If you do not
                agree, please do not use the app.
              </p>

              <h3>2. Eligibility</h3>
              <p>
                You must be at least 13 years old to use Nosey. If you are under the age of
                majority where you live, you may use it only with the involvement of a parent or
                guardian. You agree to give an accurate date of birth when asked.
              </p>

              <h3>3. Your account</h3>
              <p>
                You are responsible for activity under your account and for keeping your Google
                account secure. Guest sessions are tied to a token stored in your browser. If you
                clear your browser data or switch devices, that guest account and its contents are
                unrecoverable. We cannot restore them.
              </p>

              <h3>4. Your content</h3>
              <p>
                You keep ownership of everything you upload and create. You grant us only the
                permission needed to run the service: to store your content, process it, and
                transmit it to the AI providers listed in the privacy policy so we can generate the
                output you asked for. We claim no other rights, and we do not use your content to
                train our own models.
              </p>
              <p>
                You confirm that you have the right to upload what you upload. Do not upload
                material that infringes copyright, or that you are contractually or legally barred
                from sharing with third party AI services, such as confidential work documents or
                other people's personal data.
              </p>

              <h3>5. Acceptable use</h3>
              <p>Do not use Nosey to:</p>
              <ul>
                <li>Break the law or infringe anyone's rights.</li>
                <li>
                  Upload malware, attempt to access other users' data, or probe, overload, or
                  disrupt the service or its AI providers.
                </li>
                <li>
                  Bypass rate limits, quotas, or the provider restrictions applied to your account,
                  or automate access in a way that runs up our API costs.
                </li>
                <li>Generate content that is illegal, harassing, or designed to harm others.</li>
                <li>Resell or rebrand the hosted service as your own.</li>
              </ul>
              <p>
                We may suspend or delete accounts that break these rules, in serious cases without
                notice.
              </p>

              <h3>6. AI output, accuracy, and academic integrity</h3>
              <p>
                Everything Nosey generates, including questions, answers, explanations, grades,
                flashcards, code, and interview feedback, is produced by AI models and{" "}
                <strong>may be wrong</strong>. Grading in particular is an estimate, not an
                authoritative score. Always check important material against your own sources.
              </p>
              <p>
                You are responsible for using Nosey in line with your school or employer's rules.
                Many institutions restrict AI assistance on graded work. Nosey is built as a study
                aid, not as a way to complete assessments on your behalf, and we are not
                responsible for academic or professional consequences arising from how you use it.
              </p>
              <p>
                Mock Interview feedback, ATS scores, and career suggestions are practice tools, not
                professional career advice, and they do not indicate any real hiring outcome.
              </p>

              <h3>7. Availability</h3>
              <p>
                Nosey is offered with no uptime guarantee. It depends on third party AI providers
                with their own rate limits and outages, so features may be slow, degraded, or
                unavailable. We may change, suspend, or discontinue any part of the service at any
                time. We are not obliged to keep your data indefinitely, but we will make a
                reasonable effort to warn you before any planned shutdown.
              </p>

              <h3>8. No warranty</h3>
              <p>
                Nosey is provided "as is" and "as available", without warranties of any kind,
                express or implied, including merchantability, fitness for a particular purpose,
                and non-infringement. We do not warrant that the service will be uninterrupted,
                secure, or error free, or that generated content will be accurate.
              </p>

              <h3>9. Limitation of liability</h3>
              <p>
                To the maximum extent permitted by law, we are not liable for any indirect,
                incidental, special, consequential, or punitive damages, or for any loss of data,
                grades, opportunities, or profits, arising from your use of Nosey. Because the
                service is provided free of charge, our total liability to you is limited to the
                amount you have paid us, which is zero.
              </p>

              <h3>10. Termination</h3>
              <p>
                You may stop using Nosey and delete your account at any time from Settings. We may
                terminate or suspend access if you breach these terms or if we discontinue the
                service. Sections 4, 6, 8, 9, and 11 survive termination.
              </p>

              <h3>11. Open source</h3>
              <p>
                The Nosey source code is released under the MIT License and you are free to run
                your own copy under that license. These terms govern the hosted service we operate,
                not the code itself. Running your own instance makes you the operator, responsible
                for your own users, API keys, and compliance.
              </p>

              <h3>12. Changes to these terms</h3>
              <p>
                We may update these terms. Continuing to use Nosey after the "last updated" date
                changes means you accept the revised version. Material changes will be highlighted
                in the app where practical.
              </p>

              <h3>13. Contact</h3>
              <p>
                Questions about these terms? Email{" "}
                <a href="mailto:jamesinah34@gmail.com">jamesinah34@gmail.com</a>{" "}
                or open an issue on{" "}
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
