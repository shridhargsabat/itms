interface FieldErrorProps {
  id: string;
  error: string | null | undefined;
}

/**
 * Shared form-field error primitive (FORM audit).
 * Null when there is no error; otherwise an assertive live region the
 * input points at via `errProps(fieldId, error)['aria-describedby']`.
 */
export function FieldError({ id, error }: FieldErrorProps) {
  if (!error) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-red-400">
      {error}
    </p>
  );
}

interface ErrProps {
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
}

/**
 * A11y props for an input paired with `<FieldError id={`${fieldId}-error`} … />`.
 * `aria-describedby` is omitted (undefined) when there is no error.
 */
export function errProps(fieldId: string, error: string | null | undefined): ErrProps {
  return {
    'aria-invalid': Boolean(error),
    'aria-describedby': error ? `${fieldId}-error` : undefined,
  };
}
