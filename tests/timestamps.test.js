import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTimestamp, formatTimestampInline } from '../src/timestamps.js';

// ---------------------------------------------------------------
// formatTimestamp — UTC pass-through, IST in Asia/Kolkata
// ---------------------------------------------------------------

test('formatTimestamp — UTC pass-through is byte-identical', () => {
  const iso = '2026-06-19T07:30:00.000Z';
  const r = formatTimestamp(iso);
  assert.equal(r.utc, iso);
});

test('formatTimestamp — IST is +05:30 from UTC', () => {
  const r = formatTimestamp('2026-06-19T07:30:00.000Z');
  assert.equal(r.ist, '2026-06-19 13:00:00 IST');
});

test('formatTimestamp — IST date rolls forward when UTC is late evening', () => {
  // 19:30 UTC → 01:00 IST next day.
  const r = formatTimestamp('2026-06-18T19:30:00.000Z');
  assert.equal(r.ist, '2026-06-19 01:00:00 IST');
});

test('formatTimestamp — midnight UTC renders as 05:30 IST same day', () => {
  const r = formatTimestamp('2026-06-19T00:00:00.000Z');
  assert.equal(r.ist, '2026-06-19 05:30:00 IST');
});

test('formatTimestamp — IST does NOT depend on host TZ env var', () => {
  // No DST in IST — fixed +05:30 — but verify the formatter ignores
  // process.env.TZ regardless. Save/restore to keep the suite hermetic.
  // This is the load-bearing test for the action's CI surface: GitHub
  // hosted runners are UTC, but self-hosted runners may be anything,
  // and the dual-render output must be identical across both.
  const orig = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const r = formatTimestamp('2026-06-19T07:30:00.000Z');
    assert.equal(r.ist, '2026-06-19 13:00:00 IST');
  } finally {
    if (orig === undefined) delete process.env.TZ;
    else process.env.TZ = orig;
  }
});

test('formatTimestamp — handles ISO without milliseconds', () => {
  const r = formatTimestamp('2026-06-19T07:30:00Z');
  assert.equal(r.ist, '2026-06-19 13:00:00 IST');
  assert.equal(r.utc, '2026-06-19T07:30:00Z');
});

test('formatTimestamp — throws on non-string input', () => {
  assert.throws(() => formatTimestamp(undefined), TypeError);
  assert.throws(() => formatTimestamp(null), TypeError);
  assert.throws(() => formatTimestamp(1234), TypeError);
});

test('formatTimestamp — throws on unparseable string', () => {
  assert.throws(() => formatTimestamp('not-a-date'), RangeError);
  assert.throws(() => formatTimestamp(''), TypeError);
});

// ---------------------------------------------------------------
// formatTimestampInline — log-line convenience
// ---------------------------------------------------------------

test('formatTimestampInline — emits "<utc> (<ist>)" shape', () => {
  const s = formatTimestampInline('2026-06-19T07:30:00.000Z');
  assert.equal(s, '2026-06-19T07:30:00.000Z (2026-06-19 13:00:00 IST)');
});

test('formatTimestampInline — propagates parse errors', () => {
  assert.throws(() => formatTimestampInline('garbage'), RangeError);
});
