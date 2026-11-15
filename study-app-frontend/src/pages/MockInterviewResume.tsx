import { Loader2 } from "lucide-react";
import { AlertIcon, ArrowLeftIcon, BookIcon, ChatIcon, ChevronRightIcon, CloseIcon, UploadIcon } from "../icons";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { getSavedResume, screenResume, sendResumeGrillMessage } from "../lib/api";
import type { InterviewChatMessage, MockInterviewSession, ResumeScreenResult, SavedResume } from "../lib/types";
import { COMPANY_OPTIONS, type CompanyKey } from "../data/mockInterviewProblems";
import { answerTooLong, loadMockProgress, saveMockProgress, type MockProgress, type MockCompany } from "../lib/mockInterview";
import { MockProgressGate } from "../components/MockProgressGate";
import { VoiceRoom } from "../components/VoiceRoom";
import { useInterviewerVoice } from "../lib/voice";
import { VoicePicker } from "../components/VoiceStart";
import { ToggleSwitch } from "../components/ToggleSwitch";
import { ProgressBar, useStagedProgress, type ProgressStage } from "../components/Progress";
import { formatSavedDate } from "../components/SavedResumeCard";
import "../styles/components/mock-debrief.css";
import "../styles/components/mock-setup.css";
import "../styles/components/mock-ats.css";

const ACCEPT = ".pdf,.docx,.doc,.txt,.md,.tex";

// What the scan actually does, for the progress bar. Only the ratios matter.
const SCAN_STAGES: ProgressStage[] = [
  { label: "Reading your resume", seconds: 2 },
  { label: "Matching keywords to the role", seconds: 5 },
  { label: "Writing the recruiter's read", seconds: 6 },
];

// The score color follows the verdict, so a passing 74 never reads as a warning.
function scoreTone(result: ResumeScreenResult): string {
  if (result.passes_oa) return "debrief-tone-good";
  if (result.ats_score >= 50) return "debrief-tone-mid";
  return "debrief-tone-bad";
}

type InputMode = "saved" | "upload" | "paste";

export default function MockInterviewResume() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <MockProgressGate
      sessionId={Number(sessionId)}
      label="Loading your resume screen"
      render={(stored) => <ResumeScreenView stored={stored} />}
    />
  );
}

