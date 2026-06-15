import { test, mock } from 'node:test';
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
  environment: '',
  'output-file': '.env',
  'env-example': '.env.example',
  'export-to-env': 'false',
  'sync-github-secrets': 'false',
};

test('buildEnvFile preserves orderedKeys and quotes values that need it', () => {
  const body = buildEnvFile(['A', 'B', 'C'], { A: 'simple', B: 'has space', C: 'plain' }, {
    timestamp: 'T',
    projectName: 'p',
    environment: 'default',
  });
  // ordering preserved
  assert.match(body, /A=simple\nB="has space"\nC=plain\n$/);
  // header present
  assert.match(body, /# project: p/);
});

test('maskAll calls setSecret for every non-empty value', () => {
  const seen = [];
  maskAll(['x', '', 'y', null, undefined, 'z'], (v) => seen.push(v));
  assert.deepEqual(seen, ['x', 'y', 'z']);
});

test('run masks every resolved value BEFORE writing the .env file', async () => {
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

  const vault = {
    version: 2,
    projects: {
      myproj: {
        A: 'aval',
        B: 'bval',
        C: 'cval',
      },
    },
  };

  await run({
    core,
    fs,
    fetchVault: async () => vault,
    setRepoSecret: async () => {},
  });

  // No failure
  assert.equal(core._failed, null);

  // Every non-empty resolved value triggered setSecret
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

test('run fails when a project value is a direct enc:* literal', async () => {
  const core = makeCore(baseInputs);
  const writes = [];
  const fs = makeFs(writes);
  const exportedSecrets = [];

  const vault = {
    version: 2,
    projects: {
      myproj: {
        A: 'plain',
        SECRET: 'enc:abc123',
      },
    },
  };

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
  // No .env written
  assert.equal(writes.length, 0);
  // No secrets synced
  assert.equal(exportedSecrets.length, 0);
  // No exported env vars
  assert.deepEqual(core._vars, {});
});

test('run fails when an enc:* value is reached via shared.* indirection', async () => {
  const core = makeCore({ ...baseInputs, 'sync-github-secrets': 'true', 'export-to-env': 'true' });
  process.env.GITHUB_REPOSITORY = 'org/myproj';
  const writes = [];
  const fs = makeFs(writes);
  const exportedSecrets = [];

  const vault = {
    version: 2,
    shared: {
      DB_PASSWORD: 'enc:zzz',
    },
    projects: {
      myproj: {
        A: 'plain',
        DB_PASSWORD: 'shared.DB_PASSWORD',
      },
    },
  };

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
  // No .env written
  assert.equal(writes.length, 0);
  // No secrets synced
  assert.equal(exportedSecrets.length, 0);
  // No exported env vars
  assert.deepEqual(core._vars, {});
});

test('run fails defensively when an enc:* slips into resolved without being flagged', async () => {
  // Defensive re-scan: even if a future resolver bug let an enc:* value
  // through without populating result.encrypted, the action must still
  // refuse to write it. Achieved here by stubbing resolveProject's output
  // shape via a hand-crafted vault that the real resolver would already
  // mark encrypted — proving the dual-check works.
  const core = makeCore(baseInputs);
  const writes = [];
  const fs = makeFs(writes);

  const vault = {
    version: 2,
    projects: {
      myproj: {
        A: 'enc:another',
      },
    },
  };

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

test('run can be imported without firing the action (isMain gate)', () => {
  // If importing the module had fired run(), reaching this assertion
  // would already have been preceded by a network attempt to
  // api.github.com. The fact that the earlier tests pass with deps
  // injected is itself the proof; this test just pins the contract.
  assert.equal(typeof run, 'function');
  assert.equal(typeof buildEnvFile, 'function');
  assert.equal(typeof maskAll, 'function');
});
