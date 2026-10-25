// -----------------------------------------------------------------------------
// The hub against the fake MinIO and the SDK's fake Gladys: discovery, states,
// scene events, persistence, widget, scene actions, quiet logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { BUCKET_KEYS, SERVER_KEYS, buildServerDevice } from '../src/devices.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import {
  ACCESS_KEY,
  BASE,
  FakeMinio,
  SECRET_KEY,
  bucketOf,
  createClock,
  createDevices,
  createWorld,
  lastState,
  serverOf,
} from './helpers/world.js';

const MINUTE = 60_000;
const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);

test('discovery: the server and one device per bucket, nothing polled by Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.name),
    ['MinIO', 'backups', 'empty-bucket', 'photos'],
  );
  assert.ok(devices.every((device) => device.should_poll === false));
  assert.equal(devices[1].external_id, bucketOf(world, 'backups').device);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('the states of the added devices, sent again in full when one is created', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(world.fake.states.length, 0, 'nothing before the devices are added');
  await createDevices(world);
  const server = serverOf(world);
  assert.equal(lastState(world, server.feature(SERVER_KEYS.ONLINE)), 1);
  assert.equal(lastState(world, server.feature(SERVER_KEYS.HEALTHY)), 1);
  assert.equal(lastState(world, server.feature(SERVER_KEYS.VERSION)), '2026-10-23T20-06-51Z');
  assert.equal(lastState(world, server.feature(SERVER_KEYS.FREE)), 400);
  assert.equal(lastState(world, server.feature(SERVER_KEYS.TOTAL)), 1000);
  assert.equal(lastState(world, server.feature(SERVER_KEYS.FREE_PERCENT)), 40);
  assert.equal(lastState(world, server.feature(SERVER_KEYS.USED)), 0.01);
  assert.equal(lastState(world, server.feature(SERVER_KEYS.BUCKETS)), 3);
  assert.equal(lastState(world, server.feature(SERVER_KEYS.DRIVES_ONLINE)), 4);
  assert.equal(lastState(world, bucketOf(world, 'photos').feature(BUCKET_KEYS.SIZE)), 9);
  assert.equal(lastState(world, bucketOf(world, 'photos').feature(BUCKET_KEYS.OBJECTS)), 3);
  assert.ok(world.fake.widgetRefreshes.includes(WIDGET_KEY));

  // A read without change sends nothing.
  const before = world.fake.states.length;
  await world.hub.pollNow();
  assert.equal(world.fake.states.length, before);

  // Gladys restarted: everything again.
  await world.fake.deviceCreated(world.fake.discoveredDevices[0]);
  assert.ok(world.fake.states.length > before);
});

test('the integration reads MinIO on its own timer (Gladys never polls)', async (t) => {
  const world = await createWorld({ timers: true, config: undefined });
  t.after(() => world.app.stop());
  // A timer on the configured interval, without any onPoll from Gladys.
  await world.fake.configUpdated({
    url: BASE,
    access_key: ACCESS_KEY,
    secret_key: SECRET_KEY,
    poll_interval: '30',
  });
  const reads = world.minio.requests.length;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(world.hub.pollTimer, 'a read is scheduled');
  assert.equal(world.hub.config.pollIntervalMs, 30_000);
  assert.equal(world.minio.requests.length, reads, 'not before the interval');
});

test('unreachable after two failed reads, back with the downtime; Online follows', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const online = serverOf(world).feature(SERVER_KEYS.ONLINE);

  world.minio.down = true;
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.UNREACHABLE).length, 0, 'one failure is not an outage');
  assert.equal(lastState(world, online), 0);
  assert.equal(world.fake.connectionStatus.connected, false);
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  world.clock.advance(MINUTE);
  await world.hub.pollNow();
  const down = events(world, TRIGGERS.UNREACHABLE);
  assert.equal(down.length, 1, 'once');
  assert.deepEqual(down[0].data, { server: '192.0.2.10:9000', error: 'MinIO does not answer' });
  assert.ok(
    world.fake.transports.some(
      (entry) =>
        entry.device_external_id === serverOf(world).device && entry.transport === 'unreachable',
    ),
  );

  world.minio.down = false;
  world.clock.advance(3 * MINUTE);
  await world.hub.pollNow();
  const back = events(world, TRIGGERS.RECOVERED);
  assert.equal(back.length, 1);
  assert.deepEqual(back[0].data, { server: '192.0.2.10:9000', downtime_minutes: 5 });
  assert.equal(lastState(world, online), 1);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
});

