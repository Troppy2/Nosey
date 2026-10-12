import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

export type DropdownOption<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  /** Shown above the trigger, or only its accessible name when `bare`. */
  label: string;
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  hint?: string;
  /** Trigger text when `value` matches no option (e.g. "Select a folder"). */
  placeholder?: string;
  /** Just the trigger, for a caller that lays out its own label (inline rows,
   *  table cells, compact forms). */
  bare?: boolean;
  /** Trigger classes in place of the default `.input` look. */
  className?: string;
  /** Trigger id, so an outside <label htmlFor> can point at it. */
  id?: string;
  title?: string;
};

// Gap between the trigger and the panel, and the most the panel shows before
// it scrolls. Matches the LeetCode topic picker's panel.
const PANEL_GAP = 6;
const PANEL_MAX_HEIGHT = 264;
// A narrow trigger (a pill in a table cell) still gets a readable list, kept
// this far inside the viewport edges.
const PANEL_MIN_WIDTH = 160;
const VIEWPORT_MARGIN = 8;

type PanelPosition = { left: number; width: number; top?: number; bottom?: number };

function horizontal(rect: DOMRect): { left: number; width: number } {
  const width = Math.max(rect.width, PANEL_MIN_WIDTH);
  const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN));
  return { left, width };
}

/**
 * Custom single-select, a styled stand-in for a native <select> (whose open
 * list can't be styled). Field label + `.input` trigger by default (`bare` for
 * just the trigger); the option
 * list is a listbox portalled to <body>, because a modal backdrop's
 * backdrop-filter would otherwise trap a fixed panel and a scrolling modal
 * body would clip it. Keyboard: arrows, Home/End, Enter/Space, Escape, Tab,
 * and a typed letter jumps to the next option starting with it.
 */
export function Dropdown<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  hint,
  placeholder,
  bare,
  className,
  id,
  title,
}: Props<T>) {
  const baseId = useId();
  const labelId = `${baseId}-label`;
  const listId = `${baseId}-list`;
  const triggerId = id ?? `${baseId}-trigger`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  function openList() {
    if (disabled || options.length === 0) return;
    // Place it before the first paint so the list is visible, and so focusable,
    // from the start; the layout effect then flips it up if it doesn't fit.
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPosition({ ...horizontal(rect), top: rect.bottom + PANEL_GAP });
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    close(true);
  }

  // Place the panel under the trigger, or above it when there's no room below.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - PANEL_GAP;
      const above = rect.top - PANEL_GAP;
      const flip = below < Math.min(PANEL_MAX_HEIGHT, listRef.current?.scrollHeight ?? PANEL_MAX_HEIGHT) && above > below;
      setPosition(
        flip
          ? { ...horizontal(rect), bottom: window.innerHeight - rect.top + PANEL_GAP }
          : { ...horizontal(rect), top: rect.bottom + PANEL_GAP },
      );
    };
    place();
    listRef.current?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      close(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  function onTriggerKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openList();
    }
  }

  function onListKey(event: ReactKeyboardEvent<HTMLUListElement>) {
    const last = options.length - 1;
    if (event.key === "ArrowDown") setActive((i) => Math.min(last, i + 1));
    else if (event.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
    else if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(last);
    else if (event.key === "Enter" || event.key === " ") choose(active);
    else if (event.key === "Escape") close(true);
    else if (event.key === "Tab") {
      // Back on the trigger first, so the browser's Tab moves on from there
      // instead of from <body> once the list unmounts.
      close(true);
      return;
    } else if (event.key.length === 1) {
      const letter = event.key.toLowerCase();
      const order = [...options.slice(active + 1), ...options.slice(0, active + 1)];
      const match = order.find((option) => option.label.toLowerCase().startsWith(letter));
      if (match) setActive(options.indexOf(match));
    } else return;
    event.preventDefault();
    // Keep Escape and the rest from reaching a modal's own key handler.
    event.stopPropagation();
  }

  const shown = selected?.label ?? placeholder ?? "";
  const trigger = (
    <button
      ref={triggerRef}
      id={triggerId}
      type="button"
      className={`dropdown-trigger ${className ?? "input"}${selected ? "" : " is-placeholder"}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      // Bare has no visible label element, so name it "Label: value" directly.
      aria-label={bare ? `${label}: ${shown}` : undefined}
      aria-labelledby={bare ? undefined : `${labelId} ${triggerId}`}
      disabled={disabled}
      title={title}
      onClick={() => (open ? close(false) : openList())}
      onKeyDown={onTriggerKey}
    >
      <span className="dropdown-value">{shown}</span>
      <ChevronDown size={16} className={`dropdown-chevron${open ? " is-open" : ""}`} aria-hidden="true" />
    </button>
  );

  const panel = open
    ? createPortal(
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              tabIndex={-1}
              aria-label={bare ? label : undefined}
              aria-labelledby={bare ? undefined : labelId}
              aria-activedescendant={`${listId}-${active}`}
              className="dropdown-panel"
              style={position ?? undefined}
              onKeyDown={onListKey}
            >
              {options.map((option, index) => (
                <li
                  key={option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  className={`dropdown-option${index === active ? " is-active" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(index)}
                >
                  <span>{option.label}</span>
                  {option.value === value ? <Check size={15} className="dropdown-check" aria-hidden="true" /> : null}
                </li>
              ))}
            </ul>,
            document.body,
          )
    : null;

  if (bare) {
    return (
      <>
        {trigger}
        {panel}
      </>
    );
  }
  return (
    <div className="field">
      <span className="field-label" id={labelId}>
        {label}
      </span>
      {trigger}
      {hint ? <span className="field-hint">{hint}</span> : null}
      {panel}
    </div>
  );
}
