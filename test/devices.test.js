// -----------------------------------------------------------------------------
// Devices: discovery payloads, polling, publication, manifest actions.
// -----------------------------------------------------------------------------

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { restoreFetch, stubFetch } from './helpers/stubFetch.js';
import {
  alertsFeed,
  bikeRoutes,
  DISCOVERY,
  INFORMATION,
  lineAlert,
  STATUS,
  stopTimesPayload,
  VEHICLE_TYPES,
} from './helpers/fixtures.js';
import { encodeFeed } from './helpers/gtfsRealtimeEncoder.js';
import { GLADYS_POLL_FREQUENCIES_MS, normalizeConfig } from '../src/config.js';
import {
  ACTIONS,
  buildBlueprints,
  buildDiscoveredDevices,
  findSelectedBlueprint,
  DeviceSelectionError,
  pollDevice,
  refreshDeviceNow,
} from '../src/devices/index.js';
import { NO_DEPARTURE_MINUTES } from '../src/devices/stop.js';
import { clearPollSchedule } from '../src/devices/pollSchedule.js';
import { clearStateCache } from '../src/devices/stateCache.js';
import { clearPublishReports } from '../src/devices/publish.js';
import { clearReadings } from '../src/devices/readings.js';
import { clearSceneMemory } from '../src/scenes/triggers.js';
import { clearRealtimeCache } from '../src/api/realtime.js';
import { clearBikeCache, GBFS_URL } from '../src/api/bikes.js';
import { clearTransitousCache } from '../src/api/transitous.js';
import { clearSuggestions } from '../src/devices/suggestions.js';
import { ABSENT_POLL_SECONDS, clearAbsentStations } from '../src/devices/bikeStation.js';
import { NETWORK } from '../src/network.js';

const TRIP_UPDATES = new URL(NETWORK.realtime.tripUpdatesUrl).pathname;
const ALERTS = new URL(NETWORK.realtime.alertsUrl).pathname;

const config = normalizeConfig({
  api_key: 'k',
  stops: '50040, 61925@Canada Line:Train to work',
  bike_stations: '0021',
  max_departures: 2,
  language: 'fr',
});

function tripFeed(nowSeconds) {
  return encodeFeed({
    timestamp: nowSeconds,
    entities: [
      {
        tripUpdate: {
          trip: { tripId: 'T1', routeId: '6637' },
          stopTimeUpdates: [{ stopId: '40', departure: { time: nowSeconds + 185 } }],
        },
      },
    ],
  });
}

function routes(extra = {}) {
  return {
    [TRIP_UPDATES]: tripFeed(Math.floor(Date.now() / 1000)),
    [ALERTS]: alertsFeed([]),
    ...bikeRoutes(),
    ...extra,
  };
}

beforeEach(() => {
  clearPollSchedule();
  clearStateCache();
  clearPublishReports();
  clearReadings();
  clearSceneMemory();
  clearRealtimeCache();
  clearBikeCache();
  clearTransitousCache();
  clearSuggestions();
  clearAbsentStations();
});
afterEach(() => restoreFetch());

test('one device per watched entry, plus the lines', () => {
  const gladys = createFakeGladys();
  const devices = buildDiscoveredDevices(gladys, config);
  assert.deepEqual(
    devices.map((device) => device.name),
    [
      'TransLink – SkyTrain et SeaBus',
      'TransLink – Waterfront Station @ Bay 2',
      'Train to work',
      'Mobi – station 0021',
    ],
  );
  assert.deepEqual(
    devices.map((device) => device.external_id),
    [
      'transit-lines:network',
      'transit-stop:50040',
      'transit-stop:61925@CANADA LINE',
      'bike-station:0021',
    ],
  );
});

test('every discovery payload is one the core accepts', () => {
  const gladys = createFakeGladys();
  for (const device of buildDiscoveredDevices(gladys, config)) {
    assert.ok(GLADYS_POLL_FREQUENCIES_MS.includes(device.poll_frequency), device.name);
    assert.equal(device.should_poll, true, `${device.name} must be scheduled by the core`);
    const ids = new Set();
    for (const feature of device.features) {
      // t_device_feature.min / max are NOT NULL in the core.
      assert.equal(typeof feature.min, 'number', `${feature.name} needs a min`);
      assert.equal(typeof feature.max, 'number', `${feature.name} needs a max`);
      assert.equal(feature.read_only, true);
      assert.ok(!ids.has(feature.external_id), `duplicate feature ${feature.external_id}`);
      ids.add(feature.external_id);
    }
  }
  // 2 departures x (minutes + route) + summary.
  const stop = buildDiscoveredDevices(gladys, config)[1];
  assert.equal(stop.features.length, 5);
});

