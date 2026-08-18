-- Archive the system Sick Leave type: it is no longer an active system type.
-- Historical LeaveRequest and LeaveBalance rows referencing this type are
-- preserved; isArchived prevents it from appearing in new-request selection.
UPDATE "LeaveType" SET "isArchived" = true WHERE name = 'Sick Leave' AND "isSystem" = true;
