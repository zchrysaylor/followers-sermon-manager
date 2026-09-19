# Development workflow

## Commands

- `bun run dev:ts` — watch the frontend TypeScript configuration.
- `bun run test` — run `tsc -p tsconfig.api.json`, then `node --test tests/*.test.cjs`.
- `bun run deploy` — deploy a linked, authenticated local checkout to production.
- `bun run deploy:cloud` — deploy non-interactively from Codex Cloud using `VERCEL_TOKEN`, `VERCEL_ORG_ID`, and `VERCEL_PROJECT_ID`.

Both deployment commands update production because this project has no staging
environment. Run either command only when the user explicitly requests a
production deployment. Never print deployment credentials or add them to the
repository.

See the [root instructions](../../AGENTS.md) for installation and compilation commands.

## Formatting and checks

- Prettier is configured with default settings.
- No ESLint configuration is set up.
- Compile both TypeScript configurations when a change affects shared code.
