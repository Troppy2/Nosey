import { useEffect, useRef, useState } from "react";
import { Button } from "./Button";
import { InlineLoading } from "./Loaders";

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

type TypeToConfirmModalProps = {
  title: string;
  message: React.ReactNode;
  confirmWord?: string;
  confirmLabel?: string;
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

export function TypeToConfirmModal({
  title,
  message,
  confirmWord = "delete",
  confirmLabel = "Delete",
  loading = false,
  error,
  onConfirm,
  onCancel,
}: TypeToConfirmModalProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const canConfirm = value === confirmWord && !loading;

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal-card" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="muted">{message}</p>
        <input
          ref={inputRef}
          type="text"
          className="modal-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`Type "${confirmWord}" to confirm`}
          autoComplete="off"
        />
        {error ? <p className="modal-type-confirm-error">{error}</p> : null}
        <div className="button-row">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>Cancel</Button>
          <Button variant="danger" onClick={onConfirm} disabled={!canConfirm}>
            {loading ? <InlineLoading label="Deleting" /> : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

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
