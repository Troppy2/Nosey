import { AlertCircle, ChevronRight, Loader2, MessageSquare, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { sendStage3Message } from "../lib/api";
import type { InterviewChatMessage, MockInterviewSession } from "../lib/types";
import { COMPANY_OPTIONS, type CompanyKey } from "../data/mockInterviewProblems";

export default function MockInterviewStage3() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { session: MockInterviewSession; selectedStages: string[] } | null;

  const session = state?.session;
  const selectedStages = state?.selectedStages ?? ["stage3"];
  const company = (session?.company ?? "random") as CompanyKey;
  const companyLabel = COMPANY_OPTIONS.find((c) => c.key === company)?.label ?? company;

  const [messages, setMessages] = useState<InterviewChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [sending, setSending] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [isDone, setIsDone] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  function scrollToBottom() {
    setTimeout(() => {
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
    }, 50);
  }

  // Start interview
  useEffect(() => {
    async function init() {
      try {
        const res = await sendStage3Message(Number(sessionId), null, []);
        setMessages([{ role: "interviewer", content: res.reply }]);
        if (res.is_done) setIsDone(true);
      } catch (e: unknown) {
        setInitError(e instanceof Error ? e.message : "Failed to start interview.");
      } finally {
        setInitializing(false);
        scrollToBottom();
      }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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
      const res = await sendStage3Message(Number(sessionId), text, messages);
      const aiMsg: InterviewChatMessage = { role: "interviewer", content: res.reply };
      setMessages([...nextHistory, aiMsg]);
      if (res.is_done) setIsDone(true);
    } catch {
      const errMsg: InterviewChatMessage = {
        role: "interviewer",
        content: "(Connection error. Please try again.)",
      };
      setMessages([...nextHistory, errMsg]);
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
        <div className="mock-interviewer-avatar" style={{ width: 52, height: 52, fontSize: "0.9rem" }}>
          <MessageSquare size={18} />
        </div>
        <p className="muted">Preparing your behavioral interview…</p>
        <Loader2 size={20} className="spin" style={{ color: "var(--green-dark)" }} />
      </div>
    );
  }

  if (initError) {
    return (
      <div className="page page-narrow">
        <div className="card mock-error-card">
          <AlertCircle size={20} style={{ color: "var(--error)" }} />
          <p>{initError}</p>
          <button className="button button-ghost" onClick={() => navigate("/mock-interview")}>
            Back to Setup
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      {/* Header */}
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="mock-interviewer-avatar">BQ</div>
          <div>
            <div className="mock-interviewer-name">{companyLabel} Interviewer</div>
            <div className="mock-stage-breadcrumb">Stage 3 , Behavioral Interview</div>
          </div>
        </div>
        {isDone && (
          <button
            className="button button-primary"
            onClick={() =>
              navigate(`/mock-interview/${sessionId}/summary`, { state: { session, selectedStages } })
            }
          >
            View Summary <ChevronRight size={14} />
          </button>
        )}
      </div>

      {/* Chat window */}
      <div className="mock-stage3-chat-wrap">
        <div className="mock-stage3-chat-thread" ref={threadRef}>
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`mock-chat-msg ${msg.role === "interviewer" ? "mock-chat-msg--interviewer" : "mock-chat-msg--user"}`}
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
              placeholder="Type your answer… (Enter to send, Shift+Enter for newline)"
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

      {/* STAR hint */}
      {!isDone && (
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span className="mock-star-hint-label">STAR:</span>
          <span className="mock-star-chip mock-star-chip-s">Situation</span>
          <span className="mock-star-chip mock-star-chip-t">Task</span>
          <span className="mock-star-chip mock-star-chip-a">Action</span>
          <span className="mock-star-chip mock-star-chip-r">Result</span>
          <span className="mock-star-hint-label" style={{ marginLeft: 4 }}>, Speak it out loud first, then type.</span>
        </div>
      )}
    </div>
  );
}