test('a single failed read then success: no event at all', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.minio.down = true;
  await world.hub.pollNow();
  world.minio.down = false;
  await world.hub.pollNow();
  assert.equal(world.fake.sceneEvents.length, 0);
});

test('drives and nodes: offline and back, with the counts', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.minio.loseDrives(1);
  await world.hub.pollNow();
  assert.deepEqual(events(world, TRIGGERS.DRIVE_OFFLINE)[0].data, {
    server: '192.0.2.10:9000',
    drives_offline: 1,
    drives_online: 3,
    nodes_offline: 0,
    nodes_online: 4,
  });
  assert.equal(events(world, TRIGGERS.NODE_OFFLINE).length, 0);

  // A whole node: its drive and the node.
  world.minio.loseDrives(1, { nodes: 1 });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.DRIVE_OFFLINE).length, 2);
  assert.equal(events(world, TRIGGERS.NODE_OFFLINE).length, 1);
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.DRIVE_OFFLINE).length, 2, 'no repeat');

  world.minio.restoreDrives();
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.DRIVE_RECOVERED).length, 1);
  assert.equal(events(world, TRIGGERS.NODE_RECOVERED).length, 1);
  assert.equal(events(world, TRIGGERS.DRIVE_RECOVERED)[0].data.drives_offline, 0);
});

test('a drive lost while the integration was stopped is announced at restart, once', async (t) => {
  const clock = createClock();
  const first = await createWorld({ clock });
  await first.app.stop();
  const minio = new FakeMinio({ now: clock.now });
  minio.loseDrives(1);
  const second = await createWorld({ clock, minio, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.equal(events(second, TRIGGERS.DRIVE_OFFLINE).length, 1);
  await second.app.stop();
  const saved = JSON.parse(await readFile(join(first.dataDir, 'minio-state.json'), 'utf8'));
  assert.equal(saved.drivesOffline, 1);
  const third = await createWorld({ clock, minio, dataDir: first.dataDir });
  t.after(() => third.app.stop());
  assert.equal(events(third, TRIGGERS.DRIVE_OFFLINE).length, 0);
});

test('low free space: fires under the threshold, once, again after climbing back', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const GB = 1e9;
  world.minio.cluster.freeBytes = 95 * GB; // 9.5 % < 10 %
  await world.hub.pollNow();
  const fired = events(world, TRIGGERS.LOW_SPACE);
  assert.equal(fired.length, 1);
  assert.deepEqual(fired[0].data, {
    server: '192.0.2.10:9000',
    free_percent: 9.5,
    free_space: '95 GB',
    threshold: 10,
  });
  world.minio.cluster.freeBytes = 80 * GB;
  await world.hub.pollNow();
  world.minio.cluster.freeBytes = 105 * GB; // 10.5 %: within the hysteresis
  await world.hub.pollNow();
  world.minio.cluster.freeBytes = 95 * GB;
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.LOW_SPACE).length, 1, 'no flapping');
  world.minio.cluster.freeBytes = 120 * GB; // 12 %: re-armed
  await world.hub.pollNow();
  world.minio.cluster.freeBytes = 90 * GB;
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.LOW_SPACE).length, 2);
});

test('a new threshold is not an event', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.configUpdated({
    url: BASE,
    access_key: ACCESS_KEY,
    secret_key: SECRET_KEY,
    language: 'en',
    low_space_percent: 50, // 40 % free is now under it
  });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.LOW_SPACE).length, 0);
});

