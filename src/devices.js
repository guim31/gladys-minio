// -----------------------------------------------------------------------------
// The Gladys devices, proposed in the Discovery tab (the user adds the ones to
// follow, nothing is created on their behalf):
//
//   - one "MinIO" device for the server or cluster:
//       online          input/binary         1 while MinIO answers
//       healthy         input/binary         1 while every erasure set has
//                                            its write quorum
//       version         text/text            RELEASE date of MinIO
//       used_space      data/size (GB)       data stored (scanner)
//       free_space      data/size (GB)       usable free space
//       total_space     data/size (GB)       usable capacity
//       free_percent    level-sensor (%)     free / capacity
//       objects         counter-sensor       objects stored (scanner)
//       buckets         counter-sensor
//       drives_online   counter-sensor
//       drives_offline  counter-sensor
//       nodes_offline   counter-sensor
//       healing_drives  counter-sensor       drives being healed
//
//   - one device per bucket, identified by its name (unique and permanent in
//     MinIO): size (data/size, MB) and objects.
//
// Published with should_poll: false: the integration reads MinIO on its own
// timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const SERVER_TYPE = 'server';
export const BUCKET_TYPE = 'bucket';
export const SERVER_ID = 'main';
export const MODEL = 'MinIO';

// Suffixes of the feature external ids: permanent once published.
export const SERVER_KEYS = Object.freeze({
  ONLINE: 'online',
  HEALTHY: 'healthy',
  VERSION: 'version',
  USED: 'used_space',
  FREE: 'free_space',
  TOTAL: 'total_space',
  FREE_PERCENT: 'free_percent',
  OBJECTS: 'objects',
  BUCKETS: 'buckets',
  DRIVES_ONLINE: 'drives_online',
  DRIVES_OFFLINE: 'drives_offline',
  NODES_OFFLINE: 'nodes_offline',
  HEALING: 'healing_drives',
});

export const BUCKET_KEYS = Object.freeze({
  SIZE: 'size',
  OBJECTS: 'objects',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [SERVER_KEYS.ONLINE]: 'Online',
    [SERVER_KEYS.HEALTHY]: 'Healthy (write quorum)',
    [SERVER_KEYS.VERSION]: 'Version',
    [SERVER_KEYS.USED]: 'Data stored',
    [SERVER_KEYS.FREE]: 'Free space',
    [SERVER_KEYS.TOTAL]: 'Usable capacity',
    [SERVER_KEYS.FREE_PERCENT]: 'Free space (%)',
    [SERVER_KEYS.OBJECTS]: 'Objects',
    [SERVER_KEYS.BUCKETS]: 'Buckets',
    [SERVER_KEYS.DRIVES_ONLINE]: 'Drives online',
    [SERVER_KEYS.DRIVES_OFFLINE]: 'Drives offline',
    [SERVER_KEYS.NODES_OFFLINE]: 'Nodes offline',
    [SERVER_KEYS.HEALING]: 'Drives healing',
    [`bucket_${BUCKET_KEYS.SIZE}`]: 'Size',
    [`bucket_${BUCKET_KEYS.OBJECTS}`]: 'Objects',
  },
  fr: {
    [SERVER_KEYS.ONLINE]: 'En ligne',
    [SERVER_KEYS.HEALTHY]: 'En bonne santé (quorum)',
    [SERVER_KEYS.VERSION]: 'Version',
    [SERVER_KEYS.USED]: 'Données stockées',
    [SERVER_KEYS.FREE]: 'Espace libre',
    [SERVER_KEYS.TOTAL]: 'Capacité utilisable',
    [SERVER_KEYS.FREE_PERCENT]: 'Espace libre (%)',
    [SERVER_KEYS.OBJECTS]: 'Objets',
    [SERVER_KEYS.BUCKETS]: 'Buckets',
    [SERVER_KEYS.DRIVES_ONLINE]: 'Disques en ligne',
    [SERVER_KEYS.DRIVES_OFFLINE]: 'Disques hors ligne',
    [SERVER_KEYS.NODES_OFFLINE]: 'Nœuds hors ligne',
    [SERVER_KEYS.HEALING]: 'Disques en réparation',
    [`bucket_${BUCKET_KEYS.SIZE}`]: 'Taille',
    [`bucket_${BUCKET_KEYS.OBJECTS}`]: 'Objets',
  },
  de: {
    [SERVER_KEYS.ONLINE]: 'Online',
    [SERVER_KEYS.HEALTHY]: 'Gesund (Schreib-Quorum)',
    [SERVER_KEYS.VERSION]: 'Version',
    [SERVER_KEYS.USED]: 'Gespeicherte Daten',
    [SERVER_KEYS.FREE]: 'Freier Speicher',
    [SERVER_KEYS.TOTAL]: 'Nutzbare Kapazität',
    [SERVER_KEYS.FREE_PERCENT]: 'Freier Speicher (%)',
    [SERVER_KEYS.OBJECTS]: 'Objekte',
    [SERVER_KEYS.BUCKETS]: 'Buckets',
    [SERVER_KEYS.DRIVES_ONLINE]: 'Laufwerke online',
    [SERVER_KEYS.DRIVES_OFFLINE]: 'Laufwerke offline',
    [SERVER_KEYS.NODES_OFFLINE]: 'Knoten offline',
    [SERVER_KEYS.HEALING]: 'Laufwerke in Heilung',
    [`bucket_${BUCKET_KEYS.SIZE}`]: 'Größe',
    [`bucket_${BUCKET_KEYS.OBJECTS}`]: 'Objekte',
  },
  es: {
    [SERVER_KEYS.ONLINE]: 'En línea',
    [SERVER_KEYS.HEALTHY]: 'En buen estado (quórum)',
    [SERVER_KEYS.VERSION]: 'Versión',
    [SERVER_KEYS.USED]: 'Datos almacenados',
    [SERVER_KEYS.FREE]: 'Espacio libre',
    [SERVER_KEYS.TOTAL]: 'Capacidad utilizable',
    [SERVER_KEYS.FREE_PERCENT]: 'Espacio libre (%)',
    [SERVER_KEYS.OBJECTS]: 'Objetos',
    [SERVER_KEYS.BUCKETS]: 'Buckets',
    [SERVER_KEYS.DRIVES_ONLINE]: 'Discos en línea',
    [SERVER_KEYS.DRIVES_OFFLINE]: 'Discos fuera de línea',
    [SERVER_KEYS.NODES_OFFLINE]: 'Nodos fuera de línea',
    [SERVER_KEYS.HEALING]: 'Discos en reparación',
    [`bucket_${BUCKET_KEYS.SIZE}`]: 'Tamaño',
    [`bucket_${BUCKET_KEYS.OBJECTS}`]: 'Objetos',
  },
};

