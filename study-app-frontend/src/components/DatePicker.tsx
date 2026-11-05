import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon } from "../icons";
import "../styles/components/date-picker.css";

// A shared calendar date picker that replaces the browser's native <input type="date">.
// It renders as a text field with the ISO value, and opens a month grid portalled to
// <body>. Uses Nosey tokens (--ink, --green-dark, --green-lightest, --radius-*) and
// the custom icon set. No Lucide.
//
// Value: YYYY-MM-DD or "". onChange fires with the chosen ISO string.
// min/max are optional ISO strings that clamp which days can be selected.
//
// Keyboard: arrow keys move focus, Enter picks a day, Escape closes the panel.

export type DatePickerProps = {
  label: string;
  value: string; // "" or YYYY-MM-DD
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  /** "chip" is a small inline trigger for list rows; "field" (default) looks like an input. */
  variant?: "field" | "chip";
  /** Trigger text in place of the formatted date (e.g. "Tomorrow"). */
  display?: string;
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

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

function isoFromParts(year: number, month: number, day: number): string {
  return iso(new Date(year, month, day));
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
  variant = "field",
  display,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [rawViewMonth, setRawViewMonth] = useState(
    value ? parseIso(value) ?? new Date() : new Date(),
  );
  const [focusedDay, setFocusedDay] = useState<number | null>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  const baseId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

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

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const totalDays = daysInMonth(year, month);
  const startWeekday = startOfMonthWeekday(year, month);

  const isDayDisabled = useCallback(
    (day: number): boolean => {
      const dIso = isoFromParts(year, month, day);
      if (min && dIso < min) return true;
      if (max && dIso > max) return true;
      return false;
    },
    [year, month, min, max],
  );

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setFocusedDay(null);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const pick = useCallback(
    (day: number) => {
      const chosen = new Date(year, month, day);
      onChange(iso(chosen));
      close(true);
    },
    [year, month, onChange, close],
  );

  const prevMonth = useCallback(() => {
    setRawViewMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    setFocusedDay(null);
  }, []);

  const nextMonth = useCallback(() => {
    setRawViewMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    setFocusedDay(null);
  }, []);

  const clearDate = useCallback(() => {
    onChange("");
    setRawViewMonth(new Date());
    close(true);
  }, [onChange, close]);

  const goToday = useCallback(() => {
    const now = new Date();
    setRawViewMonth(now);
    onChange(iso(now));
    close(true);
  }, [onChange, close]);

  // Position panel below trigger
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPanelPos({ top: rect.bottom + 6, left: rect.left });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  // Focus the panel when it opens
  useEffect(() => {
    if (open && panelRef.current) {
      panelRef.current.focus({ preventScroll: true });
    }
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close(false);
    }
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open, close]);

  // Set initial focused day when month changes
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally syncs focusedDay when the viewed month changes
  useEffect(() => {
    if (!open) return;
    // If selected value is in this month, focus it
    if (selected && selected.getFullYear() === year && selected.getMonth() === month) {
      setFocusedDay(selected.getDate());
    } else {
      // Focus today if it's in this month, otherwise day 1
      const now = new Date();
      if (now.getFullYear() === year && now.getMonth() === month) {
        setFocusedDay(now.getDate());
      } else {
        setFocusedDay(1);
      }
    }
  }, [open, year, month]); // selected omitted: only month changes should reset focus

  const prevDisabled = !!min && !!parseIso(min) && new Date(year, month - 1, daysInMonth(year, month - 1)) < parseIso(min)!;
  const nextDisabled = !!max && !!parseIso(max) && new Date(year, month + 1, 1) > parseIso(max)!;

  // Build cells for the grid: in-month days + trailing out-of-month days to fill last row
  const cells = useMemo(() => {
    const list: Array<{
      day: number;
      iso: string;
      disabled: boolean;
      inMonth: boolean;
      isSelected: boolean;
      isToday: boolean;
    }> = [];
    // Previous month trailing days
    const prevMonthTotal = daysInMonth(year, month - 1);
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = prevMonthTotal - i;
      const prevM = month - 1;
      const prevY = prevM < 0 ? year - 1 : year;
      const actualM = prevM < 0 ? 11 : prevM;
      const dIso = isoFromParts(prevY, actualM, d);
      list.push({ day: d, iso: dIso, disabled: true, inMonth: false, isSelected: false, isToday: false });
    }
    // Current month days
    for (let day = 1; day <= totalDays; day++) {
      const dIso = isoFromParts(year, month, day);
      list.push({
        day,
        iso: dIso,
        disabled: isDayDisabled(day),
        inMonth: true,
        isSelected: !!selected && iso(selected) === dIso,
        isToday: dIso === todayIso,
      });
    }
    // Next month leading days to fill row
    const remainder = list.length % 7;
    if (remainder > 0) {
      const fill = 7 - remainder;
      for (let i = 1; i <= fill; i++) {
        const nextM = month + 1;
        const nextY = nextM > 11 ? year + 1 : year;
        const actualM = nextM > 11 ? 0 : nextM;
        const dIso = isoFromParts(nextY, actualM, i);
        list.push({ day: i, iso: dIso, disabled: true, inMonth: false, isSelected: false, isToday: false });
      }
    }
    return list;
  }, [year, month, totalDays, startWeekday, selected, todayIso, isDayDisabled]);

  function onPanelKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      case "Enter": {
        event.preventDefault();
        if (focusedDay != null && !isDayDisabled(focusedDay)) {
          pick(focusedDay);
        }
        return;
      }
      case "ArrowRight": {
        event.preventDefault();
        setFocusedDay((d) => {
          const next = (d ?? 0) + 1;
          if (next > totalDays) {
            nextMonth();
            return null; // will be reset by the month change effect
          }
          return next;
        });
        return;
      }
      case "ArrowLeft": {
        event.preventDefault();
        setFocusedDay((d) => {
          const prev = (d ?? 2) - 1;
          if (prev < 1) {
            prevMonth();
            return null;
          }
          return prev;
        });
        return;
      }
      case "ArrowDown": {
        event.preventDefault();
        setFocusedDay((d) => {
          const next = (d ?? 0) + 7;
          if (next > totalDays) {
            nextMonth();
            return null;
          }
          return next;
        });
        return;
      }
      case "ArrowUp": {
        event.preventDefault();
        setFocusedDay((d) => {
          const prev = (d ?? 8) - 7;
          if (prev < 1) {
            prevMonth();
            return null;
          }
          return prev;
        });
        return;
      }
      default:
        return;
    }
  }

  const triggerValue = value
    ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  const trigger = (
    <button
      ref={triggerRef}
      id={id}
      type="button"
      className={`date-picker-trigger ${variant === "chip" ? "date-picker-chip" : "input"}${!triggerValue ? " is-placeholder" : ""}`}
      aria-haspopup="grid"
      aria-expanded={open}
      aria-controls={open ? `${baseId}-panel` : undefined}
      aria-label={triggerValue ? `${label}: ${triggerValue}` : label}
      disabled={disabled}
      onClick={() => {
        if (open) {
          close(false);
        } else {
          if (value) setRawViewMonth(parseIso(value) ?? new Date());
          setOpen(true);
        }
      }}
    >
      <CalendarIcon size={variant === "chip" ? 14 : 16} className="date-picker-icon" aria-hidden="true" />
      <span className="date-picker-value">{display ?? triggerValue ?? placeholder ?? "Pick a date"}</span>
    </button>
  );

  const panel = open
    ? createPortal(
        <div
          ref={panelRef}
          id={`${baseId}-panel`}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="date-picker-panel"
          tabIndex={-1}
          onKeyDown={onPanelKey}
          style={panelPos ? { top: panelPos.top, left: panelPos.left } : undefined}
        >
          <div className="date-picker-header">
            <span className="date-picker-month-label">{monthLabel(viewMonth)}</span>
            <span className="date-picker-nav-group">
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
                className="date-picker-nav"
                aria-label="Next month"
                disabled={nextDisabled}
                onClick={nextMonth}
              >
                <ChevronRightIcon size={16} aria-hidden="true" />
              </button>
            </span>
          </div>
          <div className="date-picker-weekdays" aria-hidden="true">
            {WEEKDAYS.map((d, i) => (
              <span key={i} className="date-picker-weekday">{d}</span>
            ))}
          </div>
          <div className="date-picker-grid" role="grid" id={`${baseId}-grid`}>
            {cells.map((cell, i) => (
              <button
                key={cell.iso + "-" + i}
                type="button"
                className={
                  "date-picker-day" +
                  (!cell.inMonth ? " is-outside" : "") +
                  (cell.disabled && cell.inMonth ? " is-disabled" : "") +
                  (cell.isSelected ? " is-selected" : "") +
                  (cell.isToday && !cell.isSelected ? " is-today" : "") +
                  (cell.inMonth && focusedDay === cell.day ? " is-focused" : "")
                }
                disabled={!cell.inMonth || cell.disabled}
                tabIndex={-1}
                aria-label={cell.inMonth ? new Date(`${cell.iso}T00:00:00`).toLocaleDateString() : undefined}
                onClick={() => cell.inMonth && !cell.disabled && pick(cell.day)}
              >
                {cell.day}
              </button>
            ))}
          </div>
          <div className="date-picker-footer">
            <Button variant="ghost" onClick={clearDate}>Clear</Button>
            <Button variant="secondary" onClick={goToday}>Today</Button>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div className="date-picker">
      {trigger}
      {panel}
    </div>
  );
}
