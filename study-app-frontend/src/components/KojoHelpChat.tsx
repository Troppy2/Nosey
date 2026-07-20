import { AlertCircle, Maximize2, Minimize2, Send, Sparkles, X } from "lucide-react";
import KojoMascot from "./KojoMascot";
import { useEffect, useRef, useState } from "react";
import {
  createGeneralKojoConversation,
  fetchKojoConversationById,
  kojoChatGeneral,
  kojoChatGeneralStream,
  scopeKey,
} from "../lib/api";
import type { KojoMessage } from "../lib/types";
import { formatTime } from "./KojoChat";
import { MarkdownContent } from "./MarkdownContent";
import { SlashCommandMenu, type CommandOption } from "./SlashCommandMenu";

export interface KojoHelpChatProps {
  /** Stable per-context id (e.g. a problem slug or test id) used to look up
   * the backing conversation. Scoped per user via scopeKey() before writing
   * to localStorage. */
  storageKey: string;
  /** Header subtitle, e.g. the problem title or test name. */
  subtitle: string;
  onClose: () => void;
  /** Ephemeral per-turn grounding (problem statement + code, or the current
   * test question) sent alongside each message but never persisted as a
   * visible chat bubble. */
  buildContext: () => string;
  /** Standing instruction/guardrail, e.g. "give hints, never the full answer". */
  customInstruction?: string;
  strictness?: string;
  provider?: string;
  /** Prefilled composer text shown the first time this thread is opened empty. */
  initialDraft?: string;
  suggestions?: string[];
  /** Optional banner shown under the header (LeetCode's hint-contract notice). */
  contractNote?: string;
  slashCommands?: CommandOption[];
  disabled?: boolean;
  disabledNote?: string;
  emptyTitle?: string;
  emptySub?: string;
}

const DEFAULT_SUGGESTIONS = [
  "Explain what this is really asking",
  "Give me a hint without the full answer",
  "What concept should I review first?",
];

