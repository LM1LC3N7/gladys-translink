// -----------------------------------------------------------------------------
// Scene triggers (computed between two polls) and scene actions.
// -----------------------------------------------------------------------------

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { restoreFetch, stubFetch } from './helpers/stubFetch.js';
import { alertsFeed, lineAlert } from './helpers/fixtures.js';
import { encodeFeed } from './helpers/gtfsRealtimeEncoder.js';
import { normalizeConfig } from '../src/config.js';
import { pollDevice } from '../src/devices/index.js';
import { clearPollSchedule } from '../src/devices/pollSchedule.js';
import { clearStateCache } from '../src/devices/stateCache.js';
import { clearReadings } from '../src/devices/readings.js';
import {
  bikeStationEvents,
  clearSceneMemory,
  departureCrossings,
  lineEvents,
  SCENE_TRIGGERS,
} from '../src/scenes/triggers.js';
import { SCENE_ACTIONS } from '../src/scenes/actions.js';
import { clearRealtimeCache } from '../src/api/realtime.js';
import { LINE_STATUS } from '../src/api/lines.js';
import { NETWORK } from '../src/network.js';

const TRIP_UPDATES_PATH = new URL(NETWORK.realtime.tripUpdatesUrl).pathname;
const ALERTS_PATH = new URL(NETWORK.realtime.alertsUrl).pathname;

const config = normalizeConfig({ api_key: 'k', stops: '50040', language: 'fr' });

beforeEach(() => {
  clearPollSchedule();
  clearStateCache();
  clearReadings();
  clearSceneMemory();
  clearRealtimeCache();
});
afterEach(() => restoreFetch());

const bus = (tripId, minutes, route = '50') => ({ tripId, route, minutes });

test('a bus is followed by its trip: every threshold it crosses fires once', () => {
  assert.deepEqual(
    departureCrossings([bus('A', 11)], [bus('A', 4)]).map((crossing) => crossing.threshold),
    [5, 10],
  );
  // The next bus taking the place of the one that left is not a crossing.
  assert.deepEqual(departureCrossings([bus('A', 1)], [bus('B', 9)]), []);
  // A bus appearing on the board did not approach.
  assert.deepEqual(departureCrossings([], [bus('A', 2)]), []);
});

test('line events: one per line whose status changed, unknown is a hole', () => {
  const lines = (statuses) =>
    Object.entries(statuses).map(([id, status]) => ({
      id,
      status,
      message: '',
      name: { en: id, fr: id },
    }));
  const { NORMAL, DISRUPTED, NOTICE, UNKNOWN } = LINE_STATUS;
  assert.deepEqual(
    lineEvents(
      { lines: lines({ 1: NORMAL, 2: DISRUPTED, 4: NORMAL, 5: DISRUPTED }) },
      { lines: lines({ 1: DISRUPTED, 2: NORMAL, 4: NOTICE, 5: UNKNOWN }) },
    ).map(({ line, event }) => [line.id, event]),
    [
      ['1', 'disrupted'],
      ['2', 'restored'],
      ['4', 'notice'],
    ],
  );
});

test('a station leaving and coming back to the feed is one event each way', () => {
  const live = { bikes: 3, docks: 4, installed: true };
  const removed = { bikes: 0, docks: 0, installed: false, absent: true };
  assert.deepEqual(bikeStationEvents(live, removed), ['out_of_service']);
  assert.deepEqual(bikeStationEvents(removed, removed), []);
  assert.deepEqual(bikeStationEvents(removed, live), ['back_in_service']);
  // Already out of service before it was removed: nothing new to announce.
  assert.deepEqual(bikeStationEvents({ ...live, installed: false }, removed), []);
});

test('bike station events', () => {
  assert.deepEqual(bikeStationEvents({ bikes: 2, docks: 0 }, { bikes: 0, docks: 2 }), [
    'no_bike',
    'docks_back',
  ]);
  assert.deepEqual(bikeStationEvents({ installed: true }, { installed: false }), [
    'out_of_service',
  ]);
  assert.deepEqual(bikeStationEvents({}, { bikes: 0 }), []);
});

