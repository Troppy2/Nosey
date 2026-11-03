import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowDownIcon, CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "../icons";
import "../styles/components/date-picker.css";

// A shared calendar date picker that replaces the browser's native <input type="date">.
// It renders as a text field with the ISO value, and opens a month grid portalled to
// <body>. Uses Nosey tokens (--ink, --green-dark, --green-lightest, --radius-*) and
// the custom icon set. No Lucide.
//
// Value: YYYY-MM-DD or "". onChange fires with the chosen ISO string.
// min/max are optional ISO strings that clamp which days can be selected.
//
// Keyboard: Enter/Space opens/closes, Escape closes, Enter on a hovered day picks it.

export type DatePickerProps = {
  label: string;
  value: string; // "" or YYYY-MM-DD
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
};

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function monthLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function startOfMonthWeekday(year: number, month: number): number {
  // Sunday = 0
  return new Date(year, month, 1).getDay();
}

function iso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseIso(value: string): Date | null {
  const d = new Date(`${value}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

export function DatePicker({
  label,
  value,
  onChange,
  min,
  max,
  placeholder,
  disabled,
  id,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [rawViewMonth, setRawViewMonth] = useState(
    value ? parseIso(value) ?? new Date() : new Date(),
  );
  const [hovered, setHovered] = useState<string | null>(null);

  const baseId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = parseIso(value);
  const todayIso = iso(new Date());

  // Derive the clamped view month during render (no setState in effects).
  const viewMonth = useMemo(() => {
    let d = rawViewMonth;
    if (min) {
      const minD = parseIso(min);
      if (minD && d < minD) d = minD;
    }
    if (max) {
      const maxD = parseIso(max);
      if (maxD && d > maxD) d = maxD;
    }
    return d;
  }, [rawViewMonth, min, max]);

  const isDisabled = useCallback(
    (day: number): boolean => {
      const d = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day);
      const dIso = iso(d);
      if (min && dIso < min) return true;
      if (max && dIso > max) return true;
      return false;
    },
    [viewMonth, min, max],
  );

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const pick = useCallback(
    (day: number) => {
      const chosen = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day);
      onChange(iso(chosen));
      close(true);
    },
    [viewMonth, onChange, close],
  );

  const prevMonth = useCallback(() => {
    setRawViewMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }, []);

  const nextMonth = useCallback(() => {
    setRawViewMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }, []);

  const clearDate = useCallback(() => {
    onChange("");
    setRawViewMonth(new Date());
    close(true);
  }, [onChange, close]);

  const today = useCallback(() => {
    const now = new Date();
    const t = iso(now);
    setRawViewMonth(now);
    onChange(t);
    close(true);
  }, [onChange, close]);

  function onTriggerKey(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((o) => !o);
    }
  }

  function onPanelKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        close(true);
        return;
      case "Enter": {
        event.preventDefault();
        if (hovered) {
          const day = Number(hovered);
          if (!isNaN(day)) pick(day);
        }
        return;
      }
      default:
        return;
    }
  }

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const totalDays = daysInMonth(year, month);
  const startWeekday = startOfMonthWeekday(year, month);

  const prevDisabled = !!min && parseIso(min) && new Date(year, month - 1, 15) < parseIso(min)!;
  const nextDisabled = !!max && parseIso(max) && new Date(year, month + 1, 15) > parseIso(max)!;

  // Build a flat list of cells: {day, iso, disabled, inMonth, selected, today, hovered}
  const cells = useMemo(() => {
    const list: Array<{
      day: number | null;
      iso: string | null;
      disabled: boolean;
      inMonth: boolean;
      selected: boolean;
      today: boolean;
      hovered: boolean;
    }> = [];
    for (let i = 0; i < startWeekday; i++) list.push({ day: null, iso: null, disabled: true, inMonth: false, selected: false, today: false, hovered: false });
    for (let day = 1; day <= totalDays; day++) {
      const dIso = new Date(year, month, day).toISOString().slice(0, 10);
      list.push({
        day,
        iso: dIso,
        disabled: isDisabled(day),
        inMonth: true,
        selected: !!selected && iso(selected) === value,
        today: dIso === todayIso,
        hovered: hovered === dIso,
      });
    }
    return list;
  }, [year, month, totalDays, startWeekday, value, selected, todayIso, hovered, isDisabled]);

  const triggerValue = value
    ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : placeholder ?? "Pick a date";

  const trigger = (
    <button
      ref={triggerRef}
      id={id}
      type="button"
      className="date-picker-trigger"
      aria-haspopup="grid"
      aria-expanded={open}
      aria-controls={open ? `${baseId}-grid` : undefined}
      disabled={disabled}
      onClick={() => setOpen((o) => !o)}
      onKeyDown={onTriggerKey}
    >
      <span className="date-picker-value">{triggerValue}</span>
      <CalendarIcon size={18} aria-hidden="true" />
      <ArrowDownIcon size={14} className="date-picker-chevron" aria-hidden="true" />
    </button>
  );

  const panel = open
    ? createPortal(
        <div
          ref={listRef}
          id={`${baseId}-panel`}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="date-picker-panel"
          onKeyDown={onPanelKey}
          style={{ position: "fixed", zIndex: 50 }}
        >
          <div className="date-picker-header">
            <button
              type="button"
              className="date-picker-nav"
              aria-label="Previous month"
              disabled={prevDisabled}
              onClick={prevMonth}
            >
              <ChevronLeftIcon size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="date-picker-month"
              onClick={() => {
                // Month/year navigation stays via arrows; clicking the label does nothing extra.
              }}
            >
              {monthLabel(viewMonth)}
            </button>
            <button
              type="button"
              className="date-picker-nav"
              aria-label="Next month"
              disabled={nextDisabled}
              onClick={nextMonth}
            >
              <ChevronRightIcon size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="date-picker-grid">
            <div className="date-picker-weekdays">
              {DAYS.map((d) => (
                <span key={d} className="date-picker-weekday" aria-hidden="true">
                  {d}
                </span>
              ))}
            </div>
            {cells.map((cell) => (
              <button
                key={cell.iso ?? `blank-${cell.day}`}
                type="button"
                className={
                  "date-picker-day" +
                  (cell.disabled ? " is-disabled" : "") +
                  (cell.selected ? " is-selected" : "") +
                  (cell.today ? " is-today" : "") +
                  (cell.hovered ? " is-hovered" : "") +
                  (!cell.inMonth ? " is-outside" : "")
                }
                disabled={cell.disabled || !cell.inMonth}
                aria-label={cell.iso ? new Date(`${cell.iso}T00:00:00`).toLocaleDateString() : undefined}
                onMouseEnter={() => (cell.inMonth && !cell.disabled ? setHovered(cell.iso!) : null)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => (cell.inMonth && !cell.disabled && cell.iso ? pick(cell.day!) : null)}
              >
                {cell.day ?? null}
              </button>
            ))}
          </div>
          <div className="date-picker-footer">
            <button type="button" className="date-picker-footer-btn" onClick={clearDate}>
              Clear
            </button>
            <button type="button" className="date-picker-footer-btn date-picker-footer-btn--today" onClick={today}>
              Today
            </button>
            <button type="button" className="date-picker-close" aria-label="Close calendar" onClick={() => close(true)}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="date-picker" style={{ position: "relative", display: "inline-block" }}>
      <label className="field-label" id={`${baseId}-label`}>
        {label}
      </label>
      <div className="date-picker-field">
        {trigger}
        {panel}
      </div>
    </div>
  );
}