export function KojoHelpChat({
  storageKey,
  subtitle,
  onClose,
  buildContext,
  customInstruction,
  strictness,
  provider,
  initialDraft,
  suggestions = DEFAULT_SUGGESTIONS,
  contractNote,
  slashCommands,
  disabled = false,
  disabledNote,
  emptyTitle = "Hi, I'm Kojo",
  emptySub = "Ask me anything about this. I'll guide your thinking instead of handing over the answer.",
}: KojoHelpChatProps) {
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<KojoMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [loadingThread, setLoadingThread] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadKey = scopeKey(`nosey_kojo_thread_${storageKey}`);

  // Resolve (or create) the conversation backing this context. Only the
  // conversation id pointer lives in localStorage; the messages themselves
  // live server-side, so history survives navigating away and back.
  useEffect(() => {
    let cancelled = false;
    async function loadOrCreate() {
      setLoadingThread(true);
      setError(null);
      const savedId = Number(localStorage.getItem(threadKey) || "");
      const existing = savedId ? await fetchKojoConversationById(savedId) : null;

      if (existing) {
        if (cancelled) return;
        setConversationId(existing.id);
        setMessages(existing.messages);
        if (existing.messages.length === 0 && initialDraft) setInput(initialDraft);
      } else {
        try {
          const summary = await createGeneralKojoConversation();
          localStorage.setItem(threadKey, String(summary.id));
          if (cancelled) return;
          setConversationId(summary.id);
          setMessages([]);
          if (initialDraft) setInput(initialDraft);
        } catch (err) {
          if (!cancelled) setError(err instanceof Error ? err.message : "Could not start a Kojo chat.");
        }
      }
      if (!cancelled) setLoadingThread(false);
    }
    void loadOrCreate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!loadingThread) inputRef.current?.focus();
  }, [loadingThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  useEffect(() => {
    document.body.style.overflow = isFullscreen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isFullscreen]);

  const showsCommands = !!slashCommands?.length && input.trimStart().startsWith("/");
  const inputDisabled = isLoading || disabled || loadingThread || conversationId == null;

  function selectCommand(command: CommandOption) {
    setInput("");
    void handleSend(command.prompt);
  }

  async function handleSend(text?: string) {
    const messageText = (text ?? input).trim();
    if (!messageText || isLoading || disabled || conversationId == null) return;

    const userMsg: KojoMessage = {
      id: Date.now(),
      role: "user",
      content: messageText,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setIsLoading(true);
    setError(null);

    const context = buildContext();

    // Streaming assistant bubble. The placeholder is inserted on the first
    // delta so the "thinking" indicator shows until real text arrives.
    const tempId = Date.now() + 1;
    let streamed = "";
    let placed = false;
    const onDelta = (delta: string) => {
      streamed += delta;
      if (!placed) {
        placed = true;
        setIsLoading(false);
        setMessages((prev) => [
          ...prev,
          { id: tempId, role: "assistant", content: streamed, created_at: new Date().toISOString() },
        ]);
      } else {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, content: streamed } : m)));
      }
    };

    try {
      let result;
      try {
        result = await kojoChatGeneralStream(
          conversationId, messageText, onDelta, provider, strictness, customInstruction, undefined, context,
        );
      } catch (streamErr) {
        // If the stream failed before producing any text, fall back to the
        // non-streamed endpoint so a transient stream issue still answers.
        if (placed) throw streamErr;
        result = await kojoChatGeneral(conversationId, messageText, provider, strictness, customInstruction, context);
      }
      const assistantMsg: KojoMessage = {
        id: result.message_id,
        role: "assistant",
        content: result.response,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempId && m.id !== userMsg.id),
        { ...userMsg, id: result.message_id - 1 },
        assistantMsg,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kojo failed to respond. Try again.");
      setMessages((prev) => prev.filter((m) => m.id !== tempId && m.id !== userMsg.id));
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

  return (
    <>
      {!isFullscreen && <div className="kojo-backdrop" onClick={onClose} aria-hidden="true" />}
      <div
        className={`kojo-panel${isFullscreen ? " kojo-panel--fullscreen" : ""}`}
        role="dialog"
        aria-label="Ask Kojo"
      >
        {/* ── Header ── */}
        <div className="kojo-header">
          <div className="kojo-header-left">
            <div className="kojo-avatar">
              <KojoMascot state={isLoading ? "loading" : "idle"} />
            </div>
            <div className="kojo-header-info">
              <span className="kojo-header-name">
                <Sparkles size={13} className="kojo-title-icon" />
                Kojo
              </span>
              <span className="kojo-header-sub">{subtitle}</span>
            </div>
          </div>

          <div className="kojo-header-actions">
            <button
              className="kojo-header-btn"
              onClick={() => setIsFullscreen((f) => !f)}
              type="button"
              aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
              title={isFullscreen ? "Exit full screen" : "Full screen"}
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
            <button className="kojo-header-btn" onClick={onClose} type="button" aria-label="Close Kojo" title="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {contractNote ? (
          <div className="lc-kojo-contract">
            <p>{contractNote}</p>
          </div>
        ) : null}

        {/* ── Messages ── */}
        <div className="kojo-messages">
          <div className="kojo-messages-inner">
            {!loadingThread && messages.length === 0 && !isLoading ? (
              <div className="kojo-empty">
                <div className="kojo-empty-icon">
                  <KojoMascot state="idle" />
                </div>
                <p className="kojo-empty-title">{emptyTitle}</p>
                <p className="kojo-empty-sub">{emptySub}</p>
                <div className="kojo-suggestions">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      className="kojo-suggestion"
                      onClick={() => handleSend(s)}
                      type="button"
                      disabled={disabled}
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
                      <KojoMascot state="idle" />
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
                <div className="kojo-msg-avatar kojo-msg-avatar--working"><KojoMascot state="loading" /></div>
                <div className="kojo-message-body">
                  <div className="kojo-message-meta">
                    <span className="kojo-message-label">Kojo</span>
                    <span className="kojo-message-time kojo-thinking-label">thinking…</span>
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

            <div ref={bottomRef} />
          </div>
        </div>

        {/* ── Input ── */}
        <div className="kojo-input-area">
          <p className="kojo-input-label">{disabled && disabledNote ? disabledNote : "Message Kojo"}</p>
          <div className={isFullscreen ? "kojo-input-row" : undefined}>
            <div className="kojo-input-wrap">
              <textarea
                ref={inputRef}
                className="kojo-input"
                rows={1}
                placeholder={slashCommands?.length ? "Ask Kojo anything, or type / for commands" : "Ask Kojo anything…"}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={inputDisabled}
              />
              {showsCommands ? <SlashCommandMenu commands={slashCommands!} onSelect={selectCommand} /> : null}
              <button
                className="kojo-send"
                onClick={() => handleSend()}
                disabled={!input.trim() || inputDisabled}
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
