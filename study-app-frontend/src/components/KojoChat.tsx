import { AlertCircle, Maximize2, Minimize2, Send, Trash2, X } from "lucide-react";
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
  "What should I focus on when studying this?",
  "Give me an example to help understand a key idea",
  "What are the most important terms to know?",
];

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
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }

  async function handleClearConversation() {
    if (isLoading) return;
    try {
      setError(null);
      await clearKojoConversation(folderId);
      setMessages([]);
      setConfirmClear(false);
      setClearNotice("Chat history cleared. You can restore it from Settings for 5 hours.");
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
            <div className="kojo-avatar">K</div>
            <div className="kojo-header-info">
              <span className="kojo-header-name">Kojo</span>
              <span className="kojo-header-sub">{folderName}</span>
            </div>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 8}}>
            <label style={{fontSize:12, opacity:0.8, marginRight:4}}>Model</label>
            <select
              value={provider}
              onChange={(e) => { setProvider(e.target.value); localStorage.setItem("kojo_llm_provider", e.target.value); }}
              disabled={isLoading}
              aria-label="LLM provider"
            >
              <option value="auto">Auto</option>
              <option value="ollama">Ollama</option>
              <option value="groq">Groq</option>
            </select>
          </div>
          <div className="kojo-header-actions">
            <button
              className="kojo-header-btn"
              onClick={() => setConfirmClear((current) => !current)}
              type="button"
              aria-label="Clear chat history"
              title="Clear chat history"
              disabled={isLoading}
            >
              <Trash2 size={16} />
            </button>
            <button
              className="kojo-header-btn"
              onClick={() => setIsFullscreen((f) => !f)}
              type="button"
              aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
              title={isFullscreen ? "Exit full screen" : "Full screen"}
            >
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
            <button
              className="kojo-header-btn"
              onClick={onClose}
              type="button"
              aria-label="Close Kojo"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {confirmClear && (
          <div className="kojo-clear-inline" role="alert">
            <span>Clear this chat? You can restore it from Settings within 5 hours.</span>
            <div className="kojo-clear-inline-actions">
              <button
                className="kojo-clear-inline-btn kojo-clear-inline-btn--confirm"
                type="button"
                onClick={handleClearConversation}
                disabled={isLoading}
              >
                Clear chat
              </button>
              <button
                className="kojo-clear-inline-btn"
                type="button"
                onClick={() => setConfirmClear(false)}
                disabled={isLoading}
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
                <div className="kojo-empty-icon">K</div>
                <p className="kojo-empty-title">Hi, I'm Kojo</p>
                <p className="kojo-empty-sub">
                  Your study companion for <strong>{folderName}</strong>. I can explain concepts,
                  give examples, and help you think through ideas — but I won't hand you test answers.
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
                    <div className="kojo-msg-avatar">K</div>
                    <div className="kojo-message-body">
                      <span className="kojo-message-label">Kojo</span>
                      <MarkdownContent content={msg.content} />
                    </div>
                  </div>
                ) : (
                  <div key={msg.id} className="kojo-message kojo-message--user">
                    <div className="kojo-user-bubble">{msg.content}</div>
                  </div>
                ),
              )
            )}

            {isLoading && (
              <div className="kojo-message kojo-message--assistant">
                <div className="kojo-msg-avatar">K</div>
                <div className="kojo-message-body">
                  <span className="kojo-message-label">Kojo</span>
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
              <Send size={16} />
            </button>
          </div>
          <p className="kojo-input-hint">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </>
  );
}