test('the line trigger fires on the second poll, never on the first', async () => {
  const gladys = createFakeGladys();
  stubFetch({ [ALERTS_PATH]: alertsFeed([]) });
  await pollDevice(gladys, { external_id: 'transit-lines:network' }, config);
  assert.deepEqual(gladys.sceneEvents, []);

  restoreFetch();
  stubFetch({ [ALERTS_PATH]: alertsFeed([lineAlert('canada', 'No service.')]) });
  clearPollSchedule();
  await pollDevice(gladys, { external_id: 'transit-lines:network' }, config);
  assert.equal(gladys.sceneEvents.length, 1);
  assert.equal(gladys.sceneEvents[0].key, SCENE_TRIGGERS.LINE_STATUS_CHANGED);
  assert.deepEqual(gladys.sceneEvents[0].data, {
    line: 'canada',
    line_name: 'Ligne Canada',
    event: 'disrupted',
    message: 'No service.',
  });
});

test('the departure trigger carries the stop device and the threshold as a string', async () => {
  const gladys = createFakeGladys();
  const now = Math.floor(Date.now() / 1000);
  const feedAt = (seconds) =>
    encodeFeed({
      entities: [
        {
          tripUpdate: {
            trip: { tripId: 'T1', routeId: '6637' },
            stopTimeUpdates: [{ stopId: '40', departure: { time: now + seconds } }],
          },
        },
      ],
    });
  stubFetch({ [TRIP_UPDATES_PATH]: feedAt(7 * 60 + 30) });
  await pollDevice(gladys, { external_id: 'transit-stop:50040' }, config);
  restoreFetch();
  stubFetch({ [TRIP_UPDATES_PATH]: feedAt(4 * 60 + 30) });
  clearPollSchedule();
  clearRealtimeCache();
  await pollDevice(gladys, { external_id: 'transit-stop:50040' }, config);

  assert.deepEqual(gladys.sceneEvents, [
    {
      key: SCENE_TRIGGERS.DEPARTURE_APPROACHING,
      data: {
        stop: 'transit-stop:50040',
        stop_name: 'TransLink – Waterfront Station @ Bay 2',
        route: '50',
        threshold: '5',
        minutes: 4,
      },
    },
  ]);
});

test('scene action get_next_departures reads now and filters by route', async () => {
  const now = Math.floor(Date.now() / 1000);
  stubFetch({
    [TRIP_UPDATES_PATH]: encodeFeed({
      entities: [
        {
          tripUpdate: {
            trip: { tripId: 'A', routeId: '6612' },
            stopTimeUpdates: [{ stopId: '40', departure: { time: now + 90 } }],
          },
        },
        {
          tripUpdate: {
            trip: { tripId: 'B', routeId: '6637' },
            stopTimeUpdates: [{ stopId: '40', departure: { time: now + 400 } }],
          },
        },
      ],
    }),
  });
  const outputs = await SCENE_ACTIONS.get_next_departures(createFakeGladys(), {
    // "050" is how TransLink writes the 50: both read the same.
    fields: { stop: 'transit-stop:50040', route: '050' },
    config,
  });
  assert.deepEqual(outputs, {
    route: '50',
    minutes: 6,
    following_minutes: null,
    summary: '50 6 min',
    count: 1,
  });
});

test('scene action get_line_status', async () => {
  stubFetch({ [ALERTS_PATH]: alertsFeed([lineAlert('expo')]) });
  const outputs = await SCENE_ACTIONS.get_line_status(createFakeGladys(), {
    fields: { line: 'expo' },
    config,
  });
  assert.equal(outputs.line_name, 'Ligne Expo');
  assert.equal(outputs.status, 'disrupted');
  assert.equal(outputs.status_label, 'Perturbé');
  assert.equal(outputs.normal, false);

  await assert.rejects(
    SCENE_ACTIONS.get_line_status(createFakeGladys(), {
      fields: { line: 'expo' },
      config: normalizeConfig({ api_key: 'k', watch_lines: false }),
    }),
    /lines are not watched/,
  );
});
