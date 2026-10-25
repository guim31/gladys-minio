// -----------------------------------------------------------------------------
// The MinIO hub: the metrics read on a timer of the container (the interval
// chosen in the configuration); the states of the added devices published
// when they change, the scene events fired on what happens to the server,
// and the views the widget and the scene actions read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 15 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire whether the devices are added or not.
//
// What the scene events compare with (drives and nodes offline, free space
// under the threshold) is kept in /data (src/store.js): a drive lost while
// the integration or Gladys restarted is still announced, once.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  buildBucketDevice,
  buildServerDevice,
  bucketIds,
  bucketValues,
  freePercent,
  parseBucketName,
  serverIds,
  serverValues,
} from './devices.js';
import { ERROR_KINDS, MinioClient, MinioError } from './minio/client.js';
import { hostOf, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  REPORT_TEXT,
  formatBytes,
  formatPercent,
  labelled,
  pick,
} from './texts.js';

const logger = createLogger({ name: 'minio-hub' });

export const WIDGET_KEY = 'minio';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  UNREACHABLE: 'server_unreachable',
  RECOVERED: 'server_recovered',
  DRIVE_OFFLINE: 'drive_offline',
  DRIVE_RECOVERED: 'drive_recovered',
  NODE_OFFLINE: 'node_offline',
  NODE_RECOVERED: 'node_recovered',
  LOW_SPACE: 'low_free_space',
});

export const HUB_TIMINGS = {
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads MinIO again when the last read is older.
  freshMs: 15_000,
};

// Failed reads in a row before "MinIO no longer answers": a single lost
// request (a restart of MinIO, a busy network) is not an outage.
export const FAILURES_BEFORE_UNREACHABLE = 2;

// The free space must climb this many points above the threshold before a new
// "low free space" can fire: no flapping around the threshold.
export const LOW_SPACE_HYSTERESIS = 1;

// Kinds of failure that mean "the server is down", not "the configuration is wrong".
const OUTAGE_KINDS = new Set([ERROR_KINDS.UNREACHABLE, ERROR_KINDS.HTTP]);

const MAX_TRANSPORTS_PER_REQUEST = 100;

