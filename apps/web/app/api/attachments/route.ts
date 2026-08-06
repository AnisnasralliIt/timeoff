import { requireAuth } from "@/lib/session";
import { stageAttachment, AttachmentError, StorageError } from "@/lib/services/attachments";
import { errorKeyFor } from "@/lib/errors";

export const runtime = "nodejs";

/** POST /api/attachments — stages an encrypted attachment (unclaimed yet). */
export async function POST(request: Request) {
  const user = await requireAuth();
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json(
        { error: "No file provided (multipart field `file`).", errorCode: "noFileProvided" },
        { status: 400 },
      );
    }
    const kind = String(form.get("kind") ?? "GENERAL");
    const body = Buffer.from(await file.arrayBuffer());
    const attachment = await stageAttachment(user, {
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      body,
      kind: kind === "MEDICAL_CERTIFICATE" ? "MEDICAL_CERTIFICATE" : "GENERAL",
    });
    return Response.json({
      attachment: {
        id: attachment.id,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        sizeBytes: attachment.sizeBytes,
      },
    });
  } catch (error) {
    if (error instanceof AttachmentError) {
      return Response.json({ error: error.message, ...errorKeyFor(error.message) }, { status: 400 });
    }
    if (error instanceof StorageError) {
      return Response.json(
        { error: "File storage is unavailable right now.", errorCode: "storageUnavailable" },
        { status: 503 },
      );
    }
    throw error;
  }
}
