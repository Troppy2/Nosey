import { X } from "lucide-react";
import { useEffect, useRef } from "react";

type ConfirmModalProps = {
  title: string;
  message: string;
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
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <p className="muted">{message}</p>
        </div>
        <div className="modal-footer">
          <button type="button" className="modal-btn modal-btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`modal-btn ${danger ? "modal-btn--danger" : "modal-btn--primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
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
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">
          <input
            ref={inputRef}
            type="text"
            className="modal-input"
            defaultValue={initialValue}
            placeholder="Enter a name"
            maxLength={200}
          />
        </div>
        <div className="modal-footer">
          <button type="button" className="modal-btn modal-btn--secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="modal-btn modal-btn--primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
