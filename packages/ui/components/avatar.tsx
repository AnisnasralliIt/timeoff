import * as React from "react";
import { cn } from "../lib/utils";

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  /** True when the person is on approved leave — shows a teal ring + dot. */
  out?: boolean;
}

const sizes = {
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-12 text-sm",
};

export function Avatar({ name, src, size = "md", out, className, ...props }: AvatarProps) {
  return (
    <div
      className={cn("relative inline-flex shrink-0", className)}
      title={name}
      {...props}
    >
      {out ? (
        <span
          aria-hidden
          className="absolute -inset-0.5 rounded-full border-2 border-leave-vacation/70"
        />
      ) : null}
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          className={cn(
            "size-full rounded-full bg-secondary object-cover",
            sizes[size]
          )}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            "flex items-center justify-center rounded-full bg-primary-subtle font-medium text-primary-subtle-foreground",
            sizes[size]
          )}
        >
          {initialsOf(name)}
        </span>
      )}
      {out ? (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-background bg-leave-vacation"
        />
      ) : null}
      <span className="sr-only">{name}</span>
    </div>
  );
}
