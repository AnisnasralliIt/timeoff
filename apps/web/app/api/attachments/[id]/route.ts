import { getCurrentUser } from "@/lib/session";
import { getAttachmentForDownload, AttachmentError, StorageError } from "@/lib/services/attachments";
import { verifyToken } from "@/lib/crypto";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/attachments/[id] — downloads a decrypted attachment.
 * Access is authenticated (owner, their manager, HR/SUPER_ADMIN) or via a
 * short-lived signed link (`?expires=<ms>&sig=<hmac>`).
 */
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const expires = Number(url.searchParams.get("expires") ?? "0");
  const sig = url.searchParams.get("sig") ?? "";

  const user = await getCurrentUser();
  if (!user && !verifyToken(id, expires, sig)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const download = await getAttachmentForDownload(user, id);
    const filename = encodeURIComponent(download.fileName);
    const body = new Uint8Array(download.body);
    return new Response(body, {
      headers: {
        "Content-Type": download.contentType,
        "Content-Length": String(body.byteLength),
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof AttachmentError) {
      return new Response(error.message, { status: 404 });
    }
    if (error instanceof StorageError) {
      return new Response("File storage is unavailable right now.", { status: 503 });
    }
    throw error;
  }
}
