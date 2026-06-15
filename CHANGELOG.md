# Changelog

## [Unreleased]

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

> Note: `dist/index.js` (the bundled artifact GitHub Actions consumes)
> is **not** rebuilt in this entry. Bundling is handled at release time
> when v0.2.0 is tagged.

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

[0.1.0]: https://github.com/chirag127/envpact-action/releases/tag/v0.1.0