test('configuration problems: readable status, no Online 0, no outage event', async (t) => {
  const missing = await createWorld({ config: {} });
  t.after(() => missing.app.stop());
  assert.match(missing.fake.connectionStatus.message.en, /address of your MinIO/);
  assert.deepEqual(missing.fake.discoveredDevices, []);

  const noSecret = await createWorld({ config: { url: BASE, access_key: ACCESS_KEY } });
  t.after(() => noSecret.app.stop());
  assert.match(noSecret.fake.connectionStatus.message.en, /secret key/);

  const wrong = await createWorld({
    config: { url: BASE, access_key: ACCESS_KEY, secret_key: 'wrong', language: 'en' },
  });
  t.after(() => wrong.app.stop());
  await wrong.hub.pollNow();
  await wrong.hub.pollNow();
  assert.match(wrong.fake.connectionStatus.message.en, /access refused/);
  assert.equal(wrong.fake.sceneEvents.length, 0);
  assert.equal(wrong.fake.states.length, 0);
});

test('a bucket deleted in MinIO: its device turns unreachable', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.minio.buckets.delete('photos');
  await world.hub.pollNow();
  const id = bucketOf(world, 'photos').device;
  const last = world.fake.transports.filter((entry) => entry.device_external_id === id).pop();
  assert.equal(last.transport, 'unreachable');
  assert.equal(world.fake.discoveredDevices.length, 3);
});

test('the widget: gauge, tiles, buckets largest first, within the budget', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr' });
  assert.equal(ack.success, true, ack.error);
  const content = ack.data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  const types = content.components.map((component) => component.type);
  assert.deepEqual(types, ['gauge', 'value', 'value', 'value', 'status', 'button']);
  assert.equal(content.components[0].value, 60);
  assert.equal(content.components[1].value, '400 GB');
  assert.deepEqual(
    content.components[4].items.map((item) => [item.label, item.value]),
    [
      ['photos', '9 MB · 3 obj.'],
      ['backups', '3 MB · 1 obj.'],
      ['empty-bucket', '0 B · 0 obj.'],
    ],
  );

  // A chosen bucket only; a wrong id is ignored.
  await createDevices(world);
  const chosen = await world.fake.widgetGet(WIDGET_KEY, {
    settings: { buckets: [bucketOf(world, 'backups').device, 'nope'] },
  });
  assert.equal(chosen.data.content.components[4].items.length, 1);

  // MinIO down: the reason, no figures.
  world.minio.down = true;
  await world.hub.pollNow();
  const down = await world.fake.widgetGet(WIDGET_KEY, { settings: {} });
  assert.deepEqual(validateWidgetContent(down.data.content), []);
  assert.deepEqual(
    down.data.content.components.map((component) => component.type),
    ['text', 'button'],
  );

  // The Refresh button reads again.
  world.minio.down = false;
  const refreshed = await world.fake.widgetAction(WIDGET_KEY, 'refresh');
  assert.equal(refreshed.success, true, refreshed.error);
  assert.equal(world.hub.error, null);
});

test('the widget with many buckets keeps ten rows, and the write quorum lost', async (t) => {
  const world = await createWorld({ connect: false });
  for (let index = 0; index < 15; index += 1) {
    world.minio.buckets.set(`bucket-${index}`, { size: index * 1e6, objects: index });
  }
  world.minio.cluster.healthy = 0;
  world.minio.loseDrives(2);
  await world.gladys.connect();
  await world.app.ready;
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {} });
  const content = ack.data.content;
  assert.deepEqual(validateWidgetContent(content), []);
  const status = content.components.find((component) => component.type === 'status');
  assert.equal(status.items.length, 10);
  assert.equal(status.items[9].value, '+9');
  assert.ok(content.components.some((component) => component.type === 'text'));
  const drives = content.components.find((c) => c.type === 'value' && c.value === 2);
  assert.equal(drives.color, 'danger');
});

