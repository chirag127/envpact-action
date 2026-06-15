# AGENTS.md — envpact-action

## Project Context

GitHub Action that fetches the user's envpact vault via the GitHub
Contents API and writes a `.env` file at the start of any CI/CD job.

## Architecture

- Node 20 action (single-file bundled via @vercel/ncc).
- No git clone — uses the GitHub Contents API for read-only vault access.
- Embeds the canonical resolver (bit-for-bit identical to envpact-cli).
- Masks every resolved value via `core.setSecret`.

## Key Files

- `action.yml` — action definition.
- `src/index.js` — entry point.
- `src/resolver.js` — resolver (mirrors CLI).
- `dist/index.js` — ncc-bundled output (MUST be committed).
- `tests/*.test.js` — Node native test runner.

## Conventions

- ESM source, CJS bundle (ncc handles the conversion).
- `dist/` is committed — never `.gitignore` it.
- Update `dist/` whenever `src/` changes (CI enforces).
- Mask every resolved value before any logging.
- Output via `@actions/core` outputs, not stdout.

## Testing

```bash
npm install
npm test
npx ncc build src/index.js -o dist --minify
```

## Security

- The vault PAT (`vault-token`) only needs Contents:Read on the vault repo.
- Resolved values are NEVER logged in plaintext (always set as secret first).
- The action does NOT print `secrets.json` content beyond what the
  user's own .env.example references.
- `sync-github-secrets: true` requires an admin PAT in
  `GH_ADMIN_TOKEN` — different from the read-only `vault-token`.
