# envpact-action — documentation

> GitHub Action for envpact: pull secrets from your vault into a CI
> runner's environment, on every workflow run. Lets your CI use the
> same vault your local machine uses without copy-pasting tokens
> into GitHub Actions Secrets one project at a time.

## Use

```yaml
# .github/workflows/build.yml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Pull secrets from envpact vault
        uses: chirag127/envpact-action@v1
        with:
          # Path to your vault repo. Defaults to <repo-owner>/envpact-secrets.
          vault: ${{ github.repository_owner }}/envpact-secrets
          # Which environment to pull. default | development | staging | production | <custom>
          environment: production
          # PAT with read access to the private vault repo.
          # Store as repo secret VAULT_PAT or org secret.
          token: ${{ secrets.VAULT_PAT }}

      - run: npm test
        # Every key from your vault is now in env. Your test step sees
        # OPENAI_API_KEY, DATABASE_URL, etc. as if they were defined
        # locally.
```

## Inputs

| Input | Required | Default | Purpose |
| :--- | :--- | :--- | :--- |
| `vault` | yes | — | `<owner>/<repo>` of your private envpact vault |
| `token` | yes | — | PAT with `repo` scope, can read `vault` |
| `environment` | no | `default` | Which env slot to resolve |
| `project` | no | `${{ github.repository }}` | Which vault project to resolve |
| `mask` | no | `true` | Whether to register every value with `::add-mask::` so it's redacted in logs |

## Outputs

This action sets one output:

| Output | Value |
| :--- | :--- |
| `keys` | Comma-separated list of keys that were exported. Use it for sanity-checking in a follow-up step. |

## Auth model

The Action does not embed any credentials. **You** provide a PAT via
`with.token`, scoped to your vault repo. Best practice:

1. Create a fine-grained PAT scoped to **only** `<you>/envpact-secrets` with `Contents: read` permission.
2. Store it as a repository or organization secret named `VAULT_PAT`.
3. Reference it in the workflow as `${{ secrets.VAULT_PAT }}`.

The PAT never leaves the runner. Every secret value gets registered
with GitHub Actions' `::add-mask::` directive before any subsequent
log output, so values don't accidentally leak through `set -x`,
debug logs, or stack traces.

## Failure modes

| Failure | Cause |
| :--- | :--- |
| `Repository not found` | PAT can't see `vault`. Double-check scope and the repo name. |
| `KEY_NOT_IN_VAULT: FOO` | `.env.example` declares `FOO` but vault doesn't have it. Add it via `envpact-cli add-shared FOO ...`. |
| `decryption unsupported` | Vault has age-encrypted entries; Action runners can't decrypt these. Set the values in plaintext, or run a self-hosted runner with the age key. |

## See also

- [Umbrella docs](https://chirag127.github.io/envpact/) — project overview, security model
- [envpact-cli](https://github.com/chirag127/envpact-cli) — generate your vault locally
