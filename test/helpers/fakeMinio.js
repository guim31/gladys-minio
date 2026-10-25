// -----------------------------------------------------------------------------
// An in-memory MinIO for the tests: it answers the request seam of
// src/minio/client.js with metrics in the Prometheus text format, written the
// way MinIO writes them (see the real answers in test/fixtures/minio), and
// checks the bearer token the way MinIO does (HS512, issuer "prometheus",
// subject the access key, not expired).
// -----------------------------------------------------------------------------

import { createHmac } from 'node:crypto';

export const BASE = 'http://192.0.2.10:9000';
export const ACCESS_KEY = 'gladys-metrics';
export const SECRET_KEY = 'test-secret-key-0123456789';

const GB = 1e9;

export class FakeMinio {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.down = false;
    this.status = null; // a forced HTTP status
    this.public = false;
    this.requests = [];
    this.cluster = {
      version: '2026-10-23T20-06-51Z',
      servers: 4,
      healthy: 1,
      totalBytes: 1000 * GB,
      freeBytes: 400 * GB,
      usedBytes: 12_000_000,
      objects: 4,
      buckets: null, // computed from the buckets
      drivesOnline: 4,
      drivesOffline: 0,
      nodesOnline: 4,
      nodesOffline: 0,
      healing: 0,
      scanned: true, // false: no usage yet (the scanner did not run)
    };
    /** @type {Map<string, { size: number, objects: number }>} */
    this.buckets = new Map([
      ['backups', { size: 3_000_000, objects: 1 }],
      ['empty-bucket', { size: 0, objects: 0 }],
      ['photos', { size: 9_000_000, objects: 3 }],
    ]);
    this.request = this.request.bind(this);
  }

  /** Lose `count` drives (and the nodes holding them when `nodes`). */
  loseDrives(count, { nodes = 0 } = {}) {
    this.cluster.drivesOnline -= count;
    this.cluster.drivesOffline += count;
    this.cluster.nodesOnline -= nodes;
    this.cluster.nodesOffline += nodes;
  }

  restoreDrives() {
    this.cluster.drivesOnline += this.cluster.drivesOffline;
    this.cluster.drivesOffline = 0;
    this.cluster.nodesOnline += this.cluster.nodesOffline;
    this.cluster.nodesOffline = 0;
  }

  checkToken(header) {
    const match = /^Bearer ([^.]+)\.([^.]+)\.([^.]+)$/.exec(header ?? '');
    if (!match) {
      return false;
    }
    const [, head, body, signature] = match;
    const expected = createHmac('sha512', SECRET_KEY).update(`${head}.${body}`).digest('base64url');
    if (signature !== expected) {
      return false;
    }
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return (
      claims.iss === 'prometheus' &&
      claims.sub === ACCESS_KEY &&
      claims.exp * 1000 > this.now() &&
      JSON.parse(Buffer.from(head, 'base64url').toString('utf8')).alg === 'HS512'
    );
  }

  clusterText() {
    const c = this.cluster;
    const lines = ['# HELP minio_cluster_health_status Get current cluster health status'];
    const sample = (name, value, labels = 'server="minio1:9000"') =>
      lines.push(`# TYPE ${name} gauge`, `${name}{${labels}} ${value}`);
    for (let index = 1; index <= c.servers; index += 1) {
      lines.push(
        `minio_software_version_info{server="minio${index}:9000",version="${c.version}"} 0`,
      );
    }
    sample('minio_cluster_capacity_usable_total_bytes', c.totalBytes.toExponential());
    sample('minio_cluster_capacity_usable_free_bytes', c.freeBytes.toExponential());
    sample('minio_cluster_drive_online_total', c.drivesOnline);
    sample('minio_cluster_drive_offline_total', c.drivesOffline);
    sample('minio_cluster_nodes_online_total', c.nodesOnline);
    sample('minio_cluster_nodes_offline_total', c.nodesOffline);
    sample('minio_cluster_health_status', c.healthy);
    sample(
      'minio_cluster_health_erasure_set_healing_drives',
      c.healing,
      'pool="0",server="minio1:9000",set="0"',
    );
    if (c.scanned) {
      sample('minio_cluster_bucket_total', c.buckets ?? this.buckets.size);
      sample('minio_cluster_usage_object_total', c.objects);
      sample('minio_cluster_usage_total_bytes', c.usedBytes.toExponential());
    }
    return `${lines.join('\n')}\n`;
  }

  bucketText() {
    const lines = [];
    if (this.cluster.scanned) {
      for (const [name, bucket] of this.buckets) {
        lines.push(
          `minio_bucket_usage_total_bytes{bucket="${name}",server="minio1:9000"} ${bucket.size}`,
          `minio_bucket_usage_object_total{bucket="${name}",server="minio1:9000"} ${bucket.objects}`,
        );
      }
    }
    return `# HELP minio_bucket_usage_total_bytes Total bucket size in bytes\n${lines.join('\n')}\n`;
  }

  /** The request seam: `(url, { headers }) => { status, headers, body }`. */
  async request(url, { headers = {} } = {}) {
    this.requests.push({ url, headers });
    if (this.down) {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    }
    if (this.status) {
      return { status: this.status, headers: {}, body: '' };
    }
    const path = new URL(url).pathname;
    if (!this.public && !this.checkToken(headers.authorization)) {
      return {
        status: 403,
        headers: { server: 'MinIO' },
        body: '{"Code":"AccessDenied","Message":"Access Denied."}',
      };
    }
    if (path === '/minio/v2/metrics/cluster') {
      return { status: 200, headers: {}, body: this.clusterText() };
    }
    if (path === '/minio/v2/metrics/bucket') {
      return { status: 200, headers: {}, body: this.bucketText() };
    }
    return { status: 404, headers: {}, body: '' };
  }
}
