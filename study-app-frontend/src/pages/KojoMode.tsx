import { AlertCircle, Bot, FolderOpen, Send, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { MarkdownContent } from "../components/MarkdownContent";
import { SlashCommandMenu, type SlashCommand } from "../components/SlashCommandMenu";
import {
  clearKojoConversation,
  fetchFolders,
  fetchKojoConversation,
  kojoChat,
} from "../lib/api";
import type { Folder, KojoMessage } from "../lib/types";
import { useSettings } from "../lib/useSettings";

const SUGGESTIONS = [
  "Explain the main concepts in these notes",
  "What should I focus on for the exam?",
  "Give me an analogy to understand a key idea",
  "Quiz me on the most important terms",
];

const CHAT_COMMANDS: SlashCommand[] = [
  { slash: "/summarize", label: "Summarize", description: "Pull out the big ideas from this folder.", prompt: "Summarize the most important ideas in this folder." },
  { slash: "/quiz", label: "Quiz Me", description: "Turn the notes into quick review questions.", prompt: "Quiz me on the most important material in this folder." },
  { slash: "/review", label: "Review Mistakes", description: "Go over recent wrong answers.", prompt: "Review the wrong answers from my most recent test." },
  { slash: "/focus", label: "Study Focus", description: "Prioritize what to study next.", prompt: "What should I focus on next based on these notes?" },
  { slash: "/explain", label: "Explain", description: "Break down a confusing concept.", prompt: "Help me understand the hardest idea in these notes." },
  { slash: "/flashcards", label: "Flashcards", description: "Surface terms worth memorizing.", prompt: "What terms or facts from this folder would make strong flashcards?" },
];

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function KojoMode() {
  const { generationProvider } = useSettings();

  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [messages, setMessages] = useState<KojoMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearNotice, setClearNotice] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const showCommands = input.trimStart().startsWith("/");

  // Load folders on mount
  useEffect(() => {
    fetchFolders()
      .then((items) => {
        setFolders(items);
        setFolderId((cur) => cur ?? items[0]?.id ?? null);
      })
      .catch(() => {})
      .finally(() => setLoadingFolders(false));
  }, []);

  // Load conversation history when folder changes
  useEffect(() => {
    if (folderId === null) return;
    setMessages([]);
    setError(null);
    setConfirmClear(false);
    setClearNotice(null);
    fetchKojoConversation(folderId).then((conv) => {
      if (conv) setMessages(conv.messages);
    });
    inputRef.current?.focus();
  }, [folderId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const selectedFolder = folders.find((f) => f.id === folderId) ?? null;

  async function handleSend(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || isLoading || folderId === null) return;

    const userMsg: KojoMessage = {
      id: Date.now(),
      role: "user",
      content: msg,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setClearNotice(null);
    if (inputRef.current) inputRef.current.style.height = "auto";
    setIsLoading(true);
    setError(null);

    try {
      const result = await kojoChat(folderId, msg, generationProvider);
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

  async function handleClear() {
    if (isLoading || folderId === null) return;
    try {
      await clearKojoConversation(folderId);
      setMessages([]);
      setConfirmClear(false);
      setClearNotice("Chat cleared. Restorable from Settings within 5 hours.");
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear chat.");
    }
  }

  function selectCommand(command: SlashCommand) {
    setInput(command.prompt);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  if (loadingFolders) {
    return (
      <div className="chat-mode-shell">
        <div className="centered-block"><span className="loader" /></div>
      </div>
    );
  }

  if (folders.length === 0) {
    return (
      <div className="chat-mode-shell">
        <div className="chat-mode-empty">
          <Bot size={32} />
          <h2>No folders yet</h2>
          <p className="muted">Create a folder with study material for Kojo to reference.</p>
          <Link to="/folders"><Button variant="secondary" icon={<FolderOpen size={16} />}>Go to folders</Button></Link>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-mode-shell">
      {/* ── Sidebar: folder list ── */}
      <aside className="chat-mode-sidebar">
        <div className="chat-mode-sidebar-header">
          <Sparkles size={15} />
          <span>Chat mode</span>
        </div>
        <div className="chat-mode-sidebar-copy">
          <strong>Folders</strong>
          <small>{folders.length} study spaces</small>
        </div>
        <nav className="chat-mode-folder-list">
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className={`chat-mode-folder-btn${folder.id === folderId ? " chat-mode-folder-btn--active" : ""}`}
              onClick={() => setFolderId(folder.id)}
            >
              <FolderOpen size={15} />
              <span>{folder.name}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Main chat area ── */}
      <div className="chat-mode-main">
        {/* Header */}
        <div className="chat-mode-header">
          <div className="chat-mode-header-left">
            <div className="kojo-avatar"><Bot size={18} /></div>
            <div>
              <span className="chat-mode-title">
                <Sparkles size={13} className="kojo-title-icon" />
                Kojo
              </span>
              <span className="chat-mode-subtitle">{selectedFolder?.name ?? "—"}</span>
            </div>
          </div>
          <div className="chat-mode-header-meta">
            <span>Grounded in folder notes</span>
          </div>
          <button
            type="button"
            className="kojo-header-btn"
            onClick={() => setConfirmClear((c) => !c)}
            disabled={isLoading}
            title="Clear chat"
          >
            <Trash2 size={17} />
            <span>Clear</span>
          </button>
        </div>

        {/* Clear confirmation */}
        {confirmClear && (
          <div className="kojo-clear-inline" role="alert">
            <span>Clear this chat? Restorable from Settings for 5 hours.</span>
            <div className="kojo-clear-inline-actions">
              <button className="kojo-clear-inline-btn kojo-clear-inline-btn--confirm" type="button" onClick={handleClear} disabled={isLoading}>Clear</button>
              <button className="kojo-clear-inline-btn" type="button" onClick={() => setConfirmClear(false)}>Cancel</button>
            </div>
          </div>
        )}

        {/* Messages */}
        <div className="chat-mode-messages">
          <div className="chat-mode-messages-inner">
            {messages.length === 0 && !isLoading && (
              <div className="kojo-empty">
                <div className="kojo-empty-icon"><Sparkles size={28} /></div>
                <p className="kojo-empty-title">Hi, I'm Kojo</p>
                <p className="kojo-empty-sub">
                  Ask me anything grounded in <strong>{selectedFolder?.name}</strong>. I can explain, quiz, compare ideas, or help you plan what to study next.
                </p>
                <div className="kojo-suggestions">
                  {SUGGESTIONS.map((s) => (
                    <button key={s} className="kojo-suggestion" onClick={() => handleSend(s)} type="button">{s}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) =>
              msg.role === "assistant" ? (
                <div key={msg.id} className="kojo-message kojo-message--assistant">
                  <div className="kojo-msg-avatar"><Bot size={14} /></div>
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
            )}

            {isLoading && (
              <div className="kojo-message kojo-message--assistant">
                <div className="kojo-msg-avatar"><Bot size={14} /></div>
                <div className="kojo-message-body">
                  <div className="kojo-message-meta">
                    <span className="kojo-message-label">Kojo</span>
                    <span className="kojo-message-time kojo-thinking-label">thinking…</span>
                  </div>
                  <div className="kojo-thinking"><span /><span /><span /></div>
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

        {/* Input */}
        <div className="chat-mode-input-area">
          <div className="chat-mode-input-shell">
            <div className="chat-mode-input-wrap">
              <textarea
                ref={inputRef}
                className="kojo-input"
                rows={1}
                placeholder={`Ask Kojo about ${selectedFolder?.name ?? "your notes"} or type / for commands`}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={isLoading || folderId === null}
              />
              <button
                className="kojo-send"
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading || folderId === null}
                type="button"
                aria-label="Send"
              >
                <Send size={15} />
              </button>
            </div>
            {showCommands ? <SlashCommandMenu commands={CHAT_COMMANDS} query={input.trimStart()} onSelect={selectCommand} /> : null}
          </div>
          <p className="kojo-input-hint">Enter to send · Shift+Enter for new line</p>
        </div>
      </div>
    </div>
  );
}
