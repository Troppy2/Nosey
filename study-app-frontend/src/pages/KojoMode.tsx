import {
  AlertCircle,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Files,
  FolderOpen,
  FolderPlus,
  GraduationCap,
  Layers,
  Lightbulb,
  ListChecks,
  Menu,
  Puzzle,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  Search,
  Sparkles,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import KojoActionCard from "../components/KojoActionCard";
import KojoMascot from "../components/KojoMascot";
import { KojoReasoning, KojoStagedThinking } from "../components/KojoThinking";
import { MarkdownContent } from "../components/MarkdownContent";
import { SelectionKojoAssistant } from "../components/SelectionKojoAssistant";
import { SkeletonChatShell } from "../components/Skeletons";
import { SlashCommandMenu, type CommandOption } from "../components/SlashCommandMenu";
import {
  bootstrapKojoFolder,
  bootstrapKojoGeneral,
  clearKojoConversation,
  createFolder,
  createGeneralKojoConversation,
  createKojoConversation,
  createTest,
  deleteConversationFile,
  deleteKojoConversation,
  fetchConversationFiles,
  fetchFolders,
  fetchKojoActionCards,
  fetchKojoConversationById,
  fetchSlashCommands,
  getStoredUser,
  kojoChat,
  kojoChatGeneral,
  kojoChatStream,
  kojoChatGeneralStream,
  kojoTestBlueprint,
  proposeKojoAction,
  renameKojoConversation,
  uploadConversationFiles,
} from "../lib/api";
import type {
  ConversationFile,
  Folder,
  KojoActionCard as KojoActionCardType,
  KojoActionType,
  KojoConversationSummary,
  KojoMessage,
  TestBlueprint,
} from "../lib/types";
import { useSettings } from "../lib/useSettings";

// Short chip label, full prompt sent to Kojo. Keeping the two separate lets the
// composer row stay compact without truncating what Kojo actually receives.
// actionType (when set) opens a creation card instead of sending a chat turn.
type Suggestion = {
  icon: ReactNode;
  label: string;
  prompt: string;
  actionType?: KojoActionType;
};

const SUGGESTIONS: Suggestion[] = [
  { icon: <BookOpen size={13} />, label: "Explain the notes", prompt: "Explain the main concepts in these notes" },
  { icon: <Target size={13} />, label: "Exam focus", prompt: "What should I focus on for the exam?" },
  { icon: <Lightbulb size={13} />, label: "Give an analogy", prompt: "Give me an analogy to understand a key idea" },
  { icon: <Layers size={13} />, label: "Create flashcards", prompt: "Make flashcards from what we've been discussing", actionType: "create_flashcards" },
  { icon: <ClipboardList size={13} />, label: "Create a test", prompt: "Create a practice test from this folder" },
];

const GENERAL_SUGGESTIONS: Suggestion[] = [
  { icon: <BookOpen size={13} />, label: "Explain a concept", prompt: "Help me understand a concept" },
  { icon: <ListChecks size={13} />, label: "Step by step", prompt: "Explain something step by step" },
  { icon: <Layers size={13} />, label: "Create flashcards", prompt: "Make flashcards from what we've been discussing", actionType: "create_flashcards" },
  { icon: <Lightbulb size={13} />, label: "Plan my studying", prompt: "Help me plan what to study" },
];

const BUILT_IN_COMMANDS: CommandOption[] = [
  { slash: "/summarize", label: "Summarize", description: "Pull out the big ideas from this folder.", prompt: "Summarize the most important ideas in this folder." },
  { slash: "/review", label: "Review Mistakes", description: "Go over recent wrong answers.", prompt: "Review the wrong answers from my most recent test." },
  { slash: "/focus", label: "Study Focus", description: "Prioritize what to study next.", prompt: "What should I focus on next based on these notes?" },
  { slash: "/explain", label: "Explain", description: "Break down a confusing concept.", prompt: "Help me understand the hardest idea in these notes." },
  { slash: "/test", label: "Create Test", description: "Kojo proposes a test plan for your approval.", prompt: "", actionType: "blueprint" },
];

const BLUEPRINT_TRIGGERS = /\b(create|make|generate|build|write|give me|draft)\s+(a\s+)?(practice\s+)?(test|quiz|exam|assessment)\b/i;

// Chat-proposed creation actions (beta). Slash commands + natural-language
// triggers; each proposes a persisted action card the user confirms inline.
const ACTION_COMMANDS: CommandOption[] = [
  { slash: "/folder", label: "New Folder", description: "Kojo proposes a folder from this conversation.", prompt: "", actionType: "create_folder" },
  { slash: "/flashcards", label: "Create Flashcards", description: "Turn this conversation into a flashcard set.", prompt: "", actionType: "create_flashcards" },
  { slash: "/module", label: "Learning Modules", description: "Build a learning module track from a folder's notes.", prompt: "", actionType: "create_module" },
  { slash: "/match", label: "Matching Mode", description: "Start a matching game with a folder's flashcards.", prompt: "", actionType: "start_matching" },
];

const ACTION_TRIGGERS: Array<{ type: KojoActionType; pattern: RegExp }> = [
  { type: "create_flashcards", pattern: /\b(create|make|generate|build|give me)\s+(some\s+)?(new\s+)?flash\s?cards?\b/i },
  { type: "create_module", pattern: /\b(create|make|generate|build)\s+(a\s+)?(new\s+)?learning\s+(module|track)s?\b/i },
  { type: "create_folder", pattern: /\b(create|make|start)\s+(a\s+)?(new\s+)?folder\b/i },
  { type: "start_matching", pattern: /\b(start|play|practice)\s+(a\s+)?matching\b|\bmatching\s+(mode|game)\b/i },
];

const ACTION_DEFAULT_PROMPTS: Record<KojoActionType, string> = {
  create_folder: "Create a folder for what we've been discussing",
  create_flashcards: "Make flashcards from what we've been discussing",
  create_module: "Build learning modules from this material",
  start_matching: "Start matching mode",
};

// The plus-menu's "create" section: everything Kojo can build from the chat.
const ACTION_MENU_ITEMS: Array<{ actionType: KojoActionType; label: string; icon: ReactNode }> = [
  { actionType: "create_flashcards", label: "Create flashcards", icon: <Layers size={13} /> },
  { actionType: "create_module", label: "Create learning modules", icon: <GraduationCap size={13} /> },
  { actionType: "start_matching", label: "Start a matching game", icon: <Puzzle size={13} /> },
  { actionType: "create_folder", label: "Create a new folder", icon: <FolderPlus size={13} /> },
];

// folderId = null means "General" mode (no folder)
const GENERAL_FOLDER_ID = null;

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function relativeTime(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [expanded, setExpanded] = useState(true);

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
        <div className="kojo-blueprint-head kojo-blueprint-head--static">
          <ClipboardList size={13} />
          <span className="kojo-blueprint-head-label">practice test</span>
          <span className="kojo-blueprint-head-status"><Check size={11} /> created</span>
        </div>
        <div className="kojo-blueprint-done">
          <span>{title || "Practice Test"}</span>
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
      <button
        type="button"
        className="kojo-blueprint-head"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <ClipboardList size={13} />
        <span className="kojo-blueprint-head-label">practice test</span>
        <span className="kojo-blueprint-head-toggle">{expanded ? "hide" : "show"}</span>
      </button>
      {!expanded ? null : (
      <div className="kojo-blueprint-body">
      <div className="kojo-blueprint-intro">
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
          {generating ? <span className="loader loader--sm" /> : <Check size={13} />}
          {generating ? "Generating…" : "Generate Test"}
        </button>
        <button type="button" className="kojo-blueprint-btn kojo-blueprint-btn--ghost" onClick={() => onCancel(message.id)} disabled={generating}>
          <X size={13} />Dismiss
        </button>
      </div>
      </div>
      )}
    </div>
  );
}

