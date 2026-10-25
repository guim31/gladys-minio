// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One MinIO server or cluster, reached on its S3 API port (9000 by default)
// with the access key and the secret key of a user allowed to read the
// Prometheus metrics, or without credentials when the metrics are public
// (MINIO_PROMETHEUS_AUTH_TYPE=public).
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '300', '900'];

export const DEFAULT_PORT = 9000;

export const MIN_THRESHOLD = 1;
export const MAX_THRESHOLD = 90;

export const DEFAULT_CONFIG = {
  url: '',
  access_key: '',
  secret_key: '',
  accept_self_signed: false,
  poll_interval: '60',
  low_space_percent: 10,
  language: 'fr',
};

// Pages of the MinIO console or paths of the API: a URL copied from the
// browser or from a Prometheus job points at one of them, the API lives at the
// root.
const KNOWN_PATH =
  /\/(minio\/(v2|v3|metrics|health)|browser|buckets|tools|identity|access-keys|settings)(\/.*)?$/i;

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`192.0.2.10`, port 9000 then), or a URL (`https://s3.example.org`). HTTP
 * by default for a bare host. A path is kept (a server behind a reverse proxy
 * sub-path), the known MinIO paths dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const bare = !/^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(bare ? `http://${text}` : text);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  if (bare && !url.port) {
    url.port = String(DEFAULT_PORT);
  }
  const path = url.pathname.replace(KNOWN_PATH, '').replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme, no path). */
export const hostOf = (url) => (url ? new URL(url).host : '');

/** The free-space threshold, in percent: an integer, or a string with a comma. */
export function parseThreshold(raw) {
  const value = typeof raw === 'string' ? Number(raw.trim().replace(',', '.')) : Number(raw);
  if (raw === '' || raw === null || raw === undefined || !Number.isFinite(value)) {
    return DEFAULT_CONFIG.low_space_percent;
  }
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, value));
}

const isTrue = (value) => value === true || value === 'true';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const typed = text('url');
  const pollInterval = POLL_INTERVALS.includes(String(source.poll_interval))
    ? String(source.poll_interval)
    : DEFAULT_CONFIG.poll_interval;
  return {
    url: typed ? parseServerUrl(typed) : null,
    urlTyped: Boolean(typed),
    accessKey: text('access_key'),
    // Never trimmed inside: a secret key is taken as typed, minus the blanks
    // a copy and paste adds around it.
    secretKey: text('secret_key'),
    acceptSelfSigned: isTrue(source.accept_self_signed),
    pollIntervalMs: Number(pollInterval) * 1000,
    lowSpacePercent: parseThreshold(source.low_space_percent),
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
