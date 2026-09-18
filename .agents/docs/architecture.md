# Architecture

- `src/` — frontend TypeScript, compiled under `public/js/`.
- `api/` — Vercel serverless functions.
- `lib/` — shared server-side utilities.
- `shared/` — TypeScript included in both compilation configurations.
- `public/` — static frontend files.
- `tests/` — Node test runner tests.

## TypeScript configurations

Both configurations enable strict TypeScript and use the project root as `rootDir`:

- `tsconfig.json` — ES2020 modules; includes `src/**/*.ts` and `shared/**/*.ts`; outputs to `public/js/` (preserving source directories).
- `tsconfig.api.json` — CommonJS modules; includes `api/**/*.ts`, `lib/**/*.ts`, and `shared/**/*.ts`; outputs to `dist/`.

The build script only runs the frontend configuration; compile the API separately when changing server-side code.
