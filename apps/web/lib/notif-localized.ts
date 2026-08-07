"use client";

import { useTranslations } from "next-intl";

export interface LocalizedNotification {
  title: string;
  body: string | null;
}

interface Pattern {
  re: RegExp;
  key: string;
  values: string[];
}

const TITLE_PATTERNS: Pattern[] = [
  { re: /^Leave request from (.+)$/, key: "requestFrom", values: ["name"] },
  { re: /^Approval step complete$/, key: "approvalStepComplete", values: [] },
  { re: /^Leave approved$/, key: "approved", values: [] },
  { re: /^Leave request declined$/, key: "declined", values: [] },
  { re: /^Leave days added$/, key: "daysAdded", values: [] },
  { re: /^Leave days removed$/, key: "daysRemoved", values: [] },
];

const BODY_PATTERNS: Pattern[] = [
  {
    re: /^(.+?) – (.+?) · ([\d.]+) day[s]? · (.+) \(level (\d+)\)$/,
    key: "bodySpanLevel",
    values: ["start", "end", "count", "leaveType", "level"],
  },
  { re: /^(.+?) – (.+?) · ([\d.]+) day[s]? · (.+)$/, key: "bodySpan", values: ["start", "end", "count", "leaveType"] },
  {
    re: /^(.+?) · ([\d.]+) day[s]? · (.+) \(level (\d+)\)$/,
    key: "bodySpanLevel",
    values: ["start", "count", "leaveType", "level"],
  },
  { re: /^(.+?) · ([\d.]+) day[s]? · (.+)$/, key: "bodySpan", values: ["start", "count", "leaveType"] },
  { re: /^Your (.+) from (.+) moved to the next approval level\.$/, key: "bodyStep", values: ["leaveType", "start"] },
  { re: /^Your (.+) from (.+) was approved\.$/, key: "bodyApproved", values: ["leaveType", "start"] },
  { re: /^Your (.+) from (.+) was declined: (.+)\.$/, key: "bodyDeclinedReason", values: ["leaveType", "start", "reason"] },
  { re: /^Your (.+) from (.+) was declined\.$/, key: "bodyDeclined", values: ["leaveType", "start"] },
  { re: /^([+-][\d.]+) (.+) day[s]?(?: — (.+))?\.$/, key: "bodyBalance", values: ["delta", "leaveType", "reason"] },
];

/**
 * Translates stored English notification strings at render time. Notification
 * rows are created in English and kept that way (they are logs); this hook
 * matches known templates and re-renders them in the active locale. Unknown
 * strings pass through unchanged.
 */
export function useNotifLocalized() {
  const t = useTranslations("notifications");

  return (title: string, body: string | null): LocalizedNotification => {
    let outTitle = title;
    let outBody = body;

    for (const pattern of TITLE_PATTERNS) {
      const match = title.match(pattern.re);
      if (match) {
        const values: Record<string, string | number> = {};
        pattern.values.forEach((key: string, index: number) => {
          const raw = match[index + 1];
          if (raw !== undefined) values[key] = raw;
        });
        outTitle = t(pattern.key, values);
        break;
      }
    }

    if (body) {
      for (const pattern of BODY_PATTERNS) {
        const match = body.match(pattern.re);
        if (match) {
          const values: Record<string, string | number> = {};
          pattern.values.forEach((key: string, index: number) => {
            const raw = match[index + 1];
            if (raw === undefined) return;
            if (key === "count" || key === "level") values[key] = Number(raw);
            else values[key] = raw;
          });
          if (pattern.key === "bodyBalance") {
            const delta = String(values.delta ?? "");
            const hasReason = "reason" in values && values.reason !== "";
            values.count = Math.abs(Number(delta));
            const key = delta.startsWith("+")
              ? hasReason
                ? "bodyBalanceAddedReason"
                : "bodyBalanceAdded"
              : hasReason
                ? "bodyBalanceRemovedReason"
                : "bodyBalanceRemoved";
            outBody = t(key, values);
          } else {
            outBody = t(pattern.key, values);
          }
          break;
        }
      }
    }

    return { title: outTitle, body: outBody };
  };
}
