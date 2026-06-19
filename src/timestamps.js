/**
 * envpact timestamps — dual-render UTC + IST per SHARED_SPEC §1.5.
 *
 * The vault is the source of truth and stores `_modified_at` as
 * canonical ISO-8601 UTC strings (Z-suffix). For every prompt or log
 * line that surfaces a timestamp to a human, consumers MUST display
 * BOTH:
 *
 *   1. The verbatim ISO UTC string (exactly as stored on disk)
 *   2. The IST equivalent (UTC+05:30, fixed) as
 *      "YYYY-MM-DD HH:MM:SS IST"
 *
 * IST is computed via `Intl.DateTimeFormat` with
 * `timeZone: 'Asia/Kolkata'` so the rendering is independent of the
 * host runner's local timezone (no `process.env.TZ` leakage).
 *
 * envpact-action runs in CI and therefore has no interactive prompt
 * surface — this helper exists purely to make `core.info(...)` lines
 * that include a `_modified_at` value readable to a human looking at
 * the workflow log. Mirrors `envpact-cli/lib/timestamps.js` modulo
 * ESM packaging.
 *
 * Zero runtime dependencies — stdlib-only, ESM, ncc-friendly.
 */

const IST_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/**
 * Reformat the ISO UTC string into both UTC and IST renderings.
 *
 * @param {string} iso  Canonical ISO-8601 UTC string (e.g. the vault's
 *                      `_modified_at` or `metadata.updated_at` field).
 *                      Must parse via `Date.parse`; otherwise an Error
 *                      is thrown so we never silently render bogus
 *                      timestamps in the CI log.
 * @returns {{utc: string, ist: string}}
 *   - `utc`: the input string verbatim
 *   - `ist`: "YYYY-MM-DD HH:MM:SS IST" in Asia/Kolkata
 */
export function formatTimestamp(iso) {
  if (typeof iso !== 'string' || iso.length === 0) {
    throw new TypeError('formatTimestamp: iso must be a non-empty string');
  }
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new RangeError(`formatTimestamp: invalid ISO timestamp: ${iso}`);
  }
  const date = new Date(ms);
  // `formatToParts` is the only way to recompose `YYYY-MM-DD HH:MM:SS`
  // exactly — `format` for en-GB returns `dd/mm/yyyy, hh:mm:ss` which
  // we'd just have to reverse.
  const parts = IST_FORMATTER.formatToParts(date);
  const get = (type) => {
    const p = parts.find((x) => x.type === type);
    return p ? p.value : '';
  };
  // `hour: '2-digit', hour12: false` returns "24" at midnight on
  // some Node builds — normalise to "00" so the spec-mandated
  // YYYY-MM-DD HH:MM:SS shape is stable.
  let hour = get('hour');
  if (hour === '24') hour = '00';
  const ist = `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')} IST`;
  return { utc: iso, ist };
}

/**
 * Render a timestamp inline as `<utc> (<ist>)` for log lines.
 * Convenience over `formatTimestamp` when the caller only wants a
 * single string to splice into a `core.info(...)` template.
 *
 * @param {string} iso  Canonical ISO-8601 UTC string.
 * @returns {string}  e.g. `"2026-06-19T07:30:00.000Z (2026-06-19 13:00:00 IST)"`.
 */
export function formatTimestampInline(iso) {
  const { utc, ist } = formatTimestamp(iso);
  return `${utc} (${ist})`;
}
