# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-10-25

### Added

- MinIO server or cluster in Gladys, read from its Prometheus metrics: online,
  healthy (write quorum), version, data stored, free space, usable capacity,
  free space in percent, objects, buckets, drives online and offline, nodes
  offline, drives healing.
- One device per bucket: size and objects.
- Scene triggers: MinIO no longer answers / answers again, drive offline /
  back online, node offline / back online, free space under a configurable
  threshold.
- Scene actions: state of MinIO, state of a bucket, each with a ready-made
  sentence.
- Dashboard widget: capacity used, free space, drives offline, objects, and the
  buckets, the largest first.
- Bearer token signed by the integration from the access key and secret key
  (no token to renew), or public metrics.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-minio/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-minio/releases/tag/v1.0.0
