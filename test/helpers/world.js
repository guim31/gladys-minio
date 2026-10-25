// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake MinIO, a temporary
// /data and a manual clock, with the integration wired on top through
// registerHandlers. No timer runs: the tests read MinIO with
// `world.hub.pollNow()`. (Adapted from guim31/gladys-kopia.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { bucketIds, serverIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { ACCESS_KEY, BASE, FakeMinio, SECRET_KEY } from './fakeMinio.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const START = Date.UTC(2026, 9, 25, 10, 0, 0);

/** A manual clock, shared by the hub, the fake and the tests. */
export function createClock(start = START) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export async function createWorld({
  clock = createClock(),
  minio = new FakeMinio({ now: clock.now }),
  config = { url: BASE, access_key: ACCESS_KEY, secret_key: SECRET_KEY, language: 'en' },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-minio-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: minio.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, minio, app, hub: app.hub, clock, dataDir };
}

export const serverOf = (world) => serverIds(world.gladys);
export const bucketOf = (world, name) => bucketIds(world.gladys, name);

/** Add discovered devices in Gladys, as the user would (all by default). */
export async function createDevices(world, filter = () => true) {
  for (const device of world.fake.discoveredDevices.filter(filter)) {
    await world.fake.deviceCreated(device);
  }
}

/** The last state published on a feature, `state` or `text`. */
export function lastState(world, featureExternalId) {
  const states = world.fake.states.filter(
    (state) => state.device_feature_external_id === featureExternalId,
  );
  const last = states[states.length - 1];
  return last ? (last.text ?? last.state) : undefined;
}

export { ACCESS_KEY, BASE, FakeMinio, SECRET_KEY };
