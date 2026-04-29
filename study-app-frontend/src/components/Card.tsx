import type { HTMLAttributes, ReactNode } from "react";

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  interactive?: boolean;
  tone?: "plain" | "soft" | "dark";
};

export function Card({ children, className = "", interactive = false, tone = "plain", ...props }: CardProps) {
  return (
    <div className={`card card-${tone} ${interactive ? "card-interactive" : ""} ${className}`} {...props}>
      {children}
    </div>
  );
}
