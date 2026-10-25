# MinIO for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings a [MinIO](https://min.io/) object storage server or cluster into
Gladys: its free space, its drives and nodes, its buckets, and an alert when a
drive is lost or the storage gets full.

- **One server device**: online, healthy (write quorum), version, data stored,
  free space, usable capacity, free space in percent, objects, buckets, drives
  online and offline, nodes offline, drives healing.
- **One device per bucket**: size and objects.
- **Scene triggers**: MinIO no longer answers / answers again, a drive offline
  / back online, a node offline / back online, free space under a threshold
  set in the configuration.
- **Scene actions** (reading only): state of MinIO and state of a bucket, each
  with a ready-made sentence.
- **Dashboard widget**: a gauge of the capacity used, free space, drives
  offline, objects, then the buckets, the largest first.
- Texts in English, French, German and Spanish.

Tested against a real MinIO RELEASE.2026-10-23 in Docker (the Chainguard build
of the MinIO sources: a 4-node cluster and a single server with 4 drives): a
node stopped, a drive made unreadable, two drives lost (write quorum gone), the
server stopped and started again, a user restricted to the metrics, public
metrics. Also read a MinIO build of May 2025. MinIO no longer publishes Docker
images of its community edition since late 2025; the metrics read here exist in
every MinIO version of the last years. Not yet tested on a real Gladys:
feedback welcome on [the issues](https://github.com/guim31/gladys-minio/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- A MinIO server or cluster reachable from the Gladys machine on its S3 API
  port (9000 by default).
- A MinIO user with the `admin:Prometheus` permission (the guide shows the
  three `mc` commands), or public metrics (`MINIO_PROMETHEUS_AUTH_TYPE=public`).

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-minio`. Then open its configuration, enter
the address of MinIO, the access key and the secret key, and add the server
and the buckets from the Discover tab.

The full guide: [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

The container reads the Prometheus metrics of MinIO, `/minio/v2/metrics/cluster`
and `/minio/v2/metrics/bucket`, every minute by default. It signs their bearer
token itself (HS512 with the secret key, exactly what
`mc admin prometheus generate` produces), so no token expires and no extra
dependency is needed. It publishes the states of the devices added to Gladys
when they change, and fires the scene events by comparing each read with the
previous one; the drives and nodes offline and the low-space state are kept in
`/data`, so a drive lost during a restart is announced once. Redirects are not
followed.

## Limits

- Reading only: no bucket or object is created, changed or deleted.
- The counts of drives and nodes are cluster-wide: the metrics do not name the
  drive lost.
- Sizes and objects come from the background scanner of MinIO: they appear a
  few minutes after the first start and lag behind the uploads.
- S3-compatible replacements (Garage, SeaweedFS) expose other metrics and are
  not supported.
- One MinIO server or cluster per installation.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on the MinIO
metrics.

## Credits

- [MinIO](https://github.com/minio/minio) by MinIO, Inc. and its contributors
  (AGPL-3.0): the metrics in `test/fixtures/minio` were recorded from a MinIO
  server in Docker; the integration only talks to it over HTTP. The logo on
  the cover is the MinIO logo, a trademark of MinIO, Inc., from its
  repository (`.github/logo.svg`).
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and on the architecture of
  [gladys-kopia](https://github.com/guim31/gladys-kopia).

Not affiliated with MinIO, Inc.
