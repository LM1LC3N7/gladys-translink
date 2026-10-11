// -----------------------------------------------------------------------------
// Configuration: defaults, type coercion, watch-list mini-syntax.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_CONFIG,
  departuresSource,
  linesEnabled,
  estimatedDailyRequests,
  gladysPollFrequency,
  hasApiKey,
  normalizeConfig,
  parseSimpleEntry,
  parseStopEntry,
  stopPlatformId,
} from '../src/config.js';

test('an empty configuration gets the defaults and watches the lines only', () => {
  const config = normalizeConfig();
  assert.equal(config.departures_poll_frequency, DEFAULT_CONFIG.departures_poll_frequency);
  assert.equal(config.language, 'en');
  assert.deepEqual(config.watched, { stops: [], bikeStations: [], lines: true });
  assert.equal(hasApiKey(config), false);
  // Without a key: Transitous for the departures, and no line status (the
  // alerts need the key).
  assert.equal(departuresSource(config), 'schedule');
  assert.equal(linesEnabled(config), false);
  assert.equal(config.nearby_stops, 3);
  assert.equal(config.nearby_bike_stations, 2);
});

test('the stop syntax: code, route filter, custom name', () => {
  assert.deepEqual(parseStopEntry('50040'), { id: '50040', routes: [], name: null });
  assert.deepEqual(parseStopEntry(' 50040 @ 099 | r4 : Bus to work '), {
    id: '50040',
    // "099" is the 99: the leading zeros TransLink publishes are dropped.
    routes: ['99', 'R4'],
    name: 'Bus to work',
  });
  // The name may hold an '@': the name is cut first.
  assert.deepEqual(parseStopEntry('50040:Me@home'), {
    id: '50040',
    routes: [],
    name: 'Me@home',
  });
  assert.equal(parseStopEntry('@24'), null);
  assert.deepEqual(parseSimpleEntry('0201:Home'), { id: '0201', name: 'Home' });
  assert.equal(parseSimpleEntry(' :x'), null);
});

test('lists accept commas, semicolons and new lines, and drop duplicates', () => {
  const config = normalizeConfig({
    stops: '50040;61925@99\n50040, 61925@14',
    bike_stations: '0201, 0201:Again, 0021',
  });
  assert.deepEqual(config.watched.stops.map(stopPlatformId), ['50040', '61925@99', '61925@14']);
  assert.deepEqual(
    config.watched.bikeStations.map((station) => station.id),
    ['0201', '0021'],
  );
});

test('numbers, booleans and the language are coerced and bounded', () => {
  const config = normalizeConfig({
    departures_poll_frequency: '5',
    lines_poll_frequency: 'abc',
    bike_poll_frequency: 99999,
    max_departures: '9',
    watch_lines: 'false',
    language: 'de',
    api_key: '  key  ',
  });
  assert.equal(config.departures_poll_frequency, 30);
  assert.equal(config.lines_poll_frequency, DEFAULT_CONFIG.lines_poll_frequency);
  assert.equal(config.bike_poll_frequency, 3600);
  assert.equal(config.max_departures, 5);
  assert.equal(config.watched.lines, false);
  assert.equal(config.language, 'en');
  assert.equal(config.api_key, 'key');
});

test('poll frequencies map onto the values the Gladys scheduler accepts', () => {
  assert.equal(gladysPollFrequency(30), 30_000);
  assert.equal(gladysPollFrequency(60), 60_000);
  assert.equal(gladysPollFrequency(300), 60_000);
});

test('the daily request estimate counts one feed read per interval', () => {
  assert.equal(
    estimatedDailyRequests(normalizeConfig({ api_key: 'k', stops: '1, 2, 3' })),
    1440 + 720,
  );
  assert.equal(estimatedDailyRequests(normalizeConfig({ api_key: 'k', watch_lines: false })), 0);
  // The suggested and created stops count too: one feed read serves them all.
  assert.equal(
    estimatedDailyRequests(normalizeConfig({ api_key: 'k', watch_lines: false }), { stops: 4 }),
    1440,
  );
  // Without a key, nothing is read from the operator.
  assert.equal(estimatedDailyRequests(normalizeConfig({ stops: '1' })), 0);
});

test('the departures source: real time with a key, Transitous without, nothing when off', () => {
  assert.equal(departuresSource(normalizeConfig({ api_key: 'k' })), 'realtime');
  assert.equal(departuresSource(normalizeConfig({ schedule_without_key: false })), 'none');
  assert.equal(linesEnabled(normalizeConfig({ api_key: 'k' })), true);
});

test('the suggestion counts are bounded, 0 turning them off', () => {
  const config = normalizeConfig({ nearby_stops: '0', nearby_bike_stations: 99 });
  assert.equal(config.nearby_stops, 0);
  assert.equal(config.nearby_bike_stations, 8);
  assert.equal(normalizeConfig({ nearby_stops: 'x' }).nearby_stops, 3);
});
