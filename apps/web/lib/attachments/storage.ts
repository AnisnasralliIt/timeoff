/**
 * S3-compatible object storage (MinIO in dev). Objects are written already
 * encrypted with AES-256-GCM (`lib/crypto.ts`) so the bucket itself never sees
 * plaintext (I4). The bucket is created lazily on first use.
 */
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

export function isStorageConfigured(): boolean {
  return Boolean(process.env.S3_ENDPOINT && process.env.S3_BUCKET);
}

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    if (!isStorageConfigured()) {
      throw new StorageError("Object storage is not configured.");
    }
    client = new S3Client({
      region: process.env.S3_REGION ?? "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      },
    });
  }
  return client;
}

let bucketReady: Promise<void> | null = null;

/** Ensures the bucket exists (idempotent, cached). */
export async function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      const name = process.env.S3_BUCKET!;
      try {
        await s3().send(new HeadBucketCommand({ Bucket: name }));
      } catch {
        try {
          await s3().send(new CreateBucketCommand({ Bucket: name }));
        } catch (error) {
          // A concurrent create is fine; anything else is a real failure.
          if (!isBucketAlreadyExists(error)) throw error;
        }
      }
    })();
  }
  await bucketReady;
}

function isBucketAlreadyExists(error: unknown): boolean {
  if (error instanceof Error) {
    const name = (error as { name?: string }).name;
    return (
      name === "BucketAlreadyExists" ||
      name === "BucketAlreadyOwnedByYou" ||
      error.message.includes("BucketAlreadyOwnedByYou")
    );
  }
  return false;
}

export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await ensureBucket();
  await s3().send(
    new PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObject(key: string): Promise<{ body: Buffer; contentType: string }> {
  await ensureBucket();
  const result = await s3().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  const body = result.Body ? Buffer.from(await result.Body.transformToByteArray()) : Buffer.alloc(0);
  return { body, contentType: result.ContentType ?? "application/octet-stream" };
}

export async function deleteObject(key: string): Promise<void> {
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
  } catch {
    // Removing a missing object is a no-op for S3; swallow.
  }
}
