# AGENTS.md — envpact-action

## Project Context

GitHub Action that fetches the user's envpact vault via the GitHub
Contents API and writes a `.env` file at the start of any CI/CD job.

Part of the envpact ecosystem (centralized, serverless secrets manager
for solo developers managing many public GitHub repos).

## Architecture

- Vault: private GitHub repo with `secrets.json` (v3 schema, flat,
  one environment per project, per-key timestamps for conflict
  detection).
- Resolver: `shared.KEY` references, no nested per-env objects.
  v1/v2 vaults auto-upgrade in memory per SHARED_SPEC §1.4.
- Node 20 action (single-file bundled via `@vercel/ncc`).
- No git clone — uses the GitHub Contents API for read-only vault
  access.
- Embeds the canonical resolver (mirrors `envpact-cli/lib/resolver.js`
  bit-for-bit, ESM-converted).
- Masks every resolved value via `core.setSecret` BEFORE the first
  `fs.writeFileSync`.

## Key Files

- `action.yml` — public input/output surface.
- `src/index.js` — entry point. No `environment` input read since
  v0.3.0.
- `src/resolver.js` — embedded resolver port (v3 + auto-upgrade).
- `dist/index.js` — `ncc`-bundled output (MUST be committed; CI
  enforces `git diff --quiet dist/`).
- `tests/index.test.js` — covers AUDIT #3 ordering invariant and
  AUDIT #6 enc:* fail-fast paths.
- `tests/resolver.test.js` — v3 happy paths + v1/v2 upgrade
  equivalence.
- `scripts/test.mjs` — cross-platform Node test runner used by
  `pnpm test`.

## Conventions

- ESM source, ESM bundle (ncc handles the wiring).
- `dist/` is committed — never `.gitignore` it.
- Update `dist/` whenever `src/` changes (CI enforces).
- Mask every resolved value before any logging or file write.
- Output via `@actions/core` outputs, not stdout.
- Two runtime deps allowed: `@actions/core` and `@actions/exec`.
- Cross-platform paths (`path.join`).
- Atomic file writes (`.tmp` then `rename` is not needed here since
  the action writes once per run, but mode `0600` is enforced).
- All commits signed-off (`-s`).

## Testing

```bash
pnpm install
pnpm test
pnpm run build
```

CI runs `pnpm test` then `pnpm run build` and fails if `dist/` is
out of sync with `src/`.

## Security

- The vault PAT (`vault-token`) only needs Contents:Read on the
  vault repo.
- Resolved values are NEVER logged in plaintext (always set as
  secret first — AUDIT #3 ordering invariant pinned by tests).
- Encrypted (`enc:*`) values abort the run via `core.setFailed(...)`
  before any side effect (AUDIT #6).
- The action does NOT print `secrets.json` content beyond what the
  user's own `.env.example` references.
- `sync-github-secrets: true` requires an admin PAT in
  `GH_ADMIN_TOKEN` — different from the read-only `vault-token`.
