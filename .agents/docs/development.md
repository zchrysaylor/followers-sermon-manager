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

## Production deployment checklist

The canonical GitHub repository is
`https://github.com/zsaylor/followers-sermon-manager.git`. Before deploying,
fetch its `main` branch and verify that `HEAD` is the same commit as the fetched
`main`. Do not deploy a stale or unmerged commit.

Vercel uses GitHub-specific deployment metadata to display the commit message,
commit hash, and `main` branch in its dashboard. A normal local clone with the
canonical repository configured as its GitHub remote supplies that metadata
automatically. Codex and other ephemeral checkouts may instead have no remote
and may use a temporary branch such as `work`; in that case, generic Git
metadata is not enough for the Vercel dashboard.

When deploying from such an ephemeral checkout, first verify that `HEAD` matches
the canonical `main`, then include the GitHub metadata explicitly:

```sh
git fetch https://github.com/zsaylor/followers-sermon-manager.git main
test "$(git rev-parse HEAD)" = "$(git rev-parse FETCH_HEAD)"

bunx vercel --prod --yes --token="$VERCEL_TOKEN" \
  --meta githubCommitSha="$(git rev-parse HEAD)" \
  --meta githubCommitMessage="$(git log -1 --format=%s)" \
  --meta githubCommitRef=main \
  --meta githubCommitRepo=followers-sermon-manager \
  --meta githubCommitOrg=zsaylor
```

Do not fall back to `bun run deploy:cloud` in an ephemeral checkout without
these metadata arguments: the deployment will work, but its Vercel dashboard
entry will not be linked to the GitHub commit. After deployment, confirm that
Vercel reports the deployment as ready and that the production alias was
assigned.

See the [root instructions](../../AGENTS.md) for installation and compilation commands.

## Formatting and checks

- Prettier is configured with default settings.
- No ESLint configuration is set up.
- Compile both TypeScript configurations when a change affects shared code.
