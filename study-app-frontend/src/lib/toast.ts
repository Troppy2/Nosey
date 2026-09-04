// Global toast store. Any module can raise a toast without threading props or
// context through the tree: `toast.success("Test ready")`.
//
// The host that renders these lives in components/ToastHost.tsx and is mounted
// once in App.tsx, so a toast raised from a page, an api helper, or a timer all
// land in the same stack.

export type ToastKind = "success" | "error" | "info";

export type Toast = {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
};

// Errors stay longer: they usually carry a fix the reader has to act on.
const DURATION_MS: Record<ToastKind, number> = {
  success: 4000,
  info: 4500,
  error: 7000,
};

// Beyond this the stack covers the screen on a phone. Oldest drops off.
const MAX_VISIBLE = 3;

let nextId = 1;
let toasts: Toast[] = [];
const listeners = new Set<(next: Toast[]) => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

export function subscribeToasts(listener: (next: Toast[]) => void) {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}

export function dismissToast(id: number) {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  if (!toasts.some((item) => item.id === id)) return;
  toasts = toasts.filter((item) => item.id !== id);
  emit();
}

function push(kind: ToastKind, title: string, body?: string) {
  const id = nextId++;
  const entry: Toast = { id, kind, title, body };
  toasts = [...toasts, entry].slice(-MAX_VISIBLE);
  emit();
  timers.set(id, setTimeout(() => dismissToast(id), DURATION_MS[kind]));
  return id;
}

export const toast = {
  success: (title: string, body?: string) => push("success", title, body),
  error: (title: string, body?: string) => push("error", title, body),
  info: (title: string, body?: string) => push("info", title, body),
  dismiss: dismissToast,
};
