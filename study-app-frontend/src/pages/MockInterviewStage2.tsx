import Editor from "@monaco-editor/react";
import { AlertIcon, CheckCircleIcon, CrossCircleIcon, PlayIcon } from "../icons";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { MockLoader } from "../components/MockLoader";
import { fetchStage2Problem, sendStage2Message, submitStage2 } from "../lib/api";
import type { CodingProblemInfo, InterviewChatMessage, MockInterviewSession, Stage2TurnEvent } from "../lib/types";
import { COMPANY_OPTIONS, type CompanyKey } from "../data/mockInterviewProblems";
import { loadMockProgress, saveMockProgress, type MockProgress, type MockCompany } from "../lib/mockInterview";
import { MockProgressGate } from "../components/MockProgressGate";
import { MarkdownContent } from "../components/MarkdownContent";
import { runPythonLeetCode, type RunnerResult } from "../lib/pyodideRunner";
import { sanitizeLeetCodeHtml } from "../lib/leetcodeHtml";
import "../styles/components/mock-debrief.css";
import { VoiceRoom } from "../components/VoiceRoom";
import { useInterviewerVoice } from "../lib/voice";

// A real phone screen: 45 minutes on the clock, and Kojo checks in after a long silence.
const ROUND_MS = 45 * 60 * 1000;
const STALL_MS = 3 * 60 * 1000;
// One name per server goal (background, coding_problem, approach, complexity, optimize,
// dry_run, questions); the header shows the phase in progress.
const STEP_NAMES = ["Background", "The problem", "Approach and code", "Complexity", "Optimize", "Dry run", "Your questions"];
const GOALS = ["background", "coding_problem", "approach", "complexity", "optimize", "dry_run", "questions"];

/** Steps done so far: the first goal not covered, or straight to questions once Kojo asked them (time up). */
function stepsDone(covered: string[]): number {
  if (covered.includes("questions")) return GOALS.length - 1;
  const next = GOALS.findIndex((g) => !covered.includes(g));
  return next < 0 ? GOALS.length : next;
}
const DEFAULT_CODE = "# Write your solution here\n\n";

export default function MockInterviewStage2() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <MockProgressGate
      sessionId={Number(sessionId)}
      label="Loading your interview"
      tone="room"
      render={(stored) => <Stage2Runner stored={stored} />}
    />
  );
}

