/**
 * envpact resolver — embedded port of envpact-cli/lib/resolver.js for
 * the Node 20 GitHub Actions runtime. ESM. NOT a workspace import:
 * each component carries its own copy so the bundled action is
 * self-contained.
 *
 * v3 schema (flat, single-environment, per-key timestamped):
 *
 *   shared.<KEY>          = { value: string, _modified_at: ISO }
 *   projects.<NAME>.<KEY> = { value: string, _modified_at: ISO }
 *
 * The `value` field can be:
 *   - a plain literal       ("3000", "postgres://…")
 *   - a shared.KEY pointer  ("shared.OPENAI_API_KEY")
 *   - an encrypted blob     ("enc:<base64>")
 *
 * v1 (flat string values, no timestamps) and v2 (per-environment
 * objects + `_default_env`) vaults are auto-upgraded in memory by
 * `upgradeVault()` so resolution is uniform. See SHARED_SPEC §1.4.
 *
 * This action runtime carries no decryption keys, so callers refuse
 * to materialize `enc:*` values — see AUDIT #6 in src/index.js.
 */

export const SHARED_PREFIX = 'shared.';
export const ENC_PREFIX = 'enc:';

// ---------------------------------------------------------------
// Validation
// ---------------------------------------------------------------

/**
 * Accept v1, v2, or v3. v1/v2 callers MUST upgrade in memory before
 * doing further work (resolveProject calls upgradeVault for them).
 */
export function validateVault(vault) {
  if (!vault || typeof vault !== 'object') {
    throw new Error('Vault must be a JSON object');
  }
  if (vault.version !== 1 && vault.version !== 2 && vault.version !== 3) {
    throw new Error(
      `Unsupported vault version: ${vault.version}. Expected 1, 2, or 3.`
    );
  }
  if (vault.shared && typeof vault.shared !== 'object') {
    throw new Error('vault.shared must be an object');
  }
  if (vault.projects && typeof vault.projects !== 'object') {
    throw new Error('vault.projects must be an object');
  }
}

// ---------------------------------------------------------------
// v1/v2 → v3 in-memory upgrade
// ---------------------------------------------------------------

/**
 * Pick a single string from a v2 per-environment object using the
 * spec §1.4 priority: default → production → first non-empty value.
 */
function pickFlatValue(envObj) {
  if (typeof envObj.default === 'string' && envObj.default.length > 0) {
    return envObj.default;
  }
  if (typeof envObj.production === 'string' && envObj.production.length > 0) {
    return envObj.production;
  }
  for (const v of Object.values(envObj)) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

/**
 * Lossy upgrade of a v1 or v2 vault to a v3 in-memory shape.
 * Idempotent: a v3 input is returned with defensive `_modified_at`
 * fills, but otherwise unchanged. Pure function — does not mutate
 * the input.
 *
 * Logs a single loud warning on actual upgrade so users notice the
 * irreversible flattening of per-environment values.
 */
export function upgradeVault(vault) {
  if (!vault || typeof vault !== 'object') {
    throw new Error('Vault must be a JSON object');
  }
  const incomingVersion = vault.version;
  if (incomingVersion === 3) {
    return normaliseV3(vault);
  }
  if (incomingVersion !== 1 && incomingVersion !== 2) {
    throw new Error(
      `Unsupported vault version: ${incomingVersion}. Expected 1, 2, or 3.`
    );
  }

  // eslint-disable-next-line no-console
  console.warn(
    `envpact: upgrading vault from v${incomingVersion} → v3. ` +
      'Per-environment values will be flattened. Backup at ' +
      "pre-v3-migration branch (if you didn't make one, abort now)."
  );

  const now = new Date().toISOString();
  const baseTs = (vault.metadata && vault.metadata.updated_at) || now;
  const out = {
    $schema: 'https://envpact.oriz.in/schema/v3.json',
    version: 3,
    shared: {},
    projects: {},
    metadata: {
      ...(vault.metadata || {}),
      updated_at: now,
    },
  };

  for (const [k, raw] of Object.entries(vault.shared || {})) {
    if (typeof raw === 'string') {
      out.shared[k] = { value: raw, _modified_at: baseTs };
    } else if (
      raw &&
      typeof raw === 'object' &&
      typeof raw.value === 'string'
    ) {
      out.shared[k] = {
        value: raw.value,
        _modified_at: raw._modified_at || baseTs,
      };
    }
  }

  for (const [pname, project] of Object.entries(vault.projects || {})) {
    if (!project || typeof project !== 'object') continue;
    out.projects[pname] = {};
    for (const [key, raw] of Object.entries(project)) {
      if (key.startsWith('_')) continue; // drop _default_env etc.
      if (typeof raw === 'string') {
        out.projects[pname][key] = { value: raw, _modified_at: baseTs };
      } else if (
        raw &&
        typeof raw === 'object' &&
        typeof raw.value === 'string' &&
        !Array.isArray(raw)
      ) {
        // Pre-shaped v3 entry that snuck into a v1/v2 file.
        out.projects[pname][key] = {
          value: raw.value,
          _modified_at: raw._modified_at || baseTs,
        };
      } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        // v2 per-env object → flatten by §1.4 priority.
        const picked = pickFlatValue(raw);
        if (picked) {
          out.projects[pname][key] = {
            value: picked,
            _modified_at: baseTs,
          };
        }
      }
    }
  }

  return out;
}

