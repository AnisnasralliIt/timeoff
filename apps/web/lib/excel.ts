/**
 * Real .xlsx generation for leave exports (exceljs). Pure builder: all
 * localized strings (sheet name, headers, status/day-part labels) are passed
 * in, so this module stays next-intl-free and testable outside Next.
 */
import ExcelJS from "exceljs";
import type { ExportRow } from "@/lib/services/calendar";
import type { DayPartValue, RequestStatus } from "@/lib/calendar-shared";

export interface LeaveExportHeaders {
  sheetName: string;
  employee: string;
  department: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  startHalf: string;
  endHalf: string;
  workingDays: string;
  status: string;
  reason: string;
  approver: string;
  decisionDate: string;
  rejectionReason: string;
  submitted: string;
}

export interface LeaveExportLabels {
  status: Record<RequestStatus, string>;
  dayPart: Record<DayPartValue, string>;
}

export interface LeaveExportContent {
  title: string;
  /** e.g. "TimeOff — Acme GmbH — 2026-08-06". */
  scopeLine: string;
  rows: ExportRow[];
  headers: LeaveExportHeaders;
  labels: LeaveExportLabels;
  filename: string;
}

const DATE_NUM_FORMAT = "yyyy-mm-dd";
const DATETIME_NUM_FORMAT = "yyyy-mm-dd hh:mm";

/** ISO "YYYY-MM-DD" → UTC Date so Excel renders the intended calendar date. */
function isoDateValue(iso: string): Date {
  return new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
}

export async function buildLeaveExportWorkbook(content: LeaveExportContent): Promise<Buffer> {
  const { headers, labels, rows, title, scopeLine } = content;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "TimeOff";
  const sheet = workbook.addWorksheet(headers.sheetName, {
    views: [{ state: "frozen", ySplit: 3 }],
  });
  // Header row is row 3 (rows 1-2 are the merged title/scope lines).
  sheet.autoFilter = { from: "A3", to: "N3" };

  // Row 1: title + scope, merged across the header columns.
  sheet.mergeCells("A1:N1");
  const titleCell = sheet.getCell("A1");
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14, color: { argb: "FF1F2937" } };
  sheet.getRow(1).height = 24;

  sheet.mergeCells("A2:N2");
  const scopeCell = sheet.getCell("A2");
  scopeCell.value = scopeLine;
  scopeCell.font = { italic: true, color: { argb: "FF6B7280" } };

  // Row 3: bold header row (frozen view keeps rows 1-2 + header visible).
  const headerRow = sheet.getRow(3);
  const columnKeys: Exclude<keyof LeaveExportHeaders, "sheetName">[] = [
    "employee",
    "department",
    "leaveType",
    "startDate",
    "endDate",
    "startHalf",
    "endHalf",
    "workingDays",
    "status",
    "reason",
    "approver",
    "decisionDate",
    "rejectionReason",
    "submitted",
  ];
  columnKeys.forEach((key, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = headers[key];
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E9486" } };
    cell.alignment = { vertical: "middle" };
  });
  headerRow.height = 20;

  const widths = {
    employee: 24,
    department: 20,
    leaveType: 18,
    startDate: 12,
    endDate: 12,
    startHalf: 16,
    endHalf: 16,
    workingDays: 12,
    status: 12,
    reason: 40,
    approver: 24,
    decisionDate: 18,
    rejectionReason: 40,
    submitted: 18,
  };
  columnKeys.forEach((key, i) => {
    sheet.getColumn(i + 1).width = widths[key];
  });

  let rowIndex = 4;
  for (const row of rows) {
    const out = sheet.getRow(rowIndex++);
    out.values = [
      row.employee,
      row.department,
      row.leaveType,
      isoDateValue(row.startDate),
      isoDateValue(row.endDate),
      labels.dayPart[row.startDayPart],
      labels.dayPart[row.endDayPart],
      row.totalDays,
      labels.status[row.status],
      row.reason ?? "",
      row.approver ?? "",
      row.decisionDate,
      row.rejectionReason ?? "",
      row.submittedAt,
    ];
    // Real Excel date values with number formats.
    out.getCell(4).numFmt = DATE_NUM_FORMAT;
    out.getCell(5).numFmt = DATE_NUM_FORMAT;
    out.getCell(8).numFmt = "0.#";
    out.getCell(12).numFmt = DATE_NUM_FORMAT;
    out.getCell(14).numFmt = DATETIME_NUM_FORMAT;
  }

  sheet.pageSetup.orientation = "landscape";
  sheet.pageSetup.fitToPage = true;
  sheet.pageSetup.fitToWidth = 1;

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
