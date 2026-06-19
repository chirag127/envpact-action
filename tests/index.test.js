import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, buildEnvFile, maskAll } from '../src/index.js';

/**
 * Build a stub @actions/core implementation for tests. Tracks every
 * setSecret / setFailed / setOutput call so we can assert ordering and
 * failure semantics.
 */
function makeCore(inputs = {}) {
  const calls = [];
  return {
    _calls: calls,
    _failed: null,
    _outputs: {},
    _vars: {},
    getInput(name) {
      return inputs[name] ?? '';
    },
    info() {},
    warning() {},
    setSecret(v) {
      calls.push({ kind: 'setSecret', value: v });
    },
    exportVariable(k, v) {
      this._vars[k] = v;
    },
    setFailed(msg) {
      this._failed = msg;
    },
    setOutput(k, v) {
      this._outputs[k] = v;
    },
  };
}

function makeFs(calls) {
  return {
    existsSync() {
      return false; // no .env.example
    },
    readFileSync() {
      return '';
    },
    writeFileSync(file, body) {
      calls.push({ kind: 'writeFileSync', file, body });
    },
  };
}

const baseInputs = {
  'vault-repo': 'org/vault',
  'vault-token': 'tok',
  'project-name': 'myproj',
  'output-file': '.env',
  'env-example': '.env.example',
  'export-to-env': 'false',
  'sync-github-secrets': 'false',
};

// Silence the loud upgrade warning during tests.
const origWarn = console.warn;
console.warn = () => {};

// Build a v3 vault matching a flat-string v2 input so equivalence
// tests can compare hand-written vs auto-upgraded outcomes.
function v3Of(projects, shared = {}) {
  const ts = '2026-06-19T10:00:00Z';
  const wrapEntry = (val) => ({ value: val, _modified_at: ts });
  return {
    $schema: 'https://envpact.oriz.in/schema/v3.json',
    version: 3,
    shared: Object.fromEntries(
      Object.entries(shared).map(([k, v]) => [k, wrapEntry(v)])
    ),
    projects: Object.fromEntries(
      Object.entries(projects).map(([p, keys]) => [
        p,
        Object.fromEntries(
          Object.entries(keys).map(([k, v]) => [k, wrapEntry(v)])
        ),
      ])
    ),
    metadata: { updated_at: ts },
  };
}

