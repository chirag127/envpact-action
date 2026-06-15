# Changelog

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
