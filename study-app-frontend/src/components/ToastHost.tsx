import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { dismissToast, subscribeToasts, type Toast, type ToastKind } from "../lib/toast";
import "../styles/components/toast.css";

const ICONS: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

// Errors interrupt; everything else is announced without stealing focus.
const POLITENESS: Record<ToastKind, "assertive" | "polite"> = {
  success: "polite",
  info: "polite",
  error: "assertive",
};

function ToastRow({ item }: { item: Toast }) {
  const Icon = ICONS[item.kind];
  return (
    <div className="toast" data-kind={item.kind} role="status" aria-live={POLITENESS[item.kind]}>
      <Icon className="toast-icon" size={18} aria-hidden="true" />
      <div className="toast-copy">
        <strong>{item.title}</strong>
        {item.body ? <span>{item.body}</span> : null}
      </div>
      <button
        type="button"
        className="toast-close"
        onClick={() => dismissToast(item.id)}
        aria-label={`Dismiss: ${item.title}`}
      >
        <X size={15} />
      </button>
    </div>
  );
}

export function ToastHost() {
  const [items, setItems] = useState<Toast[]>([]);

  useEffect(() => subscribeToasts(setItems), []);

  if (items.length === 0) return null;

  return (
    <div className="toast-host">
      {items.map((item) => (
        <ToastRow key={item.id} item={item} />
      ))}
    </div>
  );
}

export default ToastHost;
