// -----------------------------------------------------------------------------
// The MinIO client against the real answers of MinIO RELEASE.2026-10-23
// (test/fixtures/minio, recorded on a 4-node cluster and on a 1-node server
// with 4 drives, in Docker): parsing, token, errors.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ERROR_KINDS,
  MinioClient,
  MinioError,
  parseBuckets,
  parseCluster,
  prometheusToken,
} from '../src/minio/client.js';
import { parsePrometheus } from '../src/minio/prometheus.js';
import { normalizeConfig, parseServerUrl, parseThreshold } from '../src/config.js';

const fixture = async (name) =>
  parsePrometheus(await readFile(new URL(`./fixtures/minio/${name}`, import.meta.url), 'utf8'));

test('a healthy 4-node cluster, as MinIO writes it', async () => {
  const cluster = parseCluster(await fixture('cluster.txt'));
  assert.deepEqual(cluster, {
    version: '2026-10-23T20-06-51Z',
    versions: ['2026-10-23T20-06-51Z'],
    healthy: 1,
    totalBytes: 953594478592,
    freeBytes: 63900491776,
    usedBytes: 12_000_000,
    objects: 4,
    buckets: 3,
    drivesOnline: 4,
    drivesOffline: 0,
    nodesOnline: 4,
    nodesOffline: 0,
    healingDrives: 0,
    erasureSets: 1,
  });
});

test('a node stopped: one node and its drive offline', async () => {
  const cluster = parseCluster(await fixture('cluster-node-offline.txt'));
  assert.equal(cluster.nodesOffline, 1);
  assert.equal(cluster.nodesOnline, 3);
  assert.equal(cluster.drivesOffline, 1);
  assert.equal(cluster.drivesOnline, 3);
  assert.equal(cluster.healthy, 1, 'three drives of four keep the write quorum');
});

test('one drive of a single server lost, then two: the write quorum goes', async () => {
  const one = parseCluster(await fixture('cluster-drive-offline.txt'));
  assert.deepEqual([one.drivesOffline, one.nodesOffline, one.healthy], [1, 0, 1]);
  const two = parseCluster(await fixture('cluster-no-quorum.txt'));
  assert.deepEqual([two.drivesOffline, two.drivesOnline, two.healthy], [2, 2, 0]);
});

test('the buckets, an empty one included', async () => {
  assert.deepEqual(parseBuckets(await fixture('bucket.txt')), [
    { name: 'backups', sizeBytes: 3_000_000, objects: 1 },
    { name: 'empty-bucket', sizeBytes: 0, objects: 0 },
    { name: 'photos', sizeBytes: 9_000_000, objects: 3 },
  ]);
});

test('before the first pass of the scanner: no usage, no bucket', () => {
  const metrics = parsePrometheus(
    'minio_cluster_drive_online_total{server="a:9000"} 4\n' +
      'minio_cluster_capacity_usable_total_bytes{server="a:9000"} 1e+12\n',
  );
  const cluster = parseCluster(metrics);
  assert.equal(cluster.usedBytes, null);
  assert.equal(cluster.objects, null);
  assert.equal(cluster.drivesOnline, 4);
  assert.deepEqual(parseBuckets(parsePrometheus('# HELP x\n')), []);
});

test('the parser: escaped label values, NaN, comments, timestamps', () => {
  const metrics = parsePrometheus(
    [
      '# HELP a b',
      'a{x="say \\"hi\\"",y="1"} 2.5e+00 1700000000',
      'b NaN',
      'c +Inf',
      'not a line',
    ].join('\n'),
  );
  assert.deepEqual(metrics.get('a'), [{ labels: { x: 'say "hi"', y: '1' }, value: 2.5 }]);
  assert.equal(metrics.get('b')[0].value, null);
  assert.equal(metrics.get('c')[0].value, null);
});

test('the token is exactly the one of `mc admin prometheus generate`', () => {
  // Recorded on the test cluster (root user of a throwaway container).
  const recorded =
    'eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJwcm9tZXRoZXVzIiwic3ViIjoiZ2xhZHlzYWRtaW4iLCJleHAiOjQ5NDY1NDQxNDh9.3020TbRXZzD8dGcoiJArASj_lRJDULw2KL4iXmetjIIwtl63apRgr81Bxd5lbClOnO1cbEQiHEZ6XegmeFoQ_Q';
  const now = (4946544148 - 3600) * 1000;
  assert.equal(prometheusToken('gladysadmin', 'gladys-test-secret', now), recorded);
});

