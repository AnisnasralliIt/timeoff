import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium leading-5 transition-colors [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        neutral: "border-border bg-secondary text-secondary-foreground",
        primary:
          "border-primary-border bg-primary-subtle text-primary-subtle-foreground",
        success: "border-success-border bg-success-subtle text-success-subtle-foreground",
        warning: "border-warning-border bg-warning-subtle text-warning-subtle-foreground",
        danger: "border-destructive-border bg-destructive-subtle text-destructive-subtle-foreground",
        info: "border-info-border bg-info-subtle text-info-subtle-foreground",
        outline: "border-border bg-card text-foreground",
      },
      tone: {
        // Leave-type tones — driven by the categorical palette
        vacation: "border-transparent bg-leave-vacation/15 text-leave-vacation",
        sick: "border-transparent bg-leave-sick/15 text-leave-sick",
        parental:
          "border-transparent bg-leave-parental/15 text-leave-parental",
        bereavement:
          "border-transparent bg-leave-bereavement/15 text-leave-bereavement",
        unpaid: "border-transparent bg-leave-unpaid/25 text-leave-unpaid",
        remote: "border-transparent bg-leave-remote/15 text-leave-remote",
        custom: "border-transparent bg-leave-custom/15 text-leave-custom",
        special: "border-transparent bg-leave-special/15 text-leave-special",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
);

/** Status → variant mapping so request statuses read identically everywhere. */
export const statusVariant: Record<
  string,
  VariantProps<typeof badgeVariants>["variant"]
> = {
  pending: "warning",
  approved: "success",
  rejected: "danger",
  cancelled: "neutral",
  draft: "neutral",
};

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, tone, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant, tone }), className)}
      {...props}
    />
  );
}

export { badgeVariants };
