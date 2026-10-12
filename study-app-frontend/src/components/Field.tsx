import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

type FieldShellProps = {
  label: string;
  htmlFor: string;
  children: ReactNode;
  hint?: string;
};

function FieldShell({ label, htmlFor, children, hint }: FieldShellProps) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
};

export function TextInput({ label, hint, id, ...props }: InputProps) {
  const inputId = id ?? props.name ?? label;
  return (
    <FieldShell label={label} htmlFor={inputId} hint={hint}>
      <input id={inputId} className="input" {...props} />
    </FieldShell>
  );
}

// Dropdowns: use components/Dropdown.tsx (custom listbox), not a native <select>.

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  hint?: string;
};

export function TextArea({ label = "Answer", hint, id, ...props }: TextAreaProps) {
  const inputId = id ?? props.name ?? label;
  return (
    <FieldShell label={label} htmlFor={inputId} hint={hint}>
      <textarea id={inputId} className="input textarea" {...props} />
    </FieldShell>
  );
}
