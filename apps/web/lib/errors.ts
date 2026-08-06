/**
 * Maps user-facing error messages to localized error keys (see messages/*.json
 * `errors` namespace). Service errors throw English messages; those that carry
 * a `code` (interpolated messages) are used directly, everything else is
 * matched against the stable message table below. Unknown messages fall back to
 * the raw English text.
 */

export type ServerErrorValues = Record<string, string | number>;

export interface ServerErrorShape {
  error?: string;
  errorCode?: string;
  errorValues?: ServerErrorValues;
}

interface CodeError {
  code?: string;
  values?: ServerErrorValues;
}

/** Exact-match table: English message -> error key (static strings only). */
const STATIC_MESSAGES: Record<string, string> = {
  "Pick valid start and end dates.": "pickValidDates",
  "Your account is not active.": "accountNotActive",
  "Unknown leave type.": "unknownLeaveType",
  "This overlaps a request you already submitted.": "overlapsOwnRequest",
  "This leave type requires an attachment (e.g. a medical certificate).":
    "attachmentRequiredType",
  "Request not found.": "requestNotFound",
  "This request can no longer be cancelled.": "cannotCancel",
  "You are not the approver for this request.": "notApprover",
  "This request has already been processed.": "alreadyProcessed",
  "Only approvers can delegate.": "onlyApproversDelegate",
  "Cannot delegate to yourself.": "cannotDelegateSelf",
  "Delegation start must be before its end.": "delegationDates",
  "Delegate not found in this company.": "delegateNotFound",
  "Delegation target must be in your own department.": "delegateSameDepartment",
  "Delegation not found.": "delegationNotFound",
  "Only the delegation owner or HR can deactivate this.": "delegationDeactivate",
  "HR access required.": "hrAccessRequired",
  "Name, email and start date are required.": "userFieldsRequired",
  "Invalid email address.": "invalidEmail",
  "Only a SUPER_ADMIN can assign this role.": "onlySuperAdminAssign",
  "You cannot assign this role.": "cannotAssignRole",
  "A password of at least 8 characters is required.": "passwordMinLength",
  "A user with this email already exists.": "emailExists",
  "User not found.": "userNotFound",
  "You cannot deactivate your own account.": "cannotDeactivateSelf",
  "A user cannot be their own manager.": "cannotBeOwnManager",
  "Only a SUPER_ADMIN can change privileged roles.": "onlySuperAdminChangePrivileged",
  "Department name is required.": "departmentNameRequired",
  "A department with this name already exists.": "departmentExists",
  "Department not found.": "departmentNotFound",
  "Leave type name is required.": "leaveTypeNameRequired",
  "Carry-over expiry must be MM-DD (e.g. 03-31).": "carryOverExpiryFormat",
  "Policy not found.": "policyNotFound",
  "Adjustment must be a non-zero number.": "adjustmentNonZero",
  "No balance row found for this user and leave type.": "noBalanceRow",
  "The file is empty.": "fileEmpty",
  "Files are limited to 10 MB.": "fileTooBig",
  "Only PDF and image files (png, jpg, webp) are allowed.": "fileTypeNotAllowed",
  "One of the uploaded files could not be found.": "stagedFileNotFound",
  "You can only attach files you uploaded.": "onlyOwnFiles",
  "That file was already deleted.": "fileAlreadyDeleted",
  "That file is already attached to a request.": "fileAlreadyAttached",
  "Only the requester or HR can add attachments.": "onlyRequesterOrHrAdd",
  "You cannot access this request.": "cannotAccessRequest",
  "You cannot access this attachment.": "cannotAccessAttachment",
  "You cannot delete this attachment.": "cannotDeleteAttachment",
  "Choose a leave type and a date range.": "chooseLeaveTypeAndRange",
  "Add a reason so the employee understands.": "addReason",
  "Choose a delegate.": "chooseDelegate",
  "Enter your email and password.": "enterEmailAndPassword",
  "Invalid email or password.": "invalidCredentials",
  "Not signed in.": "notSignedIn",
  "Failed to read calendar feed.": "failedReadFeed",
  "Failed to rotate calendar feed.": "failedRotateFeed",
  "A single working day cannot be split into two half days": "cannotSplitHalfDay",
  "No file provided (multipart field `file`).": "noFileProvided",
  "File storage is unavailable right now.": "storageUnavailable",
};

/** Regex table for domain span errors (messages built in @timeoff/domain). */
const PATTERN_MESSAGES: Array<{ re: RegExp; code: string; values: string[] }> = [
  { re: /^Invalid ISO date in span (.+)\.\.(.+)$/, code: "invalidIsoSpan", values: ["start", "end"] },
  { re: /^Invalid ISO date in range (.+)\.\.(.+)$/, code: "invalidIsoSpan", values: ["start", "end"] },
  { re: /^Invalid span (.+)\.\.(.+)$/, code: "invalidSpanRange", values: ["start", "end"] },
  { re: /^Range start (.+) is after end (.+)$/, code: "rangeStartAfterEnd", values: ["start", "end"] },
  { re: /^Span (.+)\.\.(.+) contains no working days$/, code: "noWorkingDays", values: ["start", "end"] },
  { re: /^Insufficient balance: ([\d.]+) day[s]? available, ([\d.]+) requested\.$/, code: "insufficientBalance", values: ["available", "requested"] },
  { re: /^Carried-over days must be used by (.+) — end the request on or before that date\.$/, code: "carriedOverExpiry", values: ["expiry"] },
  { re: /^Paid leave starts before your probation ends on (.+)\.$/, code: "probation", values: ["date"] },
  { re: /^Adjustment would take the balance below zero \(currently ([\d.]+) day[s]?\)\.$/, code: "adjustmentBelowZero", values: ["available"] },
];

/** Resolves the error key (+ values) for a raw English message, if known. */
export function errorKeyFor(message: string): ServerErrorShape | null {
  const staticCode = STATIC_MESSAGES[message];
  if (staticCode) return { errorCode: staticCode };
  for (const pattern of PATTERN_MESSAGES) {
    const match = message.match(pattern.re);
    if (match) {
      const errorValues: ServerErrorValues = {};
      pattern.values.forEach((key, index) => {
        const raw = match[index + 1] ?? "";
        errorValues[key] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
      });
      return { errorCode: pattern.code, errorValues };
    }
  }
  return null;
}

/** Converts a thrown error into a localized-state shape for server actions. */
export function toErrorState(error: unknown): ServerErrorShape {
  if (error instanceof Error) {
    const codeError = error as Error & CodeError;
    if (typeof codeError.code === "string") {
      return {
        errorCode: codeError.code,
        errorValues: codeError.values,
        error: error.message,
      };
    }
    const mapped = errorKeyFor(error.message);
    if (mapped) return { ...mapped, error: error.message };
    return { error: error.message };
  }
  return { error: String(error) };
}
