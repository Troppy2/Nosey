import { AlertCircle, Bot, Maximize2, Minimize2, Send, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clearKojoConversation, fetchKojoConversation, fetchProviderStatus, kojoChat } from "../lib/api";
import type { KojoMessage, ProviderStatus } from "../lib/types";
import { useSettings } from "../lib/useSettings";
import { MarkdownContent } from "./MarkdownContent";
import { useLocation } from 'react-router-dom'

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
  claude: "Claude (Anthropic)",
  gemini: "Gemini (Google)",
  groq: "Groq (cloud)",
  ollama: "Ollama (local)",
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
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const { generationProvider } = useSettings();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);



  useEffect(() => {
    fetchKojoConversation(folderId).then((conv) => {
      if (conv) setMessages(conv.messages);
    });
    fetchProviderStatus().then(setProviderStatus).catch(() => { });
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

  const isOllamaOffline = generationProvider === "ollama" && providerStatus !== null && !providerStatus.ollama;
  const isOllamaModelMissing = generationProvider === "ollama" && providerStatus !== null && !!providerStatus.ollama && !providerStatus.ollama_model_available;
  const hasProviderWarn = isOllamaOffline || isOllamaModelMissing;

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
      const result = await kojoChat(folderId, messageText, generationProvider);
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

  const modelPicker = (
    <div className="kojo-model-picker kojo-model-picker--locked" title={`Model: ${PROVIDER_LABELS[generationProvider] ?? generationProvider}`}>
      <span className="kojo-model-btn kojo-model-btn--static">
        {generationProvider in PROVIDER_LABELS ? generationProvider : "auto"}
        {hasProviderWarn ? <span className="kojo-model-warn-dot" /> : null}
      </span>
    </div>
  );

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
              <Bot size={18} />
            </div>
            <div className="kojo-header-info">
              <span className="kojo-header-name">
                <Sparkles size={13} className="kojo-title-icon" />
                Kojo
                <span className="kojo-header-online" aria-label="online" />
              </span>
              <span className="kojo-header-sub">{folderName}</span>
            </div>
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
              <Trash2 size={18} />
              {!isFullscreen && <span>Clear chat</span>}
            </button>
            <button
              className="kojo-header-btn"
              onClick={() => setIsFullscreen((f) => !f)}
              type="button"
              aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
              title={isFullscreen ? "Exit full screen" : "Full screen"}
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              {!isFullscreen && <span>Full screen</span>}
            </button>
            <button
              className="kojo-header-btn"
              onClick={onClose}
              type="button"
              aria-label="Close Kojo"
              title="Close"
            >
              <X size={18} />
              {!isFullscreen && <span>Close</span>}
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
          <div className={isFullscreen ? "kojo-input-row" : undefined}>
            {isFullscreen && modelPicker}
            <div className="kojo-input-wrap">
              {!isFullscreen && modelPicker}
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
          </div>
          <div className="kojo-input-footer">
            <p className="kojo-input-hint">Enter · Shift+Enter for new line</p>
          </div>
        </div>
      </div>
    </>
  );
}
