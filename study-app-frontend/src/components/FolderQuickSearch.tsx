import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { CloseIcon, FolderIcon, SearchIcon, TestsTakenIcon } from "../icons";
import { scopeKey, searchFoldersAndTests } from "../lib/api";
import type { FolderSearchResponse, FolderSearchResult } from "../lib/types";
import { Button } from "./Button";
import "../styles/components/folder-quick-search.css";

const RECENT_KEY = "nosey_quick_search_recent";
const RECENT_LIMIT = 5;

function readRecents(): FolderSearchResult[] {
  try {
    const value = JSON.parse(localStorage.getItem(scopeKey(RECENT_KEY)) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => item && (item.kind === "folder" || item.kind === "test")
      && Number.isSafeInteger(item.id) && item.id > 0 && Number.isSafeInteger(item.folder_id)
      && typeof item.title === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveRecent(result: FolderSearchResult) {
  const rest = readRecents().filter((item) => item.kind !== result.kind || item.id !== result.id);
  try {
    localStorage.setItem(scopeKey(RECENT_KEY), JSON.stringify([result, ...rest].slice(0, RECENT_LIMIT)));
  } catch {
    // Recents are a convenience; a full or blocked store just skips them.
  }
}

export function FolderQuickSearch({ disabled = false, activeFolderIds = [] }: { disabled?: boolean; activeFolderIds?: number[] }) {
  const [open, setOpen] = useState(false);
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ P" : "Ctrl P";

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "p") return;
      // Reserve the shortcut on this route, including while another modal is open.
      event.preventDefault();
      if (!disabled && !event.repeat && !document.querySelector('[aria-modal="true"], dialog[open]')) setOpen(true);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [disabled]);

  return <>
    <Button variant="secondary" icon={<SearchIcon size={18} />} onClick={() => setOpen(true)}
      disabled={disabled} aria-keyshortcuts="Control+p Meta+p" aria-haspopup="dialog">
      Search <kbd className="folder-search-shortcut">{shortcut}</kbd>
    </Button>
    {open && <FolderSearchDialog activeFolderIds={activeFolderIds} onClose={() => setOpen(false)} />}
  </>;
}

// Bold the matched part of a title. The backend matches case-insensitively,
// so the first case-insensitive occurrence is the one it found.
function Highlight({ text, query }: { text: string; query: string }) {
  const start = query ? text.toLowerCase().indexOf(query) : -1;
  if (start < 0) return <>{text}</>;
  const end = start + query.length;
  return <>{text.slice(0, start)}<mark>{text.slice(start, end)}</mark>{text.slice(end)}</>;
}

function FolderSearchDialog({ onClose, activeFolderIds }: { onClose: () => void; activeFolderIds: number[] }) {
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cache = useRef(new Map<string, FolderSearchResponse>());
  const [recents] = useState(readRecents);
  const [query, setQuery] = useState("");
  // The last answered query with its response. Kept on screen while the next one loads.
  const [found, setFound] = useState<{ query: string; data: FolderSearchResponse } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [active, setActive] = useState(0);
  const id = useId();
  const normalized = query.trim().toLowerCase();
  const loading = !!normalized && found?.query !== normalized && !error;
  const items = normalized ? found?.data.results ?? [] : recents.filter((item) => activeFolderIds.includes(item.folder_id));
  const currentResults = !normalized || found?.query === normalized;
  const hasMore = !!normalized && !loading && !!found?.data.has_more;

  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    input.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);

  useEffect(() => {
    setActive(0);
    setError(null);
    if (!normalized) return;
    const cached = cache.current.get(normalized);
    if (cached) {
      setFound({ query: normalized, data: cached });
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const data = await searchFoldersAndTests(normalized, controller.signal);
        // Guard even when a transport or mock cannot cancel an already resolved request.
        if (controller.signal.aborted) return;
        if (cache.current.size >= 20) cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(normalized, data);
        setFound({ query: normalized, data });
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Search is unavailable. Please try again.");
      }
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [normalized, retry]);

  useEffect(() => {
    document.getElementById(`${id}-result-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [id, active, items]);

  function select(result: FolderSearchResult) {
    // Retain the last results visually, but never navigate stale rows on click or after an error.
    if (!currentResults) return;
    saveRecent(result);
    onClose();
    navigate(result.kind === "folder" ? `/folders/${result.id}` : `/test/${result.id}`);
  }

  function onKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    if (event.target !== input.current || event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length) setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      // Results still on screen belong to the previous query, so wait for the new ones.
      if (currentResults && items[active]) select(items[active]);
    }
  }

  const message = error ? "Search could not be completed."
    : !normalized ? (items.length ? "Recent" : "Type to find a folder or test by name.")
    : loading ? "Searching…"
    : items.length ? `${items.length}${hasMore ? "+" : ""} result${items.length === 1 ? "" : "s"}`
    : `No results for “${query.trim()}”.`;

  return createPortal(
    <dialog ref={dialog} className="folder-search-dialog" aria-modal="true" aria-label="Find folders and tests"
      onCancel={(event) => { event.preventDefault(); onClose(); }} onKeyDown={onKey}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="folder-search-panel">
        <div className="folder-search-field">
          <SearchIcon size={20} aria-hidden="true" />
          <input ref={input} type="text" role="combobox" aria-label="Search folders and tests"
            placeholder="Search folders and tests" autoComplete="off" spellCheck={false} maxLength={160}
            value={query} onChange={(event) => { setError(null); setQuery(event.target.value); }}
            aria-expanded="true" aria-autocomplete="list" aria-controls={`${id}-results`}
            aria-activedescendant={currentResults && items[active] ? `${id}-result-${active}` : undefined}
            aria-describedby={`${id}-hint`} />
          <button type="button" className="folder-search-close" aria-label="Close search" onClick={onClose}><CloseIcon size={20} /></button>
        </div>
        <div className="folder-search-status" role="status" aria-live="polite">{message}</div>
        <div id={`${id}-results`} role="listbox" aria-label={normalized ? "Search results" : "Recent"} aria-busy={loading}
          className={`folder-search-results${loading ? " is-stale" : ""}`}>
          {items.map((result, index) => <div key={`${result.kind}-${result.id}`} id={`${id}-result-${index}`}
            role="option" aria-selected={active === index}
            className={`folder-search-result${active === index ? " is-active" : ""}`}
            onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => select(result)}>
            <span className="folder-search-result-icon" aria-hidden="true">{result.kind === "folder" ? <FolderIcon size={22} /> : <TestsTakenIcon size={22} />}</span>
            <span className="folder-search-result-text">
              <strong><Highlight text={result.title} query={normalized} /></strong>
              <span>{result.kind === "folder"
                ? `Folder${result.subject ? ` · ${result.subject}` : ""}`
                : `Test${result.folder_name ? ` · in ${result.folder_name}` : ""}`}</span>
            </span>
            <kbd className="folder-search-enter" aria-hidden="true">Enter</kbd>
          </div>)}
        </div>
        {error && <div className="folder-search-error" role="alert"><p>{error}</p><Button variant="secondary" onClick={() => { setError(null); setRetry((value) => value + 1); }}>Try again</Button></div>}
        {!loading && !error && normalized && !items.length && <p className="folder-search-empty">Check the spelling or try part of the name. Archived folders are not searched.</p>}
        {hasMore && <p className="folder-search-more">Showing the top {items.length}. Keep typing to narrow it down.</p>}
        <footer id={`${id}-hint`} className="folder-search-hint">
          <span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span>
        </footer>
      </div>
    </dialog>, document.body,
  );
}
