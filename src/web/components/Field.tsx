import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export const primaryButton =
  'inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 py-2 font-medium text-white disabled:opacity-60';
export const secondaryButton =
  'inline-flex min-h-11 items-center justify-center rounded-lg border border-line bg-white px-4 py-2 font-medium disabled:opacity-60';
export const dangerButton =
  'inline-flex min-h-11 items-center justify-center rounded-lg border border-red-900 px-4 py-2 font-medium text-red-900 disabled:opacity-60';

type FieldProps = {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
} & InputHTMLAttributes<HTMLInputElement>;

export function Field({ id, label, error, hint, ...props }: FieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        className="min-h-11 rounded-lg border border-line bg-white px-3"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        {...props}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-900">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type SelectFieldProps = {
  id: string;
  label: string;
  error?: string | undefined;
  children: ReactNode;
} & SelectHTMLAttributes<HTMLSelectElement>;

export function SelectField({ id, label, error, children, ...props }: SelectFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        className="min-h-11 rounded-lg border border-line bg-white px-3"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      >
        {children}
      </select>
      {error ? (
        <p id={`${id}-error`} className="text-sm text-red-900">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Banner({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-900 bg-white px-3 py-2 text-sm text-red-900"
    >
      {message}
    </p>
  );
}

export function Note({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <p role="status" className="rounded-lg border border-line bg-white px-3 py-2 text-sm">
      {message}
    </p>
  );
}