// Display bounds (the core never applies them on write).
export const MAX_GB = 1_000_000_000;
export const MAX_MB = 1_000_000_000_000;
export const MAX_COUNT = 1_000_000_000_000;
export const MAX_DRIVES = 100_000;

export const serverIds = (gladys) => gladys.externalIds(SERVER_TYPE, SERVER_ID);
export const bucketIds = (gladys, name) => gladys.externalIds(BUCKET_TYPE, name);

/** The bucket name of a device external id, null when it is not a bucket of ours. */
export function parseBucketName(gladys, externalId) {
  const prefix = bucketIds(gladys, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const name = externalId.slice(prefix.length);
  return name ? name : null;
}

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const text = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.TEXT, DEVICE_FEATURE_TYPES.TEXT.TEXT, {
    keep_history: false,
    min: 0,
    max: 0,
  });

const counter = (name, externalId, max) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: true, min: 0, max },
  );

const binary = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.INPUT, DEVICE_FEATURE_TYPES.SENSOR.BINARY, {
    keep_history: true,
    min: 0,
    max: 1,
  });

const size = (name, externalId, unit, max) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.DATA, DEVICE_FEATURE_TYPES.DATA.SIZE, {
    unit,
    keep_history: true,
    min: 0,
    max,
  });

/** The discovery payload of the server. */
export function buildServerDevice(gladys, language = 'en') {
  const ids = serverIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  const K = SERVER_KEYS;
  return {
    name: 'MinIO',
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [],
    features: [
      binary(names[K.ONLINE], ids.feature(K.ONLINE)),
      binary(names[K.HEALTHY], ids.feature(K.HEALTHY)),
      text(names[K.VERSION], ids.feature(K.VERSION)),
      size(names[K.USED], ids.feature(K.USED), DEVICE_FEATURE_UNITS.GIGABYTE, MAX_GB),
      size(names[K.FREE], ids.feature(K.FREE), DEVICE_FEATURE_UNITS.GIGABYTE, MAX_GB),
      size(names[K.TOTAL], ids.feature(K.TOTAL), DEVICE_FEATURE_UNITS.GIGABYTE, MAX_GB),
      sensor(
        names[K.FREE_PERCENT],
        ids.feature(K.FREE_PERCENT),
        DEVICE_FEATURE_CATEGORIES.LEVEL_SENSOR,
        DEVICE_FEATURE_TYPES.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
        { unit: DEVICE_FEATURE_UNITS.PERCENT, keep_history: true, min: 0, max: 100 },
      ),
      counter(names[K.OBJECTS], ids.feature(K.OBJECTS), MAX_COUNT),
      counter(names[K.BUCKETS], ids.feature(K.BUCKETS), MAX_COUNT),
      counter(names[K.DRIVES_ONLINE], ids.feature(K.DRIVES_ONLINE), MAX_DRIVES),
      counter(names[K.DRIVES_OFFLINE], ids.feature(K.DRIVES_OFFLINE), MAX_DRIVES),
      counter(names[K.NODES_OFFLINE], ids.feature(K.NODES_OFFLINE), MAX_DRIVES),
      counter(names[K.HEALING], ids.feature(K.HEALING), MAX_DRIVES),
    ],
  };
}

