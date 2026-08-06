"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "../lib/utils";

export interface BalanceRingProps {
  /** Used fraction 0..1 */
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  /** SVG stroke color for the progress arc */
  color?: string;
  trackClassName?: string;
  center?: React.ReactNode;
}

/**
 * Balance ring — draws in on mount. `value` is the *used* fraction, so the
 * remaining balance reads as the open arc.
 */
export function BalanceRing({
  value,
  size = 120,
  strokeWidth = 10,
  className,
  color = "var(--lagoon-500)",
  trackClassName,
  center,
}: BalanceRingProps) {
  const clamped = Math.min(1, Math.max(0, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * clamped;

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${Math.round(clamped * 100)}% used`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className={cn("stroke-secondary", trackClassName)}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference - dash}`}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: 0 }}
          transition={{ duration: 0.9, ease: "easeOut", delay: 0.1 }}
        />
      </svg>
      {center ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {center}
        </div>
      ) : null}
    </div>
  );
}
