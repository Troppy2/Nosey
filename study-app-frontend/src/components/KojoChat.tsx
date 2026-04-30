import { AlertCircle, Bot, Maximize2, Minimize2, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clearKojoConversation, fetchKojoConversation, kojoChat } from "../lib/api";
import type { KojoMessage } from "../lib/types";
import { MarkdownContent } from "./MarkdownContent";

interface KojoChatProps {
  folderId: number;
  folderName: string;
  onClose: () => void;
}

const SUGGESTIONS = [
  "Explain the main concepts in these notes",
  "What should I focus on when studying?",
  "Give me an example to understand a key idea",
  "Quiz me on the most important terms",
];

const PROVIDER_LABELS: Record<string, string> = {
  auto: "Auto",
  ollama: "Ollama (local)",
  groq: "Groq (cloud)",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function KojoChat({ folderId, folderName, onClose }: KojoChatProps) {
  const [messages, setMessages] = useState<KojoMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearNotice, setClearNotice] = useState<string | null>(null);
  const [provider, setProvider] = useState<string>(() => localStorage.getItem("kojo_llm_provider") || "auto");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchKojoConversation(folderId).then((conv) => {
      if (conv) setMessages(conv.messages);
    });
    setConfirmClear(false);
    setClearNotice(null);
    inputRef.current?.focus();
  }, [folderId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    document.body.style.overflow = isFullscreen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [isFullscreen]);

  async function handleSend(text?: string) {
    const messageText = (text ?? input).trim();
    if (!messageText || isLoading) return;

    const userMsg: KojoMessage = {
      id: Date.now(),
      role: "user",
      content: messageText,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setClearNotice(null);
    if (inputRef.current) inputRef.current.style.height = "auto";
    setIsLoading(true);
    setError(null);

    try {
      const result = await kojoChat(folderId, messageText, provider);
      const assistantMsg: KojoMessage = {
        id: result.message_id,
        role: "assistant",
        content: result.response,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [
        ...prev.slice(0, -1),
        { ...userMsg, id: result.message_id - 1 },
        assistantMsg,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kojo failed to respond. Try again.");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }

  async function handleClearConversation() {
    if (isLoading) return;
    try {
      setError(null);
      await clearKojoConversation(folderId);
      setMessages([]);
      setConfirmClear(false);
      setClearNotice("Chat cleared. You can restore it from Settings within 5 hours.");
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear chat history.");
    }
  }

  return (
    <>
      {!isFullscreen && (
        <div className="kojo-backdrop" onClick={onClose} aria-hidden="true" />
      )}
      <div
        className={`kojo-panel${isFullscreen ? " kojo-panel--fullscreen" : ""}`}
        role="dialog"
        aria-label="Kojo Study Companion"
      >
        {/* ── Header ── */}
        <div className="kojo-header">
          <div className="kojo-header-left">
            <div className="kojo-avatar">
              <Bot size={16} />
            </div>
            <div className="kojo-header-info">
              <span className="kojo-header-name">
                Kojo
                <span className="kojo-header-online" aria-label="online" />
              </span>
              <span className="kojo-header-sub">{folderName}</span>
            </div>
          </div>

          <div className="kojo-header-center">
            <label className="kojo-provider-label">Model</label>
            <select
              className="kojo-provider-select"
              value={provider}
              onChange={(e) => { setProvider(e.target.value); localStorage.setItem("kojo_llm_provider", e.target.value); }}
              disabled={isLoading}
              aria-label="LLM provider"
            >
              {Object.entries(PROVIDER_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>

          <div className="kojo-header-actions">
            <button
              className="kojo-header-btn"
              onClick={() => setConfirmClear((c) => !c)}
              type="button"
              aria-label="Clear chat history"
              title="Clear chat"
              disabled={isLoading}
            >
              <Trash2 size={15} />
            </button>
            <button
              className="kojo-header-btn"
              onClick={() => setIsFullscreen((f) => !f)}
              type="button"
              aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
              title={isFullscreen ? "Exit full screen" : "Full screen"}
            >
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button
              className="kojo-header-btn"
              onClick={onClose}
              type="button"
              aria-label="Close Kojo"
            >
              <X size={17} />
            </button>
          </div>
        </div>

        {/* ── Clear confirmation bar ── */}
        {confirmClear && (
          <div className="kojo-clear-inline" role="alert">
            <span>Clear this chat? Restorable from Settings for 5 hours.</span>
            <div className="kojo-clear-inline-actions">
              <button
                className="kojo-clear-inline-btn kojo-clear-inline-btn--confirm"
                type="button"
                onClick={handleClearConversation}
                disabled={isLoading}
              >
                Clear
              </button>
              <button
                className="kojo-clear-inline-btn"
                type="button"
                onClick={() => setConfirmClear(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── Messages ── */}
        <div className="kojo-messages">
          <div className="kojo-messages-inner">
            {messages.length === 0 && !isLoading ? (
              <div className="kojo-empty">
                <div className="kojo-empty-icon">
                  <Sparkles size={28} />
                </div>
                <p className="kojo-empty-title">Hi, I'm Kojo</p>
                <p className="kojo-empty-sub">
                  Your AI study companion for <strong>{folderName}</strong>.
                  I can explain concepts, give examples, and help you work through ideas
                  using your uploaded notes.
                </p>
                <div className="kojo-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      className="kojo-suggestion"
                      onClick={() => handleSend(s)}
                      type="button"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) =>
                msg.role === "assistant" ? (
                  <div key={msg.id} className="kojo-message kojo-message--assistant">
                    <div className="kojo-msg-avatar">
                      <Bot size={14} />
                    </div>
                    <div className="kojo-message-body">
                      <div className="kojo-message-meta">
                        <span className="kojo-message-label">Kojo</span>
                        <span className="kojo-message-time">{formatTime(msg.created_at)}</span>
                      </div>
                      <MarkdownContent content={msg.content} />
                    </div>
                  </div>
                ) : (
                  <div key={msg.id} className="kojo-message kojo-message--user">
                    <div className="kojo-user-bubble">
                      <p>{msg.content}</p>
                      <span className="kojo-message-time kojo-message-time--user">{formatTime(msg.created_at)}</span>
                    </div>
                  </div>
                ),
              )
            )}

            {isLoading && (
              <div className="kojo-message kojo-message--assistant">
                <div className="kojo-msg-avatar"><Bot size={14} /></div>
                <div className="kojo-message-body">
                  <div className="kojo-message-meta">
                    <span className="kojo-message-label">Kojo</span>
                    <span className="kojo-message-time kojo-thinking-label">thinking…</span>
                  </div>
                  <div className="kojo-thinking">
                    <span /><span /><span />
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="kojo-error">
                <AlertCircle size={14} />
                <span>{error}</span>
              </div>
            )}

            {clearNotice && <p className="kojo-notice">{clearNotice}</p>}

            <div ref={bottomRef} />
          </div>
        </div>

        {/* ── Input ── */}
        <div className="kojo-input-area">
          <div className="kojo-input-wrap">
            <textarea
              ref={inputRef}
              className="kojo-input"
              rows={1}
              placeholder="Ask Kojo anything about your notes…"
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
            />
            <button
              className="kojo-send"
              onClick={() => handleSend()}
              disabled={!input.trim() || isLoading}
              type="button"
              aria-label="Send"
            >
              <Send size={15} />
            </button>
          </div>
          <p className="kojo-input-hint">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </>
  );
}