// ── Folder browser (Claude-style folder grid, lives inside Kojo mode) ────────

function updatedLabel(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days < 1) return "Updated today";
  if (days === 1) return "Updated yesterday";
  if (days < 30) return `Updated ${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `Updated ${months} ${months === 1 ? "month" : "months"} ago`;
  return "Updated over a year ago";
}

type FolderBrowserProps = {
  folders: Folder[];
  onOpen: (folder: Folder) => void;
  onCreate: (name: string, subject: string) => Promise<void>;
};

function FolderBrowser({ folders, onOpen, onCreate }: FolderBrowserProps) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) =>
      [f.name, f.subject, f.description].filter(Boolean).some((v) => v!.toLowerCase().includes(q)),
    );
  }, [folders, query]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setCreateError(null);
    try {
      await onCreate(name.trim(), subject.trim());
      setName("");
      setSubject("");
      setCreating(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create that folder.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="kojo-browse">
      <div className="kojo-browse-inner">
        <div className="kojo-browse-head">
          <h1>Folders</h1>
          <button type="button" className="kojo-browse-new" onClick={() => setCreating((c) => !c)}>
            <Plus size={15} />
            New folder
          </button>
        </div>

        {creating && (
          <form className="kojo-browse-form" onSubmit={handleCreate}>
            <input
              className="kojo-browse-field"
              placeholder="Folder name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              autoFocus
            />
            <input
              className="kojo-browse-field"
              placeholder="Subject (optional)"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={120}
            />
            <button type="submit" className="kojo-browse-create" disabled={!name.trim() || saving}>
              {saving ? "Creating…" : "Create"}
            </button>
            <button type="button" className="kojo-browse-cancel" onClick={() => setCreating(false)}>
              Cancel
            </button>
            {createError && <p className="kojo-browse-error">{createError}</p>}
          </form>
        )}

        <div className="kojo-browse-search">
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search folders"
            aria-label="Search folders"
          />
        </div>

        {folders.length === 0 ? (
          <p className="kojo-browse-empty">No folders yet. Create one to give Kojo something to work from.</p>
        ) : visible.length === 0 ? (
          <p className="kojo-browse-empty">No folders match <strong>{query}</strong>.</p>
        ) : (
          <div className="kojo-browse-grid">
            {visible.map((folder) => (
              <button
                key={folder.id}
                type="button"
                className="kojo-browse-card"
                onClick={() => onOpen(folder)}
              >
                <span className="kojo-browse-card-name">{folder.name}</span>
                <span className="kojo-browse-card-desc">
                  {folder.description ?? folder.subject ?? "No description yet"}
                </span>
                <span className="kojo-browse-card-meta">{updatedLabel(folder.updated_at)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Folder home (folder landing inside Kojo mode) ────────────────────────────

type FolderHomeProps = {
  folder: Folder;
  conversations: KojoConversationSummary[];
  files: ConversationFile[];
  disabled: boolean;
  onBack: () => void;
  onOpenConversation: (conv: KojoConversationSummary) => void;
  onStartChat: (text: string) => void;
};

function FolderHome({ folder, conversations, files, disabled, onBack, onOpenConversation, onStartChat }: FolderHomeProps) {
  const [draft, setDraft] = useState("");

  function submit() {
    const text = draft.trim();
    if (!text || disabled) return;
    setDraft("");
    onStartChat(text);
  }

  return (
    <div className="kojo-home">
      <div className="kojo-home-inner">
        <div className="kojo-home-main">
          <button type="button" className="kojo-home-back" onClick={onBack}>
            <ArrowLeft size={14} />
            All folders
          </button>

          <h1 className="kojo-home-title">{folder.name}</h1>
          <p className="kojo-home-desc">
            {folder.description ?? folder.subject ?? "Ask Kojo anything grounded in this folder."}
          </p>

          <div className="kojo-home-composer">
            <textarea
              rows={2}
              placeholder={`Start a new chat about ${folder.name}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              disabled={disabled}
            />
            <button
              type="button"
              className="kojo-send"
              onClick={submit}
              disabled={!draft.trim() || disabled}
              aria-label="Start chat"
            >
              <ArrowUp size={16} />
            </button>
          </div>

          <p className="chat-mode-section-label kojo-home-label">recents</p>
          {conversations.length === 0 ? (
            <p className="kojo-home-empty">No chats in this folder yet.</p>
          ) : (
            <div className="kojo-home-recents">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  className="kojo-home-recent"
                  onClick={() => onOpenConversation(conv)}
                >
                  <MessageSquarePlus size={14} />
                  <span className="kojo-home-recent-name">{conv.name ?? "Untitled"}</span>
                  <span className="kojo-home-recent-time">{relativeTime(conv.created_at)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <aside className="kojo-home-rail">
          <section className="kojo-home-card">
            <p className="chat-mode-section-label">overview</p>
            <dl className="kojo-home-stats">
              <div>
                <dt>Subject</dt>
                <dd>{folder.subject ?? "-"}</dd>
              </div>
              <div>
                <dt>Tests</dt>
                <dd>{folder.test_count}</dd>
              </div>
              <div>
                <dt>Flashcards</dt>
                <dd>{folder.flashcard_count}</dd>
              </div>
            </dl>
            <Link to={`/folders/${folder.id}`} className="kojo-home-link">
              <ExternalLink size={13} />
              Open in library
            </Link>
          </section>

          <section className="kojo-home-card">
            <p className="chat-mode-section-label">files</p>
            {files.length === 0 ? (
              <p className="kojo-home-empty">No files attached to this chat yet.</p>
            ) : (
              files.map((f) => (
                <div key={f.id} className="chat-mode-doc-row">
                  <Paperclip size={13} className="chat-mode-doc-icon" />
                  <span className="chat-mode-doc-info">
                    <span className="chat-mode-doc-name" title={f.file_name}>{f.file_name}</span>
                    <span className="chat-mode-doc-meta">{formatFileSize(f.size_bytes)}</span>
                  </span>
                </div>
              ))
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function KojoMode() {
  const { generationProvider, kojoStrictness, betaMode } = useSettings();

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
  // Temp id of the assistant message currently streaming (null when idle). Drives
  // the caret, staged-thinking indicator, and live reasoning disclosure.
  const [streamingId, setStreamingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearNotice, setClearNotice] = useState<string | null>(null);
  const [customCommands, setCustomCommands] = useState<CommandOption[]>([]);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  // ID of the conversation showing the delete confirmation inline
  const [deletingConvId, setDeletingConvId] = useState<number | null>(null);
  // Mobile: whether the off-canvas sidebar drawer is open
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Desktop: whether the sidebar column is collapsed
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Whether the documents slide-over panel is open
  const [docsOpen, setDocsOpen] = useState(false);
  // Which pane fills the main column. All three live on this page, no routing.
  const [view, setView] = useState<"chat" | "folders" | "home">("chat");
  // Non-null while the header title is being renamed inline (double-click).
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  // Persisted chat action cards for the active conversation (beta)
  const [actionCards, setActionCards] = useState<KojoActionCardType[]>([]);
  // Action type currently being proposed (shows a pending row in the stream)
  const [pendingAction, setPendingAction] = useState<KojoActionType | null>(null);

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

  const chatCommands = useMemo(
    () => [...customCommands, ...BUILT_IN_COMMANDS, ...(betaMode ? ACTION_COMMANDS : [])],
    [customCommands, betaMode],
  );

  const visibleCommands = useMemo(() => {
    if (!showSlashMenu) return [];
    // General chat has no folder context: only the creation action commands apply
    const pool = isGeneralMode ? (betaMode ? ACTION_COMMANDS : []) : chatCommands;
    const normalized = input.trimStart().toLowerCase().replace(/^\//, "");
    if (!normalized) return pool;
    return pool.filter(
      (cmd) => cmd.slash.toLowerCase().includes(normalized) || cmd.label.toLowerCase().includes(normalized),
    );
  }, [showSlashMenu, input, chatCommands, isGeneralMode, betaMode]);

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
    setActionCards([]);
    setPendingAction(null);

    const loadConversations = async () => {
      // Single round-trip: conversation list + the most recent conversation's
      // messages and files. The backend auto-creates a conversation when the
      // folder (or General) has none, so `active` is present on success.
      const bootstrap =
        folderId === null ? await bootstrapKojoGeneral() : await bootstrapKojoFolder(folderId);
      if (!bootstrap) return;

      setConversations(bootstrap.conversations);
      if (bootstrap.active) {
        setConversationId(bootstrap.active.id);
        setMessages(bootstrap.active.messages);
        fetchKojoActionCards(bootstrap.active.id).then(setActionCards);
      } else if (bootstrap.conversations.length > 0) {
        setConversationId(bootstrap.conversations[0].id);
        fetchKojoActionCards(bootstrap.conversations[0].id).then(setActionCards);
      }
      setSessionFiles(bootstrap.files);
    };

    loadConversations().catch(() => {});
    inputRef.current?.focus();
  }, [folderId, loadingFolders]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const selectedFolder = folders.find((f) => f.id === folderId) ?? null;

  // Tests created from blueprints in this conversation, for the documents panel
  const createdTests = useMemo(
    () => messages.filter((m) => m.message_type === "blueprint_done" && m.blueprint),
    [messages],
  );

  // Confirmed action cards double as the documents panel's created artifacts
  const createdArtifacts = useMemo(
    () => actionCards.filter((c) => c.status === "confirmed"),
    [actionCards],
  );

  // Message stream with action cards merged in at their timestamps. Both sides
  // carry UTC wall-clock ISO strings, so lexicographic comparison is enough.
  type StreamItem =
    | { kind: "message"; key: string; msg: KojoMessage }
    | { kind: "card"; key: string; card: KojoActionCardType };
  const stream = useMemo<StreamItem[]>(() => {
    const items: StreamItem[] = messages.map((m) => ({ kind: "message", key: `m${m.id}`, msg: m }));
    const visibleCards = actionCards.filter((c) => c.status !== "dismissed");
    for (const card of visibleCards) {
      let idx = items.length;
      while (idx > 0) {
        const prev = items[idx - 1];
        const prevTime = prev.kind === "message" ? prev.msg.created_at : prev.card.created_at;
        if (prevTime.replace("Z", "") <= card.created_at.replace("Z", "")) break;
        idx -= 1;
      }
      items.splice(idx, 0, { kind: "card", key: `c${card.id}`, card });
    }
    return items;
  }, [messages, actionCards]);

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

  // ── Action card flow (beta: chat-proposed creations) ───────────────────────

  async function handleActionRequest(actionType: KojoActionType, trigger: string, display?: string) {
    if (conversationId === null) return;
    const userMsg: KojoMessage = { id: Date.now(), role: "user", content: trigger, created_at: new Date().toISOString(), display };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setPendingAction(actionType);
    setIsLoading(true);
    setError(null);
    try {
      const card = await proposeKojoAction(conversationId, actionType, trigger, generationProvider);
      setActionCards((prev) => [...prev, card]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kojo couldn't draft that plan. Try again.");
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
    } finally {
      setPendingAction(null);
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }

  function handleActionResolved(card: KojoActionCardType) {
    setActionCards((prev) => prev.map((c) => (c.id === card.id ? card : c)));
  }

  function handleActionFolderCreated(folder: Folder) {
    setFolders((prev) => [folder, ...prev]);
  }

  // ── Chat flow ──────────────────────────────────────────────────────────────

  async function handleSend(text?: string, display?: string, actionType?: CommandOption["actionType"]) {
    const msg = (text ?? input).trim();
    if (!msg || isLoading || conversationId === null) return;

    // Explicit action command from the slash menu
    if (actionType && actionType !== "chat" && actionType !== "blueprint") {
      await handleActionRequest(actionType, msg, display);
      return;
    }

    // Blueprint only available with a folder
    if (folderId !== null && (actionType === "blueprint" || BLUEPRINT_TRIGGERS.test(msg))) {
      await handleBlueprintRequest(msg, display ?? msg);
      return;
    }

    // Natural-language creation triggers (beta)
    if (betaMode && !actionType) {
      const hit = ACTION_TRIGGERS.find((t) => t.pattern.test(msg));
      if (hit) {
        await handleActionRequest(hit.type, msg, display);
        return;
      }
    }

    const userMsg: KojoMessage = { id: Date.now(), role: "user", content: msg, created_at: new Date().toISOString(), display };
    const convId = conversationId;
    // The assistant bubble is inserted up front in a streaming state so the
    // staged-thinking indicator and live reasoning show while tokens arrive.
    const tempId = Date.now() + 1;
    setMessages((prev) => [
      ...prev,
      userMsg,
      { id: tempId, role: "assistant", content: "", reasoning: "", streaming: true, created_at: new Date().toISOString() },
    ]);
    setInput("");
    setClearNotice(null);
    if (inputRef.current) inputRef.current.style.height = "auto";
    setIsLoading(true);
    setStreamingId(tempId);
    setError(null);

    let content = "";
    let reasoning = "";
    let streamedAny = false;
    const onDelta = (delta: string) => {
      streamedAny = true;
      content += delta;
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, content } : m)));
    };
    const onReasoning = (delta: string) => {
      streamedAny = true;
      reasoning += delta;
      setMessages((prev) => prev.map((m) => (m.id === tempId ? { ...m, reasoning } : m)));
    };

    try {
      let result;
      try {
        const handlers = { onDelta, onReasoning, reasoning: true };
        result = isGeneralMode
          ? await kojoChatGeneralStream(convId, msg, handlers, generationProvider, kojoStrictness)
          : await kojoChatStream(folderId!, msg, handlers, generationProvider, kojoStrictness, convId);
      } catch (streamErr) {
        // Fall back to the non-streamed endpoint only if nothing streamed yet.
        if (streamedAny) throw streamErr;
        result = isGeneralMode
          ? await kojoChatGeneral(convId, msg, generationProvider, kojoStrictness)
          : await kojoChat(folderId!, msg, generationProvider, kojoStrictness, convId);
      }

      const assistantMsg: KojoMessage = {
        id: result.message_id,
        role: "assistant",
        content: result.response,
        created_at: new Date().toISOString(),
        reasoning: reasoning || undefined,
      };
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempId && m.id !== userMsg.id),
        { ...userMsg, id: result.message_id - 1 },
        assistantMsg,
      ]);

      // Auto-name: update conversation list when server returns a generated name
      if (result.conversation_name) {
        setConversations((prev) =>
          prev.map((c) => c.id === convId ? { ...c, name: result.conversation_name! } : c)
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kojo failed to respond. Try again.");
      setMessages((prev) => prev.filter((m) => m.id !== tempId && m.id !== userMsg.id));
    } finally {
      setStreamingId(null);
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
      setActionCards([]);
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
    setView("chat");
    try {
      const fresh = isGeneralMode
        ? await createGeneralKojoConversation()
        : await createKojoConversation(folderId!);
      setConversations((prev) => [fresh, ...prev]);
      setConversationId(fresh.id);
      setMessages([]);
      setSessionFiles([]);
      setActionCards([]);
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
    setView("chat");
    if (conv.id === conversationId) return;
    setConversationId(conv.id);
    setMessages([]);
    setSessionFiles([]);
    setActionCards([]);
    setError(null);
    setDeletingConvId(null);
    // Use the real by-ID endpoint so any conversation loads correctly
    const c = await fetchKojoConversationById(conv.id);
    if (c) setMessages(c.messages);
    fetchConversationFiles(conv.id).then(setSessionFiles);
    fetchKojoActionCards(conv.id).then(setActionCards);
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
          fetchKojoActionCards(remaining[0].id).then(setActionCards);
        } else {
          // No conversations left , auto-create a fresh one
          const fresh = isGeneralMode
            ? await createGeneralKojoConversation()
            : await createKojoConversation(folderId!);
          setConversations([fresh]);
          setConversationId(fresh.id);
          setMessages([]);
          setSessionFiles([]);
          setActionCards([]);
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

  // ── Folder browsing (inside this page, no navigation) ──────────────────────

  function handleOpenFolder(folder: Folder) {
    setFolderId(folder.id);
    setView("home");
    setSidebarOpen(false);
  }

  async function handleCreateFolderInline(name: string, subject: string) {
    const folder = await createFolder({ name, subject: subject || null, description: null });
    setFolders((prev) => [folder, ...prev]);
    handleOpenFolder(folder);
  }

  function handleStartChatFromHome(text: string) {
    setView("chat");
    void handleSend(text);
  }

  function handleOpenConversationFromHome(conv: KojoConversationSummary) {
    setView("chat");
    void handleSwitchConversation(conv);
  }

  // ── Inline chat rename (double-click the header title) ─────────────────────

  async function commitTitleRename() {
    const draft = titleDraft;
    setTitleDraft(null);
    if (draft === null || conversationId === null) return;

    const next = draft.trim();
    const current = conversations.find((c) => c.id === conversationId)?.name ?? null;
    if (!next || next === current) return;

    const prev = conversations;
    setConversations((cs) => cs.map((c) => (c.id === conversationId ? { ...c, name: next } : c)));
    try {
      await renameKojoConversation(conversationId, next);
    } catch (err) {
      setConversations(prev);
      setError(err instanceof Error ? err.message : "Couldn't rename this chat.");
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
    const isAction = command.actionType && command.actionType !== "chat" && command.actionType !== "blueprint";
    void handleSend(
      command.actionType === "blueprint"
        ? `Create a practice test for ${selectedFolder?.name ?? "this folder"}`
        : isAction
          ? ACTION_DEFAULT_PROMPTS[command.actionType as KojoActionType]
          : command.prompt,
      command.slash,
      command.actionType,
    );
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // Mirrors the chat shell: sidebar rail of classes beside the message column,
  // so the two-pane layout is already standing when the chat arrives.
  if (loadingFolders) {
    return (
      <div className="chat-mode-shell">
        <SkeletonChatShell />
      </div>
    );
  }

  // Creation chips only work with the action-card feature on
  const suggestions = (isGeneralMode ? GENERAL_SUGGESTIONS : SUGGESTIONS).filter(
    (s) => betaMode || !s.actionType,
  );

  return (
    <div className={`chat-mode-shell${sidebarCollapsed ? " chat-mode-shell--collapsed" : ""}`}>
      {/* Mobile drawer backdrop */}
      {sidebarOpen && (
        <div className="chat-mode-sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      {/* ── Sidebar ── */}
      <aside className={`chat-mode-sidebar${sidebarOpen ? " chat-mode-sidebar--open" : ""}`}>
        {/* Brand row */}
        <div className="chat-mode-brand">
          <span className="chat-mode-brand-name">Kojo</span>
          <button
            type="button"
            className="chat-mode-brand-new"
            onClick={() => void handleNewChat()}
            disabled={isLoading}
            aria-label="New chat"
            title="New chat"
          >
            <MessageSquarePlus size={15} />
          </button>
          <button
            type="button"
            className="chat-mode-sidebar-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* New chat shortcut */}
        <button
          type="button"
          className="chat-mode-new-chat"
          onClick={() => void handleNewChat()}
          disabled={isLoading}
        >
          <Plus size={14} />
          new chat
        </button>

        {/* Scope switches. Folders opens the browser in the main column. */}
        <nav className="chat-mode-nav">
          <button
            type="button"
            className={`chat-mode-nav-btn${view === "chat" && folderId === null ? " chat-mode-nav-btn--active" : ""}`}
            onClick={() => { setFolderId(null); setView("chat"); setSidebarOpen(false); }}
          >
            <MessageSquarePlus size={14} />
            general
          </button>
          <button
            type="button"
            className={`chat-mode-nav-btn${view === "folders" || view === "home" ? " chat-mode-nav-btn--active" : ""}`}
            onClick={() => { setView("folders"); setSidebarOpen(false); }}
          >
            <FolderOpen size={14} />
            folders
          </button>
        </nav>

        <div className="chat-mode-sidebar-scroll">
          {/* Recent chats in the current context */}
          {conversations.length > 0 && (
            <>
              <p className="chat-mode-section-label">recent</p>
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
                      <span className="kojo-chat-item-date">{relativeTime(conv.created_at)}</span>
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
            </>
          )}
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
              <Menu size={26} />
            </button>
            <button
              type="button"
              className="chat-mode-collapse-btn"
              onClick={() => setSidebarCollapsed((c) => !c)}
              aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
              title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
            <div className="chat-mode-title-wrap">
              {view === "chat" && titleDraft !== null ? (
                <input
                  className="chat-mode-title-input"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => void commitTitleRename()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); void commitTitleRename(); }
                    if (e.key === "Escape") { e.preventDefault(); setTitleDraft(null); }
                  }}
                  maxLength={120}
                  aria-label="Chat name"
                  autoFocus
                />
              ) : (
                <span
                  className={`chat-mode-title${view === "chat" && conversationId !== null ? " chat-mode-title--editable" : ""}`}
                  onDoubleClick={() => {
                    if (view !== "chat" || conversationId === null) return;
                    setTitleDraft(conversations.find((c) => c.id === conversationId)?.name ?? "");
                  }}
                  title={view === "chat" && conversationId !== null ? "Double-click to rename" : undefined}
                >
                  {view === "folders"
                    ? "folders"
                    : view === "home"
                      ? selectedFolder?.name ?? "folder"
                      : conversations.find((c) => c.id === conversationId)?.name ?? "New chat"}
                </span>
              )}
              {view === "chat" && !isGeneralMode && (
                <span className="chat-mode-folder-pill">{selectedFolder?.name ?? "-"}</span>
              )}
            </div>
          </div>
          {view === "chat" && (
            <div className="chat-mode-header-actions">
              <button
                type="button"
                className={`chat-mode-docs-btn${docsOpen ? " chat-mode-docs-btn--open" : ""}`}
                onClick={() => setDocsOpen((v) => !v)}
                aria-label="Open documents"
              >
                <Files size={14} />
                <span>docs</span>
                {sessionFiles.length + createdTests.length + createdArtifacts.length > 0 && (
                  <span className="chat-mode-docs-count">{sessionFiles.length + createdTests.length + createdArtifacts.length}</span>
                )}
              </button>
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
          )}
        </div>

        {view === "folders" && (
          <FolderBrowser folders={folders} onOpen={handleOpenFolder} onCreate={handleCreateFolderInline} />
        )}

        {view === "home" && selectedFolder && (
          <FolderHome
            folder={selectedFolder}
            conversations={conversations}
            files={sessionFiles}
            disabled={conversationId === null || isLoading}
            onBack={() => setView("folders")}
            onOpenConversation={handleOpenConversationFromHome}
            onStartChat={handleStartChatFromHome}
          />
        )}

        {view === "chat" && (
          <>

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
                  <div className="kojo-empty-icon"><KojoMascot state="idle" size={64} /></div>
                  <p className="kojo-empty-title">Hi, I'm Kojo</p>
                  <p className="kojo-empty-sub">
                    {isGeneralMode
                      ? "Ask me anything , no folder needed. I'll answer from my own knowledge."
                      : <>Ask me anything grounded in <strong>{selectedFolder?.name}</strong>. I can explain, quiz, compare ideas, or help you plan what to study next.</>}
                  </p>
                  <div className="kojo-suggestions">
                    {suggestions.map((s) => (
                      <button key={s.label} className="kojo-suggestion" onClick={() => handleSend(s.prompt, undefined, s.actionType)} type="button">
                        {s.icon}
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {stream.map((item) => {
                if (item.kind === "card") {
                  return (
                    <div key={item.key} className="kojo-message kojo-message--assistant">
                      <div className="kojo-msg-avatar"><KojoMascot state="idle" /></div>
                      <div className="kojo-message-body">
                        <KojoActionCard
                          card={item.card}
                          folders={folders}
                          scopedFolderId={folderId}
                          provider={generationProvider}
                          onResolved={handleActionResolved}
                          onFolderCreated={handleActionFolderCreated}
                        />
                        <span className="kojo-message-time">{formatTime(item.card.created_at)}</span>
                      </div>
                    </div>
                  );
                }
                const msg = item.msg;
                if (msg.role === "assistant" && (msg.message_type === "blueprint" || msg.message_type === "blueprint_done" || msg.message_type === "blueprint_cancelled")) {
                  return (
                    <div key={msg.id} className="kojo-message kojo-message--assistant">
                      <div className={`kojo-msg-avatar${msg.blueprint ? "" : " kojo-msg-avatar--working"}`}>
                        <KojoMascot state={msg.blueprint ? "idle" : "loading"} />
                      </div>
                      <div className="kojo-message-body">
                        {msg.blueprint ? (
                          <>
                            <BlueprintCard message={msg} folderId={folderId!} provider={generationProvider} onGenerate={handleBlueprintGenerate} onCancel={handleBlueprintCancel} />
                            <span className="kojo-message-time">{formatTime(msg.created_at)}</span>
                          </>
                        ) : (
                          <span className="kojo-message-time kojo-thinking-label">drafting a test plan…</span>
                        )}
                      </div>
                    </div>
                  );
                }

                if (msg.role === "assistant") {
                  const isStreaming = msg.id === streamingId;
                  const awaitingAnswer = isStreaming && !msg.content;
                  const reasoningLive = awaitingAnswer;
                  // Staged indicator only before any token arrives; once reasoning
                  // streams, its disclosure carries the "thinking" state.
                  const showStaged = awaitingAnswer && !msg.reasoning;
                  return (
                    <div key={msg.id} className="kojo-message kojo-message--assistant">
                      <div className={`kojo-msg-avatar${awaitingAnswer ? " kojo-msg-avatar--working" : ""}`}>
                        <KojoMascot state={awaitingAnswer ? "loading" : "idle"} />
                      </div>
                      <div className="kojo-message-body">
                        {(msg.reasoning || reasoningLive) && (
                          <KojoReasoning text={msg.reasoning ?? ""} live={reasoningLive} />
                        )}
                        {msg.content ? (
                          <div className="kojo-answer">
                            <MarkdownContent content={msg.content} />
                            {isStreaming && <span className="kojo-caret" aria-hidden="true" />}
                          </div>
                        ) : showStaged ? (
                          <KojoStagedThinking />
                        ) : null}
                        {!isStreaming && (
                          <span className="kojo-message-time">{formatTime(msg.created_at)}</span>
                        )}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={msg.id} className="kojo-message kojo-message--user">
                    <div className="kojo-user-col">
                      <div className="kojo-user-bubble">
                        {msg.display ? (
                          <span className="kojo-command-pill"><Sparkles size={11} />{msg.display}</span>
                        ) : (
                          <p>{msg.content}</p>
                        )}
                      </div>
                      <span className="kojo-message-time kojo-message-time--user">{formatTime(msg.created_at)}</span>
                    </div>
                  </div>
                );
              })}

              {/* Bottom loader only for non-chat pending work (action drafting);
                  chat streaming shows its own inline bubble with staged thinking. */}
              {isLoading && streamingId === null && (
                <div className="kojo-message kojo-message--assistant" aria-label="Kojo is thinking">
                  <div className="kojo-msg-avatar kojo-msg-avatar--working"><KojoMascot state="loading" /></div>
                  {pendingAction && (
                    <div className="kojo-message-body">
                      <span className="kojo-message-time kojo-thinking-label">drafting a plan…</span>
                    </div>
                  )}
                </div>
              )}
              {error && (
                <div className="kojo-error" role="alert">
                  <KojoMascot state="error" />
                  <span>{error}</span>
                </div>
              )}
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

            {/* Suggestion chips above the composer once a conversation is going */}
            {messages.length > 0 && !isLoading && (
              <div className="chat-mode-input-chips kojo-suggestions">
                {suggestions.map((s) => (
                  <button key={s.label} className="kojo-suggestion" onClick={() => handleSend(s.prompt, undefined, s.actionType)} type="button">
                    {s.icon}
                    {s.label}
                  </button>
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

              <div className="chat-mode-composer-row">
                {/* Plus button: upload files + everything Kojo can create */}
                <div className="kojo-attach-wrap" ref={attachMenuRef}>
                  <button
                    type="button"
                    className={`kojo-attach-btn${showAttachMenu ? " kojo-attach-btn--open" : ""}`}
                    onClick={() => setShowAttachMenu((v) => !v)}
                    disabled={isLoading || conversationId === null}
                    aria-label="Attach files and actions"
                  >
                    {isUploading ? <span className="loader loader--sm" /> : <Plus size={16} />}
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

                      {betaMode && (
                        <>
                          <p className="kojo-attach-menu-label">create</p>
                          {ACTION_MENU_ITEMS.map((item) => (
                            <button
                              key={item.actionType}
                              type="button"
                              className="kojo-attach-menu-item"
                              onClick={() => {
                                setShowAttachMenu(false);
                                void handleSend(
                                  ACTION_DEFAULT_PROMPTS[item.actionType],
                                  undefined,
                                  item.actionType,
                                );
                              }}
                            >
                              {item.icon}
                              <span>{item.label}</span>
                            </button>
                          ))}
                        </>
                      )}

                      {!isGeneralMode && (
                        <div className="kojo-attach-menu-item kojo-attach-menu-item--info">
                          <CheckCircle2 size={13} className="kojo-attach-menu-check" />
                          <span>Folder notes included</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

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
            <p className="chat-mode-input-hint">↵ send · ⇧↵ new line{!isGeneralMode || betaMode ? " · / for commands" : ""}</p>
          </div>
        </div>
        </>
        )}

        {/* ── Documents slide-over ── */}
        {docsOpen && view === "chat" && (
          <div className="chat-mode-docs-panel">
            <div className="chat-mode-docs-header">
              <span>documents</span>
              <button
                type="button"
                className="chat-mode-docs-close"
                onClick={() => setDocsOpen(false)}
                aria-label="Close documents"
              >
                <X size={14} />
              </button>
            </div>
            <div className="chat-mode-docs-body">
              {createdArtifacts.length > 0 && (
                <section>
                  <p className="chat-mode-section-label">created artifacts</p>
                  {createdArtifacts.map((c) => {
                    const artifactFolderId = (c.payload["folder_id"] as number | undefined) ?? c.entity_id ?? null;
                    const title = (c.payload["entity_title"] as string | undefined) ?? c.action_type.replace(/_/g, " ");
                    const to =
                      c.action_type === "create_folder" && c.entity_id ? `/folders/${c.entity_id}`
                        : c.action_type === "create_flashcards" && artifactFolderId ? `/flashcards/${artifactFolderId}/review`
                          : c.action_type === "create_module" && artifactFolderId ? `/flashcards/${artifactFolderId}/modules`
                            : c.action_type === "start_matching" && artifactFolderId ? `/flashcards/${artifactFolderId}/matching`
                              : null;
                    const typeLabel =
                      c.action_type === "create_folder" ? "folder"
                        : c.action_type === "create_flashcards" ? "flashcards"
                          : c.action_type === "create_module" ? "learning modules"
                            : "matching";
                    const row = (
                      <>
                        <FolderOpen size={13} className="chat-mode-doc-icon chat-mode-doc-icon--test" />
                        <span className="chat-mode-doc-info">
                          <span className={`chat-mode-doc-name${c.entity_deleted ? " kojo-action-deleted-name" : ""}`}>{title}</span>
                          <span className="chat-mode-doc-meta">
                            {typeLabel} · {c.entity_deleted ? "deleted" : relativeTime(c.created_at)}
                          </span>
                        </span>
                      </>
                    );
                    return c.entity_deleted || !to ? (
                      <div key={c.id} className="chat-mode-doc-row">{row}</div>
                    ) : (
                      <Link key={c.id} to={to} className="chat-mode-doc-row">{row}</Link>
                    );
                  })}
                </section>
              )}

              {createdTests.length > 0 && (
                <section>
                  <p className="chat-mode-section-label">created in this chat</p>
                  {createdTests.map((m) => (
                    <Link key={m.id} to={`/folders/${folderId}`} className="chat-mode-doc-row">
                      <ClipboardList size={13} className="chat-mode-doc-icon chat-mode-doc-icon--test" />
                      <span className="chat-mode-doc-info">
                        <span className="chat-mode-doc-name">{m.blueprint!.title}</span>
                        <span className="chat-mode-doc-meta">practice test · {relativeTime(m.created_at)}</span>
                      </span>
                    </Link>
                  ))}
                </section>
              )}

              {sessionFiles.length > 0 && (
                <section>
                  <p className="chat-mode-section-label">uploaded files</p>
                  {sessionFiles.map((f) => (
                    <div key={f.id} className="chat-mode-doc-row">
                      <Paperclip size={13} className="chat-mode-doc-icon" />
                      <span className="chat-mode-doc-info">
                        <span className="chat-mode-doc-name" title={f.file_name}>{f.file_name}</span>
                        <span className="chat-mode-doc-meta">{formatFileSize(f.size_bytes)} · {relativeTime(f.uploaded_at)}</span>
                      </span>
                      <button
                        type="button"
                        className="chat-mode-doc-delete"
                        onClick={() => void handleDeleteFile(f.id)}
                        aria-label={`Remove ${f.file_name}`}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                </section>
              )}

              {createdTests.length === 0 && sessionFiles.length === 0 && createdArtifacts.length === 0 && (
                <div className="chat-mode-docs-empty">
                  <Files size={34} />
                  <p>No documents yet. Attach notes with the paperclip, or ask Kojo to create a practice test.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
