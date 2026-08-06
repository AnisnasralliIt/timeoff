/**
 * Transactional email templates (I3). Rendered server-side as brand-styled
 * inline-HTML (email clients ignore external stylesheets). Each template maps
 * to an `EmailMessage.templateType` written by the outbox.
 */

export type EmailTemplate =
  | "request.submitted"
  | "request.approved"
  | "request.rejected"
  | "approval.step"
  | "balance.adjust"
  | "leave.starts"
  | "leave.starts.team"
  | "digest.pending";

export type TemplateData = {
  "request.submitted": {
    requesterName: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    days: number;
    reason?: string | null;
    level?: number;
    requestId: string;
  };
  "request.approved": {
    leaveType: string;
    startDate: string;
    endDate: string;
    days: number;
  };
  "request.rejected": {
    leaveType: string;
    startDate: string;
    endDate: string;
    days: number;
    reason?: string | null;
  };
  "approval.step": {
    leaveType: string;
    startDate: string;
    endDate: string;
    days: number;
    level: number;
  };
  "balance.adjust": {
    delta: number;
    leaveType: string;
    periodStart: string;
    periodEnd: string;
    available: number;
    reason?: string | null;
  };
  "leave.starts": {
    name: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    days: number;
  };
  "leave.starts.team": {
    employeeName: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    days: number;
  };
  "digest.pending": {
    pendingCount: number;
    items: Array<{
      requesterName: string;
      leaveType: string;
      startDate: string;
      endDate: string;
      days: number;
      requestId: string;
    }>;
  };
};

export interface RenderOptions {
  companyName?: string;
}

const LAGOON = "#2e9486";
const LAGOON_DARK = "#1f776c";
const SAND_BG = "#f5f4f2";
const SAND_BORDER = "#d6d3cc";
const TEXT = "#21201c";
const MUTED = "#79766e";
const CARDS_BG = "#ffffff";

function span(start: string, end: string): string {
  return start === end ? start : `${start} – ${end}`;
}

