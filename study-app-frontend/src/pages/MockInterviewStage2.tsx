import Editor from "@monaco-editor/react";
import { AlertCircle, ChevronRight, ExternalLink, Flag, Loader2, Send, Users, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { sendStage2Message, submitStage2 } from "../lib/api";
import type { CodingProblemInfo, InterviewChatMessage, MockInterviewSession } from "../lib/types";
import { COMPANY_OPTIONS, type CompanyKey } from "../data/mockInterviewProblems";

function speak(text: string, onEnd?: () => void) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 0.95;
  utt.pitch = 1;
  if (onEnd) utt.onend = onEnd;
  window.speechSynthesis.speak(utt);
}

function stopSpeaking() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
}

const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

export default function MockInterviewStage2() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { session: MockInterviewSession; selectedStages: string[] } | null;

  const session = state?.session;
  const selectedStages = state?.selectedStages ?? ["stage2", "stage3"];
  const company = (session?.company ?? "random") as CompanyKey;
  const companyLabel = COMPANY_OPTIONS.find((c) => c.key === company)?.label ?? company;

  const [messages, setMessages] = useState<InterviewChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [initializing, setInitializing] = useState(true);
  const [sending, setSending] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const [codingProblem, setCodingProblem] = useState<CodingProblemInfo | null>(null);
  const [code, setCode] = useState("# Write your solution here\n\n");
  const [codeSubmitting, setCodeSubmitting] = useState(false);
  const [codeFeedback, setCodeFeedback] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);

  const [isDone, setIsDone] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);

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
        const res = await sendStage2Message(Number(sessionId), null, []);
        const first: InterviewChatMessage = { role: "interviewer", content: res.reply };
        setMessages([first]);
        if (ttsEnabled) speak(res.reply);
        if (res.coding_problem) setCodingProblem(res.coding_problem);
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
    stopSpeaking();

    const userMsg: InterviewChatMessage = { role: "user", content: text };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput("");
    setSending(true);
    scrollToBottom();

    try {
      const res = await sendStage2Message(Number(sessionId), text, messages);
      const aiMsg: InterviewChatMessage = { role: "interviewer", content: res.reply };
      setMessages([...nextHistory, aiMsg]);
      if (ttsEnabled) speak(res.reply);
      if (res.coding_problem && !codingProblem) {
        setCodingProblem(res.coding_problem);
        setCode(`# ${res.coding_problem.title}\n# Write your solution here\n\n`);
      }
      if (res.is_done) setIsDone(true);
    } catch (e: unknown) {
      const errMsg: InterviewChatMessage = {
        role: "interviewer",
        content: "(Connection error — please try again.)",
      };
      setMessages([...nextHistory, errMsg]);
    } finally {
      setSending(false);
      scrollToBottom();
      inputRef.current?.focus();
    }
  }

  async function handleSubmitCode() {
    if (!codingProblem || codeSubmitting) return;
    setCodeError(null);
    setCodeSubmitting(true);
    try {
      const res = await submitStage2(Number(sessionId), code);
      setCodeFeedback(res.feedback);
      // Add code submission + feedback to chat
      const codeMsg: InterviewChatMessage = {
        role: "user",
        content: `MY SOLUTION:\n\`\`\`python\n${code.slice(0, 400)}${code.length > 400 ? "\n..." : ""}\n\`\`\``,
      };
      const fbMsg: InterviewChatMessage = { role: "interviewer", content: res.feedback };
      setMessages((prev) => [...prev, codeMsg, fbMsg]);
      if (ttsEnabled) speak(res.feedback);
      setIsDone(true);
      scrollToBottom();
    } catch (e: unknown) {
      setCodeError(e instanceof Error ? e.message : "Submission failed. Try again.");
    } finally {
      setCodeSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function nextRoute() {
    if (selectedStages.includes("stage3")) return `/mock-interview/${sessionId}/stage3`;
    return `/mock-interview/${sessionId}/summary`;
  }

  if (initializing) {
    return (
      <div className="mock-loading" style={{ height: "100vh" }}>
        <div className="mock-interviewer-avatar" style={{ width: 52, height: 52, fontSize: "0.9rem" }}>
          <Users size={20} />
        </div>
        <p className="muted">Preparing your interviewer…</p>
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
    <div className="mock-stage2-room">
      {/* Top bar */}
      <div className="mock-stage2-room-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="mock-interviewer-avatar">AI</div>
          <div>
            <div className="mock-interviewer-name">{companyLabel} Interviewer</div>
            <div className="mock-stage-breadcrumb">Stage 2 — Technical Interview</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {ttsSupported && (
            <button
              className={`button button-ghost mock-stage2-tts-btn${ttsEnabled ? " active" : ""}`}
              onClick={() => { stopSpeaking(); setTtsEnabled((v) => !v); }}
            >
              {ttsEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
              {ttsEnabled ? "Audio On" : "Audio Off"}
            </button>
          )}
          {isDone && (
            <button
              className="button button-primary"
              onClick={() => navigate(nextRoute(), { state: { session, selectedStages } })}
            >
              Continue <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="mock-stage2-room-body">
        {/* Left: problem (optional) + chat */}
        <div
          className="mock-stage2-room-left"
          style={!codingProblem ? { width: "100%", maxWidth: "none" } : undefined}
        >
          {/* Problem card — visible once coding problem is revealed */}
          {codingProblem && (
            <div className="mock-stage2-problem-card">
              <div className="mock-stage2-problem-header">
                <div className="mock-stage2-problem-title">{codingProblem.title}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className={`pill mock-diff-${codingProblem.difficulty.toLowerCase()}`}>
                    {codingProblem.difficulty}
                  </span>
                  <a
                    href={`https://leetcode.com/problems/${codingProblem.slug}/`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.75rem", color: "var(--green-dark)" }}
                  >
                    LeetCode <ExternalLink size={10} />
                  </a>
                </div>
              </div>
              <p className="mock-stage2-problem-text">{codingProblem.prompt}</p>
            </div>
          )}

          {/* Chat thread */}
          <div
            className="mock-stage2-chat-thread"
            ref={threadRef}
            style={!codingProblem ? { maxWidth: 720, width: "100%", margin: "0 auto", alignSelf: "stretch" } : undefined}
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`mock-chat-msg ${msg.role === "interviewer" ? "mock-chat-msg--interviewer" : "mock-chat-msg--user"}`}
              >
                <span className="mock-chat-msg-role">
                  {msg.role === "interviewer" ? companyLabel + " Interviewer" : "You"}
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
          </div>

          {/* Chat input */}
          {!isDone && (
            <div className="mock-stage2-chat-input-row">
              <textarea
                ref={inputRef}
                className="kojo-input"
                placeholder="Type your response… (Enter to send, Shift+Enter for newline)"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sending}
                rows={2}
                style={{ flex: 1, minHeight: 44, maxHeight: 120, resize: "none" }}
              />
              <button
                className="kojo-send"
                onClick={handleSend}
                disabled={!input.trim() || sending}
                title="Send"
              >
                {sending ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
              </button>
            </div>
          )}
        </div>

        {/* Right: editor — visible once coding problem is revealed */}
        {codingProblem && (
          <div className="mock-stage2-room-right">
            <div className="mock-stage2-room-editor-wrap">
              <div className="mock-stage2-coding-header">
                <span className="eyebrow">Solution</span>
                <span style={{ color: "#888", fontSize: "0.8rem", marginLeft: "auto" }}>Python 3</span>
              </div>

              <div className="mock-stage2-editor-wrap" style={{ flex: 1, minHeight: 0 }}>
                <Editor
                  height="100%"
                  language="python"
                  theme="vs-dark"
                  value={code}
                  onChange={(v) => setCode(v ?? "")}
                  options={{
                    fontSize: 14,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                  }}
                />
              </div>

              {codeFeedback ? (
                <div className="mock-stage2-feedback">
                  <span className="eyebrow">Code Feedback</span>
                  <p className="muted" style={{ lineHeight: 1.65 }}>{codeFeedback}</p>
                </div>
              ) : (
                <div className="mock-stage2-submit-bar">
                  {codeError && (
                    <span style={{ color: "var(--error)", fontSize: "0.82rem", display: "flex", alignItems: "center", gap: 4 }}>
                      <AlertCircle size={13} /> {codeError}
                    </span>
                  )}
                  <div style={{ flex: 1 }} />
                  <button
                    className="button button-primary"
                    onClick={handleSubmitCode}
                    disabled={codeSubmitting || !code.trim()}
                  >
                    {codeSubmitting ? (
                      <><Loader2 size={14} className="spin" /> Submitting…</>
                    ) : (
                      <><Flag size={13} /> Submit Solution</>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
