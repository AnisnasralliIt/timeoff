import { buildIcs, getApprovedRequestsForFeed, verifyFeedToken } from "@/lib/services/integrations";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
): Promise<Response> {
  const { userId } = await context.params;
  const url = new URL(_request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token || !(await verifyFeedToken(userId, token))) {
    return new Response("Forbidden", { status: 403 });
  }
  const requests = await getApprovedRequestsForFeed(userId);
  const body = buildIcs(requests);
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Disposition": 'attachment; filename="timeoff-leave.ics"',
    },
  });
}
