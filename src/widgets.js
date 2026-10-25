// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `minio`.
//
// The use case: a glance at the wall tablet tells how full the storage is,
// whether a drive is missing, and which bucket takes the space. So the widget
// shows a gauge of the capacity used, the free space, the drives offline and
// the objects, then one row per bucket, the largest first, with its size and
// its objects.
//
// Every bucket by default, or the ones chosen in the widget settings (devices
// added to Gladys). The figures are sent as values, not bound to device
// features: the widget works before the devices are added.
//
// Budget (8 components, 2 texts): four tiles, one text when MinIO does not
// answer or lost its write quorum, one status list of ten rows at most, a
// Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { freePercent } from './devices.js';
import { WIDGET_KEY, isLowSpace } from './hub.js';
import { ERROR_TEXT, formatBytes, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  pick: {
    en: 'Enter the address of your MinIO server in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre serveur MinIO dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines MinIO-Servers in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su servidor MinIO en la configuración de la integración.',
  },
  unhealthy: {
    en: 'Write quorum lost: MinIO refuses new objects until enough drives are back.',
    fr: "Quorum d'écriture perdu : MinIO refuse les nouveaux objets tant que trop de disques manquent.",
    de: 'Schreib-Quorum verloren: MinIO lehnt neue Objekte ab, bis genug Laufwerke zurück sind.',
    es: 'Quórum de escritura perdido: MinIO rechaza objetos nuevos hasta que vuelvan suficientes discos.',
  },
  used: { en: 'Used', fr: 'Utilisé', de: 'Belegt', es: 'Usado' },
  free: { en: 'Free', fr: 'Libre', de: 'Frei', es: 'Libre' },
  drivesOffline: {
    en: 'Drives offline',
    fr: 'Disques hors ligne',
    de: 'Laufwerke offline',
    es: 'Discos fuera de línea',
  },
  objects: { en: 'Objects', fr: 'Objets', de: 'Objekte', es: 'Objetos' },
  objectCount: {
    en: (count) => `${count} obj.`,
    fr: (count) => `${count} obj.`,
    de: (count) => `${count} Obj.`,
    es: (count) => `${count} obj.`,
  },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'MinIO read again.',
    fr: 'MinIO relu.',
    de: 'MinIO neu gelesen.',
    es: 'MinIO leído de nuevo.',
  },
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** The buckets the widget shows: the chosen devices, or every bucket. */
export function selectBuckets(hub, settings) {
  const chosen = [settings?.buckets ?? []].flat().filter((id) => typeof id === 'string' && id);
  if (chosen.length === 0) {
    return [...hub.buckets.values()];
  }
  return [...new Set(chosen)].map((id) => hub.findBucket(id)).filter(Boolean);
}

/** The largest first, then by name. */
export const sortBuckets = (buckets) =>
  [...buckets].sort(
    (a, b) => (b.sizeBytes ?? -1) - (a.sizeBytes ?? -1) || a.name.localeCompare(b.name),
  );

function usedColor(free, threshold) {
  if (isLowSpace(free, threshold)) {
    return WIDGET_COLORS.DANGER;
  }
  return isLowSpace(free, 2 * threshold) ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS;
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    // No address, an address not understood or a secret key missing: say which.
    const status = hub.connectionStatus();
    return message(status.connected ? TEXT.pick : status.message, language);
  }
  const cluster = hub.error ? null : hub.cluster;
  const components = [];
  const free = cluster ? freePercent(cluster) : null;
  if (free !== null) {
    const used = Math.round((100 - free) * 10) / 10;
    components.push({
      type: 'gauge',
      value: used,
      min: 0,
      max: 100,
      unit: '%',
      label: pick(TEXT.used, language),
      color: usedColor(free, hub.config.lowSpacePercent),
    });
    components.push({
      type: 'value',
      value: fit(formatBytes(cluster.freeBytes, language), 12),
      label: pick(TEXT.free, language),
      icon: 'hard-drive',
      color: isLowSpace(free, hub.config.lowSpacePercent)
        ? WIDGET_COLORS.DANGER
        : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (cluster && cluster.drivesOffline !== null) {
    components.push({
      type: 'value',
      value: cluster.drivesOffline,
      label: pick(TEXT.drivesOffline, language),
      icon: 'alert-triangle',
      color: cluster.drivesOffline > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.SUCCESS,
    });
  }
  if (cluster && cluster.objects !== null) {
    components.push({
      type: 'value',
      value: cluster.objects,
      label: pick(TEXT.objects, language),
      icon: 'file',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }

  if (hub.error) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  } else if (cluster?.healthy === 0) {
    components.push({ type: 'text', variant: 'body', text: pick(TEXT.unhealthy, language) });
  }

  const buckets = cluster ? sortBuckets(selectBuckets(hub, settings)) : [];
  if (buckets.length > 0) {
    const shown = buckets.length > MAX_ROWS ? buckets.slice(0, MAX_ROWS - 1) : buckets;
    const items = shown.map((bucket) => ({
      label: fit(bucket.name, 40),
      value: fit(
        bucket.objects === null
          ? formatBytes(bucket.sizeBytes, language)
          : `${formatBytes(bucket.sizeBytes, language)} · ${pick(TEXT.objectCount, language)(bucket.objects)}`,
        40,
      ),
      icon: 'archive',
      color: WIDGET_COLORS.PRIMARY,
    }));
    if (buckets.length > shown.length) {
      items.push({
        label: pick(TEXT.more, language),
        value: `+${buckets.length - shown.length}`,
        icon: 'more-horizontal',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({ type: 'status', items });
  }

  components.push({
    type: 'button',
    label: pick(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });

  return { ttl_seconds: hub.error ? 30 : 120, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  // Taps in a row read MinIO once: a failure counts once toward "no longer answers".
  await hub.refreshIfStale();
  if (hub.error) {
    return { message: ERROR_TEXT[hub.error.kind] };
  }
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
