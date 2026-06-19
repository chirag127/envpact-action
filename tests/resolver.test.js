import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveProject,
  resolveString,
  validateVault,
  upgradeVault,
  entryValue,
  SHARED_PREFIX,
  ENC_PREFIX,
} from '../src/resolver.js';

// ---------------------------------------------------------------
// v3 happy paths
// ---------------------------------------------------------------

const v3 = {
  $schema: 'https://envpact.oriz.in/schema/v3.json',
  version: 3,
  shared: {
    OPENAI_API_KEY: { value: 'sk-xyz', _modified_at: '2026-06-19T10:00:00Z' },
    DB_PASSWORD: { value: 'enc:abcd', _modified_at: '2026-06-19T10:00:00Z' },
  },
  projects: {
    myapp: {
      OPENAI_API_KEY: {
        value: 'shared.OPENAI_API_KEY',
        _modified_at: '2026-06-19T10:00:00Z',
      },
      PORT: { value: '3000', _modified_at: '2026-06-19T10:00:00Z' },
      DATABASE_URL: {
        value: 'postgresql://localhost/myapp',
        _modified_at: '2026-06-19T10:00:00Z',
      },
      MISSING_REF: {
        value: 'shared.NOT_THERE',
        _modified_at: '2026-06-19T10:00:00Z',
      },
      ENC_DIRECT: {
        value: 'enc:zzz',
        _modified_at: '2026-06-19T10:00:00Z',
      },
      DB_PASSWORD: {
        value: 'shared.DB_PASSWORD',
        _modified_at: '2026-06-19T10:00:00Z',
      },
      BAD_SHAPE: 'string-not-object',
    },
  },
  metadata: { updated_at: '2026-06-19T10:00:00Z' },
};

test('resolveProject v3: literals + shared lookup', () => {
  const r = resolveProject(v3, 'myapp');
  assert.equal(r.missing, false);
  assert.equal(r.resolved.PORT, '3000');
  assert.equal(r.resolved.DATABASE_URL, 'postgresql://localhost/myapp');
  assert.equal(r.resolved.OPENAI_API_KEY, 'sk-xyz');
});

test('resolveProject v3: missing shared ref → unresolved', () => {
  const r = resolveProject(v3, 'myapp');
  assert.ok(r.unresolved.includes('MISSING_REF'));
  assert.ok(!('MISSING_REF' in r.resolved));
});

test('resolveProject v3: enc:* (direct + via shared) marked encrypted', () => {
  const r = resolveProject(v3, 'myapp');
  assert.ok(r.encrypted.includes('ENC_DIRECT'));
  assert.ok(r.encrypted.includes('DB_PASSWORD'));
  // Encrypted values pass through to resolved with the enc: prefix
  // so the caller can decide what to do.
  assert.ok(r.resolved.ENC_DIRECT.startsWith(ENC_PREFIX));
  assert.ok(r.resolved.DB_PASSWORD.startsWith(ENC_PREFIX));
});

test('resolveProject v3: malformed entry shape → invalid', () => {
  const r = resolveProject(v3, 'myapp');
  assert.ok(r.invalid.includes('BAD_SHAPE'));
});

test('resolveProject v3: missing project → missing:true', () => {
  const r = resolveProject(v3, 'nope');
  assert.equal(r.missing, true);
  assert.deepEqual(r.resolved, {});
});

// ---------------------------------------------------------------
// resolveString primitives
// ---------------------------------------------------------------

test('resolveString plain literal', () => {
  assert.deepEqual(resolveString('foo', {}), { value: 'foo', status: 'ok' });
});

test('resolveString shared lookup with v3 entry shape', () => {
  const shared = { K: { value: 'val', _modified_at: '2026-06-19T10:00:00Z' } };
  assert.deepEqual(resolveString('shared.K', shared), {
    value: 'val',
    status: 'ok',
  });
});

test('resolveString shared → enc passthrough', () => {
  const shared = {
    K: { value: 'enc:zzz', _modified_at: '2026-06-19T10:00:00Z' },
  };
  assert.deepEqual(resolveString('shared.K', shared), {
    value: 'enc:zzz',
    status: 'encrypted',
  });
});

test('resolveString shared chain rejected (no recursion)', () => {
  const shared = {
    A: { value: 'shared.B', _modified_at: '2026-06-19T10:00:00Z' },
    B: { value: 'val', _modified_at: '2026-06-19T10:00:00Z' },
  };
  assert.deepEqual(resolveString('shared.A', shared), {
    value: null,
    status: 'invalid',
  });
});

test('resolveString unknown shared → unresolved', () => {
  assert.deepEqual(resolveString('shared.NOPE', {}), {
    value: null,
    status: 'unresolved',
  });
});