function layout(title: string, bodyHtml: string, opts: RenderOptions): string {
  const company = opts.companyName ?? "TimeOff";
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:${SAND_BG};font-family:Inter,Helvetica,Arial,sans-serif;color:${TEXT};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${SAND_BG};padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:${CARDS_BG};border:1px solid ${SAND_BORDER};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:${LAGOON};padding:20px 28px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.4px;">${company}</span>
                <span style="color:rgba(255,255,255,0.85);font-size:18px;font-weight:300;"> · leave</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:${TEXT};">${title}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="border-top:1px solid ${SAND_BORDER};padding:16px 28px;">
                <p style="margin:0;font-size:12px;color:${MUTED};">${company} — sent automatically. Do not reply to this message.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function detailRows(rows: Array<[string, string]>): string {
  const body = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:${MUTED};font-size:13px;width:120px;vertical-align:top;">${k}</td><td style="padding:6px 0;font-size:13px;color:${TEXT};">${v}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">${body}</table>`;
}

function primaryButton(href: string, label: string): string {
  return `<a href="${href}" style="display:inline-block;background:${LAGOON};color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;padding:10px 18px;border-radius:8px;">${label}</a>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderEmail<T extends EmailTemplate>(
  template: T,
  data: TemplateData[T],
  opts: RenderOptions = {},
): { subject: string; html: string; text: string } {
  const e = escapeHtml;
  switch (template) {
    case "request.submitted": {
      const d = data as TemplateData["request.submitted"];
      const subject = `Leave request from ${d.requesterName}${d.level ? ` (level ${d.level})` : ""}`;
      const html = layout(
        `New leave request from ${e(d.requesterName)}`,
        `<p style="margin:0 0 8px;font-size:14px;color:${TEXT};">A request is waiting for your review.</p>${detailRows([
          ["Type", e(d.leaveType)],
          ["Dates", `${e(span(d.startDate, d.endDate))} · ${d.days} day${d.days === 1 ? "" : "s"}`],
          ["Reason", d.reason ? e(d.reason) : "—"],
        ])}${primaryButton(`https://timeoff.local/requests/${d.requestId}`, "Review request")}`,
        opts,
      );
      return {
        subject,
        html,
        text: `New leave request from ${d.requesterName}: ${d.leaveType}, ${span(d.startDate, d.endDate)} (${d.days} days).`,
      };
    }
    case "request.approved": {
      const d = data as TemplateData["request.approved"];
      const html = layout(
        "Leave approved",
        `<p style="margin:0 0 8px;font-size:14px;color:${TEXT};">Good news — your request was approved.</p>${detailRows([
          ["Type", e(d.leaveType)],
          ["Dates", `${e(span(d.startDate, d.endDate))} · ${d.days} day${d.days === 1 ? "" : "s"}`],
        ])}`,
        opts,
      );
      return {
        subject: "Leave approved",
        html,
        text: `Your ${d.leaveType} (${span(d.startDate, d.endDate)}, ${d.days} days) was approved.`,
      };
    }
    case "request.rejected": {
      const d = data as TemplateData["request.rejected"];
      const html = layout(
        "Leave request declined",
        `<p style="margin:0 0 8px;font-size:14px;color:${TEXT};">Your request was not approved.</p>${detailRows([
          ["Type", e(d.leaveType)],
          ["Dates", `${e(span(d.startDate, d.endDate))} · ${d.days} day${d.days === 1 ? "" : "s"}`],
          ["Reason", d.reason ? e(d.reason) : "No reason was given"],
        ])}`,
        opts,
      );
      return {
        subject: "Leave request declined",
        html,
        text: `Your ${d.leaveType} (${span(d.startDate, d.endDate)}, ${d.days} days) was declined${d.reason ? `: ${d.reason}` : "."}`,
      };
    }
    case "approval.step": {
      const d = data as TemplateData["approval.step"];
      const html = layout(
        "Approval step complete",
        `<p style="margin:0 0 8px;font-size:14px;color:${TEXT};">Your request passed level ${d.level} of the approval chain.</p>${detailRows([
          ["Type", e(d.leaveType)],
          ["Dates", `${e(span(d.startDate, d.endDate))} · ${d.days} day${d.days === 1 ? "" : "s"}`],
        ])}`,
        opts,
      );
      return {
        subject: "Approval step complete",
        html,
        text: `Your ${d.leaveType} (${span(d.startDate, d.endDate)}) passed level ${d.level}.`,
      };
    }
    case "balance.adjust": {
      const d = data as TemplateData["balance.adjust"];
      const sign = d.delta > 0 ? "+" : "−";
      const subject = d.delta > 0 ? "Leave days added" : "Leave days removed";
      const html = layout(
        subject,
        `<p style="margin:0 0 8px;font-size:14px;color:${TEXT};">${d.delta > 0 ? "Days were added" : "Days were removed"} to your ${e(d.leaveType)} balance.</p>${detailRows([
          ["Change", `${sign}${Math.abs(d.delta)} day${Math.abs(d.delta) === 1 ? "" : "s"}`],
          ["Leave year", `${e(d.periodStart)} – ${e(d.periodEnd)}`],
          ["Available now", `${d.available} day${d.available === 1 ? "" : "s"}`],
          ["Reason", d.reason ? e(d.reason) : "—"],
        ])}`,
        opts,
      );
      return {
        subject,
        html,
        text: `${sign}${Math.abs(d.delta)} ${d.leaveType} day(s). Available now: ${d.available}.${d.reason ? ` Reason: ${d.reason}` : ""}`,
      };
    }
    case "leave.starts": {
      const d = data as TemplateData["leave.starts"];
      const html = layout(
        `Your leave starts tomorrow`,
        `<p style="margin:0 0 8px;font-size:14px;color:${TEXT};">${e(d.name)}, a quick heads-up that your leave starts tomorrow.</p>${detailRows([
          ["Type", e(d.leaveType)],
          ["Dates", `${e(span(d.startDate, d.endDate))} · ${d.days} day${d.days === 1 ? "" : "s"}`],
        ])}`,
        opts,
      );
      return {
        subject: "Your leave starts tomorrow",
        html,
        text: `${d.name}, your ${d.leaveType} starts tomorrow (${span(d.startDate, d.endDate)}, ${d.days} days).`,
      };
    }
    case "leave.starts.team": {
      const d = data as TemplateData["leave.starts.team"];
      const html = layout(
        `${d.employeeName}'s leave starts tomorrow`,
        `<p style="margin:0 0 8px;font-size:14px;color:${TEXT};">A member of your team starts leave tomorrow.</p>${detailRows([
          ["Team member", e(d.employeeName)],
          ["Type", e(d.leaveType)],
          ["Dates", `${e(span(d.startDate, d.endDate))} · ${d.days} day${d.days === 1 ? "" : "s"}`],
        ])}`,
        opts,
      );
      return {
        subject: `${d.employeeName}'s leave starts tomorrow`,
        html,
        text: `${d.employeeName}'s ${d.leaveType} starts tomorrow (${span(d.startDate, d.endDate)}, ${d.days} days).`,
      };
    }
    case "digest.pending": {
      const d = data as TemplateData["digest.pending"];
      const rows = d.items
        .map(
          (item) =>
            `<li style="padding:10px 0;border-bottom:1px solid ${SAND_BORDER};font-size:13px;color:${TEXT};">${e(item.requesterName)} — ${e(item.leaveType)} · ${e(span(item.startDate, item.endDate))} (${item.days} day${item.days === 1 ? "" : "s"})</li>`,
        )
        .join("");
      const html = layout(
        "Pending approvals",
        `<p style="margin:0 0 8px;font-size:14px;color:${TEXT};">You have ${d.pendingCount} pending approval${d.pendingCount === 1 ? "" : "s"} waiting on you.</p><ul style="margin:0;padding:0;list-style:none;${rows ? "" : "display:none;"}">${rows}</ul>`,
        opts,
      );
      return {
        subject: `${d.pendingCount} pending approval${d.pendingCount === 1 ? "" : "s"} to review`,
        html,
        text: `You have ${d.pendingCount} pending approvals:\n${d.items.map((i) => `- ${i.requesterName}: ${i.leaveType}, ${span(i.startDate, i.endDate)}`).join("\n")}`,
      };
    }
  }
}
