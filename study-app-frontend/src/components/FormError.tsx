import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import { toast } from "../lib/toast";
import { useMobileShell } from "../lib/useMobileShell";

/**
 * The one render site for a form/page error message. Desktop keeps the
 * existing inline red box; the mobile shell has no room to spare for it and
 * raises a toast instead, so the same failure is never reported twice.
 */
export function FormError({
  message,
  className,
  style,
}: {
  message: string | null | undefined;
  className?: string;
  style?: CSSProperties;
}) {
  const isMobileShell = useMobileShell();
  const lastToasted = useRef<string | null>(null);

  useEffect(() => {
    if (!isMobileShell) return;
    if (!message || message === lastToasted.current) return;
    lastToasted.current = message;
    toast.error(message);
  }, [isMobileShell, message]);

  useEffect(() => {
    if (!message) lastToasted.current = null;
  }, [message]);

  if (!message || isMobileShell) return null;

  return <div className={className ? `form-error ${className}` : "form-error"} style={style}>{message}</div>;
}

export default FormError;
