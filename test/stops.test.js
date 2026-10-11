// -----------------------------------------------------------------------------
// The stop table (gtfs/) and the script that generates it.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import {
  fold,
  normalizeRoute,
  routeLabel,
  searchStops,
  stopByCode,
  stopsNear,
} from '../src/api/stops.js';
import {
  buildStops,
  parseCsv,
  routeLabel as gtfsRouteLabel,
  zipEntries,
} from '../scripts/update-stops.mjs';

test('a stop code gives its name, its position and its GTFS stop_ids', () => {
  const bay = stopByCode('50040');
  assert.equal(bay.name, 'Waterfront Station @ Bay 2');
  assert.deepEqual(bay.ids, ['40']);
  // A station stands for its platforms, and Transitous is asked for it.
  const station = stopByCode('61925');
  assert.ok(station.ids.includes('12034'));
  assert.ok(station.ids.includes('8039'));
  assert.deepEqual(station.query, ['12034']);
  assert.equal(stopByCode('00000'), null);
});

test('route ids become the labels riders use', () => {
  assert.equal(routeLabel('6637'), '50');
  assert.equal(routeLabel('13686'), 'Canada Line');
  assert.equal(routeLabel('nope'), null);
  assert.equal(normalizeRoute(' 099 '), '99');
  assert.equal(normalizeRoute('0'), '0');
  assert.equal(normalizeRoute('r4'), 'R4');
});

test('the stops near a point come closest first, within the radius', () => {
  const near = stopsNear({ lat: 49.2856, lon: -123.1115 }, 100);
  assert.ok(near.length > 0);
  assert.ok(near.every((stop) => stop.distance <= 100));
  assert.deepEqual(
    near.map((stop) => stop.distance),
    [...near.map((stop) => stop.distance)].sort((a, b) => a - b),
  );
  assert.ok(near.some((stop) => stop.code === '50040'));
});

test('the search matches every word of the query, or the code itself', () => {
  assert.deepEqual(
    searchStops('waterfront bay 2').map((stop) => stop.code),
    ['50040'],
  );
  assert.equal(searchStops('50040')[0].code, '50040');
  assert.deepEqual(searchStops('   '), []);
  // The stop named exactly so comes first: the station, not a street corner.
  assert.equal(searchStops('waterfront station')[0].code, '61925');
  assert.equal(fold('Côte-des-Neiges'), 'cote des neiges');
});

test('the CSV parser handles quotes, commas in fields and a byte order mark', () => {
  const rows = parseCsv('﻿stop_id,stop_name\r\n1,"Main St, ""North"""\n2,Plain\n');
  assert.deepEqual(rows, [
    { stop_id: '1', stop_name: 'Main St, "North"' },
    { stop_id: '2', stop_name: 'Plain' },
  ]);
});

test('the stop table groups the platforms of a station under its code', () => {
  const rows = parseCsv(
    [
      'stop_id,stop_code,stop_name,stop_lat,stop_lon,location_type,parent_station',
      'S,3009,RIDEAU,45.4262,-75.6917,1,',
      'A,3009,RIDEAU A,45.4261,-75.6916,0,S',
      'B,3009,RIDEAU B,45.4263,-75.6918,0,S',
      'E,,RIDEAU ENTRANCE,45.4263,-75.6918,2,S',
      'X,0513,WOODROFFE / STRANDHERD,45.27,-75.75,0,',
      'Y,0513,STRANDHERD / WOODROFFE,45.27,-75.75,0,',
      'Z,,NO CODE,45,-75,0,',
    ].join('\n'),
  );
  const stops = buildStops(rows, (row) => row.stop_name);
  assert.deepEqual(stops, [
    ['0513', 'WOODROFFE / STRANDHERD', 45.27, -75.75, ['X', 'Y'], ['X', 'Y']],
    ['3009', 'RIDEAU', 45.4262, -75.6917, ['S', 'A', 'B'], ['S']],
  ]);
  assert.equal(gtfsRouteLabel({ route_id: '1', route_short_name: '099' }), '99');
  assert.equal(
    gtfsRouteLabel({ route_id: '2', route_short_name: '', route_long_name: 'Expo Line' }),
    'Expo Line',
  );
});

test('the ZIP reader finds a deflated file in an archive', () => {
  const name = Buffer.from('stops.txt');
  const content = Buffer.from('stop_id\n1\n');
  const data = deflateRawSync(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  const zip = Buffer.concat([local, name, data, central, name, end]);
  const entries = zipEntries(zip);
  assert.equal(entries.get('stops.txt')().toString(), 'stop_id\n1\n');
  assert.throws(() => zipEntries(Buffer.alloc(40)), /Not a ZIP/);
});
