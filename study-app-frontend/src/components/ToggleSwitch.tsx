import type { ButtonHTMLAttributes, ReactNode } from "react";

type ToggleSwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  checked: boolean;
  label?: ReactNode;
};

/** Shared on/off control for settings and feature preferences. */
export function ToggleSwitch({
  checked,
  label,
  className = "",
  type = "button",
  ...props
}: ToggleSwitchProps) {
  return (
    <button
      type={type}
      role="switch"
      aria-checked={checked}
      className={`toggle-switch${checked ? " toggle-switch--on" : ""}${className ? ` ${className}` : ""}`}
      {...props}
    >
      <span className="toggle-switch-track" aria-hidden="true">
        <span className="toggle-switch-thumb" />
      </span>
      {label ? <span className="toggle-switch-label">{label}</span> : null}
    </button>
  );
}