test('buildEnvFile preserves orderedKeys and quotes values that need it', () => {
  const body = buildEnvFile(['A', 'B', 'C'], { A: 'simple', B: 'has space', C: 'plain' }, {
    timestamp: 'T',
    projectName: 'p',
  });
  // ordering preserved
  assert.match(body, /A=simple\nB="has space"\nC=plain\n$/);
  // header present
  assert.match(body, /# project: p/);
  // v3: no `# environment:` line
  assert.doesNotMatch(body, /# environment:/);
});

test('maskAll calls setSecret for every non-empty value', () => {
  const seen = [];
  maskAll(['x', '', 'y', null, undefined, 'z'], (v) => seen.push(v));
  assert.deepEqual(seen, ['x', 'y', 'z']);
});

test('run masks every resolved value BEFORE writing the .env file (v3)', async () => {
  const core = makeCore(baseInputs);
  const sharedCalls = [];
  const fs = makeFs(sharedCalls);
  // Bridge core.setSecret into the same shared call log so we can compare
  // setSecret indices against fs.writeFileSync indices.
  const origSetSecret = core.setSecret.bind(core);
  core.setSecret = (v) => {
    origSetSecret(v);
    sharedCalls.push({ kind: 'setSecret', value: v });
  };

  const vault = v3Of({
    myproj: { A: 'aval', B: 'bval', C: 'cval' },
  });

  await run({
    core,
    fs,
    fetchVault: async () => vault,
    setRepoSecret: async () => {},
  });

  assert.equal(core._failed, null);

  const masked = sharedCalls
    .filter((c) => c.kind === 'setSecret')
    .map((c) => c.value)
    .sort();
  assert.deepEqual(masked, ['aval', 'bval', 'cval']);

  // Ordering invariant: every setSecret index < first writeFileSync index
  const firstWrite = sharedCalls.findIndex((c) => c.kind === 'writeFileSync');
  assert.ok(firstWrite >= 0, 'writeFileSync must have been called');
  const setSecretIndices = sharedCalls
    .map((c, i) => (c.kind === 'setSecret' ? i : -1))
    .filter((i) => i >= 0);
  assert.ok(setSecretIndices.length > 0);
  for (const i of setSecretIndices) {
    assert.ok(i < firstWrite, `setSecret at index ${i} must precede writeFileSync at ${firstWrite}`);
  }
});

test('run fails when a project value is a direct enc:* literal (v3)', async () => {
  const core = makeCore(baseInputs);
  const writes = [];
  const fs = makeFs(writes);
  const exportedSecrets = [];

  const vault = v3Of({
    myproj: { A: 'plain', SECRET: 'enc:abc123' },
  });

  await run({
    core,
    fs,
    fetchVault: async () => vault,
    setRepoSecret: async (...args) => {
      exportedSecrets.push(args);
    },
  });

  assert.ok(core._failed, 'should setFailed');
  assert.match(core._failed, /SECRET/);
  assert.match(core._failed, /envpact-cli/);
  assert.equal(writes.length, 0);
  assert.equal(exportedSecrets.length, 0);
  assert.deepEqual(core._vars, {});
});

test('run fails when an enc:* value is reached via shared.* indirection (v3)', async () => {
  const core = makeCore({ ...baseInputs, 'sync-github-secrets': 'true', 'export-to-env': 'true' });
  process.env.GITHUB_REPOSITORY = 'org/myproj';
  const writes = [];
  const fs = makeFs(writes);
  const exportedSecrets = [];

  const vault = v3Of(
    {
      myproj: { A: 'plain', DB_PASSWORD: 'shared.DB_PASSWORD' },
    },
    { DB_PASSWORD: 'enc:zzz' }
  );

  await run({
    core,
    fs,
    fetchVault: async () => vault,
    setRepoSecret: async (...args) => {
      exportedSecrets.push(args);
    },
  });

  assert.ok(core._failed, 'should setFailed');
  assert.match(core._failed, /DB_PASSWORD/);
  assert.equal(writes.length, 0);
  assert.equal(exportedSecrets.length, 0);
  assert.deepEqual(core._vars, {});
});

test('run fails defensively when an enc:* slips into resolved without being flagged', async () => {
  const core = makeCore(baseInputs);
  const writes = [];
  const fs = makeFs(writes);

  const vault = v3Of({ myproj: { A: 'enc:another' } });

  await run({
    core,
    fs,
    fetchVault: async () => vault,
    setRepoSecret: async () => {},
  });

  assert.ok(core._failed);
  assert.match(core._failed, /A/);
  assert.equal(writes.length, 0);
});

test('run accepts v2 vault and produces same .env body as hand-written v3', async () => {
  // v2 input — flat strings under a project, no _default_env
  const v2 = {
    version: 2,
    shared: { K: 'shared-val' },
    projects: {
      myproj: {
        A: 'shared.K',
        PORT: '3000',
        DBNAME: 'app',
      },
    },
    metadata: { updated_at: '2026-01-01T00:00:00Z' },
  };

  const handV3 = v3Of({
    myproj: { A: 'shared.K', PORT: '3000', DBNAME: 'app' },
  }, { K: 'shared-val' });

  const captureBody = async (vault) => {
    const core = makeCore(baseInputs);
    const writes = [];
    const fs = makeFs(writes);
    await run({
      core,
      fs,
      fetchVault: async () => vault,
      setRepoSecret: async () => {},
    });
    return { failed: core._failed, body: writes[0]?.body };
  };

  const v2Result = await captureBody(v2);
  const v3Result = await captureBody(handV3);

  assert.equal(v2Result.failed, null);
  assert.equal(v3Result.failed, null);

  // Strip the timestamp comment which differs between runs.
  const stripTs = (s) => s.replace(/^# Generated by .*\n/, '');
  assert.equal(stripTs(v2Result.body), stripTs(v3Result.body));
  // Confirm the resolved keys made it into the file body.
  assert.match(v2Result.body, /A=shared-val/);
  assert.match(v2Result.body, /PORT=3000/);
  assert.match(v2Result.body, /DBNAME=app/);
});

test('run accepts v1 (flat-string) vault and resolves correctly', async () => {
  const v1 = {
    version: 1,
    shared: { K: 'sv' },
    projects: {
      myproj: { A: 'shared.K', B: 'literal' },
    },
  };

  const core = makeCore(baseInputs);
  const writes = [];
  const fs = makeFs(writes);

  await run({
    core,
    fs,
    fetchVault: async () => v1,
    setRepoSecret: async () => {},
  });

  assert.equal(core._failed, null);
  assert.match(writes[0].body, /A=sv/);
  assert.match(writes[0].body, /B=literal/);
});

test('run does NOT read an `environment` core input (v0.3.0 contract)', async () => {
  const inputsAccessed = [];
  const core = makeCore(baseInputs);
  const origGetInput = core.getInput.bind(core);
  core.getInput = (name, opts) => {
    inputsAccessed.push(name);
    return origGetInput(name, opts);
  };
  const fs = makeFs([]);
  const vault = v3Of({ myproj: { A: 'val' } });

  await run({
    core,
    fs,
    fetchVault: async () => vault,
    setRepoSecret: async () => {},
  });

  assert.ok(!inputsAccessed.includes('environment'),
    `'environment' input must not be read; got: ${inputsAccessed.join(', ')}`);
});

test('run can be imported without firing the action (isMain gate)', () => {
  assert.equal(typeof run, 'function');
  assert.equal(typeof buildEnvFile, 'function');
  assert.equal(typeof maskAll, 'function');
});

// Restore console.warn at module end so the global hijack doesn't leak.
process.on('exit', () => {
  console.warn = origWarn;
});
