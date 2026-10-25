// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+). Reading only:
// the integration never writes to MinIO.
//
// "Is a drive offline?" is already a scene condition on the device features.
// The reading actions are about what a condition cannot do: put the state in
// a message ("MinIO: 64 GB free (6.7 %), 1 drive(s) offline."), and work on a
// server whose device is not added. They read MinIO again when the last read
// is older than 15 seconds.
// -----------------------------------------------------------------------------

import { freePercent } from './devices.js';
import { SENTENCE_TEXT, formatBytes, formatPercent } from './texts.js';

const words = (language) => SENTENCE_TEXT[language] ?? SENTENCE_TEXT.en;

export const SCENE_ACTIONS = {
  async get_server_status(hub) {
    await hub.freshView();
    const language = hub.config.language;
    const cluster = hub.isDown() ? null : hub.cluster;
    if (!cluster) {
      return {
        online: false,
        healthy: false,
        version: '',
        free_percent: -1,
        free_space: '',
        used_space: '',
        total_space: '',
        objects: -1,
        buckets: -1,
        drives_online: -1,
        drives_offline: -1,
        nodes_offline: -1,
        healing_drives: -1,
        sentence: words(language).unreachable,
      };
    }
    const percent = freePercent(cluster);
    const free = formatBytes(cluster.freeBytes, language);
    const count = (value) => value ?? -1;
    return {
      online: true,
      healthy: cluster.healthy === 1,
      version: cluster.version ?? '',
      free_percent: percent ?? -1,
      free_space: cluster.freeBytes === null ? '' : free,
      used_space: cluster.usedBytes === null ? '' : formatBytes(cluster.usedBytes, language),
      total_space: cluster.totalBytes === null ? '' : formatBytes(cluster.totalBytes, language),
      objects: count(cluster.objects),
      buckets: count(cluster.buckets),
      drives_online: count(cluster.drivesOnline),
      drives_offline: count(cluster.drivesOffline),
      nodes_offline: count(cluster.nodesOffline),
      healing_drives: count(cluster.healingDrives),
      sentence:
        percent === null || cluster.drivesOffline === null
          ? words(language).online
          : words(language).server(free, formatPercent(percent, language), cluster.drivesOffline),
    };
  },

  async get_bucket_status(hub, { fields = {} }) {
    const bucket = await hub.bucketOf(fields.device);
    const language = hub.config.language;
    const size = formatBytes(bucket.sizeBytes, language);
    return {
      name: bucket.name,
      size,
      size_mb: bucket.sizeBytes === null ? -1 : Math.round(bucket.sizeBytes / 1e6),
      objects: bucket.objects ?? -1,
      sentence:
        bucket.sizeBytes === null || bucket.objects === null
          ? words(language).bucketUnknown(bucket.name)
          : words(language).bucket(bucket.name, size, bucket.objects),
    };
  },
};