test('feature names follow the configured language', () => {
  const gladys = createFakeGladys();
  const english = normalizeConfig({ ...config, language: 'en' });
  const [lines, stop] = buildDiscoveredDevices(gladys, english);
  assert.equal(lines.name, 'TransLink – SkyTrain and SeaBus');
  assert.equal(lines.features[0].name, 'Expo Line – status');
  assert.equal(stop.features[0].name, 'Next departure');
});

test('polling a stop publishes the board, and the sentinel for missing departures', async () => {
  stubFetch(routes());
  const gladys = createFakeGladys();
  await pollDevice(gladys, { external_id: 'transit-stop:50040' }, config);

  const byFeature = Object.fromEntries(
    gladys.published.map((state) => [state.featureExternalId, state.state ?? state.text]),
  );
  assert.equal(byFeature['transit-stop:50040:departure_1'], 3);
  assert.equal(byFeature['transit-stop:50040:departure_1_route'], '50');
  assert.equal(byFeature['transit-stop:50040:departure_2'], NO_DEPARTURE_MINUTES);
  assert.equal(byFeature['transit-stop:50040:departure_2_route'], '');
  assert.equal(byFeature['transit-stop:50040:departures'], '50 3 min');
});

test('polling the lines publishes a status and a message per line', async () => {
  stubFetch(routes({ [ALERTS]: alertsFeed([lineAlert('millennium', 'No service.')]) }));
  const gladys = createFakeGladys();
  await pollDevice(gladys, { external_id: 'transit-lines:network' }, config);

  const byFeature = Object.fromEntries(
    gladys.published.map((state) => [state.featureExternalId, state.text]),
  );
  assert.equal(byFeature['transit-lines:network:line_expo_status'], 'Normal');
  assert.equal(byFeature['transit-lines:network:line_millennium_status'], 'Perturbé');
  assert.equal(byFeature['transit-lines:network:line_millennium_message'], 'No service.');
});

test('polling a bike station publishes its counts and status', async () => {
  stubFetch(routes());
  const gladys = createFakeGladys();
  await pollDevice(gladys, { external_id: 'bike-station:0021' }, config);
  const byFeature = Object.fromEntries(
    gladys.published.map((state) => [state.featureExternalId, state.state ?? state.text]),
  );
  assert.equal(byFeature['bike-station:0021:bikes'], 8);
  assert.equal(byFeature['bike-station:0021:electric_bikes'], 2);
  assert.equal(byFeature['bike-station:0021:docks'], 12);
  assert.equal(byFeature['bike-station:0021:status'], 'retour impossible');
});

test('the ticks inside the refresh interval do not read the API again', async () => {
  const calls = stubFetch(routes());
  const gladys = createFakeGladys();
  await pollDevice(gladys, { external_id: 'transit-lines:network' }, config);
  await pollDevice(gladys, { external_id: 'transit-lines:network' }, config);
  assert.equal(calls.filter((call) => call.url.includes(ALERTS)).length, 1);

  // A device just created is read right away, whole.
  const before = gladys.published.length;
  await refreshDeviceNow(gladys, { external_id: 'transit-lines:network' }, config);
  assert.equal(calls.filter((call) => call.url.includes(ALERTS)).length, 2);
  assert.equal(gladys.published.length - before, NETWORK.lines.length * 2);
});

test('unchanged values are not published twice', async () => {
  stubFetch(routes());
  const gladys = createFakeGladys();
  await pollDevice(gladys, { external_id: 'transit-lines:network' }, config);
  clearPollSchedule();
  clearRealtimeCache();
  const before = gladys.published.length;
  await pollDevice(gladys, { external_id: 'transit-lines:network' }, config);
  assert.equal(gladys.published.length, before);
});

test('a device removed from the configuration is ignored', async () => {
  const calls = stubFetch({});
  await pollDevice(createFakeGladys(), { external_id: 'transit-stop:00000' }, config);
  assert.equal(calls.length, 0);
});

test('a stop code missing from the stop table says so', async () => {
  const unknown = normalizeConfig({ stops: '12' });
  const [blueprint] = buildBlueprints(createFakeGladys(), unknown);
  await assert.rejects(blueprint.read(unknown), (err) =>
    /n’est pas dans la liste des arrêts TransLink/.test(err.userMessage.fr),
  );
});

