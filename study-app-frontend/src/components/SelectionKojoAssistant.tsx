import { Bot, ChevronDown, ChevronUp, Sparkles, X } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { kojoChat } from "../lib/api";
import { MarkdownContent } from "./MarkdownContent";

type Position = { x: number; y: number };

type Props = {
  folderId: number;
  folderName: string;
  children: ReactNode;
};

const TEXT_TRUNCATE_LEN = 120;
const PANEL_WIDTH = 480;

export function SelectionKojoAssistant({ folderId, folderName, children }: Props) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isOpenRef = useRef(false);
  const isDragging = useRef(false);
  const dragOffset = useRef<Position>({ x: 0, y: 0 });

  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textExpanded, setTextExpanded] = useState(false);

  isOpenRef.current = isOpen;

  useEffect(() => {
    function handleMouseUp(event: MouseEvent) {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      // Keep existing panel open — don't replace it with a new selection
      if (isOpenRef.current) return;

      window.setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim() ?? "";
        if (!selection || selection.isCollapsed || !text) return;

        const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
        const scope = scopeRef.current;
        if (!range || !scope) return;

        const commonAncestor = range.commonAncestorContainer;
        const anchorNode =
          commonAncestor.nodeType === Node.TEXT_NODE
            ? commonAncestor.parentElement
            : (commonAncestor as Element);
        if (!anchorNode || !scope.contains(anchorNode)) return;

        const rect = range.getBoundingClientRect();
        if (!rect.width && !rect.height) return;

        const panelW = Math.min(PANEL_WIDTH, window.innerWidth - 32);
        const rawX = rect.left + rect.width / 2 - panelW / 2;
        const x = Math.max(16, Math.min(rawX, window.innerWidth - panelW - 16));
        // prefer above selection; fall back to below
        const aboveY = rect.top - 16;
        const belowY = rect.bottom + 12;
        const y = aboveY > 80 ? aboveY : belowY;

        setSelectedText(text);
        setPosition({ x, y: Math.max(16, y) });
        setResponse(null);
        setError(null);
        setTextExpanded(false);
        setIsOpen(true);
      }, 0);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("keyup", handleEscape);
    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("keyup", handleEscape);
    };
  }, []);

  useEffect(() => {
    async function explainSelection() {
      if (!isOpen || !selectedText || response || isLoading) return;
      setIsLoading(true);
      setError(null);
      try {
        const prompt = [
          "You are Kojo, a study companion.",
          "Explain the selected text in simple terms and describe what the question is asking.",
          "Do not give the direct answer.",
          "Focus on reasoning, context, and how to approach it.",
          "Use clear, concise language and include math formatting if present.",
          "",
          `Folder: ${folderName}`,
          `Selected text:\n${selectedText}`,
        ].join("\n");
        const result = await kojoChat(folderId, prompt);
        setResponse(result.response);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Kojo could not explain this selection.");
      } finally {
        setIsLoading(false);
      }
    }
    explainSelection();
  }, [folderId, folderName, isOpen, selectedText, response, isLoading]);

  function close() {
    setIsOpen(false);
    setSelectedText(null);
    setPosition(null);
    setResponse(null);
    setError(null);
    setTextExpanded(false);
    isDragging.current = false;
  }

  function handleDragStart(event: React.MouseEvent) {
    // Only drag on the header itself, not its buttons
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragOffset.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    isDragging.current = true;

    function onMove(e: MouseEvent) {
      if (!isDragging.current || !panelRef.current) return;
      const panelW = panelRef.current.offsetWidth;
      const panelH = panelRef.current.offsetHeight;
      const x = Math.max(0, Math.min(e.clientX - dragOffset.current.x, window.innerWidth - panelW));
      const y = Math.max(0, Math.min(e.clientY - dragOffset.current.y, window.innerHeight - panelH));
      setPosition({ x, y });
    }

    function onUp() {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  const needsTruncation = !!selectedText && selectedText.length > TEXT_TRUNCATE_LEN;
  const displayText =
    needsTruncation && !textExpanded ? selectedText!.slice(0, TEXT_TRUNCATE_LEN) + "…" : selectedText;

  if (!isOpen || !selectedText) {
    return <div ref={scopeRef} className="selection-kojo-scope">{children}</div>;
  }

  return (
    <div ref={scopeRef} className="selection-kojo-scope">
      {children}

      <div
        ref={panelRef}
        className="selection-kojo-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Kojo explanation"
        style={position ? { left: `${position.x}px`, top: `${position.y}px` } : undefined}
      >
        {/* Drag handle header */}
        <div className="selection-kojo-header kojo-header" onMouseDown={handleDragStart}>
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
            <button className="kojo-header-btn" type="button" onClick={close} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Unified body */}
        <div className="selection-kojo-body">
          {/* Selected text section */}
          <div className="selection-kojo-quote">
            <span className="eyebrow">Selected text</span>
            <p className="selection-kojo-quote-text">{displayText}</p>
            {needsTruncation && (
              <button
                className="selection-kojo-see-more"
                type="button"
                onClick={() => setTextExpanded((v) => !v)}
              >
                {textExpanded ? (
                  <><ChevronUp size={13} /> Show less</>
                ) : (
                  <><ChevronDown size={13} /> See more</>
                )}
              </button>
            )}
          </div>

          <div className="selection-kojo-sep" />

          {/* Explanation section */}
          <div className="selection-kojo-explanation">
            {isLoading ? (
              <div className="kojo-thinking">
                <span /><span /><span />
              </div>
            ) : error ? (
              <div className="kojo-error">{error}</div>
            ) : response ? (
              <MarkdownContent content={response} />
            ) : (
              <p className="muted small">Kojo is thinking…</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
