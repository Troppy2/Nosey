import { AlertIcon, ChatIcon } from "../icons";
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { LoadingNotice } from "../components/Loaders";
import { sendStage3Message } from "../lib/api";
import type { InterviewChatMessage, MockInterviewSession } from "../lib/types";
import { COMPANY_OPTIONS, type CompanyKey } from "../data/mockInterviewProblems";
import { loadMockProgress, saveMockProgress, type MockProgress, type MockCompany } from "../lib/mockInterview";
import { MockProgressGate } from "../components/MockProgressGate";
import { VoiceRoom } from "../components/VoiceRoom";
import { useInterviewerVoice } from "../lib/voice";

export default function MockInterviewStage3() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return (
    <MockProgressGate
      sessionId={Number(sessionId)}
      label="Loading your interview"
      render={(stored) => <Stage3Runner stored={stored} />}
    />
  );
}

function Stage3Runner({ stored }: { stored: MockProgress | null }) {
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
  const selectedStages = state?.selectedStages ?? stored?.selectedStages ?? ["stage3"];

  const [messages, setMessages] = useState<InterviewChatMessage[]>(() => stored?.stage3?.messages ?? []);
  const [initializing, setInitializing] = useState(() => (stored?.stage3?.messages?.length ?? 0) === 0);
  const [sending, setSending] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(() => stored?.stage3?.isDone ?? false);
  const [coveredGoals, setCoveredGoals] = useState<string[]>(() => stored?.stage3?.coveredGoals ?? []);
  // Probes Kojo has asked on the current story; the server caps it at 2.
  const [followups, setFollowups] = useState(0);

  // Stage 3 covers 5 behavioral questions; this drives a small progress indicator.
  const totalGoals = 5;

  const voice = useInterviewerVoice();

  useEffect(() => {
    if (!Number.isFinite(numericSessionId)) return;
    const prev = loadMockProgress(numericSessionId);
    const progress: MockProgress = {
      ...(prev ?? { sessionId: numericSessionId, company: rawCompany, selectedStages, updatedAt: Date.now() }),
      sessionId: numericSessionId,
      company: rawCompany,
      selectedStages,
      updatedAt: Date.now(),
      stage3: { messages, isDone, coveredGoals },
    };
    saveMockProgress(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isDone, coveredGoals]);

  useEffect(() => {
    if (!initializing) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await sendStage3Message(numericSessionId, null, [], []);
        if (cancelled) return;
        setMessages([{ role: "interviewer", content: res.reply }]);
        if (res.covered_goals) setCoveredGoals(res.covered_goals);
        if (res.is_done) setIsDone(true);
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
  }, [numericSessionId]);

  async function handleSend(text: string) {
    if (!text || sending || isDone) return;
    voice.stop();

    const userMsg: InterviewChatMessage = { role: "user", content: text };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setSending(true);

    try {
      const res = await sendStage3Message(numericSessionId, text, messages, coveredGoals, followups);
      setFollowups(res.is_followup ? followups + 1 : 0);
      setMessages([...nextHistory, { role: "interviewer", content: res.reply }]);
      void voice.speak(res.reply);
      if (res.covered_goals) setCoveredGoals(res.covered_goals);
      if (res.is_done) setIsDone(true);
    } catch {
      setMessages([
        ...nextHistory,
        { role: "interviewer", content: "(Connection error. Please try again.)" },
      ]);
    } finally {
      setSending(false);
    }
  }

  if (initializing) {
    return (
      <div className="mock-loading" style={{ height: "100vh" }}>
        <div
          className="mock-interviewer-avatar"
          style={{ width: 52, height: 52, fontSize: "0.9rem" }}
        >
          <ChatIcon size={18} />
        </div>
        <LoadingNotice
          title="Preparing your behavioral interview"
          estimate="Writing questions from the role and your resume. About 10 seconds."
          slowNote="Still preparing. Your first question opens as soon as this finishes."
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

  return (
    <VoiceRoom
      title="Behavioral interview"
      subtitle={`${companyLabel}, ${MockLoopLabel(selectedStages, "stage3")}`}
      interviewerName="Kojo"
      messages={messages}
      covered={Math.min(coveredGoals.length, totalGoals)}
      total={totalGoals}
      waiting={sending}
      done={isDone}
      onSend={handleSend}
      onLeave={() => navigate("/mock-interview")}
      voice={voice}
      nextLabel="your debrief"
      onAdvance={() =>
        navigate(`/mock-interview/${sessionId}/summary`, { state: { session: state?.session, selectedStages } })
      }
      doneAction={
        <button
          className="voice-send"
          onClick={() =>
            navigate(`/mock-interview/${sessionId}/summary`, { state: { session: state?.session, selectedStages } })
          }
        >
          View debrief
        </button>
      }
    />
  );
}

function MockLoopLabel(stages: string[], current: string) {
  const idx = stages.indexOf(current);
  return idx < 0 ? "behavioral round" : `round ${idx + 1} of ${stages.length}`;
}