/** The discovery payload of a bucket. */
export function buildBucketDevice(gladys, bucket, language = 'en') {
  const ids = bucketIds(gladys, bucket.name);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: bucket.name,
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [{ name: 'BUCKET', value: bucket.name }],
    features: [
      size(
        names[`bucket_${BUCKET_KEYS.SIZE}`],
        ids.feature(BUCKET_KEYS.SIZE),
        DEVICE_FEATURE_UNITS.MEGABYTE,
        MAX_MB,
      ),
      counter(names[`bucket_${BUCKET_KEYS.OBJECTS}`], ids.feature(BUCKET_KEYS.OBJECTS), MAX_COUNT),
    ],
  };
}

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
export const gigabytes = (bytes) => round(bytes / 1e9, 2);
export const megabytes = (bytes) => round(bytes / 1e6, 1);

/** Free space in percent of the usable capacity, one decimal; null when unknown. */
export function freePercent(cluster) {
  if (cluster.freeBytes === null || !cluster.totalBytes) {
    return null;
  }
  return Math.min(100, Math.max(0, round((cluster.freeBytes / cluster.totalBytes) * 100, 1)));
}

const withIds = (ids, values) =>
  values.map(({ key, ...value }) => ({
    key,
    device_feature_external_id: ids.feature(key),
    ...value,
  }));

/**
 * The values of the server device: `{ key, device_feature_external_id,
 * state|text }`, nothing for a value MinIO did not give. Unreachable: only
 * "Online" (0).
 */
export function serverValues(gladys, cluster) {
  const K = SERVER_KEYS;
  if (!cluster) {
    return withIds(serverIds(gladys), [{ key: K.ONLINE, state: 0 }]);
  }
  const values = [{ key: K.ONLINE, state: 1 }];
  const push = (key, value, convert = (v) => v) => {
    if (value !== null && value !== undefined) {
      values.push({ key, state: convert(value) });
    }
  };
  push(K.HEALTHY, cluster.healthy, (v) => (v > 0 ? 1 : 0));
  if (cluster.version) {
    values.push({ key: K.VERSION, text: cluster.version.slice(0, 255) });
  }
  push(K.USED, cluster.usedBytes, gigabytes);
  push(K.FREE, cluster.freeBytes, gigabytes);
  push(K.TOTAL, cluster.totalBytes, gigabytes);
  push(K.FREE_PERCENT, freePercent(cluster));
  push(K.OBJECTS, cluster.objects);
  push(K.BUCKETS, cluster.buckets);
  push(K.DRIVES_ONLINE, cluster.drivesOnline);
  push(K.DRIVES_OFFLINE, cluster.drivesOffline);
  push(K.NODES_OFFLINE, cluster.nodesOffline);
  push(K.HEALING, cluster.healingDrives);
  return withIds(serverIds(gladys), values);
}

/** The values of a bucket device. */
export function bucketValues(gladys, bucket) {
  const values = [];
  if (bucket.sizeBytes !== null) {
    values.push({ key: BUCKET_KEYS.SIZE, state: megabytes(bucket.sizeBytes) });
  }
  if (bucket.objects !== null) {
    values.push({ key: BUCKET_KEYS.OBJECTS, state: bucket.objects });
  }
  return withIds(bucketIds(gladys, bucket.name), values);
}
