# Sermon Manager

TypeScript sermon management app for churches, deployed on Vercel with Cloudflare R2 storage.

## Commands

Package manager: **Bun** (`bun install`).

- `bun run build` — compile frontend and shared TypeScript.
- `bunx tsc -p tsconfig.api.json` — compile API and shared server-side TypeScript separately.
- `bun run test` — compile the API, then run Node's test runner.

Never run `bun run deploy` or `bun run deploy:cloud` proactively. They deploy
directly to production; run one only when the user explicitly asks for a
deployment after confirming the changes have been reviewed and merged.

Never log sensitive data; redact authorization and cookie headers.

## Task-specific guidance

Read the relevant documents for your task:

- [Architecture and TypeScript configurations](.agents/docs/architecture.md)
- [TypeScript conventions and formatting](.agents/docs/typescript.md)
- [Frontend patterns](.agents/docs/frontend.md)
- [API design, security, and uploads](.agents/docs/api-and-security.md)
- [Development, testing, and deployment](.agents/docs/development.md)
