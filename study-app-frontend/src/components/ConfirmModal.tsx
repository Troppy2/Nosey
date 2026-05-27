import { useEffect, useRef } from "react";
import { Button } from "./Button";

type ConfirmModalProps = {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal-card" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="muted">{message}</p>
        <div className="button-row">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  );
}

type RenameModalProps = {
  title: string;
  initialValue: string;
  onSave: (value: string) => void;
  onCancel: () => void;
};

export function RenameModal({ title, initialValue, onSave, onCancel }: RenameModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = inputRef.current?.value.trim();
    if (value) onSave(value);
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form className="modal-card" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h2>{title}</h2>
        <input
          ref={inputRef}
          type="text"
          className="modal-input"
          defaultValue={initialValue}
          placeholder="Enter a name"
          maxLength={200}
        />
        <div className="button-row">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button type="submit">Save</Button>
        </div>
      </form>
    </div>
  );
}
