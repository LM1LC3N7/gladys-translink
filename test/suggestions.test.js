// -----------------------------------------------------------------------------
// "Near my home": the stops and stations suggested from the house location,
// and the connection status that tells the user what to do next.
// -----------------------------------------------------------------------------

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { restoreFetch, stubFetch } from './helpers/stubFetch.js';
import { bikeRoutes, stopTimesPayload } from './helpers/fixtures.js';
import { normalizeConfig } from '../src/config.js';
import {
  clearSuggestions,
  getSuggestions,
  refreshSuggestions,
  suggestedStopLabel,
} from '../src/devices/suggestions.js';
import { buildDiscoveredDevices } from '../src/devices/index.js';
import { clearTransitousCache } from '../src/api/transitous.js';
import { clearBikeCache } from '../src/api/bikes.js';
import { describeStatus, inventory } from '../src/status.js';

function routes() {
  return {
    '/v5/stoptimes': stopTimesPayload(Date.now(), [{ minutes: 3 }, { minutes: 9 }]),
    ...bikeRoutes(),
  };
}

beforeEach(() => {
  clearSuggestions();
  clearTransitousCache();
  clearBikeCache();
});
afterEach(() => restoreFetch());

test('the closest stops and stations are suggested, named the way people know them', async () => {
  stubFetch(routes());
  const gladys = createFakeGladys();
  const config = normalizeConfig({ nearby_stops: 2, nearby_bike_stations: 2 });

  const found = await refreshSuggestions(gladys, config);

  assert.equal(found.status, 'ok');
  // Waterfront Station stands for its platforms, which are not suggested on
  // top of it; bay 2 is another place.
  assert.deepEqual(
    found.stops.map((stop) => stop.id),
    ['61925', '50040'],
  );
  // Cordova & Granville is around the corner, Rogers Tower 600 m away;
  // Commercial Drive (4 km) is beyond the 1 km radius.
  assert.deepEqual(
    found.bikeStations.map((station) => station.id),
    ['0021', '0201'],
  );

  // Without typing anything, the Discovery screen offers them, each name
  // saying what it is.
  const names = buildDiscoveredDevices(gladys, config).map((device) => device.name);
  assert.deepEqual(names, [
    'TransLink – Waterfront Station',
    'TransLink – Waterfront Station @ Bay 2 (50 → False Creek South)',
    'Mobi – Cordova & Granville',
    'Mobi – Rogers Tower',
  ]);
});

test('no located house, no permission, nothing wanted: each has its own status', async () => {
  stubFetch(routes());
  const gladys = createFakeGladys();
  const config = normalizeConfig({});

  gladys.houses = [{ id: 'h', name: 'Home', latitude: null, longitude: null }];
  assert.equal((await refreshSuggestions(gladys, config)).status, 'no_location');

  gladys.houses = new Error('HTTP 403');
  assert.equal((await refreshSuggestions(gladys, config)).status, 'no_house');

  const off = normalizeConfig({ nearby_stops: 0, nearby_bike_stations: 0 });
  assert.equal((await refreshSuggestions(gladys, off)).status, 'disabled');
});

test('a house far from the network gets nothing, and a failing bike feed says so', async () => {
  stubFetch({ 'gbfs.json': { status: 503, body: '' } });
  const gladys = createFakeGladys();
  gladys.houses = [{ id: 'h', name: 'Cottage', latitude: 50.5, longitude: -120.3 }];
  const found = await refreshSuggestions(gladys, normalizeConfig({}));
  assert.equal(found.status, 'failed');
  assert.deepEqual(getSuggestions().stops, []);
});

test('a name the user typed is never prefixed, a known station gets its name', async () => {
  stubFetch(routes());
  const gladys = createFakeGladys();
  // Station 0201 is read once (the station list is then known), and typed
  // without a name.
  const config = normalizeConfig({
    stops: '50040:My bus',
    bike_stations: '0201',
    nearby_stops: 0,
    nearby_bike_stations: 1,
  });
  await refreshSuggestions(gladys, config);
  assert.deepEqual(
    buildDiscoveredDevices(gladys, config).map((device) => device.name),
    ['My bus', 'Mobi – Rogers Tower', 'Mobi – Cordova & Granville'],
  );
});

test('a suggested label: the name, then the first routes and their direction', () => {
  assert.equal(suggestedStopLabel({ code: '1', name: 'Main St' }, null), 'Main St');
  assert.equal(suggestedStopLabel({ code: '1', name: '' }, null), '1');
  const busy = {
    name: 'Hub',
    routes: Array.from({ length: 12 }, (_, index) => ({
      route: String(index + 1),
      headsigns: ['Somewhere far away'],
    })),
  };
  const label = suggestedStopLabel({ code: '1', name: 'Hub' }, busy);
  assert.match(label, /^Hub \(1 → Somewhere far away, 2 → Somewhere far away, …\)$/);
});

test('status: nothing found asks to locate the house', async () => {
  stubFetch(routes());
  const gladys = createFakeGladys();
  gladys.houses = [];
  const config = normalizeConfig({});
  await refreshSuggestions(gladys, config);
  const status = describeStatus(gladys, config);
  assert.equal(status.connected, false);
  assert.match(status.message.fr, /Paramètres → Maisons/);
});

test('status: devices waiting point to the Discovery tab, and say what a key adds', async () => {
  stubFetch(routes());
  const gladys = createFakeGladys();
  const config = normalizeConfig({ nearby_stops: 2, nearby_bike_stations: 1 });
  await refreshSuggestions(gladys, config);

  const status = describeStatus(gladys, config);
  assert.equal(status.connected, true);
  assert.equal(
    status.message.fr,
    'Prêt : 2 arrêts et 1 station Mobi à ajouter. Ouvrez l’onglet « Découverte » de cette ' +
      'intégration et cliquez sur « Ajouter ». Sans clé : une clé TransLink gratuite ajoute ' +
      'le temps réel officiel et l’état des lignes.',
  );
});

test('status: once everything is added, what is watched and the request count', async () => {
  stubFetch(routes());
  const gladys = createFakeGladys();
  const config = normalizeConfig({ api_key: 'k', nearby_stops: 1, nearby_bike_stations: 0 });
  await refreshSuggestions(gladys, config);
  gladys.devices = buildDiscoveredDevices(gladys, config);

  const status = describeStatus(gladys, config);
  assert.equal(
    status.message.en,
    'Connected. Watching 1 stop and the lines (about 2160 TransLink requests a day).',
  );
});

test('status: stops with neither a key nor Transitous', () => {
  const config = normalizeConfig({ stops: '50040', schedule_without_key: false });
  const status = describeStatus(createFakeGladys(), config);
  assert.equal(status.connected, false);
  assert.match(status.message.en, /TransLink API key/);
});

test('inventory', () => {
  assert.deepEqual(inventory({ stops: 1, stations: 2, lines: true }), {
    en: '1 stop, 2 Mobi stations and the lines',
    fr: '1 arrêt, 2 stations Mobi et les lignes',
  });
});