test('the lines are not built when they are not watched', () => {
  const blueprints = buildBlueprints(
    createFakeGladys(),
    normalizeConfig({ api_key: 'k', watch_lines: false, stops: '50040' }),
  );
  assert.deepEqual(
    blueprints.map((blueprint) => blueprint.type),
    ['transit-stop'],
  );
});

test('a widget pointing at a device of another kind gets an explanation', () => {
  const gladys = createFakeGladys();
  assert.throws(
    () => findSelectedBlueprint(gladys, 'bike-station:0021', config, 'transit-stop'),
    (err) => err instanceof DeviceSelectionError && /Mobi/.test(err.userMessage.en),
  );
  assert.throws(
    () => findSelectedBlueprint(gladys, '', config, 'transit-stop'),
    DeviceSelectionError,
  );
});

test('test_api_key reports each feed on its own line', async () => {
  stubFetch(routes({ [TRIP_UPDATES]: { status: 403, body: '' } }));
  const message = await ACTIONS.test_api_key(createFakeGladys(), { config });
  assert.match(message.en, /✔ Service alerts/);
  assert.match(message.en, /✖ Real-time predictions: TransLink refused the API key/);

  const noKey = await ACTIONS.test_api_key(createFakeGladys(), {
    config: normalizeConfig({}),
  });
  assert.match(noKey.fr, /Aucune clé/);
});

test('test_api_key gives the daily request estimate when everything works', async () => {
  stubFetch(routes());
  const message = await ACTIONS.test_api_key(createFakeGladys(), { config });
  assert.match(
    message.en,
    /^TransLink API OK\. This configuration costs about 2160 requests a day/,
  );
});

test('search_bike_stations lists the ids to paste', async () => {
  stubFetch(routes());
  const message = await ACTIONS.search_bike_stations(createFakeGladys(), {
    fields: { query: 'cordova' },
    config,
  });
  assert.match(message.fr, /0021 — Cordova & Granville \(20\)/);
  const tooShort = await ACTIONS.search_bike_stations(createFakeGladys(), {
    fields: { query: 'd' },
    config,
  });
  assert.match(tooShort.en, /at least 2/);
});

test('a created device keeps refreshing once it is neither typed nor suggested', async () => {
  stubFetch(routes());
  const gladys = createFakeGladys();
  const empty = normalizeConfig({ api_key: 'k', watch_lines: false });
  // What Gladys lists for a stop and a station the user added earlier.
  gladys.devices = [
    {
      external_id: 'transit-stop:50040@50',
      name: 'Bus to work',
      params: [
        { name: 'stop_code', value: '50040' },
        { name: 'routes', value: '50' },
      ],
    },
    {
      external_id: 'bike-station:0021',
      name: 'Mobi',
      params: [{ name: 'station_id', value: '0021' }],
    },
  ];
  assert.deepEqual(
    buildDiscoveredDevices(gladys, empty).map((device) => device.external_id),
    ['transit-stop:50040@50', 'bike-station:0021'],
  );
  // Not in the configuration, yet decoded: its board is not empty.
  await pollDevice(gladys, { external_id: 'transit-stop:50040@50' }, empty);
  const first = gladys.published.find((state) => state.featureExternalId.endsWith(':departure_1'));
  assert.equal(first.state, 3);
});

test('without a key, a stop shows Transitous, marked as scheduled, every 2 minutes at most', async () => {
  const calls = stubFetch({
    '/v5/stoptimes': stopTimesPayload(Date.now(), [
      { minutes: 4 },
      { minutes: 12, routeId: '6612', shortName: '002', headsign: '2 Macdonald' },
    ]),
  });
  const gladys = createFakeGladys();
  const noKey = normalizeConfig({ stops: '50040', max_departures: 2 });

  const [stop] = buildDiscoveredDevices(gladys, noKey);
  assert.equal(stop.poll_frequency, 60_000);
  assert.equal(buildBlueprints(gladys, noKey)[0].pollIntervalMs(noKey), 120_000);

  await pollDevice(gladys, { external_id: 'transit-stop:50040' }, noKey);
  const summary = gladys.published.find((state) => state.featureExternalId.endsWith(':departures'));
  assert.match(summary.text, /^50 ~[34] min · 2 ~1[12] min$/);
  assert.ok(calls.every((call) => !call.url.includes('translink.ca')));
});

