import { cn } from "@timeoff/ui";

/** Brand mark — a sun meeting the horizon. Calm, distinctive, leave-y. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden
      className={cn("size-7", className)}
    >
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <circle cx="16" cy="13" r="5" className="fill-card" />
      <path
        d="M7 21a9 9 0 0 1 18 0Z"
        className="fill-card"
        opacity="0.35"
      />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "font-display text-lg font-semibold tracking-tight text-foreground",
        className
      )}
    >
      TimeOff
    </span>
  );
}
