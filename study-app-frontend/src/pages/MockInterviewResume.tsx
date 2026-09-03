import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  FileText,
  Loader2,
  LogOut,
  MessagesSquare,
  ScanLine,
  Send,
  Type,
  Upload,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { screenResume, sendResumeGrillMessage } from "../lib/api";
import type { InterviewChatMessage, MockInterviewSession, ResumeScreenResult } from "../lib/types";
import { COMPANY_OPTIONS, type CompanyKey } from "../data/mockInterviewProblems";
import { loadMockProgress, saveMockProgress, type MockProgress, type MockCompany } from "../lib/mockInterview";
import { MockProgressGate } from "../components/MockProgressGate";

const ACCEPT = ".pdf,.docx,.doc,.txt,.md,.tex";

function scoreColor(score: number): string {
  if (score >= 80) return "#10b981";
  if (score >= 65) return "#3b82f6";
  if (score >= 50) return "#d97706";
  return "#dc2626";
}

type InputMode = "upload" | "paste";

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
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(() => stored?.resume?.fileName ?? null);
  const [mode, setMode] = useState<InputMode>(() =>
    stored?.resume?.inputText && !stored?.resume?.fileName ? "paste" : "upload",
  );
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<ResumeScreenResult | null>(() => stored?.resume?.result ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Drives the gauge fill animation (0 -> score) when a result appears.
  const [gauge, setGauge] = useState(0);

  // Resume deep dive: the interviewer grills the candidate on their own resume. Opens
  // only after a scan (the server needs the parsed resume to quote from) and is always
  // skippable, like the scan itself.
  const [grillOpen, setGrillOpen] = useState(() => (stored?.resume?.grillMessages?.length ?? 0) > 0);
  const [grillMessages, setGrillMessages] = useState<InterviewChatMessage[]>(
    () => stored?.resume?.grillMessages ?? [],
  );
  const [grillCoveredGoals, setGrillCoveredGoals] = useState<string[]>(
    () => stored?.resume?.grillCoveredGoals ?? [],
  );
  const [grillDone, setGrillDone] = useState(() => stored?.resume?.grillDone ?? false);
  const [grillInput, setGrillInput] = useState("");
  const [grillSending, setGrillSending] = useState(false);
  const [grillError, setGrillError] = useState<string | null>(null);
  const grillThreadRef = useRef<HTMLDivElement>(null);
  const grillInputRef = useRef<HTMLTextAreaElement>(null);

  const GRILL_TOTAL_GOALS = 5;

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!result) return;
    setGauge(0);
    const id = requestAnimationFrame(() => setGauge(result.ats_score));
    return () => cancelAnimationFrame(id);
  }, [result]);

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

  function scrollGrillToBottom() {
    setTimeout(() => {
      grillThreadRef.current?.scrollTo({
        top: grillThreadRef.current.scrollHeight,
        behavior: "smooth",
      });
    }, 50);
  }

  // One turn of the deep dive. `message` is null for the opening question.
  async function sendGrillTurn(message: string | null) {
    if (grillSending) return;
    setGrillError(null);
    setGrillSending(true);
    const history = message === null ? [] : grillMessages;
    const nextHistory =
      message === null ? [] : [...grillMessages, { role: "user", content: message } as InterviewChatMessage];
    if (message !== null) {
      setGrillMessages(nextHistory);
      setGrillInput("");
      scrollGrillToBottom();
    }
    try {
      const res = await sendResumeGrillMessage(numericSessionId, message, history, grillCoveredGoals);
      const withReply = [...nextHistory, { role: "interviewer", content: res.reply } as InterviewChatMessage];
      setGrillMessages(withReply);
      const covered = res.covered_goals ?? grillCoveredGoals;
      setGrillCoveredGoals(covered);
      setGrillDone(res.is_done);
      persist({ grillMessages: withReply, grillCoveredGoals: covered, grillDone: res.is_done });
    } catch (e: unknown) {
      setGrillError(e instanceof Error ? e.message : "Could not reach the interviewer. Try again.");
    } finally {
      setGrillSending(false);
      scrollGrillToBottom();
      grillInputRef.current?.focus();
    }
  }

  function startGrill() {
    setGrillOpen(true);
    if (grillMessages.length === 0) void sendGrillTurn(null);
  }

  function handleGrillKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = grillInput.trim();
      if (text && !grillSending && !grillDone) void sendGrillTurn(text);
    }
  }

  function nextRoute() {
    if (selectedStages.includes("stage1")) return `/mock-interview/${sessionId}/stage1`;
    if (selectedStages.includes("stage2")) return `/mock-interview/${sessionId}/stage2`;
    if (selectedStages.includes("stage3")) return `/mock-interview/${sessionId}/stage3`;
    return `/mock-interview/${sessionId}/summary`;
  }

  function takeFile(f: File | null) {
    setFile(f);
    setFileName(f?.name ?? null);
    setError(null);
  }

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    takeFile(e.target.files?.[0] ?? null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) takeFile(f);
  }

  function clearFile() {
    setFile(null);
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleScreen() {
    if (loading) return;
    const usingFile = mode === "upload";
    if (usingFile && !file && !fileName) {
      setError("Choose a PDF or DOCX file to scan.");
      return;
    }
    if (!usingFile && text.trim().length < 40) {
      setError("Paste at least a few lines of your resume to scan.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await screenResume(numericSessionId, {
        file: usingFile ? file : null,
        text: usingFile ? "" : text,
      });
      setResult(res);
      persist({ inputText: text, fileName, result: res });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not screen the resume. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleContinue() {
    persist({ inputText: text, fileName, result }, true);
    navigate(nextRoute(), { state: { session: state?.session, selectedStages } });
  }

  if (missingContext) {
    navigate("/mock-interview", { replace: true });
    return null;
  }

  const canRun = mode === "upload" ? !!(file || fileName) : text.trim().length >= 40;
  const RING = 2 * Math.PI * 46;
  const ringColor = result ? scoreColor(result.ats_score) : "#718355";

  return (
    <div className="page page-narrow ats-page">
      {/* Header */}
      <header className="ats-head">
        <div className="ats-head-text">
          <span className="ats-eyebrow">
            <ScanLine size={13} /> Resume Screen
          </span>
          <h1 className="ats-title">ATS Resume Check</h1>
          <p className="ats-sub">
            <strong>{companyLabel}</strong> screen simulation. Would your resume clear the bots and a
            recruiter to earn an OA? This never blocks you, scan it or skip ahead.
          </p>
        </div>
        <button
          className="ats-quit"
          onClick={() => navigate("/mock-interview")}
          title="Quit (your progress is saved)"
        >
          <LogOut size={15} /> Quit
        </button>
      </header>

      {/* Scanner console */}
      <section className="ats-console">
        <div className="ats-console-bar">
          <span className="ats-dots" aria-hidden>
            <i /><i /><i />
          </span>
          <span className="ats-console-id">nosey ats scanner</span>
          <span className="ats-console-target">TARGET: {companyLabel.toUpperCase()}</span>
        </div>

        <div className="ats-console-body">
          {/* Mode toggle */}
          <div className="ats-modes" role="tablist">
            <button
              role="tab"
              aria-selected={mode === "upload"}
              className={`ats-mode${mode === "upload" ? " active" : ""}`}
              onClick={() => setMode("upload")}
            >
              <Upload size={14} /> Upload file
            </button>
            <button
              role="tab"
              aria-selected={mode === "paste"}
              className={`ats-mode${mode === "paste" ? " active" : ""}`}
              onClick={() => setMode("paste")}
            >
              <Type size={14} /> Paste text
            </button>
            <span className={`ats-mode-slider ${mode}`} aria-hidden />
          </div>

          {/* Upload mode */}
          {mode === "upload" &&
            (fileName ? (
              <div className="ats-file">
                <div className="ats-file-icon">
                  <FileText size={18} />
                </div>
                <div className="ats-file-meta">
                  <span className="ats-file-name">{fileName}</span>
                  <span className="ats-file-hint">Ready to scan</span>
                </div>
                <button className="ats-file-remove" onClick={clearFile} title="Remove file">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={`ats-drop${dragging ? " dragging" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragEnter={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
              >
                <span className="ats-drop-icon">
                  <Upload size={22} />
                </span>
                <span className="ats-drop-title">Drop your resume here</span>
                <span className="ats-drop-sub">or click to browse. PDF or DOCX</span>
              </button>
            ))}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPT}
            onChange={handleFilePick}
            style={{ display: "none" }}
          />

          {/* Paste mode */}
          {mode === "paste" && (
            <div className="ats-paper">
              <div className="ats-paper-gutter" aria-hidden>
                <span>résumé.tex</span>
                <span>{text.length ? `${text.length} chars` : "empty"}</span>
              </div>
              <textarea
                className="ats-paper-text"
                placeholder={"\\section{Experience}\nPaste your resume here as plain text or LaTeX source..."}
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
                rows={9}
              />
            </div>
          )}

          {error && (
            <div className="ats-error">
              <AlertCircle size={15} /> {error}
            </div>
          )}

          {/* Run row */}
          <div className="ats-run-row">
            <span className="ats-run-hint">
              {mode === "upload"
                ? "We extract the text and run it through the screen."
                : "Plain text or LaTeX both work."}
            </span>
            <button className="ats-run" onClick={handleScreen} disabled={loading || !canRun}>
              {loading ? <Loader2 size={16} className="spin" /> : <ScanLine size={16} />}
              {loading ? "Scanning resume" : result ? "Re-scan" : "Run ATS Screen"}
            </button>
          </div>
        </div>

        {/* Scan overlay */}
        {loading && (
          <div className="ats-scan" aria-hidden>
            <div className="ats-scan-beam" />
            <span className="ats-scan-label">SCANNING / parsing keywords / matching role</span>
          </div>
        )}
      </section>

      {/* Report */}
      {result && (
        <section className="ats-report">
          <div className="ats-report-strip">ATS REPORT</div>

          <div className="ats-report-top">
            <div className="ats-gauge" style={{ color: ringColor }}>
              <svg viewBox="0 0 104 104" className="ats-gauge-svg">
                <circle className="ats-gauge-track" cx="52" cy="52" r="46" />
                <circle
                  className="ats-gauge-fill"
                  cx="52"
                  cy="52"
                  r="46"
                  style={{
                    strokeDasharray: RING,
                    strokeDashoffset: RING * (1 - gauge / 100),
                  }}
                />
              </svg>
              <div className="ats-gauge-center">
                <span className="ats-gauge-num">{result.ats_score}</span>
                <span className="ats-gauge-max">/ 100</span>
              </div>
            </div>

            <div className="ats-report-headline">
              <div className={`ats-stamp ${result.passes_oa ? "pass" : "fail"}`}>
                {result.passes_oa ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                {result.passes_oa ? "OA Likely" : "OA Unlikely"}
              </div>
              <p className="ats-verdict">{result.verdict}</p>
              {result.summary && <p className="ats-summary">{result.summary}</p>}
            </div>
          </div>

          {(result.matched_keywords.length > 0 || result.missing_keywords.length > 0) && (
            <div className="ats-keywords">
              {result.matched_keywords.length > 0 && (
                <div className="ats-kw-group">
                  <span className="ats-kw-label ats-kw-label--match">Matched keywords</span>
                  <div className="ats-kw-chips">
                    {result.matched_keywords.map((k) => (
                      <span key={k} className="ats-kw ats-kw--match">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {result.missing_keywords.length > 0 && (
                <div className="ats-kw-group">
                  <span className="ats-kw-label ats-kw-label--miss">Missing keywords</span>
                  <div className="ats-kw-chips">
                    {result.missing_keywords.map((k) => (
                      <span key={k} className="ats-kw ats-kw--miss">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="ats-cols">
            {result.strengths.length > 0 && (
              <div className="ats-col">
                <span className="ats-col-label ats-col-label--good">Strengths</span>
                <ul>
                  {result.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.gaps.length > 0 && (
              <div className="ats-col">
                <span className="ats-col-label ats-col-label--bad">Gaps</span>
                <ul>
                  {result.gaps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
            {result.fixes.length > 0 && (
              <div className="ats-col">
                <span className="ats-col-label ats-col-label--fix">How to improve</span>
                <ul>
                  {result.fixes.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Resume deep dive: only offered once a scan has run, since the interviewer
          quotes the parsed resume back at the candidate. */}
      {result && (
        <section className="card ats-grill">
          <div className="ats-grill-head">
            <div>
              <span className="eyebrow">
                <MessagesSquare size={13} /> Resume Deep Dive
              </span>
              <p className="muted small" style={{ marginTop: 4 }}>
                {grillOpen
                  ? `${companyLabel} hiring manager, ${Math.min(grillCoveredGoals.length, GRILL_TOTAL_GOALS)} of ${GRILL_TOTAL_GOALS} questions covered.`
                  : "The part an ATS score cannot tell you: can you defend what is on the page? Five questions on your own projects, numbers, and choices."}
              </p>
            </div>
            {!grillOpen && (
              <button className="button button-primary" onClick={startGrill} disabled={grillSending}>
                {grillSending ? <Loader2 size={15} className="spin" /> : <MessagesSquare size={15} />}
                Start the deep dive
              </button>
            )}
          </div>

          {grillOpen && (
            <>
              <div className="ats-grill-thread" ref={grillThreadRef}>
                {grillMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`mock-chat-msg ${
                      msg.role === "interviewer" ? "mock-chat-msg--interviewer" : "mock-chat-msg--user"
                    }`}
                  >
                    <span className="mock-chat-msg-role">
                      {msg.role === "interviewer" ? `${companyLabel} Interviewer` : "You"}
                    </span>
                    <p className="mock-chat-msg-bubble">{msg.content}</p>
                  </div>
                ))}
                {grillSending && (
                  <div className="mock-chat-msg mock-chat-msg--interviewer">
                    <span className="mock-chat-msg-role">{companyLabel} Interviewer</span>
                    <p className="mock-chat-msg-bubble mock-chat-typing">
                      <Loader2 size={13} className="spin" /> Typing…
                    </p>
                  </div>
                )}
                {grillDone && (
                  <div style={{ textAlign: "center", padding: "14px 0 2px" }}>
                    <span className="eyebrow">Deep dive complete</span>
                    <p className="muted small" style={{ marginTop: 4 }}>
                      Your answers feed the final debrief. Continue when you are ready.
                    </p>
                  </div>
                )}
              </div>

              {grillError && (
                <div className="ats-error">
                  <AlertCircle size={15} /> {grillError}
                </div>
              )}

              {!grillDone && (
                <div className="mock-stage3-chat-input-row">
                  <textarea
                    ref={grillInputRef}
                    className="kojo-input"
                    placeholder="Type your answer (Enter to send, Shift+Enter for newline)"
                    value={grillInput}
                    onChange={(e) => setGrillInput(e.target.value)}
                    onKeyDown={handleGrillKeyDown}
                    disabled={grillSending}
                    rows={3}
                    style={{ flex: 1, minHeight: 56, maxHeight: 160, resize: "none" }}
                  />
                  <button
                    className="kojo-send"
                    onClick={() => void sendGrillTurn(grillInput.trim())}
                    disabled={!grillInput.trim() || grillSending}
                    title="Send answer"
                  >
                    {grillSending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Continue (non-blocking) */}
      <div className="ats-footer">
        <span className="ats-footer-note">The resume screen never blocks your interview.</span>
        <button className="button button-primary ats-continue" onClick={handleContinue}>
          {result ? "Continue to next stage" : "Skip to next stage"}
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