test('resolveString enc:* literal', () => {
  assert.deepEqual(resolveString('enc:zzz', {}), {
    value: 'enc:zzz',
    status: 'encrypted',
  });
});

// ---------------------------------------------------------------
// validateVault
// ---------------------------------------------------------------

test('validateVault accepts v1/v2/v3', () => {
  validateVault({ version: 1 });
  validateVault({ version: 2 });
  validateVault({ version: 3 });
});

test('validateVault rejects unknown versions', () => {
  assert.throws(() => validateVault({ version: 99 }));
  assert.throws(() => validateVault(null));
  assert.throws(() => validateVault({ version: 3, shared: 42 }));
});

// ---------------------------------------------------------------
// v1/v2 → v3 upgrade equivalence
// ---------------------------------------------------------------

test('upgradeVault v1 (flat strings) → v3', () => {
  // Silence the loud warning during tests.
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const v1 = {
      version: 1,
      shared: { K: 'val' },
      projects: {
        p: { A: 'shared.K', B: 'literal' },
      },
      metadata: { updated_at: '2026-01-01T00:00:00Z' },
    };
    const upgraded = upgradeVault(v1);
    assert.equal(upgraded.version, 3);
    assert.equal(upgraded.shared.K.value, 'val');
    assert.equal(upgraded.projects.p.A.value, 'shared.K');
    assert.equal(upgraded.projects.p.B.value, 'literal');
  } finally {
    console.warn = origWarn;
  }
});

test('upgradeVault v2 (per-env objects) → v3 picks default → production → first', () => {
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const v2 = {
      version: 2,
      shared: { K: 'sv' },
      projects: {
        p: {
          _default_env: 'production',
          A: 'shared.K',
          B: { production: 'pv', development: 'dv' },
          C: { default: 'cv', production: 'unused' },
          D: { staging: 'sv' }, // no default/production → first
          E: { default: '', production: 'pe' }, // empty default → production
        },
      },
    };
    const upgraded = upgradeVault(v2);
    assert.equal(upgraded.version, 3);
    assert.equal(upgraded.shared.K.value, 'sv');
    // _default_env is dropped
    assert.ok(!('_default_env' in upgraded.projects.p));
    assert.equal(upgraded.projects.p.A.value, 'shared.K');
    // production wins for B (no `default` key)
    assert.equal(upgraded.projects.p.B.value, 'pv');
    // default wins for C
    assert.equal(upgraded.projects.p.C.value, 'cv');
    // first non-empty for D
    assert.equal(upgraded.projects.p.D.value, 'sv');
    // empty default falls through to production for E
    assert.equal(upgraded.projects.p.E.value, 'pe');
  } finally {
    console.warn = origWarn;
  }
});

test('upgradeVault: v1 then resolveProject equals hand-written v3', () => {
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const v1 = {
      version: 1,
      shared: { K: 'sv' },
      projects: {
        p: { A: 'shared.K', PORT: '3000' },
      },
      metadata: { updated_at: '2026-01-01T00:00:00Z' },
    };
    const handV3 = {
      version: 3,
      shared: {
        K: { value: 'sv', _modified_at: '2026-01-01T00:00:00Z' },
      },
      projects: {
        p: {
          A: { value: 'shared.K', _modified_at: '2026-01-01T00:00:00Z' },
          PORT: { value: '3000', _modified_at: '2026-01-01T00:00:00Z' },
        },
      },
    };
    const r1 = resolveProject(v1, 'p');
    const r3 = resolveProject(handV3, 'p');
    assert.deepEqual(r1.resolved, r3.resolved);
    assert.deepEqual(r1.unresolved, r3.unresolved);
    assert.deepEqual(r1.invalid, r3.invalid);
    assert.deepEqual(r1.encrypted, r3.encrypted);
    assert.equal(r1.missing, r3.missing);
  } finally {
    console.warn = origWarn;
  }
});

test('upgradeVault v3 input is idempotent', () => {
  const upgraded = upgradeVault(v3);
  assert.equal(upgraded.version, 3);
  assert.equal(upgraded.projects.myapp.PORT.value, '3000');
});

// ---------------------------------------------------------------
// entryValue
// ---------------------------------------------------------------

test('entryValue extracts string or returns null', () => {
  assert.equal(entryValue({ value: 'x', _modified_at: 'T' }), 'x');
  assert.equal(entryValue({ _modified_at: 'T' }), null);
  assert.equal(entryValue('raw'), null);
  assert.equal(entryValue(null), null);
  assert.equal(entryValue([]), null);
});

test('exports SHARED_PREFIX + ENC_PREFIX constants', () => {
  assert.equal(SHARED_PREFIX, 'shared.');
  assert.equal(ENC_PREFIX, 'enc:');
});
