import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";
import { Label } from "./label";

const fieldStyles = cva("flex w-full flex-col gap-1.5", {
  variants: {
    invalid: {
      true: "[&_input]:border-destructive [&_input]:focus-visible:ring-destructive [&_textarea]:border-destructive",
    },
  },
});

export interface FieldProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof fieldStyles> {
  label?: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string;
}

/**
 * Label + control + hint/error wrapper. Keeps form a11y (label wiring,
 * described-by) consistent across the app.
 */
export function Field({
  label,
  required,
  hint,
  error,
  className,
  children,
  id,
  ...props
}: FieldProps) {
  const controlId = id;
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div
      className={cn(fieldStyles({ invalid: !!error }), className)}
      {...props}
    >
      {label ? (
        <Label htmlFor={controlId}>
          {label}
          {required ? <span className="ml-0.5 text-destructive">*</span> : null}
        </Label>
      ) : null}
      {children}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
