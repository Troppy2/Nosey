import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

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
