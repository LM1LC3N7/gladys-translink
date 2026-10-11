// -----------------------------------------------------------------------------
// The operator's real-time client: departures, the shared feed cache, the
// stop table mapping, the refusals.
// -----------------------------------------------------------------------------

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import {
  clearRealtimeCache,
  departuresFromFeed,
  fetchDepartures,
  getTripUpdates,
  realtimeErrorFor,
  RealtimeApiError,
  redact,
  setPolledStops,
} from '../src/api/realtime.js';
import { NETWORK } from '../src/network.js';
import { encodeFeed } from './helpers/gtfsRealtimeEncoder.js';
import { restoreFetch, stubFetch } from './helpers/stubFetch.js';

const NOW_MS = 1_760_100_000_000;
const NOW = NOW_MS / 1000;
const FEED = new URL(NETWORK.realtime.tripUpdatesUrl).pathname;

// 50040 is bay 2 of Waterfront Station (stop_id 40); 61925 the station, whose
// Canada Line platform is stop_id 8039. Route 6637 is the 50, 6612 the 2,
// 13686 the Canada Line.
const config = normalizeConfig({ api_key: 'k3y', stops: '50040, 50040@2, 61925' });

function feed() {
  return encodeFeed({
    timestamp: NOW,
    entities: [
      {
        tripUpdate: {
          trip: { tripId: 'late', routeId: '6637' },
          stopTimeUpdates: [{ stopId: '40', departure: { time: NOW + 600, delay: 400 } }],
        },
      },
      {
        tripUpdate: {
          trip: { tripId: 'soon', routeId: '6612' },
          stopTimeUpdates: [
            { stopId: '40', arrival: { time: NOW + 125 } },
            { stopId: '99999', arrival: { time: NOW + 300 } },
          ],
        },
      },
      {
        tripUpdate: {
          trip: { tripId: 'skytrain', routeId: '13686' },
          stopTimeUpdates: [{ stopId: '8039', arrival: { time: NOW + 60 } }],
        },
      },
      {
        tripUpdate: {
          trip: { tripId: 'cancelled', routeId: '6637', scheduleRelationship: 3 },
          stopTimeUpdates: [{ stopId: '40', arrival: { time: NOW + 200 } }],
        },
      },
      {
        tripUpdate: {
          trip: { tripId: 'skips', routeId: '6637' },
          stopTimeUpdates: [{ stopId: '40', scheduleRelationship: 1, arrival: { time: NOW + 90 } }],
        },
      },
      {
        tripUpdate: {
          trip: { tripId: 'gone', routeId: '6637' },
          stopTimeUpdates: [{ stopId: '40', arrival: { time: NOW - 120 } }],
        },
      },
    ],
  });
}

beforeEach(() => clearRealtimeCache());
afterEach(() => restoreFetch());

test('departures are mapped from stop codes, named, sorted and filtered', async () => {
  stubFetch({ [FEED]: feed() });
  const [bay, bayRoute2, station] = config.watched.stops;

  const board = await fetchDepartures(config, bay, { now: NOW_MS });
  assert.deepEqual(
    board.map((departure) => [departure.tripId, departure.route, departure.minutes]),
    [
      ['soon', '2', 2],
      ['late', '50', 10],
    ],
  );
  assert.equal(board[1].delaySeconds, 400);
  assert.equal(board[0].realtime, true);

  // The route filter keeps the 2 and drops the 50 calling at the same stop.
  const filtered = await fetchDepartures(config, bayRoute2, { now: NOW_MS });
  assert.deepEqual(
    filtered.map((departure) => departure.tripId),
    ['soon'],
  );

  // A station code covers its platforms.
  const platform = await fetchDepartures(config, station, { now: NOW_MS });
  assert.deepEqual(
    platform.map((departure) => [departure.route, departure.minutes]),
    [['Canada Line', 1]],
  );
});

test('one read of the feed serves every stop, with the key in the query string', async () => {
  const calls = stubFetch({ [FEED]: feed() });
  for (const stop of config.watched.stops) {
    await fetchDepartures(config, stop, { now: NOW_MS });
  }
  await fetchDepartures(config, config.watched.stops[0], { now: NOW_MS + 30_000 });
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get('apikey'), 'k3y');
  assert.match(calls[0].headers['User-Agent'], /^gladys-translink\//);

  // A new interval reads again; so does a forced fresh read.
  await fetchDepartures(config, config.watched.stops[0], { now: NOW_MS + 60_000 });
  await getTripUpdates(config, { now: NOW_MS + 61_000, fresh: true });
  assert.equal(calls.length, 3);
});

test('a stop the configuration does not list (a suggestion) is decoded too', async () => {
  stubFetch({ [FEED]: feed() });
  const typedNothing = normalizeConfig({ api_key: 'k3y' });
  const suggested = { id: '50040', routes: [], name: null };
  setPolledStops([suggested]);
  const board = await fetchDepartures(typedNothing, suggested, { now: NOW_MS });
  assert.equal(board.length, 2);
});

test('a departure just past its time stays on the board for a few seconds', () => {
  const board = departuresFromFeed(
    {
      stopTimes: [
        {
          stopId: '40',
          routeId: '6637',
          tripScheduleRelationship: 0,
          scheduleRelationship: 0,
          arrival: { time: NOW - 20 },
        },
      ],
    },
    { id: '50040', routes: [] },
    NOW,
  );
  assert.equal(board[0].minutes, 0);
});

test('no key: a bilingual explanation, and no request', async () => {
  const calls = stubFetch({});
  const noKey = normalizeConfig({ stops: '50040' });
  await assert.rejects(fetchDepartures(noKey, noKey.watched.stops[0]), (err) => {
    assert.ok(err instanceof RealtimeApiError);
    assert.match(err.userMessage.fr, /clé d’API TransLink/);
    return true;
  });
  assert.equal(calls.length, 0);
});

test('the refusals become messages the user can act on', async () => {
  stubFetch({ [FEED]: { status: 403, body: '' } });
  await assert.rejects(fetchDepartures(config, config.watched.stops[0], { now: NOW_MS }), (err) => {
    assert.equal(err.status, 403);
    assert.match(err.userMessage.en, /refused the API key/);
    // The message never carries the key.
    assert.doesNotMatch(err.message, /k3y/);
    return true;
  });
  assert.match(realtimeErrorFor(403, 'Quota exceeded', 'x').userMessage.en, /quota/);
  assert.match(realtimeErrorFor(429, '', 'x').userMessage.en, /rate limiting/);
  assert.equal(realtimeErrorFor(503, 'Service Unavailable', 'x').userMessage, undefined);
});

test('a network error never logs the key the URL carries', async () => {
  globalThis.fetch = async (url) => {
    throw new Error(`connect ECONNREFUSED ${url}`);
  };
  await assert.rejects(
    fetchDepartures(config, config.watched.stops[0], { now: NOW_MS }),
    (err) => !err.message.includes('k3y') && err.message.includes('***'),
  );
  assert.equal(redact('a k3y b k3y', 'k3y'), 'a *** b ***');
  assert.equal(redact('text', ''), 'text');
});
