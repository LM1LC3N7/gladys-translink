// -----------------------------------------------------------------------------
// The line status, from the GTFS-Realtime service alerts.
// -----------------------------------------------------------------------------

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAlert,
  fetchLineStatus,
  isActive,
  LINE_STATUS,
  parseAlerts,
  pickText,
} from '../src/api/lines.js';
import { clearRealtimeCache } from '../src/api/realtime.js';
import { decodeAlerts } from '../src/api/gtfsRealtime.js';
import { normalizeConfig } from '../src/config.js';
import { NETWORK } from '../src/network.js';
import { alertsFeed, lineAlert, routeOf } from './helpers/fixtures.js';
import { restoreFetch, stubFetch } from './helpers/stubFetch.js';

const NOW_MS = 1_760_100_000_000;
const NOW = NOW_MS / 1000;
const ALERTS = new URL(NETWORK.realtime.alertsUrl).pathname;

const statuses = (status) => Object.fromEntries(status.lines.map((line) => [line.id, line.status]));

beforeEach(() => clearRealtimeCache());
afterEach(() => restoreFetch());

test('no alert: every line runs normally', () => {
  const status = parseAlerts(decodeAlerts(alertsFeed([])), { language: 'en', now: NOW_MS });
  assert.ok(status.lines.every((line) => line.status === LINE_STATUS.NORMAL && !line.message));
  assert.deepEqual(
    status.lines.map((line) => line.id),
    NETWORK.lines.map((line) => line.id),
  );
});

test('a line alert disrupts its line only, with its message', () => {
  const feed = decodeAlerts(alertsFeed([lineAlert('expo', 'Expo Line: no service at Main St.')]));
  const status = parseAlerts(feed, { language: 'fr', now: NOW_MS });
  assert.equal(statuses(status).expo, LINE_STATUS.DISRUPTED);
  assert.equal(statuses(status).canada, LINE_STATUS.NORMAL);
  // No French text: the English one rather than nothing.
  assert.equal(status.lines[0].message, 'Expo Line: no service at Main St.');
});

test('station, accessibility and future alerts leave the line running', () => {
  const feed = decodeAlerts(
    alertsFeed([
      // An elevator: about a station, and an accessibility issue.
      {
        effect: 11,
        informedEntities: [{ routeId: routeOf('canada') }],
        headerText: [{ text: 'Elevator out of service', language: 'en' }],
      },
      // A bus bay closed at a station of the line.
      {
        effect: 9,
        informedEntities: [{ routeId: routeOf('millennium'), stopId: '8039' }],
        headerText: [{ text: 'Bay moved' }],
      },
      // Next weekend's closure, announced today.
      lineAlert('seabus', 'Weekend closure', {
        activePeriods: [{ start: NOW + 86_400 * 5, end: NOW + 86_400 * 6 }],
      }),
    ]),
  );
  const status = parseAlerts(feed, { language: 'en', now: NOW_MS });
  assert.ok(status.lines.every((line) => line.status === LINE_STATUS.NORMAL));
});

test('a detour is a notice, the worst status wins, messages of that status only', () => {
  const feed = decodeAlerts(
    alertsFeed([
      lineAlert('wce', 'Trains run on a modified schedule.', { effect: 6 }),
      lineAlert('millennium', 'Shuttle buses replace trains.', { effect: 4 }),
      lineAlert('millennium', 'No service between VCC-Clark and Commercial.'),
    ]),
  );
  const status = parseAlerts(feed, { language: 'en', now: NOW_MS });
  assert.equal(statuses(status).wce, LINE_STATUS.NOTICE);
  const millennium = status.lines.find((line) => line.id === 'millennium');
  assert.equal(millennium.status, LINE_STATUS.DISRUPTED);
  assert.equal(millennium.message, 'No service between VCC-Clark and Commercial.');
});

test('helpers: texts, periods, effects', () => {
  const texts = [
    { text: 'Hello', language: 'en-CA' },
    { text: 'Bonjour', language: 'fr' },
  ];
  assert.equal(pickText(texts, 'fr'), 'Bonjour');
  assert.equal(pickText(texts, 'en'), 'Hello');
  assert.equal(pickText([{ text: 'Only' }], 'fr'), 'Only');
  assert.equal(pickText(undefined, 'fr'), '');
  assert.equal(isActive({ activePeriods: [] }, NOW), true);
  assert.equal(isActive({ activePeriods: [{ start: NOW - 10 }] }, NOW), true);
  assert.equal(isActive({ activePeriods: [{ end: NOW - 10 }] }, NOW), false);
  assert.equal(classifyAlert({ effect: 3 }), LINE_STATUS.DISRUPTED);
  assert.equal(classifyAlert({ effect: 7, severity: 4 }), LINE_STATUS.DISRUPTED);
  assert.equal(classifyAlert({ effect: 7 }), LINE_STATUS.NOTICE);
});

test('the status is read from the alerts feed with the key', async () => {
  const calls = stubFetch({ [ALERTS]: alertsFeed([lineAlert('canada')]) });
  const status = await fetchLineStatus(normalizeConfig({ api_key: 'k3y' }), { now: NOW_MS });
  assert.equal(statuses(status).canada, LINE_STATUS.DISRUPTED);
  assert.equal(new URL(calls[0].url).searchParams.get('apikey'), 'k3y');
});
