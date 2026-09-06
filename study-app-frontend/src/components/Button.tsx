import type { ButtonHTMLAttributes, ReactNode } from "react";

// "danger" is the filled treatment and is reserved for irreversible actions.
// "danger-outline" carries the same meaning at a lower volume, for actions
// that end something but can be undone by doing it again (signing out).
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: ReactNode;
  fullWidth?: boolean;
};

export function Button({
  children,
  className = "",
  variant = "primary",
  icon,
  fullWidth = false,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button-${variant} ${fullWidth ? "button-full" : ""} ${className}`}
      type={type}
      {...props}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