/**
 * Normalise a v3 vault: ensure every leaf has a `value` string and
 * `_modified_at`. Defensive no-op for clean files; a malformed leaf
 * is preserved as-is so the resolver flags it as INVALID.
 */
function normaliseV3(vault) {
  const out = {
    ...vault,
    shared: {},
    projects: {},
  };
  const now = new Date().toISOString();
  for (const [k, v] of Object.entries(vault.shared || {})) {
    if (v && typeof v === 'object' && typeof v.value === 'string') {
      out.shared[k] = {
        value: v.value,
        _modified_at: v._modified_at || now,
      };
    } else {
      out.shared[k] = v;
    }
  }
  for (const [pname, proj] of Object.entries(vault.projects || {})) {
    out.projects[pname] = {};
    for (const [key, raw] of Object.entries(proj || {})) {
      if (key.startsWith('_')) continue;
      if (raw && typeof raw === 'object' && typeof raw.value === 'string') {
        out.projects[pname][key] = {
          value: raw.value,
          _modified_at: raw._modified_at || now,
        };
      } else {
        out.projects[pname][key] = raw;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------

/**
 * Pull the string `value` out of a v3 entry object, or return null
 * if the entry is malformed.
 */
export function entryValue(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  if (typeof entry.value !== 'string') return null;
  return entry.value;
}

/**
 * Resolve a single string value (already extracted from an entry):
 * follow shared.* references one level, pass enc:* through.
 *
 * `shared` is the v3 shared block (entry-shaped).
 */
export function resolveString(rawValue, shared) {
  if (typeof rawValue !== 'string') {
    return { value: null, status: 'invalid' };
  }
  if (rawValue.startsWith(ENC_PREFIX)) {
    return { value: rawValue, status: 'encrypted' };
  }
  if (rawValue.startsWith(SHARED_PREFIX)) {
    const sharedKey = rawValue.slice(SHARED_PREFIX.length);
    if (!sharedKey) return { value: null, status: 'invalid' };
    if (!shared || !(sharedKey in shared)) {
      return { value: null, status: 'unresolved' };
    }
    const sharedEntry = shared[sharedKey];
    const sharedVal = entryValue(sharedEntry);
    if (sharedVal === null) return { value: null, status: 'invalid' };
    // No recursion: a shared entry whose value is itself a
    // shared.* reference is malformed. (Spec §1.2 step 2.iv.)
    if (sharedVal.startsWith(SHARED_PREFIX)) {
      return { value: null, status: 'invalid' };
    }
    if (sharedVal.startsWith(ENC_PREFIX)) {
      return { value: sharedVal, status: 'encrypted' };
    }
    return { value: sharedVal, status: 'ok' };
  }
  return { value: rawValue, status: 'ok' };
}

/**
 * Resolve every key in a project. See SHARED_SPEC §1.2.
 *
 * v3 has NO `environment` parameter. Callers that previously
 * passed one (envpact-action ≤ 0.2.x) must drop it; the value is
 * silently ignored if supplied.
 *
 * Accepts v1/v2/v3 vaults — auto-upgrades v1/v2 in memory.
 */
export function resolveProject(vault, projectName) {
  validateVault(vault);
  const upgraded = upgradeVault(vault);

  const project = (upgraded.projects || {})[projectName];
  if (!project) {
    return {
      resolved: {},
      unresolved: [],
      invalid: [],
      encrypted: [],
      missing: true,
    };
  }

  const resolved = {};
  const unresolved = [];
  const invalid = [];
  const encrypted = [];
  const shared = upgraded.shared || {};

  for (const [key, entry] of Object.entries(project)) {
    if (key.startsWith('_')) continue;
    const raw = entryValue(entry);
    if (raw === null) {
      invalid.push(key);
      continue;
    }
    const r = resolveString(raw, shared);
    if (r.status === 'ok') {
      resolved[key] = r.value;
    } else if (r.status === 'encrypted') {
      resolved[key] = r.value;
      encrypted.push(key);
    } else if (r.status === 'unresolved') {
      unresolved.push(key);
    } else {
      invalid.push(key);
    }
  }

  return { resolved, unresolved, invalid, encrypted, missing: false };
}
