// -----------------------------------------------------------------------------
// Transitous client: departures of a stop code, route labels, descriptions.
// -----------------------------------------------------------------------------

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearTransitousCache,
  describeStop,
  formatRoutes,
  gtfsId,
  knownStop,
  scheduledDepartures,
  stopTimes,
  tidyHeadsign,
  TransitousError,
} from '../src/api/transitous.js';
import { distanceMeters } from '../src/api/stops.js';
import { stopTimesPayload } from './helpers/fixtures.js';
import { restoreFetch, stubFetch } from './helpers/stubFetch.js';

const HOME = { lat: 49.2856, lon: -123.1115 };
const NOW = Date.UTC(2026, 9, 11, 16, 0, 0);

beforeEach(() => clearTransitousCache());
afterEach(() => restoreFetch());

test('Transitous ids give back the GTFS ids', () => {
  assert.equal(gtfsId('ca-bc-TransLink_6637'), '6637');
  assert.equal(gtfsId('20261011_04:31_ca-bc-TransLink_15518437'), '15518437');
  assert.equal(gtfsId(undefined), '');
});

test('a stop code is asked by its GTFS id, with a User-Agent', async () => {
  const calls = stubFetch({ '/v5/stoptimes': stopTimesPayload(NOW, [{ minutes: 3 }]) });
  await stopTimes('50040');
  assert.match(calls[0].url, /stopId=ca-bc-TransLink_40&n=10/);
  assert.match(calls[0].headers['User-Agent'], /^gladys-translink\/.*github\.com/);
  await assert.rejects(stopTimes('00000'), TransitousError);
});

test('the departures: route labels from the table, other bays and termini dropped', async () => {
  stubFetch({
    '/v5/stoptimes': stopTimesPayload(NOW, [
      { minutes: 3 },
      { minutes: 7, routeId: '6612', shortName: '002', headsign: '2 Macdonald', delayMinutes: 2 },
      // Transitous answers for the whole station group: bay 1 is another sign.
      { minutes: 8, stopId: '58202' },
      { minutes: 9, cancelled: true },
      { minutes: 10, pickupType: 'NOT_ALLOWED' },
      // A route the table does not know: the short name, without its zeros.
      { minutes: 11, routeId: 'new', shortName: '0R5', headsign: 'Hastings', realTime: true },
    ]),
  });
  const departures = await stopTimes('50040');
  assert.deepEqual(
    departures.map(({ route, headsign, delaySeconds, realtime }) => [
      route,
      headsign,
      delaySeconds,
      realtime,
    ]),
    [
      ['50', 'False Creek South', 0, false],
      ['2', 'Macdonald', 120, false],
      ['R5', 'Hastings', 0, true],
    ],
  );
});

test('headsigns lose the route they repeat', () => {
  assert.equal(tidyHeadsign('3 Main/To Marine Dr Station', '3'), 'Main/To Marine Dr Station');
  assert.equal(tidyHeadsign('Canada Line To YVR-Airport', 'Canada Line'), 'YVR-Airport');
  assert.equal(tidyHeadsign('UBC', '99'), 'UBC');
  assert.equal(tidyHeadsign('99', '99'), '99');
  assert.equal(tidyHeadsign('Hospital ~ Hôpital', '45'), 'Hospital / Hôpital');
});

test('scheduled departures have the shape of the real-time board', async () => {
  stubFetch({
    '/v5/stoptimes': stopTimesPayload(NOW, [
      { minutes: -5 },
      { minutes: 4, routeId: '6612', shortName: '002', headsign: '2 Macdonald' },
      { minutes: 2 },
    ]),
  });
  const board = await scheduledDepartures({ id: '50040', routes: [] }, { now: NOW });
  assert.deepEqual(
    board.map(({ route, minutes, realtime, headsign }) => [route, minutes, realtime, headsign]),
    [
      ['50', 2, false, 'False Creek South'],
      ['2', 4, false, 'Macdonald'],
    ],
  );
  const filtered = await scheduledDepartures({ id: '50040', routes: ['2'] }, { now: NOW });
  assert.deepEqual(
    filtered.map((departure) => departure.route),
    ['2'],
  );
});

test('a stop description is cached for a day, and survives a failed refresh', async () => {
  const calls = stubFetch({
    '/v5/stoptimes': stopTimesPayload(NOW, [
      { minutes: 1, routeId: '6612', shortName: '002', headsign: '2 Macdonald' },
      { minutes: 2 },
      { minutes: 3 },
    ]),
  });
  const description = await describeStop('50040', { now: NOW });
  assert.equal(formatRoutes(description), '2 → Macdonald, 50 → False Creek South');
  assert.equal(description.name, 'Waterfront Station @ Bay 2');
  // The trips seen at the stop name the route of a bare real-time prediction.
  assert.deepEqual(description.trips.get('T0'), { route: '2', headsign: 'Macdonald' });
  await describeStop('50040', { now: NOW + 3_600_000 });
  assert.equal(calls.length, 1);
  assert.equal(knownStop('50040'), description);

  restoreFetch();
  stubFetch({ '/v5/stoptimes': { status: 503, body: 'down' } });
  const stale = await describeStop('50040', { now: NOW + 2 * 86_400_000 });
  assert.equal(stale, description);
  assert.equal(await describeStop('00000', { now: NOW }), null);
});

test('a route serving both directions lists both', async () => {
  stubFetch({
    '/v5/stoptimes': stopTimesPayload(NOW, [
      { minutes: 1, headsign: 'West' },
      { minutes: 2, headsign: 'East' },
      { minutes: 3, headsign: 'West' },
    ]),
  });
  assert.equal(formatRoutes(await describeStop('50040', { now: NOW })), '50 → West/East');
});

test('distances', () => {
  assert.equal(distanceMeters(HOME, HOME), 0);
  const oneKmNorth = { lat: HOME.lat + 1 / 111.2, lon: HOME.lon };
  assert.ok(Math.abs(distanceMeters(HOME, oneKmNorth) - 1000) < 5);
});
