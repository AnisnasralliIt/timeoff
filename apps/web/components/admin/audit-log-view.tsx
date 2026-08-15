"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight, Eye, Search } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@timeoff/ui";

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  actorNameSnapshot: string | null;
  entityNameSnapshot: string | null;
  employeeId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

interface AuditPage {
  rows: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
}

const KNOWN_ACTIONS = [
  "leaveRequest.create",
  "leaveRequest.approve",
  "leaveRequest.reject",
  "leaveRequest.cancel",
  "user.create",
  "user.update",
  "user.delete",
  "department.create",
  "department.rename",
  "department.delete",
  "leaveType.create",
  "leaveType.archive",
  "leaveType.reactivate",
  "leaveType.delete",
  "leavePolicy.update",
  "balance.adjust",
  "balance.sync",
  "company.settings.update",
  "approvalDelegation.create",
  "approvalDelegation.deactivate",
  "integration.ical.rotate",
  "attachment.delete",
  "export.requests",
];

const KNOWN_ENTITY_TYPES = [
  "User",
  "LeaveRequest",
  "LeaveBalance",
  "Department",
  "LeaveType",
  "LeavePolicy",
  "Company",
  "ApprovalDelegation",
  "Integration",
  "Attachment",
];

/** Maps an action code (e.g. "leaveRequest.create") to its message key ("leaveRequest_create"). */
const actionKey = (action: string) => `actions.${action.replace(/\./g, "_")}`;

/** Prettifies unknown action codes (e.g. "user.offboard" → "User offboard"). */
function prettifyAction(action: string): string {
  const parts = action.split(".").map((p) => p.charAt(0).toUpperCase() + p.slice(1));
  return parts.join(" · ");
}

