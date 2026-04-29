import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

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

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  hint?: string;
};

export function SelectInput({ label, hint, id, children, ...props }: SelectProps) {
  const inputId = id ?? props.name ?? label;
  return (
    <FieldShell label={label} htmlFor={inputId} hint={hint}>
      <select id={inputId} className="input select" {...props}>
        {children}
      </select>
    </FieldShell>
  );
}

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
