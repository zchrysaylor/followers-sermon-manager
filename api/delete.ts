import type { VercelRequest, VercelResponse } from "@vercel/node";
import { authenticateRequest } from "../lib/auth";
import {
  getSermonsSnapshot,
  putSermons,
  deleteAudio,
  PUBLIC_URL,
  SermonsConflictError,
} from "../lib/r2";
import { safeError } from "../lib/logger";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "DELETE") {
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
    const { id } = req.body;

    if (!id) {
      return res.status(400).json({ error: "Missing sermon ID" });
    }

    const { sermons, etag } = await getSermonsSnapshot();
    const sermonIndex = sermons.findIndex((s) => s.id === id);

    if (sermonIndex === -1) {
      return res.status(404).json({ error: "Sermon not found" });
    }

    const sermon = sermons[sermonIndex];

    // Extract the key from the audio URL
    const audioKey = sermon.audioUrl.replace(`${PUBLIC_URL}/`, "");

    // Remove sermon from array
    sermons.splice(sermonIndex, 1);

    // Save updated sermons.json
    await putSermons(sermons, etag);

    // Only remove audio after the metadata deletion succeeds. A conflict must
    // leave the still-published sermon playable.
    try {
      await deleteAudio(audioKey);
    } catch (error: unknown) {
      safeError("DELETE_SERMON_AUDIO", error);
    }

    return res.status(200).json({ message: "Sermon deleted successfully" });
  } catch (error: any) {
    if (error instanceof SermonsConflictError) {
      return res.status(409).json({ error: error.message });
    }
    safeError("DELETE_SERMON", error);
    return res
      .status(500)
      .json({ error: "Internal server error", details: error.message });
  }
}
