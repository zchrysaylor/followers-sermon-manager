import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth";
import {
  getSermonsSnapshot,
  putSermons,
  SermonsConflictError,
} from "../lib/r2";
import type { Sermon } from "../shared/types";
import { safeError, safeLog } from "../lib/logger";

function parseJsonBody(req: VercelRequest): any {
  const body: any = (req as any).body;
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return null;
    }
  }
  return body;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  safeLog("UPLOAD_COMPLETE", "Handler started");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = authenticateRequest(req);
  if (!auth.ok) {
    if (auth.status === 429) {
      if (auth.retryAfterSeconds) {
        res.setHeader("Retry-After", String(auth.retryAfterSeconds));
      }
      return res.status(429).json({ error: auth.error });
    }
    return res.status(401).json({ error: auth.error });
  }

  try {
    const body = parseJsonBody(req);
    if (!body) {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    const {
      id,
      title,
      description,
      speaker,
      date,
      durationSeconds,
      audioUrl,
      audioFileSize,
      keywords,
    } = body;

    const required = [
      ["id", id],
      ["title", title],
      ["description", description],
      ["speaker", speaker],
      ["date", date],
      ["durationSeconds", durationSeconds],
      ["audioUrl", audioUrl],
      ["audioFileSize", audioFileSize],
    ] as const;

    for (const [name, value] of required) {
      if (value === undefined || value === null || value === "") {
        return res
          .status(400)
          .json({ error: `Missing required field: ${name}` });
      }
    }

    const duration = Number(durationSeconds);
    if (!Number.isFinite(duration) || duration <= 0) {
      return res.status(400).json({ error: "Invalid durationSeconds" });
    }

    const size = Number(audioFileSize);
    if (!Number.isFinite(size) || size <= 0) {
      return res.status(400).json({ error: "Invalid audioFileSize" });
    }

    const sermon: Sermon = {
      id: String(id),
      title: String(title),
      description: String(description),
      speaker: String(speaker),
      date: String(date),
      audioUrl: String(audioUrl),
      audioFileSize: size,
      durationSeconds: Math.round(duration),
      createdAt: new Date().toISOString(),
      keywords: keywords && Array.isArray(keywords) ? keywords : undefined,
    };

    safeLog("UPLOAD_COMPLETE", "Saving sermon:", sermon.id);
    const { sermons, etag } = await getSermonsSnapshot();
    sermons.unshift(sermon);
    await putSermons(sermons, etag);

    return res.status(200).json(sermon);
  } catch (err: any) {
    if (err instanceof SermonsConflictError) {
      return res.status(409).json({ error: err.message });
    }
    safeError("UPLOAD_COMPLETE", err);
    return res.status(500).json({
      error: "Internal server error",
      details: err?.message || String(err),
    });
  }
}
