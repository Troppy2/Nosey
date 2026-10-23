import Editor from "@monaco-editor/react";
import { AlertIcon, ChatIcon } from "../icons";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { LoadingNotice } from "../components/Loaders";
import { sendStage2Message, submitStage2 } from "../lib/api";
import type { CodingProblemInfo, InterviewChatMessage, MockInterviewSession } from "../lib/types";
import { COMPANY_OPTIONS, type CompanyKey } from "../data/mockInterviewProblems";
import { loadMockProgress, saveMockProgress, type MockProgress, type MockCompany } from "../lib/mockInterview";
import { MockProgressGate } from "../components/MockProgressGate";
import { MarkdownContent } from "../components/MarkdownContent";
import "../styles/components/mock-debrief.css";
import { VoiceRoom } from "../components/VoiceRoom";
import { useInterviewerVoice } from "../lib/voice";

export default function MockInterviewStage2() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <MockProgressGate
      sessionId={Number(sessionId)}
      label="Loading your interview"
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

  const [messages, setMessages] = useState<InterviewChatMessage[]>(() => stored?.stage2?.messages ?? []);
  const [initializing, setInitializing] = useState(() => (stored?.stage2?.messages?.length ?? 0) === 0);
  const [sending, setSending] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const [codingProblem, setCodingProblem] = useState<CodingProblemInfo | null>(
    () => stored?.stage2?.codingProblem ?? null,
  );
  const [code, setCode] = useState(() => stored?.stage2?.code ?? "# Write your solution here\n\n");
  const [codeSubmitting, setCodeSubmitting] = useState(false);
  const [codeFeedback, setCodeFeedback] = useState<string | null>(() => stored?.stage2?.codeFeedback ?? null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(() => stored?.stage2?.submitted ?? false);
  const [coveredGoals, setCoveredGoals] = useState<string[]>(() => stored?.stage2?.coveredGoals ?? []);
  const voice = useInterviewerVoice();

  // Stage 2 covers 5 interview goals; this drives a small progress indicator.
  const totalGoals = 5;

  const threadRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    setTimeout(() => {
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  }

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
      stage2: { messages, codingProblem, code, codeFeedback, submitted, coveredGoals },
    };
    saveMockProgress(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, codingProblem, code, codeFeedback, submitted, coveredGoals]);

  // Start the interview only if there is no saved conversation.
  useEffect(() => {
    if (!initializing) {
      scrollToBottom();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await sendStage2Message(numericSessionId, null, [], []);
        if (cancelled) return;
        setMessages([{ role: "interviewer", content: res.reply }]);
        if (res.covered_goals) setCoveredGoals(res.covered_goals);
        if (res.coding_problem) setCodingProblem(res.coding_problem);
      } catch (e: unknown) {
        if (!cancelled) setInitError(e instanceof Error ? e.message : "Failed to start interview.");
      } finally {
        if (!cancelled) {
          setInitializing(false);
          scrollToBottom();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numericSessionId]);

  async function handleSend(text: string) {
    if (!text || sending || submitted) return;
    voice.stop();

    const userMsg: InterviewChatMessage = { role: "user", content: text };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setSending(true);
    scrollToBottom();

    try {
      const res = await sendStage2Message(numericSessionId, text, messages, coveredGoals);
      const aiMsg: InterviewChatMessage = { role: "interviewer", content: res.reply };
      setMessages([...nextHistory, aiMsg]);
      if (res.covered_goals) setCoveredGoals(res.covered_goals);
      void voice.speak(res.reply);
      if (res.coding_problem && !codingProblem) {
        setCodingProblem(res.coding_problem);
        setCode(`# ${res.coding_problem.title}\n# Write your solution here\n\n`);
      }
    } catch {
      setMessages([
        ...nextHistory,
        { role: "interviewer", content: "(Connection error. Please try again.)" },
      ]);
    } finally {
      setSending(false);
      scrollToBottom();
    }
  }

  async function handleSubmitCode() {
    if (!codingProblem || codeSubmitting) return;
    setCodeError(null);
    setCodeSubmitting(true);
    try {
      const res = await submitStage2(numericSessionId, code, codingProblem.title, codingProblem.slug);
      setCodeFeedback(res.feedback);
      const codeMsg: InterviewChatMessage = {
        role: "user",
        content: `MY SOLUTION:\n\`\`\`python\n${code.slice(0, 400)}${code.length > 400 ? "\n..." : ""}\n\`\`\``,
      };
      const fbMsg: InterviewChatMessage = { role: "interviewer", content: res.feedback };
      setMessages((prev) => [...prev, codeMsg, fbMsg]);
      void voice.speak(res.feedback);
      setSubmitted(true);
      scrollToBottom();
    } catch (e: unknown) {
      setCodeError(e instanceof Error ? e.message : "Submission failed. Try again.");
    } finally {
      setCodeSubmitting(false);
    }
  }

  function nextRoute() {
    if (selectedStages.includes("stage3")) return `/mock-interview/${sessionId}/stage3`;
    return `/mock-interview/${sessionId}/summary`;
  }

  if (initializing) {
    return (
      <div className="mock-loading" style={{ height: "100vh" }}>
        <div
          className="mock-interviewer-avatar"
          style={{ width: 52, height: 52, fontSize: "0.9rem" }}
        >
          <ChatIcon size={20} />
        </div>
        <LoadingNotice
          title="Preparing your interviewer"
          estimate="Reading the role and your resume. About 10 seconds."
          slowNote="Still preparing. Your interviewer opens as soon as this finishes."
          slowAfterMs={14000}
        />
      </div>
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

  const workspace = codingProblem ? (
    <div className="voice-work-grid">
      <article className="voice-problem">
        <div className="voice-problem-head">
          <h1>{codingProblem.title}</h1>
          <span className={`voice-diff voice-diff-${codingProblem.difficulty.toLowerCase()}`}>{codingProblem.difficulty}</span>
        </div>
        <div className="voice-problem-text">
          <MarkdownContent content={codingProblem.prompt} />
        </div>
        {!codingProblem.slug.startsWith("custom-") && (
          <a className="voice-problem-link" href={`https://leetcode.com/problems/${codingProblem.slug}/`} target="_blank" rel="noopener noreferrer">
            Open on LeetCode
          </a>
        )}
      </article>
      <section className="voice-editor" aria-label="Code">
        <div className="voice-editor-head">
          <span>solution.py</span>
          <span>Python 3</span>
        </div>
        <div className="voice-editor-body">
          <Editor
            height="100%"
            language="python"
            theme="vs-dark"
            value={code}
            onChange={(v) => setCode(v ?? "")}
            options={{ fontSize: 14, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on" }}
          />
        </div>
        {codeFeedback ? (
          <div className="voice-editor-feedback debrief-body">
            <MarkdownContent content={codeFeedback} />
          </div>
        ) : (
          <div className="voice-editor-foot">
            {codeError && (
              <span className="voice-editor-error">
                <AlertIcon size={13} /> {codeError}
              </span>
            )}
            <button type="button" className="voice-submit" onClick={handleSubmitCode} disabled={codeSubmitting || !code.trim()}>
              {codeSubmitting ? "Submitting..." : "Submit solution"}
            </button>
          </div>
        )}
      </section>
    </div>
  ) : undefined;

  return (
    <VoiceRoom
      title="Technical interview"
      subtitle={`${companyLabel}, ${roundLabel(selectedStages, "stage2")}`}
      interviewerName="Kojo"
      messages={messages}
      covered={Math.min(coveredGoals.length, totalGoals)}
      total={totalGoals}
      waiting={sending}
      done={submitted}
      onSend={handleSend}
      onLeave={() => navigate("/mock-interview")}
      voice={voice}
      workspace={workspace}
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
  );
}

function roundLabel(stages: string[], current: string) {
  const idx = stages.indexOf(current);
  return idx < 0 ? "technical round" : `round ${idx + 1} of ${stages.length}`;
}
