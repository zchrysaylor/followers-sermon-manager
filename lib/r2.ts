import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Sermon, SermonsData } from "../shared/types";

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export const BUCKET = process.env.R2_BUCKET_NAME!;
export const PUBLIC_URL = process.env.R2_PUBLIC_URL!;

export async function getSermons(): Promise<Sermon[]> {
  return (await getSermonsSnapshot()).sermons;
}

export async function getSermonsSnapshot(): Promise<{
  sermons: Sermon[];
  etag: string | null;
}> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: "sermons.json",
    });
    const response = await r2.send(command);
    const body = await response.Body?.transformToString();
    const data: SermonsData = body ? JSON.parse(body) : { sermons: [] };
    // R2 supplies the object version as an ETag. Never write unconditionally.
    if (!response.ETag) throw new Error("Missing sermons ETag");
    return { sermons: data.sermons || [], etag: response.ETag };
  } catch (error: any) {
    if (error.name === "NoSuchKey") {
      return { sermons: [], etag: null };
    }
    throw error;
  }
}

export class SermonsConflictError extends Error {
  constructor() {
    super("Sermons changed while saving. Please try again.");
    this.name = "SermonsConflictError";
  }
}

export async function putSermons(
  sermons: Sermon[],
  etag: string | null,
): Promise<void> {
  const data: SermonsData = { sermons };
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: "sermons.json",
    Body: JSON.stringify(data, null, 2),
    ContentType: "application/json",
    ...(etag === null ? { IfNoneMatch: "*" } : { IfMatch: etag }),
  });
  try {
    await r2.send(command);
  } catch (error: any) {
    if (
      error.$metadata?.httpStatusCode === 412 ||
      error.name === "PreconditionFailed"
    ) {
      throw new SermonsConflictError();
    }
    throw error;
  }
}

export async function uploadAudio(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await r2.send(command);
}

export async function createPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds: number = 10 * 60,
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(r2, command, { expiresIn: expiresInSeconds });
}

export async function deleteAudio(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });
  await r2.send(command);
}

export async function getPodcastMeta(): Promise<any> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: "podcastMeta.json",
    });
    const response = await r2.send(command);
    const body = await response.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body);
  } catch (error: any) {
    if (error.name === "NoSuchKey") {
      return null;
    }
    throw error;
  }
}
