import { AlertCircle, ChevronRight, Loader2, LogOut, MessageSquare, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { LoadingNotice } from "../components/Loaders";
import { sendStage3Message } from "../lib/api";
import type { InterviewChatMessage, MockInterviewSession } from "../lib/types";
import { COMPANY_OPTIONS, type CompanyKey } from "../data/mockInterviewProblems";
import { loadMockProgress, saveMockProgress, type MockProgress } from "../lib/mockInterview";

export default function MockInterviewStage3() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const numericSessionId = Number(sessionId);
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { session?: MockInterviewSession; selectedStages?: string[] } | null;

  const stored = useMemo<MockProgress | null>(
    () => (Number.isFinite(numericSessionId) ? loadMockProgress(numericSessionId) : null),
    [numericSessionId],
  );

  const company = (state?.session?.company ?? stored?.company ?? "random") as CompanyKey;
  const companyLabel = COMPANY_OPTIONS.find((c) => c.key === company)?.label ?? company;
  const selectedStages = state?.selectedStages ?? stored?.selectedStages ?? ["stage3"];

  const [messages, setMessages] = useState<InterviewChatMessage[]>(() => stored?.stage3?.messages ?? []);
  const [input, setInput] = useState("");
  const [initializing, setInitializing] = useState(() => (stored?.stage3?.messages?.length ?? 0) === 0);
  const [sending, setSending] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(() => stored?.stage3?.isDone ?? false);

  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function scrollToBottom() {
    setTimeout(() => {
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  }

  useEffect(() => {
    if (!Number.isFinite(numericSessionId)) return;
    const prev = loadMockProgress(numericSessionId);
    const progress: MockProgress = {
      ...(prev ?? { sessionId: numericSessionId, company, selectedStages, updatedAt: Date.now() }),
      sessionId: numericSessionId,
      company,
      selectedStages,
      updatedAt: Date.now(),
      stage3: { messages, isDone },
    };
    saveMockProgress(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isDone]);

  useEffect(() => {
    if (!initializing) {
      scrollToBottom();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await sendStage3Message(numericSessionId, null, []);
        if (cancelled) return;
        setMessages([{ role: "interviewer", content: res.reply }]);
        if (res.is_done) setIsDone(true);
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

  async function handleSend() {
    const text = input.trim();
    if (!text || sending || isDone) return;

    const userMsg: InterviewChatMessage = { role: "user", content: text };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput("");
    setSending(true);
    scrollToBottom();

    try {
      const res = await sendStage3Message(numericSessionId, text, messages);
      setMessages([...nextHistory, { role: "interviewer", content: res.reply }]);
      if (res.is_done) setIsDone(true);
    } catch {
      setMessages([
        ...nextHistory,
        { role: "interviewer", content: "(Connection error. Please try again.)" },
      ]);
    } finally {
      setSending(false);
      scrollToBottom();
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (initializing) {
    return (
      <div className="mock-loading" style={{ height: "100vh" }}>
        <div
          className="mock-interviewer-avatar"
          style={{ width: 52, height: 52, fontSize: "0.9rem" }}
        >
          <MessageSquare size={18} />
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
          <AlertCircle size={20} style={{ color: "var(--error)" }} />
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
    <div className="page page-narrow">
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="mock-interviewer-avatar">BQ</div>
          <div>
            <div className="mock-interviewer-name">{companyLabel} Interviewer</div>
            <div className="mock-stage-breadcrumb">Stage 3: Behavioral Interview</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            className="button button-ghost"
            onClick={() => navigate("/mock-interview")}
            title="Quit (your progress is saved)"
          >
            <LogOut size={14} /> Quit
          </button>
          {isDone && (
            <button
              className="button button-primary"
              onClick={() =>
                navigate(`/mock-interview/${sessionId}/summary`, {
                  state: { session: state?.session, selectedStages },
                })
              }
            >
              View Summary <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="mock-stage3-chat-wrap">
        <div className="mock-stage3-chat-thread" ref={threadRef}>
          {messages.map((msg, i) => (
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

          {sending && (
            <div className="mock-chat-msg mock-chat-msg--interviewer">
              <span className="mock-chat-msg-role">{companyLabel} Interviewer</span>
              <p className="mock-chat-msg-bubble mock-chat-typing">
                <Loader2 size={13} className="spin" /> Typing…
              </p>
            </div>
          )}

          {isDone && (
            <div style={{ textAlign: "center", padding: "16px 0 4px" }}>
              <span className="eyebrow">Interview Complete</span>
              <p className="muted small" style={{ marginTop: 4 }}>
                All questions answered. Click "View Summary" to see your debrief.
              </p>
            </div>
          )}
        </div>

        {!isDone && (
          <div className="mock-stage3-chat-input-row">
            <textarea
              ref={inputRef}
              className="kojo-input"
              placeholder="Type your answer (Enter to send, Shift+Enter for newline)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              rows={3}
              style={{ flex: 1, minHeight: 56, maxHeight: 160, resize: "none" }}
            />
            <button
              className="kojo-send"
              onClick={handleSend}
              disabled={!input.trim() || sending}
              title="Send answer"
            >
              {sending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
            </button>
          </div>
        )}
      </div>

      {!isDone && (
        <div
          style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
        >
          <span className="mock-star-hint-label">STAR:</span>
          <span className="mock-star-chip mock-star-chip-s">Situation</span>
          <span className="mock-star-chip mock-star-chip-t">Task</span>
          <span className="mock-star-chip mock-star-chip-a">Action</span>
          <span className="mock-star-chip mock-star-chip-r">Result</span>
          <span className="mock-star-hint-label" style={{ marginLeft: 4 }}>
            Speak it out loud first, then type.
          </span>
        </div>
      )}
    </div>
  );
}
