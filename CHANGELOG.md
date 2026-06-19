# Changelog

All notable changes to this project are documented here. Format
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
this project adheres to [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-06-19

### Added

- **IST timestamp rendering in log output (per spec §1.5).** The
  vault's `metadata.updated_at` is now logged as
  `<UTC> (<YYYY-MM-DD HH:MM:SS IST>)` so a human reading the workflow
  log can correlate the vault timestamp with the local engineering
  wall-clock without doing TZ math. The vault on-disk format is
  unchanged — `_modified_at` is still stored as canonical ISO-8601
  UTC. **No behavioural change** to resolution, masking, or
  `.env` writing — purely a log readability improvement.
- New `src/timestamps.js` (ESM) exporting `formatTimestamp(iso)` and
  `formatTimestampInline(iso)`. Mirrors `envpact-cli/lib/timestamps.js`
  bit-for-bit modulo ESM packaging.
- `tests/timestamps.test.js` — host-TZ-independent IST format tests
  (the load-bearing one runs with `process.env.TZ='America/Los_Angeles'`
  to prove the formatter ignores host TZ).

### Internal

- Zero new runtime dependencies — `Intl.DateTimeFormat` is stdlib.
- `dist/index.js` rebuilt via `@vercel/ncc`.

## [0.3.0] - 2026-06-19

### Changed (BREAKING)

- **Vault schema bumped to v3.** Project secrets are now flat,
  single-environment, and per-key timestamped. The `environment`
  action input is **removed**; it has no meaning under v3. Workflows
  that pass `environment:` will need to drop the line. v1 and v2
  vaults are auto-upgraded in memory on every run per
  [SHARED_SPEC §1.4](https://github.com/chirag127/envpact/blob/main/_build/specs/SHARED_SPEC.md):
  - v2 per-environment objects collapse to a single value with
    priority `default` → `production` → first non-empty.
  - v1 flat-string entries get wrapped into the v3
    `{value, _modified_at}` shape.
  - The on-disk vault is **not** rewritten by the action; only
    explicit pushes through CLI/MCP/VS Code do that.
- **`# environment:` header line removed** from generated `.env`
  files. Only `# project:` is emitted now.

### Migration from 0.2.x

```diff
   - uses: chirag127/envpact-action@v0
     with:
       vault-repo: chirag127/envpact-secrets
       vault-token: ${{ secrets.ENVPACT_VAULT_TOKEN }}
-      environment: production
       export-to-env: true
```

If your vault still has v2 per-environment objects, the action will
print a one-time `envpact: upgrading vault from v2 → v3 …` warning
and pick the `default` (or `production`) value per key. Run
`envpact --help` to migrate the on-disk vault permanently.

### Preserved

- AUDIT #6 fail-fast: `enc:*` values still abort the run via
  `core.setFailed(...)` before any side effect.
- AUDIT #3 ordering invariant: `core.setSecret(v)` for every resolved
  value runs before the first `fs.writeFileSync(...)`. Pinned by
  `tests/index.test.js`.

### Internal

- `src/resolver.js` rewritten to mirror `envpact-cli/lib/resolver.js`
  (v3) and `envpact-mcp/src/lib/resolver.js` (ESM): adds
  `upgradeVault`, `entryValue`, `validateVault` exports and drops the
  `environment` parameter from `resolveProject`.
- `dist/index.js` rebuilt via `@vercel/ncc` (483 KB).

## [0.2.0]

### Changed (BREAKING but correct)

- **AUDIT #6**: The action now refuses to materialize encrypted (`enc:*`)
  values. Previously, an `enc:*` literal — whether sitting directly on a
  project key or reached via `shared.*` indirection — would be written
  verbatim into the generated `.env`, exported via `core.exportVariable`,
  and synced through `gh secret set`, silently breaking every downstream
  consumer that expected the cleartext. The runtime carries no decryption
  keys, so this was never recoverable at runtime. The action now calls
  `core.setFailed(...)` naming the offending keys and pointing operators
  at `envpact-cli` (e.g. `envpact decrypt`) BEFORE any side effect
  (`fs.writeFileSync`, `core.exportVariable`, `setRepoSecret`). Vaults
  that ship encrypted values will need to be decrypted via the CLI before
  the action will run cleanly.

### Refactored

- **AUDIT #3**: `src/index.js` now exports `run({core, fs, fetchVault,
  setRepoSecret})` with sensible production defaults so tests can inject
  mocks without monkey-patching modules. Pure helpers `buildEnvFile()`
  and `maskAll()` are exported. The bottom-of-module invocation is now
  gated on an `isMain` check so importing the module from tests does not
  fire the action. Adds `tests/index.test.js` covering the masking
  ordering invariant (`setSecret` before `fs.writeFileSync`) and the
  AUDIT #6 fail-fast paths (direct `enc:`, `shared.*` -> `enc:`, no
  side effects when failure fires).

## [0.1.0] - 2026-06-15

### Added

- Initial release of `envpact-action`.
- Fetches vault via GitHub Contents API (no full clone needed).
- All 8 inputs from spec: vault-repo, vault-token, project-name,
  environment, output-file, env-example, export-to-env,
  sync-github-secrets.
- Outputs: resolved-count, env-file-path, unresolved-keys.
- Auto-masks every resolved value via `core.setSecret()`.
- Bundled as Node 20 action via @vercel/ncc.
- Bit-for-bit identical resolver semantics with envpact-cli.

[0.4.0]: https://github.com/chirag127/envpact-action/releases/tag/v0.4.0
[0.3.0]: https://github.com/chirag127/envpact-action/releases/tag/v0.3.0
[0.2.0]: https://github.com/chirag127/envpact-action/releases/tag/v0.2.0
[0.1.0]: https://github.com/chirag127/envpact-action/releases/tag/v0.1.0
