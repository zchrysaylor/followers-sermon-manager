# API design and security

## Handlers

- Use Vercel's `VercelRequest` and `VercelResponse` types, imported with `import type`.
- Reject unsupported HTTP methods with status `405` and a structured error response.
- Handle failures with try/catch and return structured JSON error responses with appropriate status codes.
- Use `safeLog`/`safeError` from `lib/logger` for server-side logging, with context identifying the failed operation; do not use the frontend `console.error` pattern.
- Use `authenticateRequest()` from `lib/auth` for protected routes.

## Uploads

- Audio uploads have a maximum size of **200MB**.
- Use presigned URLs for direct-to-R2 uploads to bypass Vercel request size limits.