export class MinioHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/minio/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    /** @type {object|null} the cluster view of the last successful read */
    this.cluster = null;
    /** @type {Map<string, object>} the buckets of the last successful read, by name */
    this.buckets = new Map();
    this.readAt = 0;
    this.error = null;
    this.failures = 0;
    this.downSince = null;
    this.downAnnounced = false;
    this.polling = null;
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.widgetKey = null;
    this.saved = {};
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = saved && typeof saved === 'object' ? saved : {};
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.signature !== null && this.config.language !== config.language;
    const thresholdChanged =
      this.signature !== null && this.config.lowSpacePercent !== config.lowSpacePercent;
    this.config = config;
    const signature = JSON.stringify([
      config.url,
      config.accessKey,
      config.secretKey,
      config.acceptSelfSigned,
    ]);
    if (signature !== this.signature) {
      if (config.url && this.saved.url !== config.url) {
        // Another server: what was seen of the previous one means nothing here.
        this.saved = { url: config.url };
        this.store.save(this.saved);
      }
      this.signature = signature;
      this.client =
        config.url && !(config.accessKey && !config.secretKey)
          ? new MinioClient({
              url: config.url,
              accessKey: config.accessKey,
              secretKey: config.secretKey,
              acceptSelfSigned: config.acceptSelfSigned,
              request: this.request,
              now: this.now,
            })
          : null;
      this.cluster = null;
      this.buckets = new Map();
      this.readAt = 0;
      this.error = null;
      this.failures = 0;
      this.downSince = null;
      this.downAnnounced = false;
      this.polling = null;
    }
    if (languageChanged) {
      this.discovered = null; // new names for the Discovery tab
      this.widgetKey = null;
    }
    if (thresholdChanged) {
      // A new threshold is not an event: the state under it is only recorded.
      delete this.saved.lowSpace;
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterRead({ publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading MinIO works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading MinIO -----------------------------------------------------------

  /** Read the server now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    await this.poll();
    await this.afterRead({ publish });
  }

  /** Read again when the last read is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /** Read the server and apply what changed. Concurrent calls share the read. */
  poll() {
    if (!this.client) {
      return Promise.resolve();
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    let result;
    try {
      result = await client.read();
    } catch (err) {
      if (!(err instanceof MinioError)) {
        throw err;
      }
      if (client === this.client) {
        await this.applyFailure(err);
      }
      return;
    }
    if (client === this.client) {
      await this.applySuccess(result);
    }
  }

  async applySuccess({ cluster, buckets }) {
    const now = this.now();
    if (this.error) {
      logger.info('MinIO answers again');
    }
    if (this.readAt === 0 || this.error) {
      logger.info(
        `MinIO (${hostOf(this.config.url)}): version ${cluster.version ?? '?'}, ` +
          `${cluster.drivesOnline ?? '?'} drive(s) online, ${buckets.length} bucket(s)`,
      );
    }
    if (this.downAnnounced) {
      await this.fire(TRIGGERS.RECOVERED, {
        downtime_minutes: Math.max(0, Math.round((now - this.downSince) / 60_000)),
      });
    }
    this.error = null;
    this.failures = 0;
    this.downSince = null;
    this.downAnnounced = false;
    this.readAt = now;
    this.cluster = cluster;
    this.buckets = new Map(buckets.map((bucket) => [bucket.name, bucket]));
    if (await this.transition(cluster)) {
      this.saved.url = this.config.url;
      // Written only when something changed: no wear of the SD card at every read.
      this.store.save(this.saved);
    }
    await this.publishStates();
  }

  async applyFailure(err) {
    const now = this.now();
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.readAt = now;
    if (wasError !== err.kind) {
      logger.warn(`MinIO: ${err.message}`);
    }
    if (!OUTAGE_KINDS.has(err.kind)) {
      return;
    }
    this.failures += 1;
    this.downSince ??= now;
    if (this.failures === FAILURES_BEFORE_UNREACHABLE && !this.downAnnounced) {
      this.downAnnounced = true;
      logger.info('MinIO no longer answers');
      await this.fire(TRIGGERS.UNREACHABLE, {
        error: pick(ERROR_TEXT[err.kind], this.config.language),
      });
    }
    await this.publishStates(); // "Online" goes to 0
  }

  /**
   * Compare the cluster with what was seen before and fire the scene events
   * of drives and nodes going offline or back, and of the free space going
   * under the threshold. The first sight only records.
   * @returns {boolean} whether the saved state changed
   */
  async transition(cluster) {
    let dirty = false;
    const counts = [
      ['drivesOffline', TRIGGERS.DRIVE_OFFLINE, TRIGGERS.DRIVE_RECOVERED, 'drive'],
      ['nodesOffline', TRIGGERS.NODE_OFFLINE, TRIGGERS.NODE_RECOVERED, 'node'],
    ];
    for (const [key, offline, recovered, what] of counts) {
      const value = cluster[key];
      if (value === null) {
        continue;
      }
      const previous = this.saved[key];
      if (previous === value) {
        continue;
      }
      if (typeof previous === 'number') {
        logger.info(`MinIO: ${value} ${what}(s) offline (was ${previous})`);
        await this.fire(value > previous ? offline : recovered, this.countVariables(cluster));
      }
      this.saved[key] = value;
      dirty = true;
    }

    const percent = freePercent(cluster);
    if (percent !== null) {
      const threshold = this.config.lowSpacePercent;
      const below = percent < threshold;
      if (typeof this.saved.lowSpace !== 'boolean') {
        this.saved.lowSpace = below;
        dirty = true;
      } else if (!this.saved.lowSpace && below) {
        logger.info(`MinIO: free space ${percent} % under ${threshold} %`);
        await this.fire(TRIGGERS.LOW_SPACE, {
          free_percent: percent,
          free_space: formatBytes(cluster.freeBytes, this.config.language),
          threshold,
        });
        this.saved.lowSpace = true;
        dirty = true;
      } else if (this.saved.lowSpace && percent >= threshold + LOW_SPACE_HYSTERESIS) {
        this.saved.lowSpace = false;
        dirty = true;
      }
    }
    return dirty;
  }

  countVariables(cluster) {
    return {
      drives_offline: cluster.drivesOffline ?? 0,
      drives_online: cluster.drivesOnline ?? 0,
      nodes_offline: cluster.nodesOffline ?? 0,
      nodes_online: cluster.nodesOnline ?? 0,
    };
  }

  async fire(key, extra = {}) {
    try {
      await this.gladys.publishSceneEvent(key, {
        server: hostOf(this.config.url),
        ...extra,
      });
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  discoveredDevices() {
    if (!this.client) {
      return [];
    }
    if (!this.cluster || this.error) {
      return null; // nothing read: keep the list Gladys has
    }
    const language = this.config.language;
    return [
      buildServerDevice(this.gladys, language),
      ...[...this.buckets.values()].map((bucket) =>
        buildBucketDevice(this.gladys, bucket, language),
      ),
    ];
  }

  /** Publish the Discovery list when it changed (a bucket created or deleted…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices();
    if (devices === null) {
      return;
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read MinIO, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.afterRead({ publish: true });
  }

  /**
   * The user added (or updated) a device: its states sent before were dropped
   * by Gladys, and a device deleted then added again needs its badge.
   */
  async onDeviceCreated(device) {
    this.gladys.forgetPublishedStates?.(device.external_id);
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /** True while the last failure means MinIO is down (not a configuration problem). */
  isDown() {
    return Boolean(this.error && OUTAGE_KINDS.has(this.error.kind));
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`).
   */
  async publishStates() {
    const states = [];
    const serverCreated = this.isCreated(serverIds(this.gladys).device);
    if (this.error) {
      // Down: only "Online" goes to 0. A configuration problem says nothing
      // about the server: nothing is sent.
      if (serverCreated && this.isDown()) {
        states.push(...serverValues(this.gladys, null));
      }
    } else if (this.cluster) {
      if (serverCreated) {
        states.push(...serverValues(this.gladys, this.cluster));
      }
      for (const bucket of this.buckets.values()) {
        if (this.isCreated(bucketIds(this.gladys, bucket.name).device)) {
          states.push(...bucketValues(this.gladys, bucket));
        }
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(
        states.map(({ key: _key, ...state }) => state),
        { heartbeat: this.timings.heartbeatMs },
      );
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterRead({ publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    // The widget is pulled again only when what it shows changed.
    const key = JSON.stringify([
      this.error?.kind ?? null,
      this.cluster && freePercent(this.cluster),
      this.cluster?.drivesOffline,
      this.cluster?.nodesOffline,
      this.cluster?.healthy,
      this.cluster?.objects,
      [...this.buckets.values()].map((b) => [b.name, b.sizeBytes, b.objects]),
    ]);
    if (key !== this.widgetKey) {
      this.widgetKey = key;
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /**
   * The badge of the added devices: local, or unreachable (MinIO does not
   * answer, or the bucket no longer exists).
   */
  async publishTransports() {
    if (!this.client || this.readAt === 0) {
      return;
    }
    const prefix = bucketIds(this.gladys, '').device;
    const entries = [];
    for (const device of this.gladys.devices ?? []) {
      const externalId = device.external_id;
      let reachable;
      if (externalId === serverIds(this.gladys).device) {
        reachable = !this.error;
      } else if (typeof externalId === 'string' && externalId.startsWith(prefix)) {
        reachable = !this.error && this.buckets.has(parseBucketName(this.gladys, externalId));
      } else {
        continue;
      }
      const transport = reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (!this.config.urlTyped) {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (this.config.accessKey && !this.config.secretKey) {
      return { connected: false, message: CONNECTION_TEXT.noSecret };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, scene actions, report) ------------------------------------------

  /** The bucket of a device external id, null when it is not one (or no longer exists). */
  findBucket(externalId) {
    const name = parseBucketName(this.gladys, externalId);
    return name ? (this.buckets.get(name) ?? null) : null;
  }

  /** Throws the reason MinIO cannot be read, unless it is only down. */
  assertConfigured() {
    const status = this.connectionStatus();
    if (!status.connected && !this.isDown()) {
      throw new Error(pick(status.message, this.config.language));
    }
  }

  /** Read again if stale, for a scene action; throws on a configuration problem. */
  async freshView() {
    if (!this.client) {
      this.assertConfigured();
    }
    await this.refreshIfStale();
    this.assertConfigured();
  }

  /** The bucket of a device, read again if stale; throws a readable error. */
  async bucketOf(externalId) {
    await this.freshView();
    if (this.isDown()) {
      throw new Error(pick(ERROR_TEXT[this.error.kind], this.config.language));
    }
    const bucket = this.findBucket(externalId);
    if (!bucket) {
      throw new Error(pick(ACTION_TEXT.unknownBucket, this.config.language));
    }
    return bucket;
  }

  /** "Test the connection": read MinIO now, one line. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const message = {};
    const status = this.connectionStatus();
    const cluster = this.cluster;
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (!status.connected) {
        message[language] = pick(status.message, language);
        continue;
      }
      const parts = [text.ok];
      if (cluster.version) {
        parts.push(text.version(cluster.version));
      }
      const percent = freePercent(cluster);
      if (percent !== null) {
        parts.push(
          text.free(formatBytes(cluster.freeBytes, language), formatPercent(percent, language)),
        );
      }
      if (cluster.drivesOnline !== null) {
        parts.push(text.drives(cluster.drivesOnline, cluster.drivesOffline ?? 0));
      }
      parts.push(text.buckets(this.buckets.size));
      if (cluster.healthy === 0) {
        parts.push(text.unhealthy);
      }
      message[language] = labelled('MinIO', parts.join(', '), language);
    }
    return message;
  }
}

export { ERROR_KINDS };
