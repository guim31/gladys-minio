// -----------------------------------------------------------------------------
// MinIO client: the Prometheus metrics (v2) of a MinIO server or cluster,
// checked against a real MinIO RELEASE.2026-10-23 (4 nodes, and 1 node with
// 4 drives) and RELEASE.2025-05 (the last community Docker image).
//
//   GET /minio/v2/metrics/cluster   capacity, usage, drives and nodes online
//                                   and offline, erasure sets (healing,
//                                   quorum), version
//   GET /minio/v2/metrics/bucket    size and objects of every bucket
//
// Authentication: a JWT the integration signs itself (HS512) with the secret
// key of the user — exactly what `mc admin prometheus generate` produces — so
// the user types an access key and a secret key, never a token that expires.
// The user needs the `admin:Prometheus` permission. Without an access key,
// the request goes without token (MINIO_PROMETHEUS_AUTH_TYPE=public).
//
// The capacity, the drives and the nodes are computed by MinIO in the
// background: they lag up to a minute or so behind reality; the usage
// (objects, bytes) comes from its scanner, absent until its first pass.
// Redirects are not followed.
// -----------------------------------------------------------------------------

import { createHmac } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { first, parsePrometheus, sum } from './prometheus.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // access key, secret key or permission refused
  NOT_MINIO: 'not_minio', // something answers, not a MinIO server
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  HTTP: 'http', // any other HTTP error
});

export class MinioError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'MinioError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// A few thousand buckets fit: about 5 KB of metrics per bucket.
export const MAX_BODY_BYTES = 32 * 1024 * 1024;
export const TIMEOUT_MS = 15_000;

/**
 * The one function that talks to the network. The client takes it as a
 * parameter: the tests replace it with an in-memory MinIO
 * (test/helpers/fakeMinio.js).
 * @returns {Promise<{ status: number, headers: object, body: string }>}
 */