function Stage2Runner({ stored }: { stored: MockProgress | null }) {
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
  const selectedStages = state?.selectedStages ?? stored?.selectedStages ?? ["stage2", "stage3"];
  const saved = stored?.stage2;

  const [messages, setMessages] = useState<InterviewChatMessage[]>(() => saved?.messages ?? []);
  const [initializing, setInitializing] = useState(() => (saved?.messages?.length ?? 0) === 0);
  const [sending, setSending] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [coveredGoals, setCoveredGoals] = useState<string[]>(() => saved?.coveredGoals ?? []);

  const [preparedProblem, setPreparedProblem] = useState<CodingProblemInfo | null>(() => saved?.preparedProblem ?? null);
  const [problemError, setProblemError] = useState<string | null>(null);
  const [codingProblem, setCodingProblem] = useState<CodingProblemInfo | null>(() => saved?.codingProblem ?? null);
  const [code, setCode] = useState(() => saved?.code ?? DEFAULT_CODE);
  const [hintsUsed, setHintsUsed] = useState(() => saved?.hintsUsed ?? 0);
  const [startedAt, setStartedAt] = useState(() => saved?.startedAt ?? Date.now());
  const [timeUp, setTimeUp] = useState(() => saved?.timeUp ?? false);
  const [samplesPassed, setSamplesPassed] = useState(() => saved?.samplesPassed ?? 0);
  const [samplesTotal, setSamplesTotal] = useState(() => saved?.samplesTotal ?? 0);
  const [runResult, setRunResult] = useState<RunnerResult | null>(null);
  const [running, setRunning] = useState(false);

  const [codeFeedback, setCodeFeedback] = useState<string | null>(() => saved?.codeFeedback ?? null);
  const [verdict, setVerdict] = useState<string | null>(() => saved?.verdict ?? null);
  const [submitted, setSubmitted] = useState(() => saved?.submitted ?? false);
  const [grading, setGrading] = useState(false);
  const [gradeError, setGradeError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const voice = useInterviewerVoice();

  const problemRequest = useRef<Promise<CodingProblemInfo | null> | null>(null);
  const lastActivity = useRef(Date.now());
  const timeUpSent = useRef(saved?.timeUp ?? false);

  // Persist Stage 2 progress on every meaningful change.
  useEffect(() => {
    if (!Number.isFinite(numericSessionId)) return;
    const prev = loadMockProgress(numericSessionId);
    const progress: MockProgress = {
      ...(prev ?? { sessionId: numericSessionId, company: rawCompany, selectedStages, updatedAt: Date.now() }),
      sessionId: numericSessionId,
      company: rawCompany,
      selectedStages,
      updatedAt: Date.now(),
      stage2: {
        messages, codingProblem, code, codeFeedback, submitted, coveredGoals, preparedProblem,
        hintsUsed, startedAt, timeUp, samplesPassed, samplesTotal, verdict,
      },
    };
    saveMockProgress(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, codingProblem, code, codeFeedback, submitted, coveredGoals, preparedProblem, hintsUsed, startedAt, timeUp, samplesPassed, samplesTotal, verdict]);

  // The problem is picked while the candidate answers the background question, so
  // Kojo can put it on screen the moment they finish.
  function prepareProblem(): Promise<CodingProblemInfo | null> {
    if (codingProblem) return Promise.resolve(codingProblem);
    if (preparedProblem) return Promise.resolve(preparedProblem);
    if (!problemRequest.current) {
      setProblemError(null);
      problemRequest.current = fetchStage2Problem(numericSessionId)
        .then((p) => {
          setPreparedProblem(p);
          return p;
        })
        .catch((e: unknown) => {
          setProblemError(e instanceof Error ? e.message : "Kojo couldn't prepare the problem.");
          problemRequest.current = null;
          return null;
        });
    }
    return problemRequest.current;
  }

  useEffect(() => {
    if (!submitted) void prepareProblem();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start the interview only if there is no saved conversation.
  useEffect(() => {
    if (!initializing) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await sendStage2Message(numericSessionId, null, [], []);
        if (cancelled) return;
        setMessages([{ role: "interviewer", content: res.reply }]);
        setStartedAt(Date.now());
        if (res.covered_goals) setCoveredGoals(res.covered_goals);
      } catch (e: unknown) {
        if (!cancelled) setInitError(e instanceof Error ? e.message : "Failed to start interview.");
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericSessionId, initializing]);

  const remainingMs = Math.max(0, startedAt + ROUND_MS - now);
  const minutesLeft = Math.ceil(remainingMs / 60000);

  useEffect(() => {
    if (submitted) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [submitted]);

  async function finishRound(history: InterviewChatMessage[], ranOut: boolean) {
    const problem = codingProblem ?? preparedProblem;
    if (!problem || grading || submitted) return;
    voice.stop();
    setGrading(true);
    setGradeError(null);
    try {
      const res = await submitStage2(numericSessionId, {
        code: codingProblem ? code : "",
        problem,
        history,
        hintsUsed,
        timeUp: ranOut,
        samplesPassed,
        samplesTotal,
      });
      setCodeFeedback(res.feedback);
      setVerdict(res.verdict ?? null);
      setSubmitted(true);
    } catch (e: unknown) {
      setGradeError(e instanceof Error ? e.message : "Grading failed. Try again.");
    } finally {
      setGrading(false);
    }
  }

  async function sendTurn(message: string | null, event: Stage2TurnEvent | null = null) {
    if (sending || submitted || grading) return;
    voice.stop();
    lastActivity.current = Date.now();

    const userMsg: InterviewChatMessage | null = message ? { role: "user", content: message } : null;
    const nextHistory = userMsg ? [...messages, userMsg] : messages;
    setMessages(nextHistory);
    setSending(true);

    // Wait for the prepared problem before the answer that should bring it on screen.
    const problem = codingProblem ?? preparedProblem ?? (message ? await prepareProblem() : null);
    const ranOut = timeUp || event === "time_up";

    try {
      const res = await sendStage2Message(numericSessionId, message, messages, coveredGoals, {
        problem,
        code: codingProblem ? code : "",
        hintsUsed,
        minutesLeft: ranOut ? 0 : minutesLeft,
        event,
      });
      const finalHistory = [...nextHistory, { role: "interviewer" as const, content: res.reply }];
      setMessages(finalHistory);
      if (res.covered_goals) setCoveredGoals(res.covered_goals);
      if (res.hint_given) setHintsUsed((n) => n + 1);
      if (res.coding_problem && !codingProblem) {
        setCodingProblem(res.coding_problem);
        setCode(res.coding_problem.starter_code?.trim() ? `${res.coding_problem.starter_code.trimEnd()}\n` : DEFAULT_CODE);
      }
      lastActivity.current = Date.now();
      if (res.is_done) {
        void finishRound(finalHistory, ranOut);
      } else {
        void voice.speak(res.reply);
      }
    } catch {
      setMessages([...nextHistory, { role: "interviewer", content: "(Connection error. Please try again.)" }]);
    } finally {
      setSending(false);
    }
  }

  // Interval callbacks read the latest render through this ref.
  const sendTurnRef = useRef(sendTurn);
  sendTurnRef.current = sendTurn;

  // At zero Kojo wraps up and asks for questions; the next answer ends the round.
  useEffect(() => {
    if (remainingMs > 0 || timeUpSent.current || submitted || initializing || sending || messages.length === 0) return;
    timeUpSent.current = true;
    setTimeUp(true);
    void sendTurnRef.current(null, "time_up");
  }, [remainingMs, submitted, initializing, sending, messages.length]);

  // A long silence on the problem gets a nudge, which counts as a hint.
  useEffect(() => {
    if (!codingProblem || submitted || timeUp) return;
    const t = window.setInterval(() => {
      if (sending || voice.speaking || Date.now() - lastActivity.current < STALL_MS) return;
      lastActivity.current = Date.now();
      void sendTurnRef.current(null, "nudge");
    }, 10000);
    return () => window.clearInterval(t);
  }, [codingProblem, submitted, timeUp, sending, voice.speaking]);

  useEffect(() => {
    if (!confirmEnd) return;
    const t = window.setTimeout(() => setConfirmEnd(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirmEnd]);

  function handleCodeChange(value: string | undefined) {
    setCode(value ?? "");
    lastActivity.current = Date.now();
  }

  const examples = codingProblem?.examples ?? [];
  const runnable = examples.length > 0 && code.includes("class Solution");

  async function handleRun() {
    if (!runnable || running) return;
    setRunning(true);
    lastActivity.current = Date.now();
    try {
      const result = await runPythonLeetCode(
        code,
        examples.map((ex, i) => ({ label: `Example ${i + 1}`, inputText: ex.input_text, expectedOutput: ex.output_text })),
      );
      setRunResult(result);
      setSamplesPassed(result.cases?.filter((c) => c.passed).length ?? 0);
      setSamplesTotal(result.cases?.length ?? examples.length);
    } catch (e: unknown) {
      setRunResult({ ok: false, output: "", error: e instanceof Error ? e.message : "Run failed." });
    } finally {
      setRunning(false);
    }
  }

  function nextRoute() {
    if (selectedStages.includes("stage3")) return `/mock-interview/${sessionId}/stage3`;
    return `/mock-interview/${sessionId}/summary`;
  }

  if (initializing) {
    return (
      <MockLoader
        title="Kojo is joining the call"
        note="Reading the role. About 10 seconds."
        slowNote="Still connecting. The call opens as soon as Kojo is ready."
        slowAfterMs={14000}
      />
    );
  }

  if (initError) {
    return (
      <div className="page page-narrow">
        <div className="card mock-error-card">
          <AlertIcon size={20} style={{ color: "var(--error)" }} />
          <p>{initError}</p>
          <div className="button-row" style={{ marginTop: 8 }}>
            <button className="button button-ghost" onClick={() => navigate("/mock-interview")}>
              Back to Setup
            </button>
            <button
              className="button button-primary"
              onClick={() => {
                setInitError(null);
                setInitializing(true);
              }}
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const failing = runResult?.cases?.filter((c) => !c.passed) ?? [];
  const showExamples = !codingProblem?.prompt_html && examples.length > 0 && !/example/i.test(codingProblem?.prompt ?? "");

  const workspace = codingProblem ? (
    <div className="voice-work-grid">
      <article className="voice-problem">
        <div className="voice-problem-head">
          <h1>{codingProblem.title}</h1>
        </div>
        {codingProblem.prompt_html ? (
          <div
            className="voice-problem-text"
            dangerouslySetInnerHTML={{ __html: sanitizeLeetCodeHtml(codingProblem.prompt_html) }}
          />
        ) : (
          <div className="voice-problem-text">
            <MarkdownContent content={codingProblem.prompt} />
          </div>
        )}
        {showExamples &&
          examples.map((ex, i) => (
            <div key={i} className="voice-example">
              <h2>Example {i + 1}</h2>
              <pre>
                Input: {ex.input_text}
                {"\n"}Output: {ex.output_text}
              </pre>
            </div>
          ))}
        <p className="voice-problem-meta">
          {hintsUsed === 0 ? "No hints used" : `${hintsUsed} hint${hintsUsed === 1 ? "" : "s"} used`}. Ask Kojo out loud, or tap Hint.
        </p>
      </article>
      <section className="voice-editor" aria-label="Code">
        <div className="voice-editor-head">
          <span>solution.py</span>
          <div className="voice-editor-actions">
            <button
              type="button"
              className="voice-editor-btn"
              onClick={() => void sendTurn("Could I get a hint?", "hint")}
              disabled={sending || submitted || grading}
            >
              Hint
            </button>
            <button
              type="button"
              className="voice-editor-btn"
              onClick={() => void handleRun()}
              disabled={!runnable || running || submitted}
              title={runnable ? "Run the sample cases" : "This problem has no runnable sample cases"}
            >
              <PlayIcon size={14} /> {running ? "Running..." : "Run"}
            </button>
          </div>
        </div>
        <div className="voice-editor-body">
          <Editor
            height="100%"
            language="python"
            theme="vs-dark"
            value={code}
            onChange={handleCodeChange}
            options={{ fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on", readOnly: submitted }}
          />
        </div>
        {codeFeedback ? (
          <div className="voice-editor-feedback debrief-body">
            {verdict && <p className="voice-verdict">Kojo's call: {verdictLabel(verdict)}</p>}
            <MarkdownContent content={codeFeedback} />
          </div>
        ) : runResult ? (
          <div className="voice-editor-foot voice-run" role="status">
            {runResult.error ? (
              <span className="voice-editor-error">
                <AlertIcon size={13} /> {runResult.error.split("\n").filter(Boolean).slice(-1)[0]}
              </span>
            ) : (
              <>
                <span className={failing.length ? "voice-run-fail" : "voice-run-pass"}>
                  {failing.length ? <CrossCircleIcon size={14} /> : <CheckCircleIcon size={14} />}
                  {samplesPassed} of {samplesTotal} sample cases passed
                </span>
                {failing.slice(0, 1).map((c) => (
                  <span key={c.label} className="voice-run-case">
                    {c.label}: expected {c.expected}, got {c.actual}
                  </span>
                ))}
              </>
            )}
          </div>
        ) : null}
      </section>
    </div>
  ) : undefined;

  const headerExtra = submitted ? null : (
    <>
      <span className={`voice-clock${remainingMs < 5 * 60000 ? " is-low" : ""}`} aria-label={`${formatClock(remainingMs)} left`}>
        {formatClock(remainingMs)} left
      </span>
      {(codingProblem || preparedProblem) && (
        <button
          type="button"
          className="voice-end"
          onClick={() => (confirmEnd ? void finishRound(messages, timeUp) : setConfirmEnd(true))}
          disabled={grading || sending}
        >
          {grading ? "Grading..." : confirmEnd ? "End and grade?" : "End round"}
        </button>
      )}
    </>
  );

  return (
    <>
      {(problemError || gradeError) && (
        <div className="voice-banner" role="alert">
          <AlertIcon size={14} /> {gradeError ?? problemError}
          <button
            type="button"
            onClick={() => (gradeError ? void finishRound(messages, timeUp) : void prepareProblem())}
          >
            Retry
          </button>
        </div>
      )}
      <VoiceRoom
        title="Technical interview"
        subtitle={`${companyLabel}, ${roundLabel(selectedStages, "stage2")}`}
        interviewerName="Kojo"
        messages={messages}
        covered={submitted ? STEP_NAMES.length : stepsDone(coveredGoals)}
        total={STEP_NAMES.length}
        stepNames={STEP_NAMES}
        waiting={sending || grading}
        done={submitted}
        onSend={(text) => void sendTurn(text)}
        onLeave={() => navigate("/mock-interview")}
        voice={voice}
        workspace={workspace}
        headerExtra={headerExtra}
        nextLabel={selectedStages.includes("stage3") ? "the behavioral round" : "your debrief"}
        onAdvance={() => navigate(nextRoute(), { state: { session: state?.session, selectedStages } })}
        doneAction={
          <button
            type="button"
            className="voice-send"
            onClick={() => navigate(nextRoute(), { state: { session: state?.session, selectedStages } })}
          >
            Continue
          </button>
        }
      />
    </>
  );
}

function formatClock(ms: number) {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function verdictLabel(verdict: string) {
  return { strong: "Strong", pass: "Pass", borderline: "Borderline", needs_work: "Needs work" }[verdict] ?? verdict;
}

function roundLabel(stages: string[], current: string) {
  const idx = stages.indexOf(current);
  return idx < 0 ? "technical round" : `round ${idx + 1} of ${stages.length}`;
}