const answer =
  (status, body = '', headers = {}) =>
  async () => ({ status, headers, body });

test('errors: each failure has its kind, and never the secret', async () => {
  const cases = [
    [answer(403, '{"Code":"AccessDenied"}'), ERROR_KINDS.AUTH],
    [answer(401), ERROR_KINDS.AUTH],
    [answer(404), ERROR_KINDS.NOT_MINIO],
    [answer(200, '<html>login</html>'), ERROR_KINDS.NOT_MINIO],
    [answer(301, '', { location: 'https://x' }), ERROR_KINDS.REDIRECT],
    [answer(503), ERROR_KINDS.HTTP],
    [
      async () => {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      },
      ERROR_KINDS.UNREACHABLE,
    ],
    [
      async () => {
        throw Object.assign(new Error('self-signed certificate'), {
          code: 'DEPTH_ZERO_SELF_SIGNED_CERT',
        });
      },
      ERROR_KINDS.TLS,
    ],
  ];
  for (const [request, kind] of cases) {
    const client = new MinioClient({
      url: 'http://192.0.2.10:9000',
      accessKey: 'key',
      secretKey: 'very-secret',
      request,
    });
    await assert.rejects(client.read(), (err) => {
      assert.ok(err instanceof MinioError);
      assert.equal(err.kind, kind);
      assert.ok(!err.message.includes('very-secret'));
      return true;
    });
  }
});

test('public metrics: no authorization header; a key: a bearer token', async () => {
  const seen = [];
  const request = async (url, { headers }) => {
    seen.push(headers.authorization);
    return { status: 200, headers: {}, body: 'minio_cluster_health_status 1\n' };
  };
  await new MinioClient({ url: 'http://192.0.2.10:9000', request }).read();
  await new MinioClient({
    url: 'http://192.0.2.10:9000',
    accessKey: 'k',
    secretKey: 's',
    request,
  }).read();
  assert.equal(seen[0], undefined);
  assert.equal(seen[1], undefined);
  assert.match(seen[2], /^Bearer ey/);
});

test('the address: bare host on port 9000, console paths dropped, no credentials', () => {
  assert.equal(parseServerUrl('192.0.2.10'), 'http://192.0.2.10:9000');
  assert.equal(parseServerUrl('https://s3.example.org'), 'https://s3.example.org');
  assert.equal(
    parseServerUrl('http://192.0.2.10:9000/minio/v2/metrics/cluster'),
    'http://192.0.2.10:9000',
  );
  assert.equal(parseServerUrl('https://example.org/s3/'), 'https://example.org/s3');
  assert.equal(parseServerUrl('http://user:pw@192.0.2.10:9000'), null);
  assert.equal(parseServerUrl('ftp://192.0.2.10'), null);
  assert.equal(parseServerUrl(' '), null);
});

test('the threshold: integers, a comma, bounds, default', () => {
  assert.equal(parseThreshold(15), 15);
  assert.equal(parseThreshold('7,5'), 7.5);
  assert.equal(parseThreshold(0), 1);
  assert.equal(parseThreshold(500), 90);
  assert.equal(parseThreshold(''), 10);
  assert.equal(parseThreshold(undefined), 10);
  const config = normalizeConfig({ url: '192.0.2.10', accept_self_signed: 'true' });
  assert.equal(config.acceptSelfSigned, true);
  assert.equal(config.pollIntervalMs, 60_000);
  assert.equal(config.language, 'fr');
});

test('a reverse proxy sub-path named /minio is kept', () => {
  assert.equal(parseServerUrl('https://example.org/minio'), 'https://example.org/minio');
  assert.equal(
    parseServerUrl('https://example.org/minio/minio/v2/metrics/cluster'),
    'https://example.org/minio',
  );
});

test('an answer too large is not an outage', async () => {
  const client = new MinioClient({
    url: 'http://192.0.2.10:9000',
    request: async () => {
      throw Object.assign(new Error('Response too large'), { code: 'TOO_LARGE' });
    },
  });
  await assert.rejects(client.read(), (err) => err.kind === ERROR_KINDS.TOO_LARGE);
});
