import type { VercelRequest, VercelResponse } from "@vercel/node";
import Busboy from "busboy";
import { randomUUID } from "crypto";
import { authenticateRequest } from "../lib/auth";
import {
  r2,
  BUCKET,
  getSermonsSnapshot,
  SermonsConflictError,
  putSermons,
  uploadAudio,
  PUBLIC_URL,
} from "../lib/r2";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { Sermon } from "../shared/types";
import { safeLog, safeError } from "../lib/logger";

export const config = {
  api: {
    bodyParser: false,
  },
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  safeLog("UPLOAD", "Handler started");

  if (req.method !== "POST") {
    safeLog("UPLOAD", "Method not allowed:", req.method);
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = authenticateRequest(req);
  if (!auth.ok) {
    safeLog("UPLOAD", "Authentication failed");
    if (auth.status === 429) {
      if (auth.retryAfterSeconds) {
        res.setHeader("Retry-After", String(auth.retryAfterSeconds));
      }
      return res.status(429).json({ error: auth.error });
    }
    return res.status(401).json({ error: auth.error });
  }

  try {
    // Verify R2 connectivity first
    safeLog("UPLOAD", "Verifying R2 connectivity...");
    safeLog("UPLOAD", "R2_BUCKET:", BUCKET);
    safeLog("UPLOAD", "PUBLIC_URL:", PUBLIC_URL);
    try {
      const headCommand = new HeadBucketCommand({ Bucket: BUCKET });
      await r2.send(headCommand);
      safeLog("UPLOAD", "R2 connectivity verified successfully");
    } catch (r2Error: any) {
      safeError("UPLOAD", r2Error);
      return res.status(500).json({
        error: "R2 connectivity failed",
        details: r2Error.message,
        code: r2Error.name,
      });
    }

    const busboy = Busboy({ headers: req.headers });
    const fields: Record<string, string> = {};
    const files: { filename: string; buffer: Buffer; mimetype: string }[] = [];

    safeLog("UPLOAD", "Starting file parsing with Busboy");

    await new Promise<void>((resolve, reject) => {
      let fileCount = 0;
      let bytesReceived = 0;

      busboy.on("file", (name, file, info) => {
        fileCount++;
        safeLog(
          "UPLOAD",
          `Processing file #${fileCount}:`,
          info.filename,
          "Type:",
          info.mimeType,
        );
        const chunks: Buffer[] = [];

        file.on("data", (chunk) => {
          chunks.push(chunk);
          bytesReceived += chunk.length;
          if (bytesReceived % (1024 * 1024) < 16384) {
            // Log every ~1MB
            safeLog(
              "UPLOAD",
              `Received ${(bytesReceived / 1024 / 1024).toFixed(1)} MB so far`,
            );
          }
        });

        file.on("end", () => {
          const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
          safeLog(
            "UPLOAD",
            `File ended, total size: ${totalSize} bytes (${(totalSize / 1024 / 1024).toFixed(1)} MB)`,
          );
          files.push({
            filename: info.filename,
            buffer: Buffer.concat(chunks),
            mimetype: info.mimeType,
          });
        });

        file.on("error", (err) => {
          safeError("UPLOAD_FILE", err);
          reject(err);
        });
      });

      busboy.on("field", (name, value) => {
        safeLog("UPLOAD", `Field received:`, name, "=", value.substring(0, 50));
        fields[name] = value;
      });

      busboy.on("finish", () => {
        safeLog("UPLOAD", "Busboy parsing finished");
        resolve();
      });

      busboy.on("error", (err) => {
        safeError("UPLOAD_BUSBOY", err);
        reject(err);
      });

      safeLog("UPLOAD", "Piping request to Busboy...");
      // Avoid logging sensitive headers (authorization/cookie).
      const safeHeaders = { ...req.headers } as any;
      if (safeHeaders.authorization) safeHeaders.authorization = "[REDACTED]";
      if (safeHeaders.cookie) safeHeaders.cookie = "[REDACTED]";
      safeLog("UPLOAD", "Request headers:", JSON.stringify(safeHeaders));
      if (req.body) {
        safeLog("UPLOAD", "Using req.body (size:", req.body.length, "bytes)");
        busboy.end(req.body);
      } else {
        safeLog("UPLOAD", "Piping stream");
        req.pipe(busboy);
      }
    });

    safeLog(
      "UPLOAD",
      `File parsing complete. Files: ${files.length}, Fields: ${Object.keys(fields).length}`,
    );

    // Validate required fields
    const requiredFields = [
      "title",
      "description",
      "speaker",
      "date",
      "durationSeconds",
    ];
    for (const field of requiredFields) {
      if (!fields[field]) {
        safeLog("UPLOAD", `Missing required field: ${field}`);
        return res
          .status(400)
          .json({ error: `Missing required field: ${field}` });
      }
    }

    if (files.length === 0) {
      safeLog("UPLOAD", "No audio file uploaded");
      return res.status(400).json({ error: "No audio file uploaded" });
    }

    const audioFile = files[0];
    safeLog(
      "UPLOAD",
      `Audio file: ${audioFile.filename}, Type: ${audioFile.mimetype}, Size: ${audioFile.buffer.length} bytes`,
    );

    if (!audioFile.mimetype.startsWith("audio/")) {
      safeLog("UPLOAD", "Invalid file type:", audioFile.mimetype);
      return res.status(400).json({ error: "File must be an audio file" });
    }

    // Check file size (200MB limit)
    const MAX_FILE_SIZE = 200 * 1024 * 1024;
    if (audioFile.buffer.length > MAX_FILE_SIZE) {
      safeLog("UPLOAD", "File too large:", audioFile.buffer.length);
      return res.status(400).json({ error: "File size exceeds 200MB limit" });
    }

    // Generate sermon ID and filename
    const id = randomUUID();
    const slug = slugify(fields.title);
    const filename = `sermons/${fields.date}-${slug}.mp3`;
    safeLog("UPLOAD", "Generated filename:", filename);

    // Upload audio file to R2
    safeLog("UPLOAD", "Starting audio upload to R2...");
    safeLog("UPLOAD", "File size:", audioFile.buffer.length, "bytes");
    try {
      await uploadAudio(filename, audioFile.buffer, audioFile.mimetype);
      safeLog("UPLOAD", "Audio upload completed successfully");
    } catch (uploadErr: any) {
      safeError("UPLOAD_AUDIO", uploadErr);
      throw uploadErr;
    }

    // Create sermon object
    const sermon: Sermon = {
      id,
      title: fields.title,
      description: fields.description,
      speaker: fields.speaker,
      date: fields.date,
      audioUrl: `${PUBLIC_URL}/${filename}`,
      audioFileSize: audioFile.buffer.length,
      durationSeconds: parseInt(fields.durationSeconds, 10),
      createdAt: new Date().toISOString(),
    };
    safeLog("UPLOAD", "Created sermon object:", sermon.id);

    // Read current sermons, add new one, and save
    safeLog("UPLOAD", "Fetching existing sermons...");
    let sermons: Sermon[];
    let etag: string | null;
    try {
      ({ sermons, etag } = await getSermonsSnapshot());
      safeLog("UPLOAD", "Found", sermons.length, "existing sermons");
    } catch (getErr: any) {
      safeError("UPLOAD_GETSERMONS", getErr);
      throw getErr;
    }

    sermons.unshift(sermon); // Add to beginning (newest first)
    safeLog("UPLOAD", "Saving sermons list...");
    try {
      await putSermons(sermons, etag);
      safeLog("UPLOAD", "Sermons saved successfully");
    } catch (putErr: any) {
      safeError("UPLOAD_PUTSERMONS", putErr);
      throw putErr;
    }

    safeLog("UPLOAD", "Upload completed successfully");
    return res.status(200).json(sermon);
  } catch (error: any) {
    if (error instanceof SermonsConflictError) {
      return res.status(409).json({ error: error.message });
    }
    safeError("UPLOAD", error);
    return res.status(500).json({
      error: "Internal server error",
      details: error.message || String(error),
      code: error.code || error.name || "UNKNOWN",
    });
  }
}