export function AuditLogView() {
  const t = useTranslations("auditLog");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = React.useState<AuditPage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<AuditRow | null>(null);
  const [searchInput, setSearchInput] = React.useState(searchParams.get("search") ?? "");

  const action = searchParams.get("action") ?? undefined;
  const entityType = searchParams.get("entityType") ?? undefined;
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;
  const page = Number(searchParams.get("page") ?? 1);
  const committedSearch = searchParams.get("search") ?? "";

  const updateParams = React.useCallback(
    (patch: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      if (patch.page) params.set("page", patch.page);
      else params.delete("page");
      for (const [key, value] of Object.entries(patch)) {
        if (key === "page") continue;
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const query = params.toString();
      router.push(query ? `/admin/audit-log?${query}` : "/admin/audit-log");
    },
    [router, searchParams],
  );

  const query = React.useMemo(() => {
    const params = new URLSearchParams();
    const search = committedSearch.trim();
    if (search) params.set("search", search);
    if (action) params.set("action", action);
    if (entityType) params.set("entityType", entityType);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("page", String(page));
    params.set("pageSize", "50");
    return params.toString();
  }, [committedSearch, action, entityType, from, to, page]);

  React.useEffect(() => {
    let cancelled = false;
    setData(null);
    fetch(`/api/audit-log?${query}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { errorCode?: string };
          throw new Error(body.errorCode ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<AuditPage>;
      })
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "unknown");
      });
    return () => {
      cancelled = true;
    };
  }, [query]);

  // Keep the input in sync with the URL (browser back/forward).
  React.useEffect(() => {
    setSearchInput(committedSearch);
  }, [committedSearch]);

  // Debounced search so we don't hammer the API on every keystroke.
  React.useEffect(() => {
    const id = window.setTimeout(() => {
      const next = searchInput.trim();
      if ((searchParams.get("search") ?? "") !== next) {
        updateParams({ search: next || undefined });
      }
    }, 400);
    return () => window.clearTimeout(id);
  }, [searchInput, searchParams, updateParams]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  const renderJson = (value: Record<string, unknown> | null) => {
    if (!value || Object.keys(value).length === 0) return null;
    return (
      <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed text-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t("searchPlaceholder")}
                className="pl-8"
                aria-label={t("searchLabel")}
              />
            </div>
            <Select value={action ?? "all"} onValueChange={(v) => updateParams({ action: v === "all" ? undefined : v })}>
              <SelectTrigger className="w-full sm:w-52">
                <SelectValue placeholder={t("allActions")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allActions")}</SelectItem>
                {KNOWN_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {t.has(actionKey(a)) ? t(actionKey(a)) : prettifyAction(a)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={entityType ?? "all"}
              onValueChange={(v) => updateParams({ entityType: v === "all" ? undefined : v })}
            >
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder={t("allEntities")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allEntities")}</SelectItem>
                {KNOWN_ENTITY_TYPES.map((e) => (
                  <SelectItem key={e} value={e}>
                    {t.has(`entityTypes.${e}`) ? t(`entityTypes.${e}`) : e}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={from ?? ""}
              onChange={(e) => updateParams({ from: e.target.value || undefined })}
              className="w-full sm:w-40"
              aria-label={t("fromLabel")}
            />
            <Input
              type="date"
              value={to ?? ""}
              onChange={(e) => updateParams({ to: e.target.value || undefined })}
              className="w-full sm:w-40"
              aria-label={t("toLabel")}
            />
          </div>

          {data ? (
            <div className="divide-y divide-border">
              {data.rows.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>
              ) : (
                data.rows.map((row) => (
                  <div key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="neutral" className="font-normal">
                          {t.has(actionKey(row.action)) ? t(actionKey(row.action)) : prettifyAction(row.action)}
                        </Badge>
                        <span className="text-sm font-medium text-foreground">
                          {row.actorNameSnapshot ?? t("system")}
                        </span>
                        <span className="text-sm text-muted-foreground">
                          {row.entityNameSnapshot ?? (row.entityType ? (t.has(`entityTypes.${row.entityType}`) ? t(`entityTypes.${row.entityType}`) : row.entityType) : t("noEntity"))}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{dateLabel(row.createdAt)}</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setSelected(row)}>
                      <Eye className="size-3.5" />
                      {t("viewDetails")}
                    </Button>
                  </div>
                ))
              )}
            </div>
          ) : error ? (
            <p className="px-5 py-10 text-center text-sm text-destructive">{t("loadError")}</p>
          ) : (
            <div className="space-y-2 p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}

          {data && data.total > data.pageSize ? (
            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
              <p className="text-sm text-muted-foreground">
                {t("resultCount", { count: data.total })}
              </p>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page <= 1}
                  onClick={() => updateParams({ page: String(data.page - 1) })}
                  aria-label={t("prevPage")}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="px-2 text-sm text-muted-foreground">
                  {t("pageOf", { page: data.page, total: totalPages })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={data.page >= totalPages}
                  onClick={() => updateParams({ page: String(data.page + 1) })}
                  aria-label={t("nextPage")}
                >
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => (open ? undefined : setSelected(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selected
                ? t.has(actionKey(selected.action))
                  ? t(actionKey(selected.action))
                  : prettifyAction(selected.action)
                : ""}
            </DialogTitle>
          </DialogHeader>
          {selected ? (
            <div className="space-y-4 text-sm">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("detailActor")}</dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {selected.actorNameSnapshot ?? t("system")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("detailWhen")}</dt>
                  <dd className="mt-0.5 text-foreground">{dateLabel(selected.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("detailEntity")}</dt>
                  <dd className="mt-0.5 font-medium text-foreground">
                    {selected.entityNameSnapshot ?? t("noEntity")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("detailEntityId")}</dt>
                  <dd className="mt-0.5 break-all font-mono text-xs text-foreground">
                    {selected.entityId ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("detailEmployee")}</dt>
                  <dd className="mt-0.5 text-foreground">{selected.employeeId ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{t("detailIp")}</dt>
                  <dd className="mt-0.5 text-foreground">{selected.ip ?? "—"}</dd>
                </div>
              </dl>
              {renderJson(selected.before) ? (
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{t("detailBefore")}</p>
                  {renderJson(selected.before)}
                </div>
              ) : null}
              {renderJson(selected.after) ? (
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{t("detailAfter")}</p>
                  {renderJson(selected.after)}
                </div>
              ) : null}
              {renderJson(selected.metadata) ? (
                <div>
                  <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">{t("detailMetadata")}</p>
                  {renderJson(selected.metadata)}
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">{t("immutableHint")}</p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