test('scene actions: the server and a bucket, in the language of the configuration', async (t) => {
  const world = await createWorld({
    config: { url: BASE, access_key: ACCESS_KEY, secret_key: SECRET_KEY, language: 'fr' },
  });
  t.after(() => world.app.stop());
  const server = await world.fake.sceneAction('get_server_status', {});
  assert.equal(server.success, true, server.error);
  const outputs = server.data.outputs;
  assert.equal(outputs.online, true);
  assert.equal(outputs.free_percent, 40);
  assert.equal(outputs.free_space, '400 GB');
  assert.equal(outputs.sentence, 'MinIO : 400 GB libres (40 %), 0 disque(s) hors ligne.');

  const bucket = await world.fake.sceneAction('get_bucket_status', {
    device: bucketOf(world, 'photos').device,
  });
  assert.equal(bucket.success, true, bucket.error);
  assert.deepEqual(bucket.data.outputs, {
    name: 'photos',
    size: '9 MB',
    size_mb: 9,
    objects: 3,
    sentence: 'Bucket photos : 9 MB, 3 objet(s).',
  });

  const unknown = await world.fake.sceneAction('get_bucket_status', {
    device: serverOf(world).device,
  });
  assert.equal(unknown.success, false);
  assert.match(unknown.error, /pas un bucket MinIO/);

  // Down: the server action still answers (online false), the bucket one fails.
  world.minio.down = true;
  world.clock.advance(MINUTE);
  const down = await world.fake.sceneAction('get_server_status', {});
  assert.equal(down.success, true, down.error);
  assert.equal(down.data.outputs.online, false);
  assert.equal(down.data.outputs.sentence, 'MinIO ne répond pas.');
  const bucketDown = await world.fake.sceneAction('get_bucket_status', {
    device: bucketOf(world, 'photos').device,
  });
  assert.equal(bucketDown.success, false);
});

test('Test the connection: a one-line report in four languages', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    ack.data.en ?? ack.data.message?.en ?? JSON.stringify(ack.data),
    'MinIO: Connected, version 2026-10-23T20-06-51Z, 400 GB free (40 %), 4 drive(s) online, 0 offline, 3 bucket(s)',
  );
});

test('before the first pass of the scanner: no used space, no objects, no error', async (t) => {
  const world = await createWorld({ connect: false });
  world.minio.cluster.scanned = false;
  await world.gladys.connect();
  await world.app.ready;
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.deepEqual(world.fake.connectionStatus, { connected: true });
  assert.equal(lastState(world, serverOf(world).feature(SERVER_KEYS.OBJECTS)), undefined);
  assert.equal(lastState(world, serverOf(world).feature(SERVER_KEYS.DRIVES_ONLINE)), 4);
  assert.deepEqual(
    world.fake.discoveredDevices.map((device) => device.name),
    ['MinIO'],
  );
});

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}

test('quiet logs: a normal reading cycle writes nothing at info level, nor the secret', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const quiet = await captureLogs(t, 'info', async () => {
    for (let cycle = 0; cycle < 3; cycle += 1) {
      world.minio.buckets.get('photos').size += 1e6; // a change of figures is no news
      world.clock.advance(MINUTE);
      await world.hub.pollNow();
    }
  });
  assert.deepEqual(quiet, []);
  const debug = await captureLogs(t, 'debug', async () => {
    world.minio.down = true;
    await world.hub.pollNow();
    await world.hub.pollNow();
    world.minio.down = false;
    await world.hub.pollNow();
  });
  assert.ok(debug.length > 0);
  assert.ok(!debug.join('\n').includes(SECRET_KEY));
  assert.ok(!debug.join('\n').includes('Bearer'));
});

test('the language of the names follows the configuration', async (t) => {
  const world = await createWorld({
    config: { url: BASE, access_key: ACCESS_KEY, secret_key: SECRET_KEY, language: 'de' },
  });
  t.after(() => world.app.stop());
  const server = world.fake.discoveredDevices[0];
  assert.deepEqual(server, buildServerDevice(world.gladys, 'de'));
  assert.ok(server.features.some((feature) => feature.name === 'Laufwerke offline'));
});
