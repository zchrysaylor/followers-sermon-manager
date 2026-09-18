# Development workflow

## Commands

- `bun run dev:ts` — watch the frontend TypeScript configuration.
- `bun run test` — run `tsc -p tsconfig.api.json`, then `node --test tests/*.test.cjs`.
- `bun run deploy` — deploy to production via `vercel --prod`; run only when production deployment is requested.

See the [root instructions](../../AGENTS.md) for installation and compilation commands.

## Formatting and checks

- Prettier is configured with default settings.
- No ESLint configuration is set up.
- Compile both TypeScript configurations when a change affects shared code.
