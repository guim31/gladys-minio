// -----------------------------------------------------------------------------
// A small parser of the Prometheus text format (version 0.0.4), the one MinIO
// answers on /minio/v2/metrics/*: `name{label="value",…} number`, comments
// starting with `#`. Enough for MinIO, no dependency.
// -----------------------------------------------------------------------------

const LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)(?:\s+\S+)?$/;
const LABEL = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

const unescape = (value) => value.replace(/\\(.)/g, (_, char) => (char === 'n' ? '\n' : char));

/** A sample value: a finite number, or null (NaN, Inf, garbage). */
function number(text) {
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * @param {string} text
 * @returns {Map<string, Array<{ labels: Record<string, string>, value: number|null }>>}
 *   the samples, by metric name
 */
export function parsePrometheus(text) {
  const metrics = new Map();
  for (const raw of String(text).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const match = line.match(LINE);
    if (!match) {
      continue;
    }
    const [, name, rawLabels = '', value] = match;
    const labels = {};
    for (const [, key, labelValue] of rawLabels.matchAll(LABEL)) {
      labels[key] = unescape(labelValue);
    }
    if (!metrics.has(name)) {
      metrics.set(name, []);
    }
    metrics.get(name).push({ labels, value: number(value) });
  }
  return metrics;
}

/** The first value of a metric, null when absent. */
export function first(metrics, name) {
  const value = metrics.get(name)?.find((sample) => sample.value !== null)?.value;
  return value ?? null;
}

/** The sum of every sample of a metric, null when absent. */
export function sum(metrics, name) {
  const samples = (metrics.get(name) ?? []).filter((sample) => sample.value !== null);
  return samples.length === 0 ? null : samples.reduce((total, sample) => total + sample.value, 0);
}
