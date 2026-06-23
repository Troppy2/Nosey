import {
  AlertCircle,
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FolderOpen,
  Menu,
  MessageSquarePlus,
  Paperclip,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { MarkdownContent } from "../components/MarkdownContent";
import { SelectionKojoAssistant } from "../components/SelectionKojoAssistant";
import { SlashCommandMenu, type CommandOption } from "../components/SlashCommandMenu";
import {
  clearKojoConversation,
  createGeneralKojoConversation,
  createKojoConversation,
  createTest,
  deleteConversationFile,
  deleteKojoConversation,
  fetchConversationFiles,
  fetchFolders,
  fetchKojoConversationById,
  fetchSlashCommands,
  getStoredUser,
  kojoChat,
  kojoChatGeneral,
  kojoTestBlueprint,
  listGeneralKojoConversations,
  listKojoConversations,
  uploadConversationFiles,
} from "../lib/api";
import type {
  ConversationFile,
  Folder,
  KojoConversationSummary,
  KojoMessage,
  TestBlueprint,
} from "../lib/types";
import { useSettings } from "../lib/useSettings";

const SUGGESTIONS = [
  "Explain the main concepts in these notes",
  "What should I focus on for the exam?",
  "Give me an analogy to understand a key idea",
  "Quiz me on the most important terms",
];

const GENERAL_SUGGESTIONS = [
  "Help me understand a concept",
  "Explain something step by step",
  "Quiz me on a topic",
  "Help me study",
];

const BUILT_IN_COMMANDS: CommandOption[] = [
  { slash: "/summarize", label: "Summarize", description: "Pull out the big ideas from this folder.", prompt: "Summarize the most important ideas in this folder." },
  { slash: "/quiz", label: "Quiz Me", description: "Turn the notes into quick review questions.", prompt: "Quiz me on the most important material in this folder." },
  { slash: "/review", label: "Review Mistakes", description: "Go over recent wrong answers.", prompt: "Review the wrong answers from my most recent test." },
  { slash: "/focus", label: "Study Focus", description: "Prioritize what to study next.", prompt: "What should I focus on next based on these notes?" },
  { slash: "/explain", label: "Explain", description: "Break down a confusing concept.", prompt: "Help me understand the hardest idea in these notes." },
  { slash: "/flashcards", label: "Flashcards", description: "Surface terms worth memorizing.", prompt: "What terms or facts from this folder would make strong flashcards?" },
  { slash: "/test", label: "Create Test", description: "Kojo proposes a test plan for your approval.", prompt: "", actionType: "blueprint" },
];

const BLUEPRINT_TRIGGERS = /\b(create|make|generate|build|write|give me|draft)\s+(a\s+)?(practice\s+)?(test|quiz|exam|assessment)\b/i;

// folderId = null means "General" mode (no folder)
const GENERAL_FOLDER_ID = null;

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatChatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Blueprint card ───────────────────────────────────────────────────────────

type BlueprintCardProps = {
  message: KojoMessage;
  folderId: number;
  provider?: string;
  onGenerate: (msgId: number, testId: number) => void;
  onCancel: (msgId: number) => void;
};

function BlueprintCard({ message, folderId, provider, onGenerate, onCancel }: BlueprintCardProps) {
  const bp = message.blueprint!;
  const [title, setTitle] = useState(bp.title);
  const [testType, setTestType] = useState(bp.test_type);
  const [countMcq, setCountMcq] = useState(bp.count_mcq);
  const [countFrq, setCountFrq] = useState(bp.count_frq);
  const [difficulty, setDifficulty] = useState(bp.difficulty);
  const [topicFocus, setTopicFocus] = useState(bp.topic_focus ?? "");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  function handleTypeChange(t: string) {
    setTestType(t as TestBlueprint["test_type"]);
    if (t === "MCQ_only") setCountFrq(0);
    if (t === "FRQ_only") setCountMcq(0);
  }

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    setGenError(null);
    try {
      const result = await createTest({
        folderId,
        title: title.trim() || "Practice Test",
        testType,
        files: [],
        countMcq,
        countFrq,
        difficulty,
        topicFocus: topicFocus.trim() || undefined,
        generationProvider: provider,
      });
      onGenerate(message.id, result.test_id);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Failed to generate test. Try again.");
      setGenerating(false);
    }
  }

  if (message.message_type === "blueprint_done") {
    return (
      <div className="kojo-blueprint-card kojo-blueprint-card--done">
        <div className="kojo-blueprint-done">
          <Check size={16} className="kojo-blueprint-done-icon" />
          <span>Test created!</span>
          <Link to={`/folders/${folderId}`} className="kojo-blueprint-test-link">
            <ExternalLink size={13} />
            Open in folder
          </Link>
        </div>
      </div>
    );
  }

  if (message.message_type === "blueprint_cancelled") return null;

  return (
    <div className="kojo-blueprint-card">
      <div className="kojo-blueprint-intro">
        <ClipboardList size={15} className="kojo-blueprint-intro-icon" />
        <span>{bp.intro}</span>
      </div>
      <div className="kojo-blueprint-fields">
        <label className="kojo-blueprint-label">
          <span>Title</span>
          <input className="kojo-blueprint-input" type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} disabled={generating} />
        </label>
        <div className="kojo-blueprint-row">
          <label className="kojo-blueprint-label">
            <span>Type</span>
            <select className="kojo-blueprint-select" value={testType} onChange={(e) => handleTypeChange(e.target.value)} disabled={generating}>
              <option value="mixed">Mixed (MCQ + FRQ)</option>
              <option value="MCQ_only">MCQ only</option>
              <option value="FRQ_only">FRQ only</option>
            </select>
          </label>
          <label className="kojo-blueprint-label">
            <span>Difficulty</span>
            <select className="kojo-blueprint-select" value={difficulty} onChange={(e) => setDifficulty(e.target.value as TestBlueprint["difficulty"])} disabled={generating}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
        </div>
        <div className="kojo-blueprint-row">
          {testType !== "FRQ_only" && (
            <label className="kojo-blueprint-label">
              <span>MCQ count</span>
              <input className="kojo-blueprint-input kojo-blueprint-input--num" type="number" min={1} max={20} value={countMcq} onChange={(e) => setCountMcq(Math.max(1, Math.min(20, Number(e.target.value))))} disabled={generating} />
            </label>
          )}
          {testType !== "MCQ_only" && (
            <label className="kojo-blueprint-label">
              <span>FRQ count</span>
              <input className="kojo-blueprint-input kojo-blueprint-input--num" type="number" min={1} max={10} value={countFrq} onChange={(e) => setCountFrq(Math.max(1, Math.min(10, Number(e.target.value))))} disabled={generating} />
            </label>
          )}
        </div>
        <label className="kojo-blueprint-label">
          <span>Topic focus <span className="kojo-blueprint-optional">(optional)</span></span>
          <input className="kojo-blueprint-input" type="text" placeholder="e.g. Chapter 3, photosynthesis…" value={topicFocus} onChange={(e) => setTopicFocus(e.target.value)} maxLength={200} disabled={generating} />
        </label>
      </div>
      {genError && (
        <div className="kojo-blueprint-error"><AlertCircle size={13} /><span>{genError}</span></div>
      )}
      <div className="kojo-blueprint-actions">
        <button type="button" className="kojo-blueprint-btn kojo-blueprint-btn--primary" onClick={handleGenerate} disabled={generating}>
          {generating ? <span className="loader loader--sm" /> : <ClipboardList size={14} />}
          {generating ? "Generating…" : "Generate Test"}
        </button>
        <button type="button" className="kojo-blueprint-btn kojo-blueprint-btn--ghost" onClick={() => onCancel(message.id)} disabled={generating}>
          <X size={13} />Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function KojoMode() {
  const { generationProvider, kojoStrictness } = useSettings();

  const storedUser = getStoredUser();
  if (storedUser?.kojo_enabled === false) {
    return (
      <div className="page page-narrow">
        <div className="page-header">
          <h1>Chat Kojo</h1>
        </div>
        <p className="muted">Chat Kojo is available for users aged 15 and older.</p>
      </div>
    );
  }

  const [folders, setFolders] = useState<Folder[]>([]);
  // null = General mode (no folder), number = specific folder
  const [folderId, setFolderId] = useState<number | null>(GENERAL_FOLDER_ID);
  const [loadingFolders, setLoadingFolders] = useState(true);
  const [conversations, setConversations] = useState<KojoConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [messages, setMessages] = useState<KojoMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearNotice, setClearNotice] = useState<string | null>(null);
  const [customCommands, setCustomCommands] = useState<CommandOption[]>([]);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  // ID of the conversation showing the delete confirmation inline
  const [deletingConvId, setDeletingConvId] = useState<number | null>(null);
  // Mobile: whether the off-canvas sidebar drawer is open
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [sessionFiles, setSessionFiles] = useState<ConversationFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachMenuRef = useRef<HTMLDivElement>(null);

  const isGeneralMode = folderId === GENERAL_FOLDER_ID && !loadingFolders;
  const showSlashMenu = input.trimStart().startsWith("/");

  const chatCommands = useMemo(() => [...customCommands, ...BUILT_IN_COMMANDS], [customCommands]);

  const visibleCommands = useMemo(() => {
    if (!showSlashMenu || isGeneralMode) return [];
    const normalized = input.trimStart().toLowerCase().replace(/^\//, "");
    if (!normalized) return chatCommands;
    return chatCommands.filter(
      (cmd) => cmd.slash.toLowerCase().includes(normalized) || cmd.label.toLowerCase().includes(normalized),
    );
  }, [showSlashMenu, input, chatCommands, isGeneralMode]);

  useEffect(() => { setSlashActiveIndex(0); }, [visibleCommands.length, showSlashMenu]);

  // Close attach menu on outside click
  useEffect(() => {
    if (!showAttachMenu) return;
    function onClick(e: MouseEvent) {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) {
        setShowAttachMenu(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [showAttachMenu]);

  // Lock body scroll + close drawer on Escape while the mobile drawer is open
  useEffect(() => {
    if (!sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSidebarOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [sidebarOpen]);

  useEffect(() => {
    fetchFolders()
      .then((items) => {
        setFolders(items);
        // Start in General mode , user can click a folder to switch
      })
      .catch(() => {})
      .finally(() => setLoadingFolders(false));
  }, []);

  useEffect(() => {
    fetchSlashCommands().then((commands) => {
      setCustomCommands(commands.map((cmd) => ({ slash: cmd.slash, label: cmd.label, description: cmd.description, prompt: cmd.prompt })));
    });
  }, []);

  // When folder selection changes (including null = General), load conversation list
  useEffect(() => {
    if (loadingFolders) return;

    setMessages([]);
    setError(null);
    setConfirmClear(false);
    setClearNotice(null);
    setSessionFiles([]);
    setUploadError(null);
    setConversationId(null);
    setConversations([]);
    setDeletingConvId(null);

    const loadConversations = async () => {
      if (folderId === null) {
        // General mode
        const convs = await listGeneralKojoConversations();
        if (convs.length === 0) {
          const fresh = await createGeneralKojoConversation();
          setConversations([fresh]);
          setConversationId(fresh.id);
        } else {
          setConversations(convs);
          setConversationId(convs[0].id);
          const conv = await fetchKojoConversationById(convs[0].id);
          if (conv) setMessages(conv.messages);
          fetchConversationFiles(convs[0].id).then(setSessionFiles);
        }
      } else {
        // Folder mode
        const convs = await listKojoConversations(folderId);
        if (convs.length === 0) {
          const fresh = await createKojoConversation(folderId);
          setConversations([fresh]);
          setConversationId(fresh.id);
        } else {
          setConversations(convs);
          setConversationId(convs[0].id);
          const conv = await fetchKojoConversationById(convs[0].id);
          if (conv) setMessages(conv.messages);
          fetchConversationFiles(convs[0].id).then(setSessionFiles);
        }
      }
    };

    loadConversations().catch(() => {});
    inputRef.current?.focus();
  }, [folderId, loadingFolders]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const selectedFolder = folders.find((f) => f.id === folderId) ?? null;

  // ── Blueprint flow ─────────────────────────────────────────────────────────

  async function handleBlueprintRequest(trigger: string, display: string) {
    if (folderId === null) return;
    const userMsg: KojoMessage = { id: Date.now(), role: "user", content: trigger, created_at: new Date().toISOString(), display };
    const pendingId = Date.now() + 1;
    const pendingMsg: KojoMessage = { id: pendingId, role: "assistant", content: "", created_at: new Date().toISOString(), message_type: "blueprint" };
    setMessages((prev) => [...prev, userMsg, pendingMsg]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setIsLoading(true);
    setError(null);
    try {
      const bp = await kojoTestBlueprint(folderId, trigger, generationProvider);
      setMessages((prev) => prev.map((m) => m.id === pendingId ? { ...m, blueprint: bp } : m));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kojo couldn't build a test plan. Try again.");
      setMessages((prev) => prev.filter((m) => m.id !== pendingId && m.id !== userMsg.id));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleBlueprintGenerate(msgId: number, testId: number) {
    setMessages((prev) => prev.map((m) => m.id === msgId ? { ...m, message_type: "blueprint_done" as const, blueprint_test_id: testId } : m));
  }

  function handleBlueprintCancel(msgId: number) {
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  }

  // ── Chat flow ──────────────────────────────────────────────────────────────

  async function handleSend(text?: string, display?: string, actionType?: "chat" | "blueprint") {
    const msg = (text ?? input).trim();
    if (!msg || isLoading || conversationId === null) return;

    // Blueprint only available with a folder
    if (folderId !== null && (actionType === "blueprint" || BLUEPRINT_TRIGGERS.test(msg))) {
      await handleBlueprintRequest(msg, display ?? msg);
      return;
    }

    const userMsg: KojoMessage = { id: Date.now(), role: "user", content: msg, created_at: new Date().toISOString(), display };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setClearNotice(null);
    if (inputRef.current) inputRef.current.style.height = "auto";
    setIsLoading(true);
    setError(null);

    try {
      const result = isGeneralMode
        ? await kojoChatGeneral(conversationId, msg, generationProvider, kojoStrictness)
        : await kojoChat(folderId!, msg, generationProvider, kojoStrictness, conversationId);

      const assistantMsg: KojoMessage = { id: result.message_id, role: "assistant", content: result.response, created_at: new Date().toISOString() };
      setMessages((prev) => [...prev.slice(0, -1), { ...userMsg, id: result.message_id - 1 }, assistantMsg]);

      // Auto-name: update conversation list when server returns a generated name
      if (result.conversation_name) {
        setConversations((prev) =>
          prev.map((c) => c.id === conversationId ? { ...c, name: result.conversation_name! } : c)
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kojo failed to respond. Try again.");
      setMessages((prev) => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showSlashMenu && visibleCommands.length > 0) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlashActiveIndex((i) => (i + 1) % visibleCommands.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlashActiveIndex((i) => (i - 1 + visibleCommands.length) % visibleCommands.length); return; }
      if (e.key === "Enter") { e.preventDefault(); selectCommand(visibleCommands[slashActiveIndex]); return; }
      if (e.key === "Escape") { e.preventDefault(); setInput(""); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); }
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
      setSessionFiles([]);
      setConfirmClear(false);
      setClearNotice("Chat cleared. Restorable from Settings within 5 hours.");
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear chat.");
    }
  }

  async function handleNewChat() {
    if (isLoading) return;
    setSidebarOpen(false);
    try {
      const fresh = isGeneralMode
        ? await createGeneralKojoConversation()
        : await createKojoConversation(folderId!);
      setConversations((prev) => [fresh, ...prev]);
      setConversationId(fresh.id);
      setMessages([]);
      setSessionFiles([]);
      setError(null);
      setClearNotice(null);
      setConfirmClear(false);
      setDeletingConvId(null);
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start new chat.");
    }
  }

  async function handleSwitchConversation(conv: KojoConversationSummary) {
    setSidebarOpen(false);
    if (conv.id === conversationId) return;
    setConversationId(conv.id);
    setMessages([]);
    setSessionFiles([]);
    setError(null);
    setDeletingConvId(null);
    // Use the real by-ID endpoint so any conversation loads correctly
    const c = await fetchKojoConversationById(conv.id);
    if (c) setMessages(c.messages);
    fetchConversationFiles(conv.id).then(setSessionFiles);
  }

  async function handleDeleteConversation(id: number) {
    try {
      await deleteKojoConversation(id);
      const remaining = conversations.filter((c) => c.id !== id);
      setConversations(remaining);
      setDeletingConvId(null);

      if (id === conversationId) {
        // Deleted the active conversation , switch to next or create fresh
        if (remaining.length > 0) {
          setConversationId(remaining[0].id);
          const c = await fetchKojoConversationById(remaining[0].id);
          if (c) setMessages(c.messages);
          fetchConversationFiles(remaining[0].id).then(setSessionFiles);
        } else {
          // No conversations left , auto-create a fresh one
          const fresh = isGeneralMode
            ? await createGeneralKojoConversation()
            : await createKojoConversation(folderId!);
          setConversations([fresh]);
          setConversationId(fresh.id);
          setMessages([]);
          setSessionFiles([]);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete chat.");
      setDeletingConvId(null);
    }
  }

  async function handleDeleteFile(fileId: number) {
    if (conversationId === null) return;
    try {
      await deleteConversationFile(conversationId, fileId);
      setSessionFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch { /* silently ignore */ }
  }

  async function handleUpload(files: FileList | File[]) {
    if (!conversationId || isUploading) return;
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setIsUploading(true);
    setUploadError(null);
    setShowAttachMenu(false);
    try {
      const uploaded = await uploadConversationFiles(conversationId, arr);
      setSessionFiles((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleSelectionAskKojo(text: string) {
    const prompt = `Explain this: "${text.length > 300 ? text.slice(0, 300) + "…" : text}"`;
    setInput(prompt);
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 180)}px`;
      inputRef.current.focus();
    }
  }

  function selectCommand(command: CommandOption) {
    setInput("");
    setSlashActiveIndex(0);
    void handleSend(
      command.actionType === "blueprint" ? `Create a practice test for ${selectedFolder?.name ?? "this folder"}` : command.prompt,
      command.slash,
      command.actionType,
    );
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loadingFolders) {
    return (
      <div className="chat-mode-shell">
        <div className="centered-block"><span className="loader" /></div>
      </div>
    );
  }

  const suggestions = isGeneralMode ? GENERAL_SUGGESTIONS : SUGGESTIONS;

  return (
    <div className="chat-mode-shell">
      {/* Mobile drawer backdrop */}
      {sidebarOpen && (
        <div className="chat-mode-sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      {/* ── Sidebar ── */}
      <aside className={`chat-mode-sidebar${sidebarOpen ? " chat-mode-sidebar--open" : ""}`}>
        <div className="chat-mode-sidebar-header">
          <Sparkles size={15} />
          <span>Chat mode</span>
          <button
            type="button"
            className="chat-mode-sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* General section */}
        <div className="chat-mode-sidebar-copy">
          <strong>General</strong>
        </div>
        <nav className="chat-mode-folder-list">
          <button
            type="button"
            className={`chat-mode-folder-btn${folderId === null ? " chat-mode-folder-btn--active" : ""}`}
            onClick={() => { setFolderId(null); setSidebarOpen(false); }}
          >
            <MessageSquarePlus size={15} />
            <span>No folder</span>
          </button>
        </nav>

        {/* Folders section */}
        {folders.length > 0 && (
          <>
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
                  onClick={() => { setFolderId(folder.id); setSidebarOpen(false); }}
                >
                  <FolderOpen size={15} />
                  <span>{folder.name}</span>
                </button>
              ))}
            </nav>
          </>
        )}

        {/* Chat history list for current context */}
        {conversations.length > 0 && (
          <div className="kojo-chat-history">
            <div className="kojo-chat-history-label">
              <MessageSquarePlus size={12} />
              <span>Chats</span>
            </div>
            <div className="kojo-chat-list">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`kojo-chat-item${conv.id === conversationId ? " kojo-chat-item--active" : ""}`}
                >
                  <button
                    type="button"
                    className="kojo-chat-item-btn"
                    onClick={() => void handleSwitchConversation(conv)}
                  >
                    <span className="kojo-chat-item-name">{conv.name ?? "Untitled"}</span>
                    <span className="kojo-chat-item-date">{formatChatDate(conv.created_at)}</span>
                  </button>

                  {deletingConvId === conv.id ? (
                    <div className="kojo-chat-item-confirm">
                      <button
                        type="button"
                        className="kojo-clear-inline-btn kojo-clear-inline-btn--confirm"
                        onClick={() => void handleDeleteConversation(conv.id)}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        className="kojo-clear-inline-btn"
                        onClick={() => setDeletingConvId(null)}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="kojo-chat-item-delete"
                      onClick={() => setDeletingConvId(conv.id)}
                      title="Delete chat"
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* New Chat button */}
        <div className="chat-mode-sidebar-footer">
          <button
            type="button"
            className="chat-mode-new-chat-btn"
            onClick={() => void handleNewChat()}
            disabled={isLoading}
          >
            <Plus size={14} />
            New Chat
          </button>
        </div>
      </aside>

      {/* ── Main chat area ── */}
      <div className="chat-mode-main">
        {/* Header */}
        <div className="chat-mode-header">
          <div className="chat-mode-header-left">
            <button
              type="button"
              className="chat-mode-menu-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open chats and folders"
            >
              <Menu size={20} />
            </button>
            <div className="kojo-avatar"><Bot size={18} /></div>
            <div>
              <span className="chat-mode-title">
                <Sparkles size={13} className="kojo-title-icon" />
                Kojo
              </span>
              <span className="chat-mode-subtitle">
                {isGeneralMode ? "General chat" : (selectedFolder?.name ?? "-")}
              </span>
            </div>
          </div>
          <div className="chat-mode-header-meta">
            <span>{isGeneralMode ? "No folder context" : "Grounded in folder notes"}</span>
          </div>
          {/* Clear only available in folder mode */}
          {!isGeneralMode && (
            <button
              type="button"
              className="kojo-header-btn kojo-header-btn--danger"
              onClick={() => setConfirmClear((c) => !c)}
              disabled={isLoading}
              title="Clear chat"
              aria-label="Clear chat history"
            >
              <Trash2 size={17} />
            </button>
          )}
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
          <SelectionKojoAssistant folderId={folderId ?? 0} folderName={selectedFolder?.name ?? ""} onAskKojo={handleSelectionAskKojo}>
            <div className="chat-mode-messages-inner">
              {messages.length === 0 && !isLoading && (
                <div className="kojo-empty">
                  <div className="kojo-empty-icon"><Sparkles size={28} /></div>
                  <p className="kojo-empty-title">Hi, I'm Kojo</p>
                  <p className="kojo-empty-sub">
                    {isGeneralMode
                      ? "Ask me anything , no folder needed. I'll answer from my own knowledge."
                      : <>Ask me anything grounded in <strong>{selectedFolder?.name}</strong>. I can explain, quiz, compare ideas, or help you plan what to study next.</>}
                  </p>
                  <div className="kojo-suggestions">
                    {suggestions.map((s) => (
                      <button key={s} className="kojo-suggestion" onClick={() => handleSend(s)} type="button">{s}</button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg) => {
                if (msg.role === "assistant" && (msg.message_type === "blueprint" || msg.message_type === "blueprint_done" || msg.message_type === "blueprint_cancelled")) {
                  return (
                    <div key={msg.id} className="kojo-message kojo-message--assistant">
                      <div className="kojo-msg-avatar"><Bot size={14} /></div>
                      <div className="kojo-message-body">
                        <div className="kojo-message-meta">
                          <span className="kojo-message-label">Kojo</span>
                          <span className="kojo-message-time">{formatTime(msg.created_at)}</span>
                        </div>
                        {msg.blueprint ? (
                          <BlueprintCard message={msg} folderId={folderId!} provider={generationProvider} onGenerate={handleBlueprintGenerate} onCancel={handleBlueprintCancel} />
                        ) : (
                          <div className="kojo-thinking"><span /><span /><span /></div>
                        )}
                      </div>
                    </div>
                  );
                }

                if (msg.role === "assistant") {
                  return (
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
                  );
                }

                return (
                  <div key={msg.id} className="kojo-message kojo-message--user">
                    <div className="kojo-user-bubble">
                      {msg.display ? (
                        <span className="kojo-command-pill"><Sparkles size={11} />{msg.display}</span>
                      ) : (
                        <p>{msg.content}</p>
                      )}
                      <span className="kojo-message-time kojo-message-time--user">{formatTime(msg.created_at)}</span>
                    </div>
                  </div>
                );
              })}

              {isLoading && (
                <div className="kojo-thinking-centered"><div className="kojo-thinking"><span /><span /><span /></div></div>
              )}
              {error && <div className="kojo-error"><AlertCircle size={14} /><span>{error}</span></div>}
              {clearNotice && <p className="kojo-notice">{clearNotice}</p>}
              <div ref={bottomRef} />
            </div>
          </SelectionKojoAssistant>
        </div>

        {/* Input */}
        <div className="chat-mode-input-area">
          <div className="chat-mode-input-shell">
            {showSlashMenu && visibleCommands.length > 0 ? (
              <SlashCommandMenu commands={visibleCommands} activeIndex={slashActiveIndex} onSelect={selectCommand} />
            ) : null}

            {/* Attached file chips */}
            {sessionFiles.length > 0 && (
              <div className="kojo-attached-files">
                {sessionFiles.map((f) => (
                  <div key={f.id} className="kojo-attached-chip" title={f.file_name}>
                    <span className="kojo-attached-chip-name">{f.file_name}</span>
                    <button type="button" className="kojo-attached-chip-delete" onClick={() => void handleDeleteFile(f.id)} aria-label={`Remove ${f.file_name}`}>
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {uploadError && <p className="chat-mode-upload-error">{uploadError}</p>}

            <div id="tour-kojo-chat" className="chat-mode-input-wrap">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.md,.txt,.tex,.html,.docx,.pptx"
                style={{ display: "none" }}
                onChange={(e) => e.target.files && void handleUpload(e.target.files)}
              />

              <textarea
                ref={inputRef}
                className="kojo-input"
                rows={1}
                placeholder={
                  isGeneralMode
                    ? "Ask Kojo anything or type / for commands"
                    : `Ask Kojo about ${selectedFolder?.name ?? "your notes"} or type / for commands`
                }
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={isLoading || conversationId === null}
              />
              <div className="chat-mode-composer-footer">
                {/* Attach button + menu */}
                <div className="kojo-attach-wrap" ref={attachMenuRef}>
                  <button
                    type="button"
                    className={`kojo-attach-btn${showAttachMenu ? " kojo-attach-btn--open" : ""}`}
                    onClick={() => setShowAttachMenu((v) => !v)}
                    disabled={isLoading || conversationId === null}
                    aria-label="Attach files"
                  >
                    {isUploading ? <span className="loader loader--sm" /> : <Paperclip size={15} />}
                  </button>
                  {showAttachMenu && (
                    <div className="kojo-attach-menu">
                      <button
                        type="button"
                        className="kojo-attach-menu-item"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Paperclip size={13} />
                        <span>Upload notes / files</span>
                      </button>
                      {!isGeneralMode && (
                        <div className="kojo-attach-menu-item kojo-attach-menu-item--info">
                          <CheckCircle2 size={13} className="kojo-attach-menu-check" />
                          <span>Folder notes included</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <span className="chat-mode-composer-hint">↵ send · ⇧↵ new line{!isGeneralMode ? " · / for commands" : ""}</span>
                <button
                  className="kojo-send"
                  onClick={() => handleSend()}
                  disabled={!input.trim() || isLoading || conversationId === null}
                  type="button"
                  aria-label="Send"
                >
                  <ArrowUp size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
