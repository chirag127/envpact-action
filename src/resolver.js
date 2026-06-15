/**
 * envpact resolver — embedded copy from envpact-cli/lib/resolver.js,
 * ESM-converted for the Node 20 action runtime.
 *
 * Bit-for-bit identical to the canonical implementation. See
 * SHARED_SPEC.md §1.
 */

export const SHARED_PREFIX = 'shared.';
export const ENC_PREFIX = 'enc:';

export function validateVault(vault) {
  if (!vault || typeof vault !== 'object') {
    throw new Error('Vault must be a JSON object');
  }
  if (vault.version !== 2 && vault.version !== 1) {
    throw new Error(`Unsupported vault version: ${vault.version}. Expected 1 or 2.`);
  }
  if (vault.shared && typeof vault.shared !== 'object') {
    throw new Error('vault.shared must be an object');
  }
  if (vault.projects && typeof vault.projects !== 'object') {
    throw new Error('vault.projects must be an object');
  }
}

export function resolveString(rawValue, shared) {
  if (typeof rawValue !== 'string') return { value: null, status: 'invalid' };
  if (rawValue.startsWith(ENC_PREFIX)) return { value: rawValue, status: 'encrypted' };
  if (rawValue.startsWith(SHARED_PREFIX)) {
    const k = rawValue.slice(SHARED_PREFIX.length);
    if (!shared || !(k in shared)) return { value: null, status: 'unresolved' };
    const v = shared[k];
    if (typeof v !== 'string') return { value: null, status: 'invalid' };
    if (v.startsWith(ENC_PREFIX)) return { value: v, status: 'encrypted' };
    return { value: v, status: 'ok' };
  }
  return { value: rawValue, status: 'ok' };
}

export function resolveProject(vault, projectName, environment) {
  validateVault(vault);
  const project = (vault.projects || {})[projectName];
  if (!project) {
    return { resolved: {}, unresolved: [], invalid: [], encrypted: [], environment: environment || 'default', missing: true };
  }
  const effectiveEnv = environment || project._default_env || 'default';
  const resolved = {};
  const unresolved = [];
  const invalid = [];
  const encrypted = [];
  const shared = vault.shared || {};
  for (const [key, raw] of Object.entries(project)) {
    if (key.startsWith('_')) continue;
    let candidate;
    if (typeof raw === 'string') candidate = raw;
    else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      if (effectiveEnv in raw) candidate = raw[effectiveEnv];
      else if ('default' in raw) candidate = raw.default;
      else { unresolved.push(key); continue; }
    } else { invalid.push(key); continue; }
    const r = resolveString(candidate, shared);
    if (r.status === 'ok') resolved[key] = r.value;
    else if (r.status === 'encrypted') { resolved[key] = r.value; encrypted.push(key); }
    else if (r.status === 'unresolved') unresolved.push(key);
    else invalid.push(key);
  }
  return { resolved, unresolved, invalid, encrypted, environment: effectiveEnv, missing: false };
}
