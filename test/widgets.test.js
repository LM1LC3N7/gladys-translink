// -----------------------------------------------------------------------------
// Dashboard widgets: every content must pass the SDK's own validator (the
// vocabulary and the budget the core enforces), and no failure may reach the
// dashboard as an exception.
// -----------------------------------------------------------------------------

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from './helpers/fakeGladys.js';
import { restoreFetch, stubFetch } from './helpers/stubFetch.js';
import { alertsFeed, bikeRoutes, lineAlert, stopTimesPayload } from './helpers/fixtures.js';
import { encodeFeed } from './helpers/gtfsRealtimeEncoder.js';
import { normalizeConfig } from '../src/config.js';
import { clearReadings } from '../src/devices/readings.js';
import { clearRealtimeCache } from '../src/api/realtime.js';
import { absentStation, clearBikeCache } from '../src/api/bikes.js';
import { bikeStationContent, departuresContent } from '../src/widgets/index.js';
import { truncate, WIDGETS } from '../src/widgets/index.js';
import { NETWORK } from '../src/network.js';

const TRIP_UPDATES_PATH = new URL(NETWORK.realtime.tripUpdatesUrl).pathname;
const ALERTS_PATH = new URL(NETWORK.realtime.alertsUrl).pathname;

const config = normalizeConfig({
  api_key: 'k',
  stops: '50040',
  bike_stations: '0021',
  language: 'fr',
});

function routes(extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    [TRIP_UPDATES_PATH]: encodeFeed({
      entities: Array.from({ length: 12 }, (_, index) => ({
        tripUpdate: {
          trip: { tripId: `T${index}`, routeId: index % 2 ? '6612' : '6637' },
          stopTimeUpdates: [
            {
              stopId: '40',
              departure: { time: now + index * 240, delay: index === 3 ? 600 : 0 },
            },
          ],
        },
      })),
    }),
    [ALERTS_PATH]: alertsFeed([lineAlert('millennium', 'x'.repeat(600))]),
    ...bikeRoutes(),
    ...extra,
  };
}

function assertValid(content) {
  assert.deepEqual(validateWidgetContent(content), []);
}

beforeEach(() => {
  clearReadings();
  clearRealtimeCache();
  clearBikeCache();
});
afterEach(() => restoreFetch());

test('the departures board is valid and capped', async () => {
  stubFetch(routes());
  const content = await WIDGETS.departures(createFakeGladys(), {
    settings: { stop: 'transit-stop:50040' },
    config,
  });
  assertValid(content);
  const board = content.components.find((component) => component.type === 'status');
  assert.equal(board.items.length, 8);
  assert.equal(board.items[3].color, 'warning');
});

test('the line card is valid, and truncates a long message to the budget', async () => {
  stubFetch(routes());
  const content = await WIDGETS.line_status(createFakeGladys(), { settings: {}, config });
  assertValid(content);
  const status = content.components.find((component) => component.type === 'status');
  assert.deepEqual(
    status.items.map((item) => item.color),
    ['success', 'danger', 'success', 'success', 'success'],
  );
});

test('the bike station card is valid', async () => {
  stubFetch(routes());
  const content = await WIDGETS.bike_station(createFakeGladys(), {
    settings: { station: 'bike-station:0021' },
    config,
  });
  assertValid(content);
});

test('failures become a card that says what is wrong', async () => {
  stubFetch(routes({ [ALERTS_PATH]: { status: 403, body: '' } }));
  const refused = await WIDGETS.line_status(createFakeGladys(), { settings: {}, config });
  assertValid(refused);
  assert.match(refused.components[0].text.en, /refused the API key/);

  const unset = await WIDGETS.departures(createFakeGladys(), { settings: {}, config });
  assertValid(unset);
  assert.match(unset.components[0].text.en, /Choose a stop/);

  const notWatched = await WIDGETS.line_status(createFakeGladys(), {
    settings: {},
    config: normalizeConfig({ watch_lines: false }),
  });
  assert.match(notWatched.components[0].text.fr, /pas surveillées/);
});

test('a slow API gets a loading card rather than a dashboard error', async () => {
  // An answer that comes, but long after the card's deadline.
  globalThis.fetch = () =>
    new Promise((resolve) =>
      setTimeout(() => resolve({ ok: false, status: 503, text: async () => '' }), 100),
    );
  const content = await WIDGETS.line_status(
    createFakeGladys(),
    { settings: {}, config },
    { deadlineMs: 10 },
  );
  assertValid(content);
  assert.match(content.components[0].text.en, /longer than usual/);
});

test('truncate', () => {
  assert.equal(truncate('abc', 5), 'abc');
  assert.equal(truncate('abcdef', 5), 'abcd…');
});

test('a scheduled board is grey, marked "~", and says what a key adds', async () => {
  stubFetch({
    '/v5/stoptimes': stopTimesPayload(Date.now(), [
      { minutes: 5 },
      { minutes: 20, routeId: '6612', shortName: '002', headsign: '2 Macdonald' },
      // Real time Transitous has: green, no "~".
      { minutes: 25, realTime: true },
    ]),
  });
  const content = await WIDGETS.departures(createFakeGladys(), {
    settings: { stop: 'transit-stop:50040' },
    config: normalizeConfig({ stops: '50040', language: 'fr' }),
  });
  assertValid(content);
  const board = content.components.find((component) => component.type === 'status');
  assert.deepEqual(
    board.items.map((item) => [item.label.fr, item.color]),
    [
      ['Ligne 50 → False Creek South', 'neutral'],
      ['Ligne 2 → Macdonald', 'neutral'],
      ['Ligne 50 → False Creek South', 'success'],
    ],
  );
  assert.match(board.items[0].value, /^~[45] min$/);
  assert.match(content.components.at(-1).text.fr, /clé TransLink pour le temps réel/);
});

test('an empty board says so', () => {
  const content = departuresContent('Arrêt', []);
  assertValid(content);
  assert.match(content.components[1].text.fr, /Aucun passage/);
});

test('a removed bike station gets a card that says so, not three zeros', () => {
  const content = bikeStationContent('Mobi – Cordova & Granville', absentStation('0021'));
  assertValid(content);
  assert.equal(
    content.components.some((component) => component.type === 'value'),
    false,
  );
  assert.match(content.components[1].text.fr, /retirée pour la saison/);
});
