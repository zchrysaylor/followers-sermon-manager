import { HeadObjectCommand } from "@aws-sdk/client-s3";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth";
import { safeError } from "../lib/logger";
import {
  BUCKET,
  PUBLIC_URL,
  getSermonsSnapshot,
  putSermons,
  r2,
  SermonsConflictError,
} from "../lib/r2";
import type { Sermon } from "../shared/types";

const MAX_FILE_SIZE = 200 * 1024 * 1024;

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<VercelResponse> {
  if (req.method !== "PUT") {
    res.setHeader("Allow", "PUT");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = authenticateRequest(req);
  if (!auth.ok) {
    if (auth.status === 429 && auth.retryAfterSeconds) {
      res.setHeader("Retry-After", String(auth.retryAfterSeconds));
    }
    return res.status(auth.status).json({ error: auth.error });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  for (const name of ["id", "title", "speaker", "date", "description"]) {
    if (typeof body[name] !== "string" || !body[name].trim()) {
      return res
        .status(400)
        .json({ error: `Missing or invalid field: ${name}` });
    }
  }
  const { id, date, durationSeconds, keywords, audioUrl, audioFileSize } = body;
  // Accept the upload form's calendar date and existing ISO timestamps.
  const day = date.slice(0, 10);
  const parsedDay = new Date(`${day}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      date,
    ) ||
    !Number.isFinite(parsedDay.getTime()) ||
    parsedDay.toISOString().slice(0, 10) !== day ||
    !Number.isFinite(Date.parse(date))
  ) {
    return res.status(400).json({ error: "Invalid date" });
  }
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) {
    return res
      .status(400)
      .json({ error: "Duration must be a positive number of whole seconds" });
  }
  if (
    !Array.isArray(keywords) ||
    keywords.some((tag: unknown) => typeof tag !== "string")
  ) {
    return res.status(400).json({ error: "Tags must be a list of strings" });
  }

  const replacingAudio = audioUrl !== undefined || audioFileSize !== undefined;
  let audioKey: string | undefined;
  if (replacingAudio) {
    const prefix = `${PUBLIC_URL}/sermons/`;
    if (
      typeof audioUrl !== "string" ||
      !audioUrl.startsWith(prefix) ||
      !/^[a-zA-Z0-9_-]+\.mp3$/.test(audioUrl.slice(prefix.length)) ||
      !Number.isSafeInteger(audioFileSize) ||
      audioFileSize <= 0 ||
      audioFileSize > MAX_FILE_SIZE
    ) {
      return res.status(400).json({
        error:
          "Invalid replacement audio. Use an MP3 file no larger than 200MB.",
      });
    }
    audioKey = audioUrl.slice(`${PUBLIC_URL}/`.length);
  }

  try {
    const { sermons, etag } = await getSermonsSnapshot();
    const index = sermons.findIndex((sermon) => sermon.id === id);
    if (index === -1) {
      return res.status(404).json({ error: "Sermon not found" });
    }

    if (audioKey) {
      try {
        const audio = await r2.send(
          new HeadObjectCommand({ Bucket: BUCKET, Key: audioKey }),
        );
        if (
          audio.ContentLength !== audioFileSize ||
          audio.ContentType !== "audio/mpeg"
        ) {
          return res.status(400).json({
            error: "Replacement audio does not match the uploaded file",
          });
        }
      } catch (error: any) {
        if (
          error.$metadata?.httpStatusCode === 404 ||
          error.name === "NotFound" ||
          error.name === "NoSuchKey"
        ) {
          return res.status(400).json({
            error:
              "Replacement audio has not finished uploading. Please try again.",
          });
        }
        throw error;
      }
    }

    const sermon: Sermon = {
      ...sermons[index],
      title: body.title.trim(),
      speaker: body.speaker.trim(),
      date,
      description: body.description.trim(),
      durationSeconds,
      keywords: keywords.map((tag: string) => tag.trim()).filter(Boolean),
      ...(replacingAudio ? { audioUrl, audioFileSize } : {}),
    };
    sermons[index] = sermon;
    await putSermons(sermons, etag);
    // Keep the old audio available for podcast clients with cached feed URLs.
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(sermon);
  } catch (error: any) {
    if (error instanceof SermonsConflictError) {
      return res.status(409).json({ error: error.message });
    }
    safeError("UPDATE_SERMON", error);
    return res
      .status(500)
      .json({ error: "Could not save the sermon. Please try again." });
  }
}