test('without a key the lines are not built, and Transitous can be turned off', async () => {
  const gladys = createFakeGladys();
  assert.deepEqual(
    buildBlueprints(gladys, normalizeConfig({ stops: '50040' })).map((b) => b.type),
    ['transit-stop'],
  );
  const off = normalizeConfig({ stops: '50040', schedule_without_key: false });
  const [blueprint] = buildBlueprints(gladys, off);
  await assert.rejects(blueprint.read(off), (err) => /passages sans clé/.test(err.userMessage.fr));
});

test('search_stops lists the codes with the directions of their routes', async () => {
  stubFetch({
    '/v5/stoptimes': stopTimesPayload(Date.now(), [{ minutes: 3 }]),
  });
  const message = await ACTIONS.search_stops(createFakeGladys(), {
    fields: { query: 'waterfront bay 2' },
    config,
  });
  assert.match(message.fr, /^Collez un code dans « Arrêts »/);
  assert.match(message.fr, /50040 — Waterfront Station @ Bay 2 \(50 → False Creek South\)/);
});

test('search_stops still lists the stops when Transitous does not answer', async () => {
  stubFetch({ '/v5/stoptimes': { status: 503, body: '' } });
  const message = await ACTIONS.search_stops(createFakeGladys(), {
    fields: { query: '50040' },
    config,
  });
  assert.match(message.en, /50040 — Waterfront Station @ Bay 2$/m);
  const none = await ACTIONS.search_stops(createFakeGladys(), {
    fields: { query: 'zzzz qqqq' },
    config,
  });
  assert.match(none.en, /No TransLink stop matches/);
});

// --- Stations removed from the feed ------------------------------------------

/** The bike routes, with station 0021 present or removed from both files. */
function bikesWith({ present }) {
  const keep = (stations) => stations.filter((station) => present || station.station_id !== '0021');
  return {
    [GBFS_URL]: DISCOVERY,
    '/station_information.json': { data: { stations: keep(INFORMATION.data.stations) } },
    '/station_status.json': { data: { stations: keep(STATUS.data.stations) } },
    '/vehicle_types.json': VEHICLE_TYPES,
  };
}

test('a station removed from the feed shows as removed, flagged, and read every 15 minutes', async () => {
  const gladys = createFakeGladys();
  const device = { external_id: 'bike-station:0021' };
  const bikeConfig = normalizeConfig({ bike_stations: '0021', watch_lines: false });
  const [blueprint] = buildBlueprints(gladys, bikeConfig);

  stubFetch(bikesWith({ present: true }));
  await pollDevice(gladys, device, bikeConfig);
  assert.deepEqual(gladys.transports.at(-1), {
    external_id: 'bike-station:0021',
    transport: 'cloud',
  });

  restoreFetch();
  clearBikeCache();
  clearPollSchedule();
  stubFetch(bikesWith({ present: false }));
  await pollDevice(gladys, device, bikeConfig);

  const latest = (key) =>
    gladys.published
      .filter((state) => state.featureExternalId === `bike-station:0021:${key}`)
      .at(-1);
  assert.equal(latest('bikes').state, 0);
  assert.equal(latest('docks').state, 0);
  assert.equal(latest('status').text, 'Removed from the Mobi network (seasonal?)');
  assert.equal(gladys.transports.at(-1).degraded, true);
  assert.match(gladys.transports.at(-1).message.fr, /retirée pour la saison/);
  assert.equal(blueprint.pollIntervalMs(bikeConfig), ABSENT_POLL_SECONDS * 1000);
  // One event for the removal, not "no bike" and "no dock" on top of it.
  assert.deepEqual(
    gladys.sceneEvents.map((event) => event.data.event),
    ['out_of_service'],
  );

  // Back: one event, the badge cleared, the usual interval.
  restoreFetch();
  clearBikeCache();
  clearPollSchedule();
  stubFetch(bikesWith({ present: true }));
  await pollDevice(gladys, device, bikeConfig);
  assert.deepEqual(
    gladys.sceneEvents.map((event) => event.data.event),
    ['out_of_service', 'back_in_service'],
  );
  assert.deepEqual(gladys.transports.at(-1), {
    external_id: 'bike-station:0021',
    transport: 'cloud',
  });
  assert.equal(blueprint.pollIntervalMs(bikeConfig), bikeConfig.bike_poll_frequency * 1000);
});