function ResumeScreenView({ stored }: { stored: MockProgress | null }) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const numericSessionId = Number(sessionId);
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { session?: MockInterviewSession; selectedStages?: string[] } | null;

  const rawCompany = (state?.session?.company ?? stored?.company ?? "random") as MockCompany;
  const company = (rawCompany === "custom" ? "random" : rawCompany) as CompanyKey;
  const companyLabel =
    rawCompany === "custom"
      ? state?.session?.custom_company ?? stored?.customCompany ?? "Custom"
      : COMPANY_OPTIONS.find((c) => c.key === company)?.label ?? company;
  const selectedStages = state?.selectedStages ?? stored?.selectedStages ?? [
    "resume",
    "stage1",
    "stage2",
    "stage3",
  ];

  const missingContext = !state?.session && !stored;

  const [text, setText] = useState(() => stored?.resume?.inputText ?? "");
  // A File cannot be restored after a reload, so only a file picked on this visit counts.
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<InputMode>(() =>
    stored?.resume?.inputText && !stored?.resume?.fileName ? "paste" : "upload",
  );
  // Once the user picks a tab or a file, the saved resume no longer steals the default.
  const modeTouched = useRef(Boolean(stored?.resume?.inputText));
  const [saved, setSaved] = useState<SavedResume | null>(null);
  const [saveAsMine, setSaveAsMine] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ResumeScreenResult | null>(() => stored?.resume?.result ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scan = useStagedProgress(SCAN_STAGES, { running: loading, done: false });

  // Resume deep dive: the interviewer grills the candidate on their own resume. Opens
  // only after a scan (the server needs the parsed resume to quote from) and is always
  // skippable, like the scan itself. It runs in the same full-screen voice room as the
  // technical and behavioral rounds; a run in progress reopens straight into it.
  const [grillOpen, setGrillOpen] = useState(
    () => (stored?.resume?.grillMessages?.length ?? 0) > 0 && !stored?.resume?.grillDone,
  );
  const [grillMessages, setGrillMessages] = useState<InterviewChatMessage[]>(
    () => stored?.resume?.grillMessages ?? [],
  );
  const [grillCoveredGoals, setGrillCoveredGoals] = useState<string[]>(
    () => stored?.resume?.grillCoveredGoals ?? [],
  );
  // Follow-ups Kojo has asked on the current question; the server returns it each turn.
  const [grillFollowups, setGrillFollowups] = useState(() => stored?.resume?.grillFollowups ?? 0);
  const [grillDone, setGrillDone] = useState(() => stored?.resume?.grillDone ?? false);
  const voice = useInterviewerVoice();
  const [grillSending, setGrillSending] = useState(false);
  const [grillError, setGrillError] = useState<string | null>(null);

  const GRILL_TOTAL_GOALS = 5;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLElement>(null);

  // The saved resume (from the interview home) becomes the default input when there is one.
  useEffect(() => {
    let cancelled = false;
    getSavedResume()
      .then((row) => {
        if (cancelled || !row) return;
        setSaved(row);
        setSaveAsMine(false);
        if (!modeTouched.current) setMode("saved");
      })
      .catch(() => {
        // No saved resume reachable: upload and paste still work.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function persist(partial: Partial<NonNullable<MockProgress["resume"]>>, completed?: boolean) {
    if (!Number.isFinite(numericSessionId)) return;
    const prev = loadMockProgress(numericSessionId);
    const base = prev?.resume ?? { inputText: "", fileName: null, result: null, completed: false };
    saveMockProgress({
      ...(prev ?? { sessionId: numericSessionId, company: rawCompany, selectedStages, updatedAt: Date.now() }),
      sessionId: numericSessionId,
      company: rawCompany,
      selectedStages,
      updatedAt: Date.now(),
      resume: { ...base, ...partial, completed: completed ?? base.completed },
    });
  }

  // One turn of the deep dive. `message` is null for the opening question.
  async function sendGrillTurn(message: string | null) {
    if (grillSending) return;
    const tooLong = message ? answerTooLong(message) : null;
    if (tooLong) {
      setGrillError(tooLong);
      return;
    }
    setGrillError(null);
    setGrillSending(true);
    const history = message === null ? [] : grillMessages;
    const nextHistory =
      message === null ? [] : [...grillMessages, { role: "user", content: message } as InterviewChatMessage];
    if (message !== null) {
      setGrillMessages(nextHistory);
      voice.stop();
    }
    try {
      const res = await sendResumeGrillMessage(numericSessionId, message, history, grillCoveredGoals, grillFollowups);
      const withReply = [...nextHistory, { role: "interviewer", content: res.reply } as InterviewChatMessage];
      setGrillMessages(withReply);
      void voice.speak(res.reply);
      const covered = res.covered_goals ?? grillCoveredGoals;
      setGrillCoveredGoals(covered);
      const followups = res.followups_on_current ?? 0;
      setGrillFollowups(followups);
      setGrillDone(res.is_done);
      persist({ grillMessages: withReply, grillCoveredGoals: covered, grillFollowups: followups, grillDone: res.is_done });
    } catch (e: unknown) {
      setGrillError(e instanceof Error ? e.message : "Could not reach the interviewer. Try again.");
    } finally {
      setGrillSending(false);
    }
  }

  function startGrill() {
    setGrillOpen(true);
    if (grillMessages.length === 0) void sendGrillTurn(null);
  }

  function nextLabel() {
    if (selectedStages.includes("stage1")) return "the online assessment";
    if (selectedStages.includes("stage2")) return "the technical round";
    if (selectedStages.includes("stage3")) return "the behavioral round";
    return "your debrief";
  }

  function nextRoute() {
    if (selectedStages.includes("stage1")) return `/mock-interview/${sessionId}/stage1`;
    if (selectedStages.includes("stage2")) return `/mock-interview/${sessionId}/stage2`;
    if (selectedStages.includes("stage3")) return `/mock-interview/${sessionId}/stage3`;
    return `/mock-interview/${sessionId}/summary`;
  }

  function pickMode(next: InputMode) {
    modeTouched.current = true;
    setMode(next);
    setError(null);
  }

  function takeFile(f: File | null) {
    modeTouched.current = true;
    setFile(f);
    setError(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) takeFile(f);
  }

  function clearFile() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleScreen() {
    if (loading) return;
    if (mode === "upload" && !file) {
      setError("Choose a PDF or DOCX file to scan.");
      return;
    }
    if (mode === "paste" && text.trim().length < 40) {
      setError("Paste at least a few lines of your resume to scan.");
      return;
    }
    setError(null);
    setLoading(true);
    const keep = mode !== "saved" && saveAsMine;
    try {
      const res = await screenResume(numericSessionId, {
        file: mode === "upload" ? file : null,
        text: mode === "paste" ? text : "",
        useSaved: mode === "saved",
        saveAsMine: keep,
      });
      setResult(res);
      const fileName = mode === "upload" ? file?.name ?? null : mode === "saved" ? saved?.file_name ?? null : null;
      persist({ inputText: mode === "paste" ? text : "", fileName, result: res });
      if (keep) {
        const nextSaved: SavedResume = {
          file_name: mode === "upload" ? file?.name ?? null : null,
          updated_at: new Date().toISOString(),
          chars: mode === "paste" ? text.trim().length : saved?.chars ?? 0,
        };
        setSaved(nextSaved);
        setSaveAsMine(false);
      }
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not scan the resume. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleContinue() {
    persist({ result }, true);
    navigate(nextRoute(), { state: { session: state?.session, selectedStages } });
  }

  if (missingContext) {
    navigate("/mock-interview", { replace: true });
    return null;
  }

  if (grillOpen && result) {
    return (
      <>
        {grillError && (
          <div className="voice-banner" role="alert">
            <AlertIcon size={14} /> {grillError}
            <button
              type="button"
              onClick={() => {
                const lastUser = [...grillMessages].reverse().find((m) => m.role === "user");
                const lastIsUser = grillMessages[grillMessages.length - 1]?.role === "user";
                if (grillMessages.length === 0) void sendGrillTurn(null);
                else if (lastIsUser && lastUser) {
                  setGrillMessages(grillMessages.slice(0, -1));
                  void sendGrillTurn(lastUser.content);
                } else setGrillError(null);
              }}
            >
              Retry
            </button>
          </div>
        )}
        <VoiceRoom
          title="Resume deep dive"
          subtitle={`${companyLabel} hiring manager`}
          interviewerName="Kojo"
          messages={grillMessages}
          covered={Math.min(grillCoveredGoals.length, GRILL_TOTAL_GOALS)}
          total={GRILL_TOTAL_GOALS}
          waiting={grillSending}
          done={grillDone}
          onSend={(answer) => void sendGrillTurn(answer)}
          onLeave={() => {
            voice.stop();
            setGrillOpen(false);
          }}
          voice={voice}
          nextLabel={nextLabel()}
          onAdvance={handleContinue}
          doneAction={
            <button type="button" className="voice-send" onClick={handleContinue}>
              Continue
            </button>
          }
        />
      </>
    );
  }

  const modes: { key: InputMode; label: string }[] = [
    ...(saved ? [{ key: "saved" as const, label: "Saved resume" }] : []),
    { key: "upload", label: "Upload" },
    { key: "paste", label: "Paste" },
  ];
  const canRun = mode === "saved" ? Boolean(saved) : mode === "upload" ? Boolean(file) : text.trim().length >= 40;
  const hasKeywords = result ? result.matched_keywords.length + result.missing_keywords.length > 0 : false;

  return (
    <div className="debrief ats2">
      <header className="debrief-head">
        <button type="button" className="debrief-back" onClick={() => navigate("/mock-interview")}>
          <ArrowLeftIcon size={16} /> Leave interview
        </button>
        <span className="debrief-kicker">{companyLabel}, resume screen</span>
        <h1 className="ats2-title">Would this resume get you an OA?</h1>
        <p className="debrief-lede">
          An ATS and a {companyLabel} recruiter read it first. This round never blocks the loop.
        </p>
      </header>

      <section className="ats2-input" aria-label="Your resume">
        <div
          className={`setup2-segment ats2-segment ats2-segment--${modes.length}`}
          role="radiogroup"
          aria-label="Resume source"
        >
          {modes.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={mode === m.key}
              className={mode === m.key ? "is-on" : ""}
              onClick={() => pickMode(m.key)}
              disabled={loading}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode === "saved" && saved && (
          <div className="setup2-cv ats2-file">
            <span className="setup2-cv-icon" aria-hidden>
              <BookIcon size={18} />
            </span>
            <span className="setup2-cv-text">
              <span className="setup2-cv-name">{saved.file_name ?? "Pasted resume"}</span>
              <span className="setup2-cv-meta">Saved {formatSavedDate(saved.updated_at)}</span>
            </span>
          </div>
        )}

        {mode === "upload" &&
          (file ? (
            <div className="setup2-cv ats2-file">
              <span className="setup2-cv-icon" aria-hidden>
                <BookIcon size={18} />
              </span>
              <span className="setup2-cv-text">
                <span className="setup2-cv-name">{file.name}</span>
                <span className="setup2-cv-meta">Ready to scan</span>
              </span>
              <button
                type="button"
                className="setup2-cv-remove"
                onClick={clearFile}
                disabled={loading}
                aria-label="Remove file"
                title="Remove file"
              >
                <CloseIcon size={16} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={`ats2-drop${dragging ? " is-dragging" : ""}`}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <UploadIcon size={20} />
              <span className="ats2-drop-title">Drop your resume here or browse</span>
              <span className="ats2-drop-sub">PDF, DOCX, TXT or LaTeX</span>
            </button>
          ))}
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          onChange={(e) => takeFile(e.target.files?.[0] ?? null)}
          hidden
        />

        {mode === "paste" && (
          <textarea
            className="ats2-paste"
            aria-label="Resume text"
            placeholder={"Paste your resume as plain text or LaTeX source"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={10}
            disabled={loading}
          />
        )}

        {mode !== "saved" && (
          <ToggleSwitch
            className="ats2-keep"
            checked={saveAsMine}
            onClick={() => setSaveAsMine((v) => !v)}
            disabled={loading}
            label={saved ? "Replace my saved resume with this one" : "Save as my resume for next time"}
          />
        )}

        {error && (
          <p className="ats2-error" role="alert">
            <AlertIcon size={15} /> {error}
          </p>
        )}

        {loading ? (
          <ProgressBar
            value={scan.percent}
            label={SCAN_STAGES[Math.min(scan.activeStage, SCAN_STAGES.length - 1)].label}
          />
        ) : (
          <div className="ats2-run">
            <button
              type="button"
              className={result ? "debrief-btn" : "debrief-btn debrief-btn-primary"}
              onClick={() => void handleScreen()}
              disabled={!canRun}
            >
              {result ? "Scan again" : "Scan resume"}
            </button>
          </div>
        )}
      </section>

      {result && (
        <section className="ats2-result" ref={resultRef} aria-live="polite" aria-label="ATS result">
          <div className="ats2-score-row">
            <span className={`ats2-score ${scoreTone(result)}`}>
              {result.ats_score}
              <span className="ats2-score-max">/100</span>
            </span>
            <span className="ats2-score-side">
              <span className={`debrief-verdict ${result.passes_oa ? "debrief-tone-good" : "debrief-tone-bad"}`}>
                {result.passes_oa ? "OA likely" : "OA unlikely"}
              </span>
              <span className="ats2-verdict">{result.verdict}</span>
            </span>
          </div>
          <div className="ats2-meter" aria-hidden>
            <span className={scoreTone(result)} style={{ width: `${result.ats_score}%` }} />
          </div>
          {result.summary && <p className="ats2-summary">{result.summary}</p>}
        </section>
      )}

      {result && (hasKeywords || result.strengths.length + result.gaps.length + result.fixes.length > 0) && (
        <section className="debrief-rows" aria-label="Scan details">
          {hasKeywords && (
            <div className="debrief-row">
              <div className="debrief-row-side">
                <h2>Keywords</h2>
                <span className="debrief-meta">
                  {result.matched_keywords.length} matched, {result.missing_keywords.length} missing
                </span>
              </div>
              <div className="ats2-chips">
                {result.matched_keywords.map((k) => (
                  <span key={`m-${k}`} className="ats2-chip ats2-chip--match">
                    {k}
                  </span>
                ))}
                {result.missing_keywords.map((k) => (
                  <span key={`x-${k}`} className="ats2-chip ats2-chip--miss">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}
          {[
            { title: "Strengths", items: result.strengths },
            { title: "Gaps", items: result.gaps },
            { title: "How to improve", items: result.fixes },
          ]
            .filter((row) => row.items.length > 0)
            .map((row) => (
              <div key={row.title} className="debrief-row">
                <div className="debrief-row-side">
                  <h2>{row.title}</h2>
                </div>
                <ul className="ats2-list">
                  {row.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
        </section>
      )}

      {/* Resume deep dive: only offered once a scan has run, since the interviewer
          quotes the parsed resume back at the candidate. */}
      {result && (
        <section className="debrief-section ats2-grill">
          <h2>Resume deep dive</h2>
          <p className="ats2-grill-text">
            {grillDone
              ? "Done. Your answers feed the final debrief."
              : grillMessages.length > 0
                ? `${Math.min(grillCoveredGoals.length, GRILL_TOTAL_GOALS)} of ${GRILL_TOTAL_GOALS} questions covered. Progress is saved.`
                : `Kojo, as a ${companyLabel} hiring manager, asks five questions on your own projects, numbers and choices.`}
          </p>
          <div className="ats2-grill-actions">
            {grillMessages.length === 0 && <VoicePicker compact />}
            <button
              type="button"
              className="debrief-btn debrief-btn-primary"
              onClick={startGrill}
              disabled={grillSending}
            >
              {grillSending ? <Loader2 size={15} className="spin" /> : <ChatIcon size={15} />}
              {grillDone ? "Open transcript" : grillMessages.length > 0 ? "Resume the deep dive" : "Start the deep dive"}
            </button>
          </div>
        </section>
      )}

      <div className="setup2-footer ats2-footer">
        <span className="setup2-footer-meta">Next up: {nextLabel()}</span>
        <button type="button" className="setup2-start" onClick={handleContinue}>
          {result ? "Continue" : "Skip the screen"} <ChevronRightIcon size={16} />
        </button>
      </div>
    </div>
  );
}