export function httpRequest(
  address,
  { headers = {}, timeoutMs = TIMEOUT_MS, rejectUnauthorized = true } = {},
) {
  const url = new URL(address);
  const secure = url.protocol === 'https:';
  const options = { method: 'GET', headers, timeout: timeoutMs, agent: false };
  if (secure) {
    options.rejectUnauthorized = rejectUnauthorized;
  }
  return new Promise((resolve, reject) => {
    const request = (secure ? https : http).request(url, options, (response) => {
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          response.destroy(new Error('Response too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    const timeout = () =>
      request.destroy(Object.assign(new Error('Timeout'), { code: 'ETIMEDOUT' }));
    request.on('timeout', timeout);
    // `timeout` above is an idle timeout: a server that trickles bytes is cut here.
    const deadline = setTimeout(timeout, timeoutMs);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', reject);
    request.end();
  });
}

// A token is signed for every request: a short life is enough.
export const TOKEN_LIFETIME_S = 3600;

const base64url = (value) => Buffer.from(value).toString('base64url');

/**
 * The bearer token of the metrics, as `mc admin prometheus generate` makes
 * it: HS512, issuer "prometheus", subject the access key.
 */
export function prometheusToken(accessKey, secretKey, now = Date.now()) {
  const header = base64url(JSON.stringify({ alg: 'HS512', typ: 'JWT' }));
  const claims = base64url(
    // In the order of `mc`: the same key and time give the same token.
    JSON.stringify({
      iss: 'prometheus',
      sub: accessKey,
      exp: Math.floor(now / 1000) + TOKEN_LIFETIME_S,
    }),
  );
  const signature = createHmac('sha512', secretKey)
    .update(`${header}.${claims}`)
    .digest('base64url');
  return `${header}.${claims}.${signature}`;
}

/** The kind of a network failure. */
function networkError(err) {
  if (TLS_CODES.has(err.code) || /certificate/i.test(err.message ?? '')) {
    return new MinioError(ERROR_KINDS.TLS, `Certificate refused (${err.code ?? err.message})`);
  }
  return new MinioError(
    ERROR_KINDS.UNREACHABLE,
    `No answer (${err.code ?? err.message ?? 'error'})`,
  );
}

const integer = (value) => (value === null ? null : Math.max(0, Math.round(value)));

/** The cluster view out of /minio/v2/metrics/cluster. */
export function parseCluster(metrics) {
  const versions = [
    ...new Set(
      (metrics.get('minio_software_version_info') ?? [])
        .map((sample) => sample.labels.version)
        .filter(Boolean),
    ),
  ].sort();
  const sets = metrics.get('minio_cluster_health_erasure_set_status') ?? [];
  return {
    version: versions.length > 0 ? versions[versions.length - 1] : null,
    versions,
    healthy: first(metrics, 'minio_cluster_health_status'),
    totalBytes: first(metrics, 'minio_cluster_capacity_usable_total_bytes'),
    freeBytes: first(metrics, 'minio_cluster_capacity_usable_free_bytes'),
    usedBytes: first(metrics, 'minio_cluster_usage_total_bytes'),
    objects: integer(first(metrics, 'minio_cluster_usage_object_total')),
    buckets: integer(first(metrics, 'minio_cluster_bucket_total')),
    drivesOnline: integer(first(metrics, 'minio_cluster_drive_online_total')),
    drivesOffline: integer(first(metrics, 'minio_cluster_drive_offline_total')),
    nodesOnline: integer(first(metrics, 'minio_cluster_nodes_online_total')),
    nodesOffline: integer(first(metrics, 'minio_cluster_nodes_offline_total')),
    healingDrives: integer(sum(metrics, 'minio_cluster_health_erasure_set_healing_drives')),
    erasureSets: sets.length,
  };
}

/** The buckets out of /minio/v2/metrics/bucket, sorted by name. */
export function parseBuckets(metrics) {
  const buckets = new Map();
  const at = (name) => {
    if (!buckets.has(name)) {
      buckets.set(name, { name, sizeBytes: null, objects: null });
    }
    return buckets.get(name);
  };
  for (const sample of metrics.get('minio_bucket_usage_total_bytes') ?? []) {
    if (sample.labels.bucket && sample.value !== null) {
      at(sample.labels.bucket).sizeBytes = Math.max(0, sample.value);
    }
  }
  for (const sample of metrics.get('minio_bucket_usage_object_total') ?? []) {
    if (sample.labels.bucket && sample.value !== null) {
      at(sample.labels.bucket).objects = integer(sample.value);
    }
  }
  return [...buckets.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export class MinioClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host:port[/path]`
   * @param {string} [options.accessKey] empty: public metrics
   * @param {string} [options.secretKey]
   * @param {boolean} [options.acceptSelfSigned]
   * @param {Function} [options.request] HTTP seam (httpRequest)
   * @param {() => number} [options.now]
   */
  constructor({ url, accessKey = '', secretKey = '', acceptSelfSigned = false, request, now }) {
    this.url = url;
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.acceptSelfSigned = acceptSelfSigned;
    this.request = request ?? httpRequest;
    this.now = now ?? (() => Date.now());
  }

  /** One metrics page, parsed; throws a MinioError. */
  async metrics(path) {
    const headers = { accept: 'text/plain' };
    if (this.accessKey) {
      headers.authorization = `Bearer ${prometheusToken(this.accessKey, this.secretKey, this.now())}`;
    }
    let response;
    try {
      response = await this.request(`${this.url}/minio/v2/metrics/${path}`, {
        headers,
        rejectUnauthorized: !this.acceptSelfSigned,
      });
    } catch (err) {
      throw networkError(err);
    }
    const { status, body } = response;
    if (status >= 300 && status < 400) {
      throw new MinioError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 401 || status === 403) {
      // MinIO says AccessDenied for a bad key as for a missing permission.
      throw new MinioError(ERROR_KINDS.AUTH, `Access denied (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new MinioError(ERROR_KINDS.NOT_MINIO, 'No MinIO metrics at this address (HTTP 404)', {
        status,
      });
    }
    if (status !== 200) {
      throw new MinioError(ERROR_KINDS.HTTP, `HTTP ${status}`, { status });
    }
    const metrics = parsePrometheus(body);
    // The bucket page of a server without bucket holds no MinIO metric: only
    // the cluster page proves it is MinIO.
    if (path === 'cluster' && ![...metrics.keys()].some((name) => name.startsWith('minio_'))) {
      throw new MinioError(ERROR_KINDS.NOT_MINIO, 'The answer holds no MinIO metric');
    }
    return metrics;
  }

  /** The cluster and its buckets. */
  async read() {
    const cluster = parseCluster(await this.metrics('cluster'));
    const buckets = parseBuckets(await this.metrics('bucket'));
    return { cluster, buckets };
  }
}
